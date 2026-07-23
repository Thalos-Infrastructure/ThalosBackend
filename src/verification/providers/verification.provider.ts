import {
  VerificationProvider,
  VerificationType,
  VerificationSubject,
  ProviderCreateSessionResponse,
  ProviderStatusResponse,
  ProviderVerificationResult,
  ProviderCancelResponse,
  ProviderWebhookPayload,
} from '../dto/verification.dto';

/**
 * Common contract every KYC/KYB identity provider must satisfy.
 *
 * Core services (e.g. VerificationService) depend ONLY on this interface,
 * never on a concrete vendor SDK. This keeps business logic — including the
 * Agreement Service — fully isolated from any single vendor and prevents
 * vendor lock-in.
 *
 * Adding a new provider (Sumsub, Persona, Veriff, Synaps, Stripe Identity,
 * Alloy, ...) is a matter of implementing this interface and registering the
 * instance with the {@link VerificationProviderFactory}. No core code changes.
 *
 * The five lifecycle operations required by the abstraction are:
 *  - createSession       -> Create Verification Session
 *  - getStatus           -> Get Verification Status
 *  - getResults          -> Retrieve Verification Results
 *  - handleWebhook       -> Handle Verification Updates
 *  - cancelSession       -> Cancel Verification
 *
 * `getResults` and `cancelSession` are optional so providers that do not
 * support them (or lightweight test doubles) remain valid implementations.
 * The service degrades gracefully when a capability is absent.
 */
export interface IVerificationProvider {
  /** Canonical provider identifier. */
  readonly name: VerificationProvider;
  /** Verification types (KYC/KYB) this provider can handle. */
  readonly supportedTypes: VerificationType[];

  /** Create Verification Session. */
  createSession(
    subject: VerificationSubject,
    type: VerificationType,
  ): Promise<ProviderCreateSessionResponse>;

  /** Get Verification Status. */
  getStatus(sessionId: string): Promise<ProviderStatusResponse>;

  /** Retrieve Verification Results (normalized, vendor-agnostic). */
  getResults?(sessionId: string): Promise<ProviderVerificationResult>;

  /** Handle Verification Updates delivered via provider webhooks. */
  handleWebhook(payload: ProviderWebhookPayload): Promise<ProviderStatusResponse>;

  /** Cancel Verification. */
  cancelSession?(sessionId: string): Promise<ProviderCancelResponse>;

  /** Verify the authenticity of an inbound webhook. */
  validateWebhookSignature(payload: string, signature: string): boolean;

  /** Apply runtime configuration (API keys, secrets, base URLs, timeouts). */
  applyConfig?(config: ProviderConfig): void;
}

export interface ProviderConfig {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  webhookSecret?: string;
  timeoutMs?: number;
}
