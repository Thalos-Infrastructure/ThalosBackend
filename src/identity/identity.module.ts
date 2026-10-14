import { Module } from '@nestjs/common';
import { IDENTITY_PROVIDER, IDENTITY_PROVIDERS } from './identity.constants';
import { ManualIdentityProvider } from './providers/manual-identity.provider';
import { ProviderRegistryService } from './providers/provider-registry.service';

/**
 * Identity Provider Abstraction Module.
 *
 * Registers the default `ManualIdentityProvider` as both the primary
 * (`IDENTITY_PROVIDER`) and as a multi-provider (`IDENTITY_PROVIDERS`) for
 * registry-based lookups.
 *
 * ## Adding a new provider
 *
 * 1. Create a class implementing `IdentityProvider`.
 * 2. Add it to the `providers` array and the `IDENTITY_PROVIDERS` multi-token.
 * 3. Optionally override `IDENTITY_PROVIDER` to change the default.
 *
 * ```typescript
 * // Example: wire up Persona alongside the manual provider
 * @Module({
 *   imports: [IdentityModule],
 *   providers: [
 *     PersonaIdentityProvider,
 *     {
 *       provide: IDENTITY_PROVIDERS,
 *       useExisting: PersonaIdentityProvider,
 *       multi: true,
 *     },
 *   ],
 * })
 * export class SomeFeatureModule {}
 * ```
 *
 * @module IdentityProvider
 */
@Module({
  providers: [
    ManualIdentityProvider,
    ProviderRegistryService,
    {
      provide: IDENTITY_PROVIDER,
      useExisting: ManualIdentityProvider,
    },
    {
      provide: IDENTITY_PROVIDERS,
      useExisting: ManualIdentityProvider,
      multi: true,
    } as any,
  ],
  exports: [
    ManualIdentityProvider,
    ProviderRegistryService,
    IDENTITY_PROVIDER,
    IDENTITY_PROVIDERS,
  ],
})
export class IdentityModule {}
