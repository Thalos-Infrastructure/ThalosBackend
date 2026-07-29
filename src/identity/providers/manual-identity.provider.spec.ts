import { ManualIdentityProvider } from './manual-identity.provider';

describe('ManualIdentityProvider', () => {
  let provider: ManualIdentityProvider;

  beforeEach(() => {
    provider = new ManualIdentityProvider();
  });

  describe('config', () => {
    it('has the correct name', () => {
      expect(provider.config.name).toBe('manual');
    });

    it('supports both KYC and KYB', () => {
      expect(provider.config.supportsKyc).toBe(true);
      expect(provider.config.supportsKyb).toBe(true);
    });

    it('has maxLevel of basic', () => {
      expect(provider.config.maxLevel).toBe('basic');
    });
  });

  describe('createSession', () => {
    it('returns a pending session with a UUID', async () => {
      const result = await provider.createSession({
        externalRef: 'org-123',
        subjectType: 'business',
        business: {
          legalName: 'Test Corp',
          registrationNumber: 'REG-123',
          countryOfRegistration: 'US',
          businessType: 'corporation',
          documents: [],
        },
      });

      expect(result.providerSessionId).toBeDefined();
      expect(result.providerSessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(result.redirectUrl).toBeNull();
      expect(result.status).toBe('pending');
      expect(result.provider).toBe('manual');
    });
  });

  describe('checkStatus', () => {
    it('always returns pending', async () => {
      const result = await provider.checkStatus({
        providerSessionId: 'session-1',
      });

      expect(result.status).toBe('pending');
      expect(result.level).toBe('none');
    });
  });

  describe('getResult', () => {
    it('returns same as checkStatus', async () => {
      const result = await provider.getResult({
        providerSessionId: 'session-1',
      });

      expect(result.status).toBe('pending');
      expect(result.level).toBe('none');
    });
  });

  describe('cancelSession', () => {
    it('resolves without error', async () => {
      await expect(
        provider.cancelSession({ providerSessionId: 'session-1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('resendNotification', () => {
    it('resolves without error', async () => {
      await expect(
        provider.resendNotification({ providerSessionId: 'session-1' }),
      ).resolves.toBeUndefined();
    });
  });
});