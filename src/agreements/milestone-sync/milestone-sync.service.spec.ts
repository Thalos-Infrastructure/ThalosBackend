import {
  MilestoneSyncService,
  MilestoneSyncPayload,
  MILESTONE_SYNC_JOB_TYPE,
} from './milestone-sync.service';
import { RetryQueueService, RetryJob } from '../../common/retry/retry-queue.service';
import { TrustlessRelayError } from '../../internal-trustless/escrow-write.helper';

// ── Mock TW write helpers so tests never hit the network ──────────────────

jest.mock('../../internal-trustless/escrow-write.helper', () => ({
  approveMilestone: jest.fn(),
  changeMilestoneStatus: jest.fn(),
  TrustlessRelayError: jest.requireActual('../../internal-trustless/escrow-write.helper')
    .TrustlessRelayError,
}));

import {
  approveMilestone,
  changeMilestoneStatus,
} from '../../internal-trustless/escrow-write.helper';

const mockApproveMilestone = approveMilestone as jest.Mock;
const mockChangeMilestoneStatus = changeMilestoneStatus as jest.Mock;

// ── Factory ────────────────────────────────────────────────────────────────

function buildService() {
  const registerHandler = jest.fn();
  const enqueue = jest.fn().mockReturnValue('job-id-001');
  const retryQueue = { registerHandler, enqueue } as unknown as RetryQueueService;

  const svc = new MilestoneSyncService(retryQueue);
  return { svc, registerHandler, enqueue };
}

function makePayload(overrides: Partial<MilestoneSyncPayload> = {}): MilestoneSyncPayload {
  return {
    contractId: 'CONTRACT-001',
    agreementType: 'single',
    milestoneIndex: '0',
    action: 'approve',
    approver: 'GAPPROVER123',
    ...overrides,
  };
}

