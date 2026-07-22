/**
 * Agreement lifecycle state machine.
 *
 * Single source of truth for which agreement status transitions are allowed.
 * The canonical flow is:
 *
 *   draft ──► pending ──► funded ──► active ──► in_review ──► completed
 *                                      │            │
 *                                      ├──► disputed ──► resolved
 *                                      └──► cancelled
 *
 * Status vocabulary (conceptual name → persisted status):
 *   Draft           → 'draft'      (agreement drafted, not yet awaiting funds)
 *   Pending Funding → 'pending'    (default status on creation; escrow not funded)
 *   Funded          → 'funded'     (escrow funded, work not yet started)
 *   Active          → 'active'     (work in progress)
 *   In Review       → 'in_review'  (deliverables submitted, awaiting approval)
 *   Completed       → 'completed'  (terminal; funds released)
 *   Disputed        → 'disputed'   (a dispute is open on the agreement)
 *   Resolved        → 'resolved'   (terminal; dispute settled by a resolver)
 *   Cancelled       → 'cancelled'  (terminal; abandoned before completion)
 *
 * To introduce a new state, add it to AGREEMENT_STATUSES and declare its
 * outgoing transitions (and any inbound ones) in AGREEMENT_TRANSITIONS.
 * The lifecycle test suite derives its exhaustive transition matrix from
 * these declarations, so new states are covered automatically.
 */

export const AGREEMENT_STATUSES = [
  'draft',
  'pending',
  'funded',
  'active',
  'in_review',
  'completed',
  'disputed',
  'resolved',
  'cancelled',
] as const;

export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

/** Allowed transitions: current status → statuses it may move to. */
export const AGREEMENT_TRANSITIONS: Readonly<Record<AgreementStatus, readonly AgreementStatus[]>> =
  {
    draft: ['pending', 'cancelled'],
    // 'pending' may jump straight to 'active' when funding is confirmed and
    // work starts in the same step (Pending Funding → Active).
    pending: ['funded', 'active', 'cancelled'],
    funded: ['active', 'cancelled'],
    active: ['in_review', 'disputed', 'cancelled'],
    // Review can approve (completed), request changes (active) or escalate.
    in_review: ['completed', 'active', 'disputed'],
    // A dispute either gets resolved or is withdrawn, reactivating the work.
    disputed: ['resolved', 'active'],
    completed: [],
    resolved: [],
    cancelled: [],
  };

/** Statuses with no outgoing transitions. */
export const TERMINAL_STATUSES: readonly AgreementStatus[] = AGREEMENT_STATUSES.filter(
  (status) => AGREEMENT_TRANSITIONS[status].length === 0,
);

/** Milestone statuses that count as fulfilled when completing an agreement. */
export const COMPLETED_MILESTONE_STATUSES = ['approved', 'released'] as const;

export interface MilestoneLike {
  status?: string;
}

export function isAgreementStatus(value: unknown): value is AgreementStatus {
  return (AGREEMENT_STATUSES as readonly unknown[]).includes(value);
}

export function isTerminalStatus(status: AgreementStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: unknown, to: unknown): boolean {
  if (!isAgreementStatus(from) || !isAgreementStatus(to)) return false;
  return AGREEMENT_TRANSITIONS[from].includes(to);
}

export function invalidTransitionMessage(from: unknown, to: unknown): string {
  if (!isAgreementStatus(from)) {
    return `Agreement has unknown status "${String(from)}" and cannot be transitioned`;
  }
  if (!isAgreementStatus(to)) {
    return `"${String(to)}" is not a valid agreement status`;
  }
  const allowed = AGREEMENT_TRANSITIONS[from];
  const allowedText = allowed.length ? allowed.join(', ') : 'none (terminal status)';
  return `Invalid status transition "${from}" → "${to}". Allowed from "${from}": ${allowedText}`;
}

/**
 * Business rule: an agreement can only be completed once every milestone has
 * been approved or released. Agreements without milestones can always complete.
 */
export function milestonesSatisfyCompletion(milestones: unknown): boolean {
  if (!Array.isArray(milestones) || milestones.length === 0) return true;
  return milestones.every((m: MilestoneLike) =>
    (COMPLETED_MILESTONE_STATUSES as readonly string[]).includes(m?.status ?? ''),
  );
}
