import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AgreementSyncService } from './agreement-sync.service';
import { AgreementValidationService } from '../validation/agreement-validation.service';
import { RetryQueueService } from '../../common/retry/retry-queue.service';
import { SupabaseService } from '../../supabase/supabase.service';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockEventEmitter = { emit: jest.fn() };

const mockValidation = { validateTransition: jest.fn() };

const mockRetryQueue = {
  registerHandler: jest.fn(),
  enqueue: jest.fn(() => 'mock-job-id'),
  hasJob: jest.fn(),
  getJob: jest.fn(),
  retryJob: jest.fn(),
  listJobs: jest.fn(() => []),
  clearCompleted: jest.fn(),
};

// Mock the relay helper
jest.mock('../../internal-trustless/trustless-relay.helper', () => ({
  relayToTrustless: jest.fn(),
}));
const { relayToTrustless } = jest.requireMock('../../internal-trustless/trustless-relay.helper');

// Factory: create a Supabase mock chain that returns the given agreement
function makeSupabaseMock(agreement: unknown) {
  // The `select().eq().single()` chain
  const singleFn = jest.fn().mockResolvedValue({ data: agreement, error: null });
  const eqAfterSelect = jest.fn().mockReturnValue({ single: singleFn, maybeSingle: singleFn });
  const selectFn = jest.fn().mockReturnValue({ eq: eqAfterSelect });
  const insertFn = jest.fn().mockResolvedValue({ error: null });
  const updateEqFn = jest.fn().mockResolvedValue({ error: null });
  const updateFn = jest.fn().mockReturnValue({ eq: updateEqFn });
  const fromFn = jest.fn().mockReturnValue({
    select: selectFn,
    insert: insertFn,
    update: updateFn,
  });
  return {
    from: fromFn,
    _singleFn: singleFn,
    _updateEqFn: updateEqFn,
  };
}

// ── Test data ─────────────────────────────────────────────────────────────

const MOCK_AGREEMENT = {
  id: 'test-agreement-001',
  contract_id: null,
  status: 'pending',
  title: 'Test Agreement',
  description: 'A test',
  amount: '100',
  asset: 'USDC',
  created_by: 'GASENDER123',
  milestones: [
    { description: 'M1', amount: '50', status: 'pending' },
    { description: 'M2', amount: '50', status: 'pending' },
  ],
};

