export enum KycStatus {
  Pending = 'pending',
  InReview = 'in_review',
  Verified = 'verified',
  Rejected = 'rejected',
  Expired = 'expired',
}

export interface KycSession {
  id: string;
  userId: string;
  provider: string;
  providerVerificationId: string;
  status: KycStatus;
  metadata: Record<string, unknown>;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KycVerificationRow {
  id: string;
  user_id: string;
  provider: string;
  provider_verification_id: string;
  status: KycStatus;
  metadata: Record<string, unknown>;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}
