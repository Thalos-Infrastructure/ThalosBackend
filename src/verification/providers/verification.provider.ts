import {
  VerificationProvider,
  VerificationType,
  VerificationSubject,
  ProviderCreateSessionResponse,
  ProviderStatusResponse,
  ProviderWebhookPayload,
} from '../dto/verification.dto';

export interface IVerificationProvider {
  readonly name: VerificationProvider;
  readonly supportedTypes: VerificationType[];

  createSession(
    subject: VerificationSubject,
    type: VerificationType,
  ): Promise<ProviderCreateSessionResponse>;

  getStatus(sessionId: string): Promise<ProviderStatusResponse>;

  handleWebhook(payload: ProviderWebhookPayload): Promise<ProviderStatusResponse>;

  validateWebhookSignature(payload: string, signature: string): boolean;
}

export interface ProviderConfig {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  webhookSecret?: string;
  timeoutMs?: number;
}
