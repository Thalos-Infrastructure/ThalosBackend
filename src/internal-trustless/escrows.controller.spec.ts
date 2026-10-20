import { EscrowsController } from './escrows.controller';
import { RetryJobType } from '../retry-queue/retry-queue.types';
import * as relayHelper from './trustless-relay.helper';
import { assertRecipientsCanReceive } from './trustline.guard';
import { readEscrow, type EscrowSnapshot } from './escrow-read.helper';
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
// Only the network read is mocked: `assertResolvable` and `resolutionTotal`
// are pure, and stubbing them would stop these tests proving the refusals.
jest.mock('./escrow-read.helper', () => ({
  ...jest.requireActual<object>('./escrow-read.helper'),
  readEscrow: jest.fn(),
}));
jest.mock('./trustless-relay.helper');

const mockedRelay = relayHelper.relayToTrustless as jest.Mock;
const mockedReadEscrow = readEscrow as jest.Mock;

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
  const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

  /**
   * A funded, disputed escrow. `amount` and `balance` differ on purpose: a
   * resolution splits what the contract holds, not what was agreed.
   */
  const escrow = (overrides: Partial<EscrowSnapshot> = {}): EscrowSnapshot => ({
    contractId: 'C1',
    type: 'single-release',
    amount: 100,
    balance: 15,
    roles: { approver: PAYER, serviceProvider: PAYEE, disputeResolver: RESOLVER },
    flags: { disputed: true, released: false, resolved: false },
    milestones: [{ description: 'Full delivery', status: 'completed' }],
    trustline: { address: ISSUER, symbol: 'USDC' },
    ...overrides,
  });

  const halfAndHalf = (): ResolveDisputeDto => ({
    contractId: 'C1',
    type: 'single-release',
    disputeResolver: RESOLVER,
    allocations: [
      { address: PAYER, percentage: 50 },
      { address: PAYEE, percentage: 50 },
    ],
  });

  beforeEach(() => {
    mockedRelay.mockReset();
    (assertRecipientsCanReceive as jest.Mock).mockReset().mockResolvedValue(undefined);
    mockedReadEscrow.mockReset().mockResolvedValue(escrow());
  });

  it('turns the resolver percentages into amounts, and splits the balance', async () => {
    // 50/50 of the 15 held — not of the 100 agreed. The UI only ever sends
    // percentages; what they are percentages of is the server's to know.
    mockedRelay.mockReturnValueOnce(twResponse(200, { unsignedTransaction: 'xdr' }));
    const { controller, enqueue } = buildController();

    const result = await controller.resolveDispute(halfAndHalf());

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

  it('sends no zero-value transfer when one side gets nothing', async () => {
    mockedRelay.mockReturnValueOnce(twResponse(200, {}));
    const { controller } = buildController();

    await controller.resolveDispute({
      ...halfAndHalf(),
      allocations: [
        { address: PAYER, percentage: 0 },
        { address: PAYEE, percentage: 100 },
      ],
    });

    expect(mockedRelay).toHaveBeenCalledWith(
      'POST',
      expect.any(String),
      undefined,
      expect.objectContaining({ distributions: [{ address: PAYEE, amount: 15 }] }),
    );
  });

  it('resolves a multi-release escrow against the milestone amount, not the balance', async () => {
    // Splitting the balance there would hand out the funds reserved for every
    // other milestone.
    mockedReadEscrow.mockResolvedValue(
      escrow({
        type: 'multi-release',
        balance: 15,
        milestones: [{ amount: 10 }, { amount: 5 }],
      }),
    );
    mockedRelay.mockReturnValueOnce(twResponse(200, {}));
    const { controller } = buildController();

    await controller.resolveDispute({
      ...halfAndHalf(),
      type: 'multi-release',
      milestoneIndex: '1',
    });

    expect(mockedRelay).toHaveBeenCalledWith(
      'POST',
      'escrow/multi-release/resolve-milestone-dispute',
      undefined,
      expect.objectContaining({
        milestoneIndex: '1',
        distributions: [
          { address: PAYER, amount: 2.5 },
          { address: PAYEE, amount: 2.5 },
        ],
      }),
    );
  });

  it("checks the recipients against the escrow's own asset, before building anything", async () => {
    mockedRelay.mockReturnValueOnce(twResponse(200, {}));
    const { controller } = buildController();

    await controller.resolveDispute(halfAndHalf());

    expect(assertRecipientsCanReceive).toHaveBeenCalledWith([PAYER, PAYEE], {
      address: ISSUER,
      symbol: 'USDC',
    });
  });

  it('builds no XDR when a recipient cannot receive', async () => {
    (assertRecipientsCanReceive as jest.Mock).mockRejectedValueOnce(new Error('TRUSTLINE_MISSING'));
    const { controller, enqueue } = buildController();

    await expect(controller.resolveDispute(halfAndHalf())).rejects.toThrow('TRUSTLINE_MISSING');

    expect(mockedRelay).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues a PAYMENT_EXECUTION backstop on a TW 5xx and rethrows', async () => {
    mockedRelay.mockReturnValueOnce(twResponse(503, { message: 'upstream down' }));
    const { controller, enqueue } = buildController();

    await expect(controller.resolveDispute(halfAndHalf())).rejects.toThrow();

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

    await expect(controller.resolveDispute(halfAndHalf())).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('keys the backstop per escrow, resolver and milestone', async () => {
    mockedReadEscrow.mockResolvedValue(
      escrow({ type: 'multi-release', milestones: [{ amount: 10 }, { amount: 5 }] }),
    );
    mockedRelay.mockReturnValue(twResponse(503, {}));
    const { controller, enqueue } = buildController();

    for (const milestoneIndex of ['0', '1']) {
      await expect(
        controller.resolveDispute({ ...halfAndHalf(), type: 'multi-release', milestoneIndex }),
      ).rejects.toThrow();
    }

    const keys = (enqueue.mock.calls as unknown[][]).map((call) => call[2] as string);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('EscrowsController — resolutions it refuses before the wallet signs', () => {
  const RESOLVER = 'GRESOLVER000000000000000000000000000000000000000000000000';
  const PAYER = 'GPAYER000000000000000000000000000000000000000000000000000';
  const PAYEE = 'GPAYEE000000000000000000000000000000000000000000000000000';

  const disputed = (overrides: Partial<EscrowSnapshot> = {}): EscrowSnapshot => ({
    contractId: 'C1',
    type: 'single-release',
    amount: 100,
    balance: 15,
    roles: { approver: PAYER, serviceProvider: PAYEE, disputeResolver: RESOLVER },
    flags: { disputed: true, released: false, resolved: false },
    milestones: [{}],
    ...overrides,
  });

  const dto = (overrides: Partial<ResolveDisputeDto> = {}): ResolveDisputeDto => ({
    contractId: 'C1',
    type: 'single-release',
    disputeResolver: RESOLVER,
    allocations: [
      { address: PAYER, percentage: 50 },
      { address: PAYEE, percentage: 50 },
    ],
    ...overrides,
  });

  beforeEach(() => {
    mockedRelay.mockReset();
    (assertRecipientsCanReceive as jest.Mock).mockReset().mockResolvedValue(undefined);
    mockedReadEscrow.mockReset().mockResolvedValue(disputed());
  });

  /** Every refusal below must leave the chain, and the quota, untouched. */
  const expectNothingSent = () => {
    expect(mockedRelay).not.toHaveBeenCalled();
    expect(assertRecipientsCanReceive).not.toHaveBeenCalled();
  };

  it('refuses percentages that do not total 100', async () => {
    const { controller } = buildController();

    await expect(
      controller.resolveDispute(
        dto({
          allocations: [
            { address: PAYER, percentage: 40 },
            { address: PAYEE, percentage: 40 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_DISTRIBUTION' } });

    expectNothingSent();
  });

  it('refuses a wallet that is not this escrow dispute resolver', async () => {
    // The chain refuses it too, but only after the signature is spent.
    const { controller } = buildController();

    await expect(
      controller.resolveDispute(dto({ disputeResolver: 'GSOMEONEELSE' })),
    ).rejects.toThrow(/not the dispute resolver/);

    expectNothingSent();
  });

  it('refuses an escrow that is not in dispute', async () => {
    mockedReadEscrow.mockResolvedValue(
      disputed({ flags: { disputed: false, released: false, resolved: false } }),
    );
    const { controller } = buildController();

    await expect(controller.resolveDispute(dto())).rejects.toThrow(/not in dispute/);
    expectNothingSent();
  });

  it('refuses a dispute already resolved on-chain', async () => {
    mockedReadEscrow.mockResolvedValue(
      disputed({ flags: { disputed: true, released: false, resolved: true } }),
    );
    const { controller } = buildController();

    await expect(controller.resolveDispute(dto())).rejects.toThrow(/already resolved/);
    expectNothingSent();
  });

  it('refuses when the escrow type does not match the request', async () => {
    mockedReadEscrow.mockResolvedValue(disputed({ type: 'multi-release' }));
    const { controller } = buildController();

    await expect(controller.resolveDispute(dto())).rejects.toThrow(/not single-release/);
    expectNothingSent();
  });

  it('refuses an empty escrow instead of sending an empty distribution', async () => {
    mockedReadEscrow.mockResolvedValue(disputed({ balance: 0 }));
    const { controller } = buildController();

    await expect(controller.resolveDispute(dto())).rejects.toThrow(/nothing to distribute/);
    expectNothingSent();
  });

  it('refuses a milestone that does not exist', async () => {
    mockedReadEscrow.mockResolvedValue(
      disputed({ type: 'multi-release', milestones: [{ amount: 10 }] }),
    );
    const { controller } = buildController();

    await expect(
      controller.resolveDispute(dto({ type: 'multi-release', milestoneIndex: '7' })),
    ).rejects.toThrow(/does not exist/);

    expectNothingSent();
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
