/**
 * Verification (KYC/KYB) domain types.
 *
 * These describe the *standardized* compliance response the Verification API
 * exposes, independent of which underlying provider (Sumsub, Persona, Veriff,
 * manual review, ...) produced the data. See issue #74.
 */

export type VerificationSubjectType = 'user' | 'business';

/**
 * Who is asking for a compliance status, resolved by the controller's guard.
 *
 * Compliance data is sensitive, so a valid JWT alone is not enough — a caller
 * may only read a subject they are entitled to. Access is granted when any of:
 *  - `isInternalService` — a trusted server-to-server consumer (Agreements,
 *    Reputation, ...) authenticated with the internal secret;
 *  - the caller is the subject itself (`callerUserId === subjectId`, users only);
 *  - the caller is an admin.
 */
export interface VerificationAccessContext {
  /** JWT `sub` of the caller, when the request came with an app JWT. */
  callerUserId?: string;
  /** True when the request authenticated with the internal service secret. */
  isInternalService?: boolean;
}

/** Depth of the completed verification. `none` means nothing verified yet. */
export type VerificationLevel = 'none' | 'basic' | 'standard' | 'advanced';

/** Lifecycle state of a verification, after applying expiry. */
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'expired' | 'rejected';

/** Row shape as stored in `public.verifications` (one per subject+provider). */
export interface VerificationRecord {
  id: string;
  subject_type: VerificationSubjectType;
  subject_id: string;
  provider: string | null;
  provider_reference: string | null;
  status: VerificationStatus;
  level: VerificationLevel;
  verified_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Standardized compliance response returned by `/v1/verification/*`.
 *
 * This is the stable contract that other services (Agreements, Reputation,
 * Enterprise, future marketplace) depend on — keep it provider-agnostic.
 */
export interface VerificationStatusResponse {
  subjectType: VerificationSubjectType;
  subjectId: string;
  /** true only when there is a currently-valid (non-expired) `verified` record. */
  isVerified: boolean;
  /** Effective lifecycle state after aggregating every provider. */
  status: VerificationStatus;
  /** Highest level reached by a currently-valid verification. */
  level: VerificationLevel;
  /** Provider backing the effective verification (null when none). */
  provider: string | null;
  /** ISO timestamp when the effective verification expires (null = none / no expiry). */
  expiresAt: string | null;
  /** ISO timestamp of the most recent update across all provider records. */
  lastUpdated: string | null;
}
