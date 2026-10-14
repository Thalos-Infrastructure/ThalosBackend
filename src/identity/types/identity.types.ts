/**
 * Identity Provider Abstraction Layer — Core Types
 *
 * This module defines the provider-agnostic types for identity verification
 * (KYC/KYB). Every concrete provider (Persona, Sumsub, Onfido, Veriff, etc.)
 * maps its native response into these types so that the rest of the system
 * never depends on a specific vendor.
 *
 * @module IdentityProvider
 */

// ──────────────────────────────────────────────
// Subject & Entity Types
// ──────────────────────────────────────────────

/** The kind of subject being verified. */
export type IdentitySubjectType = 'individual' | 'business';

/** Legal entity structure for business verifications. */
export type BusinessEntityType =
  | 'sole_proprietorship'
  | 'llc'
  | 'corporation'
  | 'partnership'
  | 'non_profit'
  | 'trust'
  | 'government_entity'
  | 'other';

// ──────────────────────────────────────────────
// Verification Lifecycle
// ──────────────────────────────────────────────

/**
 * Lifecycle state of a verification session.
 *
 * - `not_started`:  No verification has been initiated.
 * - `pending`:      Verification is in progress (user needs to complete steps).
 * - `in_review`:    User has submitted; provider is reviewing.
 * - `approved`:     Verification passed.
 * - `declined`:     Verification failed (user can retry).
 * - `expired`:      The verification session or result is no longer valid.
 * - `abandoned`:    User started but never completed; provider timed out.
 * - `error`:        A system error occurred (provider outage, misconfiguration).
 */
export type IdentityVerificationStatus =
  | 'not_started'
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'declined'
  | 'expired'
  | 'abandoned'
  | 'error';

/**
 * Normalised verification level — the depth of checks performed.
 *
 * Providers may have their own tiering (e.g. Sumsub's "basic" vs "standard" vs
 * "enhanced"); this enum maps them to a common scale.
 */
export type IdentityVerificationLevel = 'none' | 'basic' | 'standard' | 'advanced';

// ──────────────────────────────────────────────
// Document & Data Types
// ──────────────────────────────────────────────

/** Supported identity document types. */
export type IdentityDocumentType =
  | 'passport'
  | 'national_id'
  | 'drivers_license'
  | 'residence_permit'
  | 'voter_id'
  | 'other';

/** A document submitted as part of a verification. */
export interface IdentityDocument {
  type: IdentityDocumentType;
  country: string;
  /** Provider-specific document reference. */
  providerDocumentId: string;
  /** Front image URL (if applicable). */
  frontImageUrl?: string;
  /** Back image URL (if applicable). */
  backImageUrl?: string;
  /** Selfie / liveness image URL (if applicable). */
  selfieImageUrl?: string;
}

/** Personal data collected during individual (KYC) verification. */
export interface IndividualData {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO 8601 date
  nationality: string;
  countryOfResidence: string;
  email?: string;
  phone?: string;
  documents: IdentityDocument[];
}

/** Business data collected during business (KYB) verification. */
export interface BusinessData {
  legalName: string;
  registrationNumber: string;
  countryOfRegistration: string;
  jurisdiction?: string;
  dateOfIncorporation?: string; // ISO 8601 date
  taxId?: string;
  businessType: BusinessEntityType;
  address?: string;
  /** Ultimate Beneficial Owners identified during verification. */
  ubos?: IndividualData[];
  directors?: IndividualData[];
  documents: IdentityDocument[];
}

// ──────────────────────────────────────────────
// Session & Result Types
// ──────────────────────────────────────────────

/** Input to create a new verification session. */
export interface CreateSessionInput {
  /** External reference the caller uses to identify the subject. */
  externalRef: string;
  subjectType: IdentitySubjectType;
  /** Individual data (required for KYC). */
  individual?: IndividualData;
  /** Business data (required for KYB). */
  business?: BusinessData;
  /** Arbitrary metadata the caller wants associated with the session. */
  metadata?: Record<string, unknown>;
  /** ISO 639-1 language code for the verification UI (e.g. 'en', 'es'). */
  locale?: string;
  /** URL the provider should redirect the user to upon completion. */
  redirectUrl?: string;
}

