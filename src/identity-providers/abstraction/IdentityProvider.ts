/**
 * Standardized response for session creation across all providers.
 */
export interface VerificationSession {
  sessionId: string;
  status: 'initiated' | 'pending' | 'completed' | 'rejected' | 'cancelled';
  provider: string;
  [key: string]: unknown;
}

/**
 * Standardized response for status queries.
 */
export interface VerificationStatus {
  sessionId: string;
  status: string;
  lastUpdated?: string;
  documents?: unknown[];
  [key: string]: unknown;
}

/**
 * Standardized response for result retrieval.
 */
export interface VerificationResult {
  sessionId: string;
  status: string;
  result?: unknown;
  documents?: unknown[];
  [key: string]: unknown;
}

/**
 * Common interface every identity provider must implement.
 * Covers the full verification lifecycle as specified in Issue #71.
 */
export interface IdentityVerificationProvider {
  /** Create a new verification session. */
  createVerificationSession(data: Record<string, unknown>): Promise<VerificationSession>;
  /** Get current verification status for a session. */
  getVerificationStatus(sessionId: string): Promise<VerificationStatus>;
  /** Retrieve full verification result payload. */
  retrieveVerificationResult(sessionId: string): Promise<VerificationResult>;
  /** Handle incoming webhook/update event from the provider. */
  handleVerificationUpdate(event: Record<string, unknown>): Promise<{ success: boolean }>;
  /** Cancel an in-progress verification. */
  cancelVerification(sessionId: string): Promise<unknown>;
  /** Return the provider identifier (e.g. 'sumsub'). */
  getProviderName(): string;
  /** Validate that the supplied config has required fields for this provider. */
  validateConfig(config: Record<string, unknown>): boolean;
}
