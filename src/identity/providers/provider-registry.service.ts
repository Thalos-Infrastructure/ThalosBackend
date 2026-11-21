import { Injectable, Inject } from '@nestjs/common';
import { IDENTITY_PROVIDERS } from '../identity.constants';
import { IdentityProvider } from '../interfaces/identity-provider.interface';
import { IdentityProviderError } from '../types/identity.types';

/**
 * Registry of all registered IdentityProviders.
 *
 * Provides lookup methods to find providers by name or capability.
 * Providers are registered via DI using the `IDENTITY_PROVIDERS` multi-token.
 *
 * @module IdentityProvider
 */
@Injectable()
export class ProviderRegistryService {
  private readonly providerMap: Map<string, IdentityProvider>;

  constructor(
    @Inject(IDENTITY_PROVIDERS)
    private readonly providers: IdentityProvider[],
  ) {
    this.providerMap = new Map(providers.map((p) => [p.config.name, p]));
  }

  /**
   * Get a provider by its configured name.
   *
   * @param name - The provider name (e.g. 'persona', 'sumsub', 'manual').
   * @returns The matching IdentityProvider.
   * @throws {IdentityProviderError} If no provider with that name is registered.
   */
  get(name: string): IdentityProvider {
    const provider = this.providerMap.get(name);
    if (!provider) {
      throw new IdentityProviderError(
        `Identity provider "${name}" is not registered`,
        'registry',
        'configuration_error',
      );
    }
    return provider;
  }

  /**
   * Check if a provider with the given name is registered.
   */
  has(name: string): boolean {
    return this.providerMap.has(name);
  }

  /**
   * Get all registered provider names.
   */
  getProviderNames(): string[] {
    return Array.from(this.providerMap.keys());
  }

  /**
   * Get all registered providers.
   */
  getAll(): IdentityProvider[] {
    return this.providers;
  }

  /**
   * Find the first provider that supports the given subject type.
   *
   * Useful for auto-selecting a provider based on whether the subject
   * is an individual (KYC) or business (KYB).
   *
   * @param subjectType - The type of subject to verify.
   * @param preferProvider - Optional preferred provider name.
   * @returns A suitable IdentityProvider.
   * @throws {IdentityProviderError} If no suitable provider is registered.
   */
  findForSubject(
    subjectType: 'individual' | 'business',
    preferProvider?: string,
  ): IdentityProvider {
    if (preferProvider) {
      const preferred = this.get(preferProvider);
      if (
        (subjectType === 'individual' && preferred.config.supportsKyc) ||
        (subjectType === 'business' && preferred.config.supportsKyb)
      ) {
        return preferred;
      }
    }

    for (const provider of this.providers) {
      if (subjectType === 'individual' && provider.config.supportsKyc) {
        return provider;
      }
      if (subjectType === 'business' && provider.config.supportsKyb) {
        return provider;
      }
    }

    throw new IdentityProviderError(
      `No registered provider supports ${subjectType} verification`,
      'registry',
      'configuration_error',
    );
  }
}