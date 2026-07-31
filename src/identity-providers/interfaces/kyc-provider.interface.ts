export enum KycStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export interface CreateSessionInput {
  userId: string;
  metadata?: Record<string, unknown>;
}

export interface SessionResult {
  providerVerificationId: string;
  sessionUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface VerificationResult {
  status: KycStatus;
  verifiedAt: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Standardized interface for all KYC verification providers.
 * Matches the contract defined in PR #80.
 */
export interface IKycProvider {
  readonly name: string;

  /**
   * Create a new verification session.
   */
  createSession(input: CreateSessionInput): Promise<SessionResult>;

  /**
   * Check the current status of a verification.
   */
  getStatus(providerVerificationId: string): Promise<VerificationResult>;

  /**
   * Process a webhook payload from the provider.
   * Should verify the signature and return the updated result.
   */
  processWebhook(payload: unknown): Promise<{
    providerVerificationId: string;
    result: VerificationResult;
  }>;
}

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');
