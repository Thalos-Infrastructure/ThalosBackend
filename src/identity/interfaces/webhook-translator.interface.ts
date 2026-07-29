import { IdentityWebhookPayload } from '../types/identity.types';

/**
 * Translates a provider's native webhook payload into the normalised
 * {@link IdentityWebhookPayload} shape.
 *
 * Each concrete provider that sends webhooks must implement a translator.
 * The translator is the only code that needs to understand the provider's
 * webhook format — downstream handlers work exclusively with the normalised
 * shape.
 *
 * ## Usage
 *
 * ```typescript
 * // In the webhook controller:
 * const translator = this.translatorRegistry.get(providerName);
 * const normalised = translator.translate(rawBody);
 * await this.verificationService.handleWebhook(normalised);
 * ```
 *
 * @module WebhookTranslator
 */
export interface WebhookTranslator {
  /**
   * The provider name this translator handles (e.g. 'persona', 'sumsub').
   * Must match the `provider` field in the normalised payload and the
   * provider's `config.name`.
   */
  readonly providerName: string;

  /**
   * Translate a raw webhook body into the normalised shape.
   *
   * @param rawBody - The raw webhook payload from the provider (parsed JSON).
   * @returns The normalised webhook payload.
   * @throws {Error} If the payload cannot be parsed or is invalid.
   */
  translate(rawBody: unknown): IdentityWebhookPayload;

  /**
   * Validate that the webhook signature is authentic.
   *
   * @param rawBody - The raw request body (string) for signature verification.
   * @param signature - The signature header value from the provider.
   * @returns `true` if the signature is valid, `false` otherwise.
   */
  verifySignature(rawBody: string, signature: string): boolean;
}