/** Result of creating a verification session. */
export interface CreateSessionResult {
  /** Provider-assigned session identifier. */
  providerSessionId: string;
  /** URL to redirect the user to for completing verification (if applicable). */
  redirectUrl: string | null;
  /** Initial status of the session. */
  status: IdentityVerificationStatus;
  /** Provider name that created the session. */
  provider: string;
}

/** Normalised verification result from a provider. */
export interface VerificationResult {
  providerSessionId: string;
  status: IdentityVerificationStatus;
  level: IdentityVerificationLevel;
  /** ISO 8601 timestamp of when verification was completed (null if not yet). */
  verifiedAt: string | null;
  /** ISO 8601 timestamp of when this result expires (null = never). */
  expiresAt: string | null;
  /** Human-readable reason if declined/error. */
  reason?: string;
  /** Provider-specific raw response (for debugging / audit). */
  rawProviderResponse?: Record<string, unknown>;
}

/** Input to check the status of an existing session. */
export interface CheckStatusInput {
  providerSessionId: string;
}

/** Input to retrieve a verification result. */
export interface GetResultInput {
  providerSessionId: string;
}

/** Input to resend a verification link/notification. */
export interface ResendNotificationInput {
  providerSessionId: string;
  /** Optional channel override (e.g. 'email', 'sms'). */
  channel?: string;
}

/** Input to cancel/abort a verification session. */
export interface CancelSessionInput {
  providerSessionId: string;
  reason?: string;
}

// ──────────────────────────────────────────────
// Webhook / Callback Types
// ──────────────────────────────────────────────

/**
 * Normalised webhook payload from any identity provider.
 *
 * Concrete providers implement a translator that converts their native webhook
 * body into this shape, so downstream handlers are provider-agnostic.
 */
export interface IdentityWebhookPayload {
  provider: string;
  providerSessionId: string;
  eventType: IdentityWebhookEventType;
  status: IdentityVerificationStatus;
  level: IdentityVerificationLevel;
  verifiedAt: string | null;
  expiresAt: string | null;
  reason?: string;
  /** ISO 8601 timestamp of when the event occurred at the provider. */
  eventTimestamp: string;
  /** Provider-specific raw payload (for debugging / audit). */
  rawPayload: Record<string, unknown>;
}

export type IdentityWebhookEventType =
  | 'verification_created'
  | 'verification_pending'
  | 'verification_in_review'
  | 'verification_approved'
  | 'verification_declined'
  | 'verification_expired'
  | 'verification_abandoned'
  | 'verification_error'
  | 'review_requested'
  | 'report_ready';

// ──────────────────────────────────────────────
// Provider Configuration
// ──────────────────────────────────────────────

/** Provider-specific configuration options. */
export interface IdentityProviderConfig {
  /** Human-readable provider name. */
  name: string;
  /** Whether this provider supports individual (KYC) verification. */
  supportsKyc: boolean;
  /** Whether this provider supports business (KYB) verification. */
  supportsKyb: boolean;
  /** Maximum verification level this provider can achieve. */
  maxLevel: IdentityVerificationLevel;
  /** Provider-specific options (API keys, endpoints, etc.). */
  options: Record<string, unknown>;
}

// ──────────────────────────────────────────────
// Error Types
// ──────────────────────────────────────────────

/** Categorised error from an identity provider. */
export class IdentityProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code: IdentityProviderErrorCode,
    public readonly providerSessionId?: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'IdentityProviderError';
  }
}

export type IdentityProviderErrorCode =
  | 'provider_unavailable'
  | 'authentication_failed'
  | 'invalid_request'
  | 'session_not_found'
  | 'rate_limited'
  | 'configuration_error'
  | 'unsupported_subject_type'
  | 'internal_error';