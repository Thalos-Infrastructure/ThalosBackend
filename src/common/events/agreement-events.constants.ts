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
  MILESTONE_RELEASED: 'milestone.released',
  DISPUTE_OPENED: 'dispute.opened',
  DISPUTE_RESOLVED: 'dispute.resolved',
  DISPUTE_PROPOSAL: 'dispute.proposal',
  DISPUTE_PROPOSAL_ACCEPTED: 'dispute.proposal_accepted',
} as const;

export type AgreementEvent = (typeof AGREEMENT_EVENTS)[keyof typeof AGREEMENT_EVENTS];
