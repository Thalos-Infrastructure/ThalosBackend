import {
  CreateSessionInput,
  CreateSessionResult,
  CheckStatusInput,
  VerificationResult,
  GetResultInput,
  CancelSessionInput,
  ResendNotificationInput,
  IdentityProviderConfig,
} from '../types/identity.types';

/**
 * Core interface for identity verification providers.
 *
 * Every concrete provider (Persona, Sumsub, Veriff, Onfido, manual review, etc.)
 * implements this interface. The rest of the system never depends on a specific
 * vendor — only on this abstraction.
 *
 * ## Design Decisions
 *
 * - **Stateless contract**: Providers own their session state. The caller is
 *   responsible for persisting the `providerSessionId` ↔ `externalRef` mapping.
 * - **Fail-fast**: Validation errors (missing fields, unsupported subject types)
 *   throw synchronously. Provider network errors reject the returned promise.
 * - **Idempotent creation**: If the provider supports it, `createSession` with
 *   the same `externalRef` should return the existing session rather than
 *   creating a duplicate.
 *
 * @module IdentityProvider
 */
export interface IdentityProvider {
  /** Provider metadata & capabilities. */
  readonly config: IdentityProviderConfig;

  /**
   * Create a new verification session with the provider.
   *
   * @param input - Session creation parameters.
   * @returns The created session details.
   * @throws {IdentityProviderError} On provider failure or invalid input.
   */
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>;

  /**
   * Check the current status of a verification session.
   *
   * @param input - Session identifier.
   * @returns Current verification status.
   * @throws {IdentityProviderError} If session not found or provider error.
   */
  checkStatus(input: CheckStatusInput): Promise<VerificationResult>;

  /**
   * Retrieve the full verification result for a completed session.
   *
   * @param input - Session identifier.
   * @returns Full verification result (including document data if available).
   * @throws {IdentityProviderError} If verification is still pending or provider error.
   */
  getResult(input: GetResultInput): Promise<VerificationResult>;

  /**
   * Cancel an ongoing verification session.
   *
   * @param input - Session identifier and optional reason.
   * @throws {IdentityProviderError} If session not found or cannot be cancelled.
   */
  cancelSession(input: CancelSessionInput): Promise<void>;

  /**
   * Resend a verification notification/link to the user.
   *
   * @param input - Session identifier and optional channel override.
   * @throws {IdentityProviderError} If notification cannot be sent.
   */
  resendNotification(input: ResendNotificationInput): Promise<void>;
}