/**
 * DI Tokens for the Identity Provider Abstraction Layer.
 */

/**
 * Multi-provider token: inject all registered IdentityProviders.
 * Use this when you need to route to multiple providers (e.g. for
 * listing all active sessions across vendors).
 */
export const IDENTITY_PROVIDERS = Symbol('IDENTITY_PROVIDERS');

/**
 * Primary/Default provider token: inject the single configured
 * IdentityProvider. Most services should use this.
 */
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

/**
 * Webhook translator registry token.
 */
export const WEBHOOK_TRANSLATORS = Symbol('WEBHOOK_TRANSLATORS');

/**
 * Token for a specific named provider. Used with @Inject(NAMED_PROVIDER('persona')).
 */
export const NAMED_PROVIDER = (name: string) => Symbol.for(`IDENTITY_PROVIDER:${name}`);