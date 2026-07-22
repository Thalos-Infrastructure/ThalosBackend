import { EscrowsController } from './escrows.controller';
import { RetryJobType } from '../retry-queue/retry-queue.types';
import * as relayHelper from './trustless-relay.helper';
import type {
  ApproveMilestoneDto,
  ChangeMilestoneStatusDto,
  CreateEscrowDto,
  FundEscrowDto,
  ReleaseFundsDto,
} from './dto/escrow-write.dto';

jest.mock('./trustless-relay.helper');

const mockedRelay = relayHelper.relayToTrustless as jest.Mock;

const SIGNER = 'GSIGNER0000000000000000000000000000000000000000000000000';
const USER_ID = 'user-1';

function supabaseStub() {
  const chain: Record<string, jest.Mock> = {};
  ['from', 'select', 'eq'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain.maybeSingle = jest.fn().mockResolvedValue({
    data: { wallet_public_key: SIGNER },
    error: null,
  });
  return { getClient: () => chain };
}

function buildController() {
  const enqueue = jest.fn().mockResolvedValue({ id: 'job-1' });
  const registerHandler = jest.fn();
  const retryQueue = { enqueue, registerHandler };
  const controller = new EscrowsController(supabaseStub() as never, retryQueue as never);
  controller.onModuleInit();
  return { controller, enqueue, registerHandler };
}

function twResponse(status: number, data: unknown = {}) {
  return Promise.resolve({ status, data });
}

const user = { userId: USER_ID } as never;

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
    const result = await controller.fundEscrow(user, dto);

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

    await expect(controller.releaseFunds(user, dto)).rejects.toMatchObject({
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

    await expect(controller.fundEscrow(user, dto)).rejects.toThrow('ECONNRESET');
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

    await expect(controller.approveMilestone(user, dto)).rejects.toMatchObject({
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

    await expect(controller.approveMilestone(user, approveDto)).rejects.toBeDefined();
    await expect(controller.changeMilestoneStatus(user, changeDto)).rejects.toBeDefined();

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

    await expect(controller.createEscrow(user, dto)).rejects.toBeDefined();
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [jobType, payload, key] = enqueue.mock.calls[0];
    expect(jobType).toBe(RetryJobType.AGREEMENT_CREATION);
    expect(key).toMatch(/^agreement_creation:/);
    expect((payload as { body: { engagementId: string } }).body.engagementId).toEqual(
      expect.stringContaining('THALOS-v2-SINGLERELEASE-'),
    );
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
