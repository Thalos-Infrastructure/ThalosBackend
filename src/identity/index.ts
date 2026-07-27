/**
 * Identity Provider Abstraction Layer — Public API
 *
 * Import from `@identity` or `../identity` to get provider-agnostic
 * identity verification types, interfaces, and services.
 *
 * @module IdentityProvider
 */

// ── Types ──────────────────────────────────────
export type {
  IdentitySubjectType,
  BusinessEntityType,
  IdentityVerificationStatus,
  IdentityVerificationLevel,
  IdentityDocumentType,
  IdentityDocument,
  IndividualData,
  BusinessData,
  CreateSessionInput,
  CreateSessionResult,
  CheckStatusInput,
  VerificationResult,
  GetResultInput,
  CancelSessionInput,
  ResendNotificationInput,
  IdentityWebhookPayload,
  IdentityWebhookEventType,
  IdentityProviderConfig,
  IdentityProviderErrorCode,
} from './types/identity.types';

export { IdentityProviderError } from './types/identity.types';

// ── Interfaces ─────────────────────────────────
export type { IdentityProvider } from './interfaces/identity-provider.interface';
export type { WebhookTranslator } from './interfaces/webhook-translator.interface';

// ── DI Tokens ──────────────────────────────────
export {
  IDENTITY_PROVIDER,
  IDENTITY_PROVIDERS,
  WEBHOOK_TRANSLATORS,
  NAMED_PROVIDER,
} from './identity.constants';

// ── Services ───────────────────────────────────
export { ProviderRegistryService } from './providers/provider-registry.service';

// ── Providers ──────────────────────────────────
export { ManualIdentityProvider } from './providers/manual-identity.provider';
export { MockIdentityProvider } from './providers/mock-identity.provider';
export type { MockIdentityProviderBehavior } from './providers/mock-identity.provider';

// ── Guards ─────────────────────────────────────
export { IdentityProviderGuard } from './guards/identity-provider.guard';

// ── Module ─────────────────────────────────────
export { IdentityModule } from './identity.module';