const MOCK_ESCROW = {
  id: 'contract-001',
  status: 'active',
  sender: 'GASENDER123',
  receiver: 'GARECEIVER456',
  amount: '100',
  asset: 'USDC',
  type: 'single-release' as const,
  milestones: [
    { description: 'M1', amount: '50', status: 'approved' },
    { description: 'M2', amount: '50', status: 'pending' },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('AgreementSyncService', () => {
  let service: AgreementSyncService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const { from } = makeSupabaseMock(MOCK_AGREEMENT);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgreementSyncService,
        { provide: SupabaseService, useValue: { getClient: () => ({ from }) } as any },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: AgreementValidationService, useValue: mockValidation },
        { provide: RetryQueueService, useValue: mockRetryQueue },
      ],
    }).compile();

    service = module.get<AgreementSyncService>(AgreementSyncService);
  });

  // ── validateContractOnTrustless ─────────────────────────────────────────

  describe('validateContractOnTrustless', () => {
    it('should return valid when TW returns an escrow', async () => {
      relayToTrustless.mockResolvedValue({ status: 200, data: MOCK_ESCROW });
      const result = await service.validateContractOnTrustless('contract-001');
      expect(result.valid).toBe(true);
      expect(result.escrow).toBeDefined();
      expect(result.escrow!.id).toBe('contract-001');
    });

    it('should return invalid when TW returns empty', async () => {
      relayToTrustless.mockResolvedValue({ status: 404, data: null });
      const result = await service.validateContractOnTrustless('bad-id');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return invalid on relay error', async () => {
      relayToTrustless.mockRejectedValue(new Error('Network error'));
      const result = await service.validateContractOnTrustless('fail');
      expect(result.valid).toBe(false);
      // fetchTrustlessEscrow catches the error and returns null,
      // so validateContractOnTrustless reports "not found"
      expect(result.error).toContain('not found');
    });
  });

  // ── syncAgreement ──────────────────────────────────────────────────────

  describe('syncAgreement', () => {
    it('should return "already in sync" when statuses match', async () => {
      relayToTrustless.mockResolvedValue({ status: 200, data: MOCK_ESCROW });

      const { from } = makeSupabaseMock({
        ...MOCK_AGREEMENT,
        status: 'active',
        contract_id: 'contract-001',
      });

      const svc = await makeService({ from });
      const result = await svc.syncAgreement('test-id');
      expect(result.synced).toBe(true);
      expect(result.direction).toBe('already_in_sync');
    });

    it('should pull TW status when TW is ahead (tw_to_thalos)', async () => {
      relayToTrustless.mockResolvedValue({ status: 200, data: MOCK_ESCROW });

      const { from, _updateEqFn } = makeSupabaseMock({
        ...MOCK_AGREEMENT,
        status: 'funded',
        contract_id: 'contract-001',
      });

      const svc = await makeService({ from });
      const result = await svc.syncAgreement('test-id');
      expect(result.synced).toBe(true);
      expect(result.direction).toBe('tw_to_thalos');
      expect(_updateEqFn).toHaveBeenCalledWith('id', 'test-id');
    });

    it('should handle agreement with no contract_id', async () => {
      const { from } = makeSupabaseMock(MOCK_AGREEMENT);
      const svc = await makeService({ from });
      const result = await svc.syncAgreement('test-id');
      expect(result.synced).toBe(true);
      expect(result.actions).toContain('No contract_id linked — skipping TW sync');
    });

    it('should return errors when TW fetch fails', async () => {
      relayToTrustless.mockResolvedValue({ status: 500, data: null });
      const { from } = makeSupabaseMock({
        ...MOCK_AGREEMENT,
        contract_id: 'contract-001',
      });
      const svc = await makeService({ from });
      const result = await svc.syncAgreement('test-id');
      expect(result.synced).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should enqueue via retry queue when useRetryQueue=true', async () => {
      const result = await service.syncAgreement('test-id', {
        useRetryQueue: true,
      });
      expect(mockRetryQueue.enqueue).toHaveBeenCalledWith('sync_agreement', {
        agreementId: 'test-id',
      });
      expect(result.actions).toContain('Enqueued sync job to retry queue');
    });
  });

  // ── reconcileAgreement ─────────────────────────────────────────────────

  describe('reconcileAgreement', () => {
    it('should detect and correct divergence', async () => {
      relayToTrustless.mockResolvedValue({ status: 200, data: MOCK_ESCROW });
      const { from } = makeSupabaseMock({
        ...MOCK_AGREEMENT,
        status: 'funded',
        contract_id: 'contract-001',
      });
      const svc = await makeService({ from });
      const result = await svc.reconcileAgreement('test-id');
      expect(result.reconciled).toBe(true);
      expect(result.actions.length).toBeGreaterThan(0);
    });

    it('should return reconciled=true when already in sync', async () => {
      relayToTrustless.mockResolvedValue({ status: 200, data: MOCK_ESCROW });
      const { from } = makeSupabaseMock({
        ...MOCK_AGREEMENT,
        status: 'active',
        contract_id: 'contract-001',
      });
      const svc = await makeService({ from });
      const result = await svc.reconcileAgreement('test-id');
      expect(result.reconciled).toBe(true);
    });

    it('should enqueue via retry queue when useRetryQueue=true', async () => {
      const result = await service.reconcileAgreement('test-id', {
        useRetryQueue: true,
      });
      expect(mockRetryQueue.enqueue).toHaveBeenCalledWith('reconcile_agreement', {
        agreementId: 'test-id',
      });
      expect(result.actions).toContain('Enqueued reconcile job to retry queue');
    });
  });

  // ── syncStatusTransition ────────────────────────────────────────────────

  describe('syncStatusTransition', () => {
    it('should reject invalid transitions via validation service', async () => {
      mockValidation.validateTransition.mockReturnValue({
        valid: false,
        reason: 'Invalid: "pending" → "completed"',
      });
      const result = await service.syncStatusTransition('test-id', 'pending', 'completed');
      expect(result.synced).toBe(false);
      expect(result.errors).toContain('Invalid: "pending" → "completed"');
    });

    it('should validate and log valid transitions', async () => {
      mockValidation.validateTransition.mockReturnValue({ valid: true });
      const { from } = makeSupabaseMock(MOCK_AGREEMENT);
      const svc = await makeService({ from });
      const result = await svc.syncStatusTransition('test-id', 'pending', 'funded');
      expect(result.synced).toBe(true);
      expect(result.actions).toContain('Transition "pending" → "funded" validated');
    });
  });

  // ── Handler registration ───────────────────────────────────────────────

  describe('retry queue handler registration', () => {
    it('should register sync_agreement handler', () => {
      expect(mockRetryQueue.registerHandler).toHaveBeenCalledWith(
        'sync_agreement',
        expect.any(Function),
      );
    });

    it('should register reconcile_agreement handler', () => {
      expect(mockRetryQueue.registerHandler).toHaveBeenCalledWith(
        'reconcile_agreement',
        expect.any(Function),
      );
    });
  });

  // ── Helper ──────────────────────────────────────────────────────────────

  async function makeService(supabaseOverrides: { from: any }) {
    const mod = await Test.createTestingModule({
      providers: [
        AgreementSyncService,
        {
          provide: SupabaseService,
          useValue: { getClient: () => supabaseOverrides } as any,
        },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: AgreementValidationService, useValue: mockValidation },
        { provide: RetryQueueService, useValue: mockRetryQueue },
      ],
    }).compile();
    return mod.get<AgreementSyncService>(AgreementSyncService);
  }
});
