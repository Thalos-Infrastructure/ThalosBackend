/* eslint-disable @typescript-eslint/require-await */
import { IdentityProviderFactory } from './abstraction/IdentityProviderFactory';
import { IdentityConfigManager } from './abstraction/IdentityConfigManager';
import {
  IdentityVerificationProvider,
  VerificationSession,
  VerificationStatus,
  VerificationResult,
} from './abstraction/IdentityProvider';

class StubProvider implements IdentityVerificationProvider {
  constructor(private config: unknown) {}
  getProviderName() {
    return 'stub';
  }
  validateConfig(c: Record<string, unknown>) {
    return !!c.apiKey;
  }
  async createVerificationSession(_data: Record<string, unknown>): Promise<VerificationSession> {
    return { sessionId: 's1', status: 'initiated', provider: 'stub' };
  }
  async getVerificationStatus(id: string): Promise<VerificationStatus> {
    return { sessionId: id, status: 'pending' };
  }
  async retrieveVerificationResult(id: string): Promise<VerificationResult> {
    return { sessionId: id, status: 'completed', result: {} };
  }
  async handleVerificationUpdate(_event: Record<string, unknown>) {
    return { success: true };
  }
  async cancelVerification(_id: string) {
    return { cancelled: true };
  }
}

class NoKeyProvider implements IdentityVerificationProvider {
  constructor(private config: unknown) {}
  getProviderName() {
    return 'nokey';
  }
  validateConfig() {
    return false;
  }
  async createVerificationSession(_data: Record<string, unknown>): Promise<VerificationSession> {
    throw new Error('no key');
  }
  async getVerificationStatus(_id: string): Promise<VerificationStatus> {
    throw new Error('no key');
  }
  async retrieveVerificationResult(_id: string): Promise<VerificationResult> {
    throw new Error('no key');
  }
  async handleVerificationUpdate(_event: Record<string, unknown>) {
    return { success: false };
  }
  async cancelVerification(_id: string) {
    throw new Error('no key');
  }
}

describe('IdentityProviderFactory', () => {
  let factory: IdentityProviderFactory;

  beforeEach(() => {
    factory = new IdentityProviderFactory();
  });

  it('registers and creates a provider', () => {
    factory.register('stub', StubProvider);
    const p = factory.create('stub', { apiKey: 'test' });
    expect(p.getProviderName()).toBe('stub');
  });

  it('is case-insensitive', () => {
    factory.register('Stub', StubProvider);
    const p = factory.create('STUB', { apiKey: 'test' });
    expect(p.getProviderName()).toBe('stub');
  });

  it('throws for unregistered provider', () => {
    expect(() => factory.create('missing', {})).toThrow(/not registered/);
  });

  it('lists supported providers', () => {
    factory.register('stub', StubProvider);
    factory.register('nokey', NoKeyProvider);
    expect(factory.getSupportedProviders()).toEqual(['stub', 'nokey']);
  });
});

describe('IdentityConfigManager', () => {
  it('builds config from env vars', () => {
    const cm = new IdentityConfigManager({
      IDENTITY_PROVIDER: 'persona',
      IDENTITY_API_KEY: 'key-123',
      IDENTITY_TIMEOUT: '10000',
    });
    const c = cm.getConfig();
    expect(c.provider).toBe('persona');
    expect(c.apiKey).toBe('key-123');
    expect(c.timeout).toBe(10000);
    expect(c.levelName).toBe('basic-kyc-level');
  });

  it('throws if apiKey missing (defaults provider to sumsub)', () => {
    expect(() => new IdentityConfigManager({})).toThrow('IDENTITY_API_KEY is required');
  });

  it('throws if apiKey missing', () => {
    expect(() => new IdentityConfigManager({ IDENTITY_PROVIDER: 'sumsub' })).toThrow(
      'IDENTITY_API_KEY is required',
    );
  });

  it('throws if sumsub missing apiSecret', () => {
    expect(
      () => new IdentityConfigManager({ IDENTITY_PROVIDER: 'sumsub', IDENTITY_API_KEY: 'k' }),
    ).toThrow('IDENTITY_API_SECRET is required for Sumsub');
  });

  it('updateConfig revalidates', () => {
    const cm = new IdentityConfigManager({ IDENTITY_PROVIDER: 'persona', IDENTITY_API_KEY: 'k' });
    expect(() => cm.updateConfig({ apiKey: '' })).toThrow('IDENTITY_API_KEY is required');
  });

  it('defaults to sumsub', () => {
    const cm = new IdentityConfigManager({ IDENTITY_API_KEY: 'k', IDENTITY_API_SECRET: 's' });
    expect(cm.getConfig().provider).toBe('sumsub');
  });
});

describe('IdentityVerificationProvider contract', () => {
  let provider: IdentityVerificationProvider;

  beforeEach(() => {
    provider = new StubProvider({ apiKey: 'test' });
  });

  it('createVerificationSession returns correct shape', async () => {
    const session = await provider.createVerificationSession({ externalUserId: 'user-123' });
    expect(session).toHaveProperty('sessionId');
    expect(session).toHaveProperty('status');
    expect(session).toHaveProperty('provider');
  });

  it('getVerificationStatus returns sessionId + status', async () => {
    const status = await provider.getVerificationStatus('abc');
    expect(status.sessionId).toBe('abc');
    expect(status).toHaveProperty('status');
  });

  it('retrieveVerificationResult returns result', async () => {
    const result = await provider.retrieveVerificationResult('abc');
    expect(result.sessionId).toBe('abc');
    expect(result).toHaveProperty('result');
  });

  it('handleVerificationUpdate returns success boolean', async () => {
    const update = await provider.handleVerificationUpdate({});
    expect(update).toEqual({ success: true });
  });

  it('cancelVerification resolves', async () => {
    const res = await provider.cancelVerification('abc');
    expect(res).toBeTruthy();
  });

  it('validateConfig returns boolean', () => {
    expect(provider.validateConfig({ apiKey: 'k' })).toBe(true);
  });
});
