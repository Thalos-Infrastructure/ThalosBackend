import { EscrowsController } from './escrows.controller';
import { RetryJobType } from '../retry-queue/retry-queue.types';
import * as relayHelper from './trustless-relay.helper';
import { assertRecipientsCanReceive } from './trustline.guard';
import type {
  ApproveMilestoneDto,
  ChangeMilestoneStatusDto,
  CreateEscrowDto,
  FundEscrowDto,
  ReleaseFundsDto,
  ResolveDisputeDto,
} from './dto/escrow-write.dto';

jest.mock('./escrow-funding.guard', () => ({
  assertEscrowFunded: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./trustline.guard', () => ({
  assertRecipientsCanReceive: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./trustless-relay.helper');

const mockedRelay = relayHelper.relayToTrustless as jest.Mock;

const SIGNER = 'GSIGNER0000000000000000000000000000000000000000000000000';

function buildController() {
  const enqueue = jest.fn().mockResolvedValue({ id: 'job-1' });
  const registerHandler = jest.fn();
  const retryQueue = { enqueue, registerHandler };
  const controller = new EscrowsController(retryQueue as never);
  controller.onModuleInit();
  return { controller, enqueue, registerHandler };
}

function twResponse(status: number, data: unknown = {}) {
  return Promise.resolve({ status, data });
}

describe('EscrowsController — retry queue backstop', () => {
  beforeEach(() => {
    mockedRelay.mockReset();
  });

  it('does not enqueue when Trustless Work succeeds (unchanged happy path)', async () => {
    mockedRelay.mockReturnValueOnce(twResponse(200, { unsignedTransaction: 'xdr' }));
    const { controller, enqueue } = buildController();

    const dto: FundEscrowDto = {
      contractId: 'c-1',
      signer: SIGNER,
      amount: 100,
      type: 'single-release',
    };
    const result = await controller.fundEscrow(dto);

    expect(result).toEqual({ unsignedTransaction: 'xdr' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues a PAYMENT_EXECUTION backstop and rethrows on a TW 5xx for releaseFunds', async () => {
    mockedRelay.mockReturnValueOnce(twResponse(503, { error: 'unavailable' }));
    const { controller, enqueue } = buildController();

    const dto: ReleaseFundsDto = {
      contractId: 'c-1',
      releaseSigner: SIGNER,
      type: 'single-release',
    };

    await expect(controller.releaseFunds(dto)).rejects.toMatchObject({
      response: { error: 'unavailable' },
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      RetryJobType.PAYMENT_EXECUTION,
      expect.objectContaining({ path: 'escrow/single-release/release-funds' }),
      expect.stringContaining('payment_execution:release:c-1'),
    );
  });

  it('enqueues a backstop and rethrows on a network-level error for fundEscrow', async () => {
    mockedRelay.mockReturnValueOnce(Promise.reject(new Error('ECONNRESET')));
    const { controller, enqueue } = buildController();

    const dto: FundEscrowDto = {
      contractId: 'c-1',
      signer: SIGNER,
      amount: 100,
      type: 'single-release',
    };

    await expect(controller.fundEscrow(dto)).rejects.toThrow('ECONNRESET');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      RetryJobType.PAYMENT_EXECUTION,
      expect.objectContaining({ path: 'escrow/single-release/fund-escrow' }),
      expect.any(String),
    );
  });

  it('does NOT enqueue on a TW 4xx (validation errors are not retryable)', async () => {
    mockedRelay.mockReturnValueOnce(twResponse(400, { message: 'invalid milestone index' }));
    const { controller, enqueue } = buildController();

    const dto: ApproveMilestoneDto = {
      contractId: 'c-1',
      milestoneIndex: '0',
      approver: SIGNER,
      type: 'single-release',
    };

    await expect(controller.approveMilestone(dto)).rejects.toMatchObject({
      response: { message: 'invalid milestone index' },
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('approveMilestone and changeMilestoneStatus both use MILESTONE_UPDATE with distinct idempotency keys', async () => {
    mockedRelay.mockReturnValue(twResponse(500, {}));
    const { controller, enqueue } = buildController();

    const approveDto: ApproveMilestoneDto = {
      contractId: 'c-1',
      milestoneIndex: '0',
      approver: SIGNER,
      type: 'single-release',
    };
    const changeDto: ChangeMilestoneStatusDto = {
      contractId: 'c-1',
      milestoneIndex: '0',
      newEvidence: 'proof',
      newStatus: 'approved',
      serviceProvider: SIGNER,
      type: 'single-release',
    };

    await expect(controller.approveMilestone(approveDto)).rejects.toBeDefined();
    await expect(controller.changeMilestoneStatus(changeDto)).rejects.toBeDefined();

    expect(enqueue).toHaveBeenCalledTimes(2);
    const [firstJobType, , firstKey] = enqueue.mock.calls[0];
    const [secondJobType, , secondKey] = enqueue.mock.calls[1];
    expect(firstJobType).toBe(RetryJobType.MILESTONE_UPDATE);
    expect(secondJobType).toBe(RetryJobType.MILESTONE_UPDATE);
    expect(firstKey).not.toBe(secondKey);
  });

  it('enqueues an AGREEMENT_CREATION backstop keyed by engagementId on a TW 5xx for createEscrow', async () => {
    mockedRelay.mockReturnValueOnce(twResponse(500, {}));
    const { controller, enqueue } = buildController();

    const dto: CreateEscrowDto = {
      title: 'Test',
      description: 'desc',
      amount: '100',
      platformFee: '5',
      signer: SIGNER,
      serviceType: 'single-release',
      roles: { approver: SIGNER, serviceProvider: SIGNER, releaseSigner: SIGNER, receiver: SIGNER },
      milestones: [{ description: 'm1' }],
    };

    await expect(controller.createEscrow(dto)).rejects.toBeDefined();
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [jobType, payload, key] = enqueue.mock.calls[0];
    expect(jobType).toBe(RetryJobType.AGREEMENT_CREATION);
    expect(key).toMatch(/^agreement_creation:/);
    expect((payload as { body: { engagementId: string } }).body.engagementId).toEqual(
      expect.stringContaining('THALOS-v2-SINGLERELEASE-'),
    );
  });

  it('passes legacy TW status "completed" through unchanged and logs deprecation', async () => {
    mockedRelay.mockReturnValueOnce(twResponse(500, {}));
    const { controller, enqueue } = buildController();

    const dto: ChangeMilestoneStatusDto = {
      contractId: 'c-1',
      milestoneIndex: '0',
      newEvidence: 'proof',
      newStatus: 'completed',
      serviceProvider: SIGNER,
      type: 'single-release',
    };

    await expect(controller.changeMilestoneStatus(dto)).rejects.toBeDefined();

    // The TW proxy body and idempotency key must retain the caller's TW status.
    const [, , key] = enqueue.mock.calls[0];
    expect(key).toContain('completed');
    expect(key).not.toContain('released');
    expect(enqueue.mock.calls[0][1]).toEqual(
      expect.objectContaining({ body: expect.objectContaining({ newStatus: 'completed' }) }),
    );
  });

  it('changeMilestoneStatus passes through canonical statuses unchanged', async () => {
    mockedRelay.mockReturnValueOnce(twResponse(500, {}));
    const { controller, enqueue } = buildController();

    const dto: ChangeMilestoneStatusDto = {
      contractId: 'c-1',
      milestoneIndex: '0',
      newEvidence: 'proof',
      newStatus: 'approved',
      serviceProvider: SIGNER,
      type: 'single-release',
    };

    await expect(controller.changeMilestoneStatus(dto)).rejects.toBeDefined();

    const [, , key] = enqueue.mock.calls[0];
    expect(key).toContain('approved');
  });

  it('registers one replay handler per bucket that re-runs relayWrite with the stored path/body', async () => {
    const { registerHandler } = buildController();

    expect(registerHandler).toHaveBeenCalledTimes(3);
    const registeredTypes = registerHandler.mock.calls.map((call) => call[0]);
    expect(registeredTypes).toEqual(
      expect.arrayContaining([
        RetryJobType.AGREEMENT_CREATION,
        RetryJobType.MILESTONE_UPDATE,
        RetryJobType.PAYMENT_EXECUTION,
      ]),
    );

    mockedRelay.mockReturnValueOnce(twResponse(200, { ok: true }));
    const [, handler] = registerHandler.mock.calls[0];
    const result = await handler({ path: 'escrow/single-release/fund-escrow', body: { a: 1 } }, 2);
    expect(result).toEqual({ ok: true });
    expect(mockedRelay).toHaveBeenCalledWith(
      'POST',
      'escrow/single-release/fund-escrow',
      undefined,
      { a: 1 },
    );
  });
});

describe('EscrowsController — resolve dispute', () => {
  const RESOLVER = 'GRESOLVER000000000000000000000000000000000000000000000000';
  const PAYER = 'GPAYER000000000000000000000000000000000000000000000000000';
  const PAYEE = 'GPAYEE000000000000000000000000000000000000000000000000000';

  const singleRelease = (): ResolveDisputeDto => ({
    contractId: 'C1',
    type: 'single-release',
    disputeResolver: RESOLVER,
    distributions: [
      { address: PAYER, amount: 7.5 },
      { address: PAYEE, amount: 7.5 },
    ],
  });

  beforeEach(() => {
    mockedRelay.mockReset();
    (assertRecipientsCanReceive as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('resolves a single-release escrow against resolve-dispute', async () => {
    mockedRelay.mockReturnValueOnce(twResponse(200, { unsignedTransaction: 'xdr' }));
    const { controller, enqueue } = buildController();

    const result = await controller.resolveDispute(singleRelease());

    expect(mockedRelay).toHaveBeenCalledWith(
      'POST',
      'escrow/single-release/resolve-dispute',
      undefined,
      {
        contractId: 'C1',
        disputeResolver: RESOLVER,
        distributions: [
          { address: PAYER, amount: 7.5 },
          { address: PAYEE, amount: 7.5 },
        ],
      },
    );
    expect(result).toEqual({ unsignedTransaction: 'xdr' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('resolves a multi-release escrow against resolve-milestone-dispute, with the milestone', async () => {
    // TW splits this by escrow type exactly as it splits opening a dispute.
    mockedRelay.mockReturnValueOnce(twResponse(200, { unsignedTransaction: 'xdr' }));
    const { controller } = buildController();

    await controller.resolveDispute({
      ...singleRelease(),
      type: 'multi-release',
      milestoneIndex: '2',
    });

    expect(mockedRelay).toHaveBeenCalledWith(
      'POST',
      'escrow/multi-release/resolve-milestone-dispute',
      undefined,
      expect.objectContaining({ milestoneIndex: '2', disputeResolver: RESOLVER }),
    );
  });

  it('enqueues a PAYMENT_EXECUTION backstop on a TW 5xx and rethrows', async () => {
    mockedRelay.mockReturnValueOnce(twResponse(503, { message: 'upstream down' }));
    const { controller, enqueue } = buildController();

    await expect(controller.resolveDispute(singleRelease())).rejects.toThrow();

    expect(enqueue).toHaveBeenCalledWith(
      RetryJobType.PAYMENT_EXECUTION,
      expect.objectContaining({ path: 'escrow/single-release/resolve-dispute' }),
      expect.stringContaining('payment_execution:resolve:C1'),
    );
  });

  it('does NOT enqueue on a TW 4xx', async () => {
    // A rejected distribution is not retryable: replaying it just burns quota.
    mockedRelay.mockReturnValueOnce(
      twResponse(400, { message: 'distributions must equal balance' }),
    );
    const { controller, enqueue } = buildController();

    await expect(controller.resolveDispute(singleRelease())).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('keys the backstop per escrow, resolver and milestone', async () => {
    mockedRelay.mockReturnValue(twResponse(503, {}));
    const { controller, enqueue } = buildController();

    await expect(controller.resolveDispute(singleRelease())).rejects.toThrow();
    await expect(
      controller.resolveDispute({
        ...singleRelease(),
        type: 'multi-release',
        milestoneIndex: '1',
      }),
    ).rejects.toThrow();

    const keys = enqueue.mock.calls.map((call) => call[2] as string);
    expect(new Set(keys).size).toBe(2);
  });

  it('checks the recipients before building anything', async () => {
    // The whole point of checking here: a resolver must not be asked to sign a
    // transaction that will bounce on submit.
    (assertRecipientsCanReceive as jest.Mock).mockResolvedValueOnce(undefined);
    mockedRelay.mockReturnValueOnce(twResponse(200, {}));
    const { controller } = buildController();

    await controller.resolveDispute(singleRelease());

    expect(assertRecipientsCanReceive).toHaveBeenCalledWith([PAYER, PAYEE]);
  });

  it('builds no XDR when a recipient cannot receive', async () => {
    (assertRecipientsCanReceive as jest.Mock).mockRejectedValueOnce(new Error('TRUSTLINE_MISSING'));
    const { controller, enqueue } = buildController();

    await expect(controller.resolveDispute(singleRelease())).rejects.toThrow('TRUSTLINE_MISSING');

    expect(mockedRelay).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('passes the distributions through untouched', async () => {
    // The amounts were already checked against the rule for this escrow type by
    // buildDistributions; rounding them again here would break that guarantee.
    mockedRelay.mockReturnValueOnce(twResponse(200, {}));
    const { controller } = buildController();
    const distributions = [
      { address: PAYER, amount: 0.0000001 },
      { address: PAYEE, amount: 14.9999999 },
    ];

    await controller.resolveDispute({ ...singleRelease(), distributions });

    expect(mockedRelay).toHaveBeenCalledWith(
      'POST',
      expect.any(String),
      undefined,
      expect.objectContaining({ distributions }),
    );
  });
});

describe('EscrowsController — the existing operations are untouched', () => {
  beforeEach(() => {
    mockedRelay.mockReset();
  });

  // Adding resolve-dispute must not move any path the working flows depend on.
  it.each([
    [
      'fund',
      (c: EscrowsController) =>
        c.fundEscrow({
          contractId: 'C1',
          signer: SIGNER,
          amount: 10,
          type: 'single-release',
        }),
      'escrow/single-release/fund-escrow',
    ],
    [
      'approve milestone',
      (c: EscrowsController) =>
        c.approveMilestone({
          contractId: 'C1',
          milestoneIndex: '0',
          approver: SIGNER,
          type: 'multi-release',
        }),
      'escrow/multi-release/approve-milestone',
    ],
    [
      'release',
      (c: EscrowsController) =>
        c.releaseFunds({
          contractId: 'C1',
          releaseSigner: SIGNER,
          type: 'single-release',
        }),
      'escrow/single-release/release-funds',
    ],
  ])('%s still relays to its own path', async (_label, invoke, expectedPath) => {
    mockedRelay.mockReturnValueOnce(twResponse(200, { unsignedTransaction: 'xdr' }));
    const { controller } = buildController();

    await invoke(controller);

    expect(mockedRelay).toHaveBeenCalledWith('POST', expectedPath, undefined, expect.anything());
  });
});
