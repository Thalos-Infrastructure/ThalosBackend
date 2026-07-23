import { ConfigService } from '@nestjs/config';
import { MockVerificationProvider } from './providers/mock.provider';
import { VerificationProviderFactory } from './providers/provider-factory';
import { IVerificationProvider } from './providers/verification.provider';
import { VerificationService } from './verification.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  VerificationProvider,
  VerificationSession,
  VerificationStatus,
  VerificationType,
} from './dto/verification.dto';

function buildConfigService(values: Record<string, string> = {}): ConfigService {
  return {
    get: jest.fn((key: string) => values[key] ?? undefined),
  } as unknown as ConfigService;
}

describe('MockVerificationProvider', () => {
  let provider: MockVerificationProvider;

  beforeEach(() => {
    provider = new MockVerificationProvider();
  });

  it('advertises identity and supported types', () => {
    expect(provider.name).toBe(VerificationProvider.MOCK);
    expect(provider.supportedTypes).toEqual([VerificationType.KYC, VerificationType.KYB]);
  });

  it('creates a verification session', async () => {
    const session = await provider.createSession(
      { type: VerificationType.KYC },
      VerificationType.KYC,
    );

    expect(session.provider_session_id).toBeDefined();
    expect(session.expires_at).toBeDefined();
  });

  it('returns verification status', async () => {
    const status = await provider.getStatus('mock-session');
    expect(status.status).toBe(VerificationStatus.COMPLETED);
  });

  it('retrieves normalized verification results', async () => {
    const results = await provider.getResults('mock-session');

    expect(results.status).toBe(VerificationStatus.COMPLETED);
    expect(results.result?.risk_level).toBe('low');
    expect(results.completed_at).toBeDefined();
  });

  it('cancels a verification session', async () => {
    const cancelled = await provider.cancelSession('mock-session');

    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.status).toBe(VerificationStatus.CANCELLED);
  });

  it('maps webhook events to statuses', async () => {
    const result = await provider.handleWebhook({
      session_id: 'mock-session',
      event: 'verification.failed',
      status: VerificationStatus.PENDING,
      timestamp: new Date().toISOString(),
    });

    expect(result.status).toBe(VerificationStatus.FAILED);
  });

  it('stores config via applyConfig and validates webhook signatures', () => {
    provider.applyConfig({ webhookSecret: 'shhh' });

    const payload = 'payload-body';
    const expected = `sha256=${Buffer.from(payload + 'shhh')
      .toString('base64')
      .slice(0, 43)}`;

    expect(provider.validateWebhookSignature(payload, expected)).toBe(true);
    expect(provider.validateWebhookSignature(payload, 'wrong')).toBe(false);
  });

  it('supports the create-failure test hook', async () => {
    provider.configure({ shouldFail: true, failOn: 'create' });

    await expect(
      provider.createSession({ type: VerificationType.KYC }, VerificationType.KYC),
    ).rejects.toThrow('MOCK_PROVIDER_ERROR');
  });
});

describe('VerificationProviderFactory', () => {
  it('registers the mock provider by default', () => {
    const factory = new VerificationProviderFactory(buildConfigService());
    expect(factory.hasProvider(VerificationProvider.MOCK)).toBe(true);
    expect(factory.getSupportedProviders()).toContain(VerificationProvider.MOCK);
  });

  it('defaults to mock when no provider is configured', () => {
    const factory = new VerificationProviderFactory(buildConfigService());
    expect(factory.getDefaultProviderName()).toBe(VerificationProvider.MOCK);
  });

  it('resolves the default provider from VERIFICATION_PROVIDER', () => {
    const factory = new VerificationProviderFactory(
      buildConfigService({ VERIFICATION_PROVIDER: 'persona' }),
    );
    expect(factory.getDefaultProviderName()).toBe(VerificationProvider.PERSONA);
  });

  it('normalizes casing and falls back for unknown providers', () => {
    const factory = new VerificationProviderFactory(
      buildConfigService({ VERIFICATION_PROVIDER: 'NotAProvider' }),
    );
    expect(factory.getDefaultProviderName()).toBe(VerificationProvider.MOCK);
  });

  it('throws when requesting an unregistered provider', () => {
    const factory = new VerificationProviderFactory(buildConfigService());
    expect(() => factory.getProvider({ provider: VerificationProvider.SUMSUB })).toThrow(
      'Unsupported verification provider: sumsub',
    );
  });

  it('applies resolved config to providers that support applyConfig', () => {
    const factory = new VerificationProviderFactory(
      buildConfigService({ MOCK_WEBHOOK_SECRET: 'from-env' }),
    );

    const spy = jest.spyOn(MockVerificationProvider.prototype, 'applyConfig');
    const provider = factory.getProvider({ provider: VerificationProvider.MOCK });

    expect(provider).toBeDefined();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ webhookSecret: 'from-env', timeoutMs: 30000 }),
    );
    spy.mockRestore();
  });

  it('allows registering and resolving new vendor providers at runtime', () => {
    const factory = new VerificationProviderFactory(buildConfigService());

    const personaLike: IVerificationProvider = {
      name: VerificationProvider.PERSONA,
      supportedTypes: [VerificationType.KYC],
      createSession: jest.fn(),
      getStatus: jest.fn(),
      handleWebhook: jest.fn(),
      validateWebhookSignature: jest.fn().mockReturnValue(true),
    };

    factory.registerProvider(personaLike);

    expect(factory.hasProvider(VerificationProvider.PERSONA)).toBe(true);
    expect(factory.getProvider({ provider: VerificationProvider.PERSONA })).toBe(personaLike);
  });
});

