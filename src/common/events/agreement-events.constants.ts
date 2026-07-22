/**
 * Single source of truth for agreement lifecycle event names.
 * Used by agreements, disputes, webhooks, and notifications.
 */
export const AGREEMENT_EVENTS = {
  CREATED: 'agreement.created',
  FUNDED: 'agreement.funded',
  COMPLETED: 'agreement.completed',
  EVIDENCE_SUBMITTED: 'evidence.submitted',
  MILESTONE_APPROVED: 'milestone.approved',
  DISPUTE_OPENED: 'dispute.opened',
  DISPUTE_RESOLVED: 'dispute.resolved',
} as const;

export type AgreementEvent = (typeof AGREEMENT_EVENTS)[keyof typeof AGREEMENT_EVENTS];
