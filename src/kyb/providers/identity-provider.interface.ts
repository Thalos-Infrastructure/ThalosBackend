export type KybEntityType = 'company' | 'startup' | 'organization' | 'legal_entity';

export type KybStatus = 'pending' | 'in_review' | 'verified' | 'rejected';

export interface CreateVerificationSessionInput {
  organizationId: string;
  businessName: string;
  registrationNumber: string;
  country: string;
  entityType: KybEntityType;
}

export interface VerificationSessionResult {
  /** Identifier for this session in the provider's own system. */
  providerSessionId: string;
  /** Where the business should be redirected to complete verification, if any. */
  redirectUrl: string | null;
  /** Status the session should start in. Providers with instant checks may return 'verified' or 'rejected' directly. */
  initialStatus: KybStatus;
}

/**
 * Abstraction over any KYB/identity verification vendor (Persona, Sumsub, Onfido, a manual
 * back-office process, etc). KybService only depends on this interface, never on a concrete
 * vendor, so swapping providers is a DI binding change, not a rewrite.
 */
export interface IdentityProvider {
  readonly name: string;
  createVerificationSession(
    input: CreateVerificationSessionInput,
  ): Promise<VerificationSessionResult>;
  checkStatus(providerSessionId: string): Promise<KybStatus>;
}

export const KYB_PROVIDER = Symbol('KYB_PROVIDER');
