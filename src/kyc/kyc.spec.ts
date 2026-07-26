import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { KYC_PROVIDER, IIdentityProvider } from './interfaces/identity-provider.interface';
import { KycStatus } from './interfaces/kyc.types';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const WEBHOOK_SECRET = 'test-webhook-secret';

function createSessionResult(overrides = {}) {
  return {
    providerVerificationId: 'verification-id-1',
    sessionUrl: 'https://mock-kyc.provider/verify/verification-id-1',
    metadata: { created_at: new Date().toISOString() },
    ...overrides,
  };
}

function statusResult(overrides = {}) {
  return {
    status: KycStatus.Verified,
    verifiedAt: new Date().toISOString(),
    ...overrides,
  };
}

function webhookResult(overrides?: { result?: ReturnType<typeof statusResult> }) {
  return {
    providerVerificationId: 'verification-id-1',
    result: statusResult(overrides?.result),
  };
}

function buildSupabaseMock(calls: Array<unknown>) {
  let callIndex = 0;
  const getClient = jest.fn().mockImplementation(() => calls[callIndex++]);
  return { getClient };
}

function insertClient(returnData: unknown, returnError: unknown = null) {
  const chain: Record<string, jest.Mock> = {};
  ['from', 'insert', 'select'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain['single'] = jest.fn().mockResolvedValue({ data: returnData, error: returnError });
  return chain;
}

function selectClient(returnData: unknown, returnError: unknown = null) {
  const chain: Record<string, jest.Mock> = {};
  ['from', 'select', 'eq', 'order', 'limit'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain['maybeSingle'] = jest.fn().mockResolvedValue({ data: returnData, error: returnError });
  return chain;
}

function updateClient(returnData: unknown, returnError: unknown = null) {
  const chain: Record<string, jest.Mock> = {};
  ['from', 'update', 'eq', 'select'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain['single'] = jest.fn().mockResolvedValue({ data: returnData, error: returnError });
  return chain;
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

interface ServiceDeps {
  provider?: Partial<IIdentityProvider>;
  supabaseCalls?: Array<unknown>;
}

function buildService(deps: ServiceDeps = {}): KycService {
  const provider: IIdentityProvider = {
    name: 'test-provider',
    createSession: jest.fn().mockResolvedValue(createSessionResult()),
    getStatus: jest.fn().mockResolvedValue(statusResult()),
    processWebhook: jest.fn().mockResolvedValue(webhookResult()),
    ...deps.provider,
  };

  const supabase = buildSupabaseMock(deps.supabaseCalls ?? []);

  return new KycService(supabase as never, provider);
}

// ---------------------------------------------------------------------------
// KycService.createSession
// ---------------------------------------------------------------------------
describe('KycService.createSession', () => {
  it('creates a session and persists it', async () => {
    const row = {
      id: 'row-1',
      user_id: USER_ID,
      provider: 'test-provider',
      provider_verification_id: 'verification-id-1',
      status: KycStatus.Pending,
      metadata: {},
      verified_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const svc = buildService({ supabaseCalls: [insertClient(row)] });
    const result = await svc.createSession(USER_ID);

    expect(result.session).toBeDefined();
    expect(result.session.userId).toBe(USER_ID);
    expect(result.session.status).toBe(KycStatus.Pending);
    expect(result.sessionUrl).toBe('https://mock-kyc.provider/verify/verification-id-1');
  });

  it('throws when DB insert fails', async () => {
    const svc = buildService({
      supabaseCalls: [insertClient(null, { message: 'DB error' })],
    });

    await expect(svc.createSession(USER_ID)).rejects.toThrow('Failed to create KYC session');
  });
});

// ---------------------------------------------------------------------------
// KycService.getStatus
// ---------------------------------------------------------------------------
describe('KycService.getStatus', () => {
  const row = {
    id: 'row-1',
    user_id: USER_ID,
    provider: 'test-provider',
    provider_verification_id: 'verification-id-1',
    status: KycStatus.Pending,
    metadata: {},
    verified_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('returns null session when no verification exists', async () => {
    const svc = buildService({ supabaseCalls: [selectClient(null)] });
    const result = await svc.getStatus(USER_ID, USER_ID);
    expect(result).toEqual({ session: null });
  });

  it('returns session when verification exists and status matches provider', async () => {
    const svc = buildService({
      supabaseCalls: [selectClient(row)],
      provider: { getStatus: jest.fn().mockResolvedValue(statusResult({ status: KycStatus.Pending })) },
    });

    const result = await svc.getStatus(USER_ID, USER_ID);
    expect(result.session).toBeDefined();
    expect(result.session!.status).toBe(KycStatus.Pending);
  });

  it('syncs status from provider when it differs', async () => {
    const dbRow = { ...row, status: KycStatus.Pending };
    const updatedRow = { ...row, status: KycStatus.Verified, verified_at: new Date().toISOString() };

    const svc = buildService({
      supabaseCalls: [selectClient(dbRow), updateClient(updatedRow)],
      provider: { getStatus: jest.fn().mockResolvedValue(statusResult({ status: KycStatus.Verified })) },
    });

    const result = await svc.getStatus(USER_ID, USER_ID);
    expect(result.session!.status).toBe(KycStatus.Verified);
  });

  it('throws UnauthorizedException when caller does not match target user', async () => {
    const svc = buildService();
    await expect(svc.getStatus(OTHER_USER_ID, USER_ID)).rejects.toThrow(UnauthorizedException);
  });

  it('allows access when callerUserId is undefined (no auth context)', async () => {
    const svc = buildService({ supabaseCalls: [selectClient(null)] });
    await expect(svc.getStatus(USER_ID)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// KycService.handleWebhook
// ---------------------------------------------------------------------------
describe('KycService.handleWebhook', () => {
  const payload = { verification_id: 'verification-id-1', status: 'verified' };
  const row = {
    id: 'row-1',
    user_id: USER_ID,
    provider: 'test-provider',
    provider_verification_id: 'verification-id-1',
    status: KycStatus.Verified,
    metadata: {},
    verified_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('processes webhook and updates verification', async () => {
    const svc = buildService({ supabaseCalls: [updateClient(row)] });
    const result = await svc.handleWebhook(payload);
    expect(result.status).toBe(KycStatus.Verified);
  });

  it('throws NotFoundException when verification not found', async () => {
    const svc = buildService({ supabaseCalls: [updateClient(null)] });
    await expect(svc.handleWebhook(payload)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when DB update errors', async () => {
    const svc = buildService({ supabaseCalls: [updateClient(null, { message: 'DB error' })] });
    await expect(svc.handleWebhook(payload)).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// KycController — status endpoint security
// ---------------------------------------------------------------------------
describe('KycController', () => {
  let controller: KycController;
  let service: jest.Mocked<KycService>;

  beforeEach(async () => {
    service = {
      createSession: jest.fn(),
      getStatus: jest.fn(),
      handleWebhook: jest.fn(),
      activeProvider: 'mock-kyc',
    } as unknown as jest.Mocked<KycService>;

    const config = { get: jest.fn().mockReturnValue(WEBHOOK_SECRET) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [KycController],
      providers: [
        { provide: KycService, useValue: service },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    controller = module.get<KycController>(KycController);
  });

  describe('webhook security', () => {
    it('throws 401 when KYC_WEBHOOK_SECRET is not configured', async () => {
      const config = { get: jest.fn().mockReturnValue(undefined) };
      const module: TestingModule = await Test.createTestingModule({
        controllers: [KycController],
        providers: [
          { provide: KycService, useValue: service },
          { provide: ConfigService, useValue: config },
        ],
      }).compile();

      const ctrl = module.get<KycController>(KycController);
      await expect(
        ctrl.handleWebhook(
          { verification_id: 'v1', status: 'verified' },
          WEBHOOK_SECRET,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when x-kyc-webhook-secret header is missing', async () => {
      await expect(
        controller.handleWebhook(
          { verification_id: 'v1', status: 'verified' },
          '',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when x-kyc-webhook-secret header does not match', async () => {
      await expect(
        controller.handleWebhook(
          { verification_id: 'v1', status: 'verified' },
          'wrong-secret',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('accepts webhook with valid secret', async () => {
      service.handleWebhook.mockResolvedValue({
        id: 'row-1',
        userId: USER_ID,
        provider: 'test-provider',
        providerVerificationId: 'v1',
        status: KycStatus.Verified,
        metadata: {},
        verifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await controller.handleWebhook(
        { verification_id: 'v1', status: 'verified' },
        WEBHOOK_SECRET,
      );
      expect(result).toBeDefined();
      expect(service.handleWebhook).toHaveBeenCalledWith({
        verification_id: 'v1',
        status: 'verified',
      });
    });
  });
});
