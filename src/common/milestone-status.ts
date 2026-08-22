/**
 * Canonical Milestone Status Enum
 *
 * Single source of truth for all milestone statuses across Thalos.
 * Used by agreements, escrows, webhooks, and sync engines.
 *
 * Lifecycle:  pending → approved → released
 *                                  ↗
 *                     rejected ──┘ (terminal, no further transitions)
 *
 * Legacy mapping:
 *   Trustless Work sends "completed" for milestones — this maps to "released" in Thalos.
 *   See {@link normalizeMilestoneStatus} for the conversion.
 */

/** All valid milestone statuses in Thalos. */
export const MILESTONE_STATUSES = ['pending', 'approved', 'released', 'rejected'] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/** Legacy values that Trustless Work may send for milestones. */
const LEGACY_MILESTONE_STATUS_MAP: Record<string, MilestoneStatus> = {
  completed: 'released',
};

/**
 * Normalizes a raw milestone status string into the canonical Thalos enum.
 *
 * - Returns the canonical status if the input is already valid.
 * - Maps legacy TW values (e.g. "completed" → "released").
 * - Returns `null` for completely unknown values.
 */
export function normalizeMilestoneStatus(raw: string): MilestoneStatus | null {
  if (isMilestoneStatus(raw)) return raw;
  const mapped = LEGACY_MILESTONE_STATUS_MAP[raw];
  return mapped ?? null;
}

/**
 * Type guard: returns true if `value` is a known MilestoneStatus.
 */
export function isMilestoneStatus(value: unknown): value is MilestoneStatus {
  return (MILESTONE_STATUSES as readonly unknown[]).includes(value);
}

/**
 * Human-readable label for each milestone status (for API docs / Swagger).
 */
export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  pending: 'Pending — work not yet started or awaiting action',
  approved: 'Approved — work reviewed and accepted, funds ready for release',
  released: 'Released — funds released to the service provider (terminal)',
  rejected: 'Rejected — work did not meet requirements (terminal)',
};
