import { Test, TestingModule } from '@nestjs/testing';
import { IDENTITY_PROVIDERS } from '../identity.constants';
import { ProviderRegistryService } from './provider-registry.service';
import { MockIdentityProvider } from './mock-identity.provider';
import { ManualIdentityProvider } from './manual-identity.provider';
import { IdentityProvider } from '../interfaces/identity-provider.interface';
import { IdentityProviderError } from '../types/identity.types';

describe('ProviderRegistryService', () => {
  let registry: ProviderRegistryService;
  let personaMock: MockIdentityProvider;
  let sumsubMock: MockIdentityProvider;

  beforeEach(async () => {
    personaMock = new MockIdentityProvider({
      name: 'persona',
      supportsKyc: true,
      supportsKyb: false,
    });

    sumsubMock = new MockIdentityProvider({
      name: 'sumsub',
      supportsKyc: true,
      supportsKyb: true,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderRegistryService,
        {
          provide: IDENTITY_PROVIDERS,
          useValue: [personaMock, sumsubMock],
        },
      ],
    }).compile();

    registry = module.get<ProviderRegistryService>(ProviderRegistryService);
  });

  describe('get', () => {
    it('returns a registered provider by name', () => {
      const provider = registry.get('persona');
      expect(provider).toBe(personaMock);
      expect(provider.config.name).toBe('persona');
    });

    it('throws IdentityProviderError for unknown provider', () => {
      expect(() => registry.get('onfido')).toThrow(IdentityProviderError);
      expect(() => registry.get('onfido')).toThrow(
        'Identity provider "onfido" is not registered',
      );
    });
  });

  describe('has', () => {
    it('returns true for registered providers', () => {
      expect(registry.has('persona')).toBe(true);
      expect(registry.has('sumsub')).toBe(true);
    });

    it('returns false for unregistered providers', () => {
      expect(registry.has('veriff')).toBe(false);
    });
  });

  describe('getProviderNames', () => {
    it('returns all registered provider names', () => {
      const names = registry.getProviderNames();
      expect(names).toEqual(expect.arrayContaining(['persona', 'sumsub']));
      expect(names).toHaveLength(2);
    });
  });

  describe('getAll', () => {
    it('returns all registered provider instances', () => {
      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(personaMock);
      expect(all).toContain(sumsubMock);
    });
  });

  describe('findForSubject', () => {
    it('finds the first KYC-capable provider for individual subject', () => {
      const provider = registry.findForSubject('individual');
      // persona supports KYC and comes first in the array
      expect(provider).toBe(personaMock);
    });

    it('finds the first KYB-capable provider for business subject', () => {
      const provider = registry.findForSubject('business');
      // persona does NOT support KYB, so sumsub is the first match
      expect(provider).toBe(sumsubMock);
    });

    it('prefers a named provider when it supports the subject type', () => {
      const provider = registry.findForSubject('business', 'sumsub');
      expect(provider).toBe(sumsubMock);
    });

    it('falls back to first suitable provider when named provider does not support subject', () => {
      // persona supports KYC but not KYB; requesting persona for business falls back
      const provider = registry.findForSubject('business', 'persona');
      expect(provider).toBe(sumsubMock);
    });

    it('throws when no provider supports the subject type', () => {
      const kycOnly = new MockIdentityProvider({
        name: 'kyc-only',
        supportsKyc: true,
        supportsKyb: false,
      });
      const kycOnlyRegistry = new ProviderRegistryService([kycOnly]);

      expect(() => kycOnlyRegistry.findForSubject('business')).toThrow(
        IdentityProviderError,
      );
      expect(() => kycOnlyRegistry.findForSubject('business')).toThrow(
        'No registered provider supports business verification',
      );
    });
  });
});