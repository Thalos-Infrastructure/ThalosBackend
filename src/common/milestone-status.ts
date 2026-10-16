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
 * Trustless Work's milestone `status` is free text that the service provider sets
 * together with the evidence. Thalos writes "completed" there, meaning "work
 * delivered" — not "funds released". Release and approval live in TW's flags, so
 * read those with {@link milestoneStatusFromTrustless}; never map the text
 * "completed" to "released", which showed unfunded escrows as paid out.
 */

/** All valid milestone statuses in Thalos. */
export const MILESTONE_STATUSES = ['pending', 'approved', 'released', 'rejected'] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/**
 * Normalizes a raw milestone status string into the canonical Thalos enum.
 *
 * - Returns the canonical status if the input is already valid.
 * - Returns `null` for anything else, including TW's "completed" (evidence
 *   delivered), which says nothing about approval or release.
 */
export function normalizeMilestoneStatus(raw: string): MilestoneStatus | null {
  return isMilestoneStatus(raw) ? raw : null;
}

/** The parts of a Trustless Work milestone that decide its Thalos status. */
export interface TrustlessMilestoneLike {
  status?: string;
  approved?: boolean;
  flags?: { approved?: boolean; released?: boolean };
}

/**
 * Thalos status of a Trustless Work milestone, read from TW's flags.
 *
 * `escrowReleased` is the escrow-level `flags.released`: a single-release escrow
 * releases everything at once and never flags individual milestones.
 */
export function milestoneStatusFromTrustless(
  milestone: TrustlessMilestoneLike,
  escrowReleased = false,
): MilestoneStatus {
  if (escrowReleased || milestone.flags?.released) return 'released';
  if (milestone.approved || milestone.flags?.approved) return 'approved';
  if (milestone.status?.toLowerCase() === 'rejected') return 'rejected';
  return 'pending';
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
