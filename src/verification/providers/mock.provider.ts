import { IVerificationProvider, ProviderConfig } from './verification.provider';
import {
  VerificationStatus,
  VerificationType,
  VerificationProvider,
  ProviderCreateSessionResponse,
  ProviderStatusResponse,
  ProviderVerificationResult,
  ProviderCancelResponse,
  ProviderWebhookPayload,
  VerificationSubject,
} from '../dto/verification.dto';

export class MockVerificationProvider implements IVerificationProvider {
  readonly name = VerificationProvider.MOCK;
  readonly supportedTypes: VerificationType[] = [VerificationType.KYC, VerificationType.KYB];

  private shouldFail = false;
  private failOn: 'create' | 'getStatus' | 'handleWebhook' = 'create';
  private delayMs = 0;
  private config: ProviderConfig = {};

  // Response templates that can be customized
  private createSessionResponse: ProviderCreateSessionResponse = {
    provider_session_id: `mock-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    provider_url: `https://mock-verification.test/session/${Math.random().toString(36).slice(2, 9)}`,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
  };

  private getStatusResponse: ProviderStatusResponse = {
    status: VerificationStatus.COMPLETED,
  };

  private getResultsResponse: ProviderVerificationResult = {
    status: VerificationStatus.COMPLETED,
    result: {
      score: 0.99,
      risk_level: 'low',
      breakdown: { document: 'clear', facial_similarity: 'clear' },
    },
    completed_at: new Date().toISOString(),
  };

  private handleWebhookResponse: ProviderStatusResponse = {
    status: VerificationStatus.COMPLETED,
  };

  applyConfig(config: ProviderConfig): void {
    this.config = { ...this.config, ...config };
  }

  configure(config: {
    shouldFail?: boolean;
    failOn?: 'create' | 'getStatus' | 'handleWebhook';
    createSessionResponse?: ProviderCreateSessionResponse;
    getStatusResponse?: ProviderStatusResponse;
    getResultsResponse?: ProviderVerificationResult;
    handleWebhookResponse?: ProviderStatusResponse;
  }): this {
    if (config.shouldFail !== undefined) {
      this.shouldFail = config.shouldFail;
    }
    if (config.failOn) {
      this.failOn = config.failOn;
    }
    if (config.createSessionResponse) {
      this.createSessionResponse = config.createSessionResponse;
    }
    if (config.getStatusResponse) {
      this.getStatusResponse = config.getStatusResponse;
    }
    if (config.getResultsResponse) {
      this.getResultsResponse = config.getResultsResponse;
    }
    if (config.handleWebhookResponse) {
      this.handleWebhookResponse = config.handleWebhookResponse;
    }
    return this;
  }

  async createSession(
    _subject: VerificationSubject,
    _type: VerificationType,
  ): Promise<ProviderCreateSessionResponse> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.shouldFail && this.failOn === 'create') {
      throw new Error('MOCK_PROVIDER_ERROR: Failed to create verification session');
    }

    // Return a copy of the template with a fresh session ID
    return {
      ...this.createSessionResponse,
    };
  }

  async getStatus(_sessionId: string): Promise<ProviderStatusResponse> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.shouldFail && this.failOn === 'getStatus') {
      throw new Error('MOCK_PROVIDER_ERROR: Failed to get verification status');
    }

    return { ...this.getStatusResponse };
  }

  async getResults(_sessionId: string): Promise<ProviderVerificationResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    return { ...this.getResultsResponse };
  }

  async cancelSession(_sessionId: string): Promise<ProviderCancelResponse> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    return { cancelled: true, status: VerificationStatus.CANCELLED };
  }

  async handleWebhook(payload: ProviderWebhookPayload): Promise<ProviderStatusResponse> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.shouldFail && this.failOn === 'handleWebhook') {
      throw new Error('MOCK_PROVIDER_ERROR: Webhook processing failed');
    }

    // Update the response based on the webhook payload
    const statusMap: Record<string, VerificationStatus> = {
      'verification.completed': VerificationStatus.COMPLETED,
      'verification.failed': VerificationStatus.FAILED,
      'verification.processing': VerificationStatus.PROCESSING,
      'verification.expired': VerificationStatus.EXPIRED,
      'session.created': VerificationStatus.PENDING,
    };

    const mappedStatus = statusMap[payload.event] ?? VerificationStatus.PENDING;

    return {
      status: mappedStatus,
      result: payload.result ?? undefined,
      error: payload.error ?? undefined,
    } as ProviderStatusResponse;
  }

  validateWebhookSignature(payload: string, signature: string): boolean {
    if (!this.config.webhookSecret) return true;
    const expected = `sha256=${Buffer.from(payload + this.config.webhookSecret)
      .toString('base64')
      .slice(0, 43)}`;
    return signature === expected;
  }
}
