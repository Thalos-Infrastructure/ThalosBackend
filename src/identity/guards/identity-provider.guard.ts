import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { IdentityProviderError } from '../types/identity.types';

/**
 * Guard that validates a provider name from the request parameters
 * exists in the registered provider registry.
 *
 * Usage:
 * ```typescript
 * @UseGuards(IdentityProviderGuard)
 * @Get(':provider/status')
 * getStatus(@Param('provider') provider: string) { ... }
 * ```
 *
 * @module IdentityProvider
 */
@Injectable()
export class IdentityProviderGuard implements CanActivate {
  constructor(private readonly registry: ProviderRegistryService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const providerName = request.params?.provider;

    if (!providerName) {
      throw new IdentityProviderError(
        'Provider name is required in request parameters',
        'guard',
        'invalid_request',
      );
    }

    if (!this.registry.has(providerName)) {
      throw new IdentityProviderError(
        `Identity provider "${providerName}" is not registered`,
        providerName,
        'configuration_error',
      );
    }

    // Attach the resolved provider to the request for downstream use.
    request.identityProvider = this.registry.get(providerName);
    return true;
  }
}