function makeRetryJob(payload: MilestoneSyncPayload): RetryJob {
  return {
    id: 'job-1',
    type: MILESTONE_SYNC_JOB_TYPE,
    payload,
    retryCount: 0,
    maxRetries: 3,
    nextRetryAt: new Date(),
    createdAt: new Date(),
    status: 'queued',
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MilestoneSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── onModuleInit ────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('registers a handler for the milestone_sync job type in the shared retry queue', () => {
      const { svc, registerHandler } = buildService();
      svc.onModuleInit();
      expect(registerHandler).toHaveBeenCalledWith(MILESTONE_SYNC_JOB_TYPE, expect.any(Function));
    });

    it('registers exactly one handler', () => {
      const { svc, registerHandler } = buildService();
      svc.onModuleInit();
      expect(registerHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ─── toTWServiceType ─────────────────────────────────────────────────────

  describe('toTWServiceType — agreement_type mapper', () => {
    it('maps "single" to "single-release"', () => {
      const { svc } = buildService();
      expect(svc.toTWServiceType('single')).toBe('single-release');
    });

    it('maps "multi" to "multi-release"', () => {
      const { svc } = buildService();
      expect(svc.toTWServiceType('multi')).toBe('multi-release');
    });

    it('falls back to "single-release" for an unknown type rather than passing garbage to TW', () => {
      const { svc } = buildService();
      // Unknown values should never reach TW with a raw slug that causes 404.
      expect(svc.toTWServiceType('unknown')).toBe('single-release');
    });
  });

  // ─── detectConflict ──────────────────────────────────────────────────────

  describe('detectConflict', () => {
    it('returns false when both statuses are the same', () => {
      const { svc } = buildService();
      expect(svc.detectConflict('approved', 'approved')).toBe(false);
    });

    it('returns false when both statuses are non-terminal (pending/pending)', () => {
      const { svc } = buildService();
      expect(svc.detectConflict('pending', 'pending')).toBe(false);
    });

    it('returns false when TW is terminal but local has not yet settled — normal apply path', () => {
      const { svc } = buildService();
      // "TW is terminal, local is not" is the standard reconcile case — reconcileAgreement
      // should apply the TW state; returning true here would incorrectly block it.
      expect(svc.detectConflict('pending', 'approved')).toBe(false);
    });

    it('returns false when TW is "released" but local is "pending" — also a normal apply path', () => {
      const { svc } = buildService();
      expect(svc.detectConflict('pending', 'released')).toBe(false);
    });

    it('returns false when local is "approved" and TW is "released" (valid forward progression)', () => {
      const { svc } = buildService();
      // approved → released is the standard completion sequence; TW being one step ahead is not a conflict.
      expect(svc.detectConflict('approved', 'released')).toBe(false);
    });

    it('returns true when both sides have reached divergent terminal states (local=released, TW=approved)', () => {
      const { svc } = buildService();
      // Local somehow advanced to released while TW only reports approved — divergent, needs review.
      expect(svc.detectConflict('released', 'approved')).toBe(true);
    });

    it('returns true when local is "cancelled" but TW is "approved" — incompatible terminal states', () => {
      const { svc } = buildService();
      expect(svc.detectConflict('cancelled', 'approved')).toBe(true);
    });

    it('returns true when local is "rejected" but TW is "approved" — incompatible terminal states', () => {
      const { svc } = buildService();
      expect(svc.detectConflict('rejected', 'approved')).toBe(true);
    });
  });

  // ─── applyTWMilestoneUpdate ──────────────────────────────────────────────

  describe('applyTWMilestoneUpdate', () => {
    it('returns "skipped" when local already matches TW (idempotent)', () => {
      const { svc } = buildService();
      expect(
        svc.applyTWMilestoneUpdate({ currentLocalStatus: 'approved', twStatus: 'approved' }),
      ).toBe('skipped');
    });

    it('returns "applied" when TW is terminal but local has not yet settled (normal reconcile path)', () => {
      const { svc } = buildService();
      // This is the most common TW→Thalos case: TW advanced to approved, local is still pending.
      // reconcileAgreement should write the TW state — not treat it as a conflict.
      expect(
        svc.applyTWMilestoneUpdate({ currentLocalStatus: 'pending', twStatus: 'approved' }),
      ).toBe('applied');
    });

    it('returns "applied" for a non-terminal TW status that differs from local', () => {
      const { svc } = buildService();
      expect(
        svc.applyTWMilestoneUpdate({ currentLocalStatus: 'pending', twStatus: 'rejected' }),
      ).toBe('applied');
    });

    it('returns "skipped" when both sides already match (idempotent re-delivery)', () => {
      const { svc } = buildService();
      expect(
        svc.applyTWMilestoneUpdate({ currentLocalStatus: 'pending', twStatus: 'pending' }),
      ).toBe('skipped');
    });

    it('returns "conflict" when both sides are at incompatible terminal states', () => {
      const { svc } = buildService();
      // local was cancelled while TW says approved — genuine divergence, needs manual review.
      expect(
        svc.applyTWMilestoneUpdate({ currentLocalStatus: 'cancelled', twStatus: 'approved' }),
      ).toBe('conflict');
    });
  });

  // ─── pushMilestoneToTW — XDR regression tests ────────────────────────────

  describe('pushMilestoneToTW — unsigned XDR vs sync success', () => {
    describe('approve action', () => {
      it('calls approveMilestone with "single-release" for a "single" agreement', async () => {
        const { svc } = buildService();
        mockApproveMilestone.mockResolvedValue({ unsignedTransaction: 'XDR_APPROVE_SINGLE' });

        await svc.pushMilestoneToTW(makePayload({ agreementType: 'single', action: 'approve' }));

        expect(mockApproveMilestone).toHaveBeenCalledWith({
          contractId: 'CONTRACT-001',
          milestoneIndex: '0',
          approver: 'GAPPROVER123',
          type: 'single-release',
        });
      });

      it('calls approveMilestone with "multi-release" for a "multi" agreement', async () => {
        const { svc } = buildService();
        mockApproveMilestone.mockResolvedValue({ unsignedTransaction: 'XDR_APPROVE_MULTI' });

        await svc.pushMilestoneToTW(makePayload({ agreementType: 'multi', action: 'approve' }));

        expect(mockApproveMilestone).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'multi-release' }),
        );
      });

      it('returns the raw { unsignedTransaction } blob — not a sync-success signal', async () => {
        const { svc } = buildService();
        mockApproveMilestone.mockResolvedValue({ unsignedTransaction: 'AAAA_XDR_BLOB' });

        const result = await svc.pushMilestoneToTW(makePayload());

        // The XDR blob is returned as-is; no extra field indicates on-chain completion.
        expect(result).toEqual({ unsignedTransaction: 'AAAA_XDR_BLOB' });
        expect(result).not.toHaveProperty('syncSucceeded');
        expect(result).not.toHaveProperty('onChainConfirmed');
      });

      it('does NOT resolve with a truthy "confirmed" flag (guards against future mis-use)', async () => {
        const { svc } = buildService();
        mockApproveMilestone.mockResolvedValue({ unsignedTransaction: 'XDR_DATA' });

        const result = await svc.pushMilestoneToTW(makePayload());

        // Any consumer of this method must not interpret the return value as
        // "milestone is now approved on-chain" — the FE must still sign and broadcast.
        expect((result as Record<string, unknown>)['confirmed']).toBeUndefined();
        expect((result as Record<string, unknown>)['milestoneStatus']).toBeUndefined();
      });
    });

    describe('change_status action', () => {
      it('calls changeMilestoneStatus with the correct serviceType', async () => {
        const { svc } = buildService();
        mockChangeMilestoneStatus.mockResolvedValue({ unsignedTransaction: 'XDR_CHANGE' });

        await svc.pushMilestoneToTW(
          makePayload({
            agreementType: 'multi',
            action: 'change_status',
            serviceProvider: 'GPROVIDER',
            newStatus: 'rejected',
            newEvidence: 'https://evidence.io/1',
          }),
        );

        expect(mockChangeMilestoneStatus).toHaveBeenCalledWith({
          contractId: 'CONTRACT-001',
          milestoneIndex: '0',
          newStatus: 'rejected',
          newEvidence: 'https://evidence.io/1',
          serviceProvider: 'GPROVIDER',
          type: 'multi-release',
        });
      });

      it('returns { unsignedTransaction } for change_status — not a completed transition', async () => {
        const { svc } = buildService();
        mockChangeMilestoneStatus.mockResolvedValue({ unsignedTransaction: 'XDR_CHANGE_BLOB' });

        const result = await svc.pushMilestoneToTW(
          makePayload({ action: 'change_status', newStatus: 'rejected', serviceProvider: 'G123' }),
        );

        expect(result).toEqual({ unsignedTransaction: 'XDR_CHANGE_BLOB' });
      });
    });
  });

  // ─── enqueueRetry ────────────────────────────────────────────────────────

  describe('enqueueRetry', () => {
    it('calls the shared retryQueue.enqueue with the milestone_sync job type', () => {
      const { svc, enqueue } = buildService();
      const payload = makePayload();

      svc.enqueueRetry(payload);

      expect(enqueue).toHaveBeenCalledWith(MILESTONE_SYNC_JOB_TYPE, payload, undefined);
    });

    it('forwards maxRetries option to the shared queue', () => {
      const { svc, enqueue } = buildService();
      svc.enqueueRetry(makePayload(), { maxRetries: 5 });
      expect(enqueue).toHaveBeenCalledWith(MILESTONE_SYNC_JOB_TYPE, expect.any(Object), {
        maxRetries: 5,
      });
    });

    it('returns the job id from the shared queue', () => {
      const { svc } = buildService();
      const jobId = svc.enqueueRetry(makePayload());
      expect(jobId).toBe('job-id-001');
    });
  });

  // ─── handleMilestoneUpdateJob (retry handler, invoked via queue) ──────────

  describe('retry handler (registered via onModuleInit)', () => {
    function getRegisteredHandler(registerHandler: jest.Mock) {
      return registerHandler.mock.calls[0][1] as (
        job: RetryJob,
      ) => Promise<{ success: boolean; error?: string }>;
    }

    it('returns { success: true } when pushMilestoneToTW resolves', async () => {
      const { svc, registerHandler } = buildService();
      mockApproveMilestone.mockResolvedValue({ unsignedTransaction: 'XDR' });
      svc.onModuleInit();

      const handler = getRegisteredHandler(registerHandler);
      const result = await handler(makeRetryJob(makePayload()));

      expect(result.success).toBe(true);
    });

    it('returns { success: true } for a 4xx TrustlessRelayError (non-retryable; stops queue backoff)', async () => {
      const { svc, registerHandler } = buildService();
      mockApproveMilestone.mockRejectedValue(new TrustlessRelayError(400, { error: 'Bad param' }));
      svc.onModuleInit();

      const handler = getRegisteredHandler(registerHandler);
      const result = await handler(makeRetryJob(makePayload()));

      // 4xx should NOT trigger retries — the handler marks the job as "success" to stop the queue.
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns { success: false } for a 5xx TrustlessRelayError so the queue retries with backoff', async () => {
      const { svc, registerHandler } = buildService();
      mockApproveMilestone.mockRejectedValue(
        new TrustlessRelayError(503, { error: 'Service unavailable' }),
      );
      svc.onModuleInit();

      const handler = getRegisteredHandler(registerHandler);
      const result = await handler(makeRetryJob(makePayload()));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns { success: false } for a generic network error so the queue retries', async () => {
      const { svc, registerHandler } = buildService();
      mockApproveMilestone.mockRejectedValue(new Error('ECONNREFUSED'));
      svc.onModuleInit();

      const handler = getRegisteredHandler(registerHandler);
      const result = await handler(makeRetryJob(makePayload()));

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('does NOT mark XDR response as sync success at the retry-handler level', async () => {
      const { svc, registerHandler } = buildService();
      // TW returns an unsigned XDR blob — this is expected; the handler should succeed
      // (job done: we pushed the request to TW) but must not claim the milestone is confirmed.
      mockApproveMilestone.mockResolvedValue({ unsignedTransaction: 'AWAITING_SIGN' });
      svc.onModuleInit();

      const handler = getRegisteredHandler(registerHandler);
      const result = await handler(makeRetryJob(makePayload()));

      // Handler succeeds from the queue's perspective (we got a TW response).
      // Actual on-chain confirmation comes through the webhook — not here.
      expect(result.success).toBe(true);
      expect(result).not.toHaveProperty('milestoneConfirmed');
    });
  });
});
