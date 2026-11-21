import { MockIdentityProvider } from './mock-identity.provider';
import { IdentityProviderError } from '../types/identity.types';

describe('MockIdentityProvider', () => {
  describe('config', () => {
    it('defaults to name "mock"', () => {
      const provider = new MockIdentityProvider();
      expect(provider.config.name).toBe('mock');
    });

    it('accepts custom name', () => {
      const provider = new MockIdentityProvider({ name: 'persona' });
      expect(provider.config.name).toBe('persona');
    });

    it('defaults to supporting both KYC and KYB', () => {
      const provider = new MockIdentityProvider();
      expect(provider.config.supportsKyc).toBe(true);
      expect(provider.config.supportsKyb).toBe(true);
      expect(provider.config.maxLevel).toBe('advanced');
    });
  });

  describe('createSession', () => {
    it('records the input and returns default pending result', async () => {
      const provider = new MockIdentityProvider();
      const input = {
        externalRef: 'user-1',
        subjectType: 'individual' as const,
        individual: {
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: '1990-01-01',
          nationality: 'US',
          countryOfResidence: 'US',
          documents: [],
        },
      };

      const result = await provider.createSession(input);

      expect(provider.createCalls).toHaveLength(1);
      expect(provider.createCalls[0]).toEqual(input);
      expect(result.status).toBe('pending');
      expect(result.provider).toBe('mock');
      expect(result.providerSessionId).toMatch(/^mock-mock-/);
      expect(result.redirectUrl).toBe('https://mock.example/session');
    });

    it('returns custom createResult when configured', async () => {
      const provider = new MockIdentityProvider({
        createResult: {
          providerSessionId: 'custom-123',
          redirectUrl: 'https://custom.example/verify',
          status: 'approved',
          provider: 'persona',
        },
      });

      const result = await provider.createSession({
        externalRef: 'ref-1',
        subjectType: 'individual',
      });

      expect(result.providerSessionId).toBe('custom-123');
      expect(result.status).toBe('approved');
      expect(result.provider).toBe('persona');
    });

    it('uses factory function when provided', async () => {
      const provider = new MockIdentityProvider({
        createResult: (input) => ({
          providerSessionId: `factory-${input.externalRef}`,
          redirectUrl: null,
          status: 'pending',
          provider: 'factory-mock',
        }),
      });

      const result = await provider.createSession({
        externalRef: 'ref-99',
        subjectType: 'individual',
      });

      expect(result.providerSessionId).toBe('factory-ref-99');
    });

    it('rejects when createError is set', async () => {
      const provider = new MockIdentityProvider({
        createError: new Error('Provider unavailable'),
      });

      await expect(
        provider.createSession({
          externalRef: 'ref-1',
          subjectType: 'individual',
        }),
      ).rejects.toThrow('Provider unavailable');
    });
  });

  describe('checkStatus', () => {
    it('returns pending by default', async () => {
      const provider = new MockIdentityProvider();
      const result = await provider.checkStatus({
        providerSessionId: 'session-1',
      });

      expect(result.status).toBe('pending');
      expect(provider.checkStatusCalls).toHaveLength(1);
    });

    it('returns custom status when configured', async () => {
      const provider = new MockIdentityProvider({
        checkStatusResult: {
          providerSessionId: 'session-1',
          status: 'approved',
          level: 'standard',
          verifiedAt: new Date().toISOString(),
          expiresAt: null,
        },
      });

      const result = await provider.checkStatus({
        providerSessionId: 'session-1',
      });

      expect(result.status).toBe('approved');
      expect(result.level).toBe('standard');
    });

    it('rejects when checkStatusError is set', async () => {
      const provider = new MockIdentityProvider({
        checkStatusError: new Error('Session not found'),
      });

      await expect(
        provider.checkStatus({ providerSessionId: 'nonexistent' }),
      ).rejects.toThrow('Session not found');
    });
  });

  describe('getResult', () => {
    it('returns approved by default', async () => {
      const provider = new MockIdentityProvider();
      const result = await provider.getResult({
        providerSessionId: 'session-1',
      });

      expect(result.status).toBe('approved');
      expect(provider.getResultCalls).toHaveLength(1);
    });

    it('rejects when getResultError is set', async () => {
      const provider = new MockIdentityProvider({
        getResultError: new Error('Result not available'),
      });

      await expect(
        provider.getResult({ providerSessionId: 'session-1' }),
      ).rejects.toThrow('Result not available');
    });
  });

  describe('cancelSession', () => {
    it('records the call and resolves', async () => {
      const provider = new MockIdentityProvider();
      await provider.cancelSession({
        providerSessionId: 'session-1',
        reason: 'User cancelled',
      });

      expect(provider.cancelSessionCalls).toHaveLength(1);
      expect(provider.cancelSessionCalls[0].reason).toBe('User cancelled');
    });
  });

  describe('resendNotification', () => {
    it('records the call and resolves', async () => {
      const provider = new MockIdentityProvider();
      await provider.resendNotification({
        providerSessionId: 'session-1',
        channel: 'sms',
      });

      expect(provider.resendNotificationCalls).toHaveLength(1);
      expect(provider.resendNotificationCalls[0].channel).toBe('sms');
    });
  });
});