/**
 * Minimal single-row Supabase stub that supports the fluent chain the service
 * uses: from().select().eq().eq().maybeSingle() and from().update().eq().
 */
function buildSupabaseStub(row: VerificationSession | null) {
  let current: VerificationSession | null = row ? { ...row } : null;
  const captured: { updates?: Record<string, unknown> } = {};

  interface QueryStub {
    select: () => QueryStub;
    update: (payload: Record<string, unknown>) => QueryStub;
    eq: () => QueryStub;
    maybeSingle: () => Promise<{ data: VerificationSession | null; error: null }>;
    then: (resolve: (v: { data: null; error: null }) => unknown) => unknown;
  }

  const builder: QueryStub = {
    select: () => builder,
    update: (payload: Record<string, unknown>) => {
      captured.updates = payload;
      if (current) current = { ...current, ...payload };
      return builder;
    },
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: current, error: null }),
    then: (resolve: (v: { data: null; error: null }) => unknown) =>
      resolve({ data: null, error: null }),
  };

  const supabase = {
    getClient: () => ({ from: () => builder }),
  } as unknown as SupabaseService;

  return { supabase, captured, getRow: () => current };
}

function baseSession(overrides: Partial<VerificationSession> = {}): VerificationSession {
  return {
    id: 'session-1',
    provider: VerificationProvider.MOCK,
    type: VerificationType.KYC,
    subject: { type: VerificationType.KYC },
    status: VerificationStatus.PENDING,
    provider_session_id: 'mock-provider-session',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('VerificationService results & cancellation', () => {
  const USER = 'user-1';

  function buildService(supabase: SupabaseService, factory: VerificationProviderFactory) {
    return new VerificationService(supabase, buildConfigService(), factory);
  }

  it('retrieves and persists verification results', async () => {
    const { supabase, captured } = buildSupabaseStub(baseSession());
    const factory = new VerificationProviderFactory(buildConfigService());
    const service = buildService(supabase, factory);

    const { session, error } = await service.getResults(USER, 'session-1');

    expect(error).toBeNull();
    expect(session?.status).toBe(VerificationStatus.COMPLETED);
    expect(captured.updates?.status).toBe(VerificationStatus.COMPLETED);
    expect(captured.updates?.result).toBeDefined();
    expect(captured.updates?.completed_at).toBeDefined();
  });

  it('returns not found when the session is missing', async () => {
    const { supabase } = buildSupabaseStub(null);
    const factory = new VerificationProviderFactory(buildConfigService());
    const service = buildService(supabase, factory);

    const { session, error } = await service.getResults(USER, 'missing');

    expect(session).toBeNull();
    expect(error).toBe('Verification session not found');
  });

  it('cancels a pending session and marks it cancelled', async () => {
    const { supabase, captured } = buildSupabaseStub(baseSession());
    const factory = new VerificationProviderFactory(buildConfigService());
    const service = buildService(supabase, factory);

    const { session, error } = await service.cancelSession(USER, 'session-1');

    expect(error).toBeNull();
    expect(session?.status).toBe(VerificationStatus.CANCELLED);
    expect(captured.updates?.status).toBe(VerificationStatus.CANCELLED);
    expect(captured.updates?.cancelled_at).toBeDefined();
  });

  it('refuses to cancel a terminal session', async () => {
    const { supabase } = buildSupabaseStub(baseSession({ status: VerificationStatus.COMPLETED }));
    const factory = new VerificationProviderFactory(buildConfigService());
    const service = buildService(supabase, factory);

    const { error } = await service.cancelSession(USER, 'session-1');

    expect(error).toContain('Cannot cancel');
  });
});
