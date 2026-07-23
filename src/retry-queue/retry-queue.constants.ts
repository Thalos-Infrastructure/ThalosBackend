export const RETRY_QUEUE_DEFAULTS = {
  MAX_ATTEMPTS: 5,
  BASE_DELAY_MS: 1_000,
  MAX_DELAY_MS: 60_000,
  POLL_INTERVAL_MS: 5_000,
  CONCURRENCY: 3,
  STALE_PROCESSING_MS: 60_000,
};

/**
 * Exponential backoff: base * 2^(attempt - 1), capped at maxDelayMs.
 * `attempt` is the 1-indexed attempt number that just failed.
 */
export function computeBackoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponent = Math.max(attempt - 1, 0);
  const delay = baseDelayMs * 2 ** exponent;
  return Math.min(delay, maxDelayMs);
}
