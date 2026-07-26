export const KYB_VERIFIED = 'kyb.verified';
export const KYB_REJECTED = 'kyb.rejected';

export interface KybVerifiedEventPayload {
  organizationId: string;
  businessName: string;
  verifiedAt: string;
}

export interface KybRejectedEventPayload {
  organizationId: string;
  businessName: string;
  rejectionReason: string;
}
