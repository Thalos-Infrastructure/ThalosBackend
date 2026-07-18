import { KycStatus } from './kyc.types';

export interface CreateSessionInput {
  userId: string;
  metadata?: Record<string, unknown>;
}

export interface VerificationResult {
  status: KycStatus;
  verifiedAt: string | null;
  metadata?: Record<string, unknown>;
}

export interface IIdentityProvider {
  readonly name: string;

  createSession(input: CreateSessionInput): Promise<{
    providerVerificationId: string;
    sessionUrl?: string;
    metadata?: Record<string, unknown>;
  }>;

  getStatus(providerVerificationId: string): Promise<VerificationResult>;

  processWebhook(payload: unknown): Promise<{
    providerVerificationId: string;
    result: VerificationResult;
  }>;
}
