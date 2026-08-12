import { AGREEMENT_EVENTS } from '../events/agreement-events.constants';

/** @deprecated Prefer AGREEMENT_EVENTS.DISPUTE_OPENED — kept as alias for existing imports. */
export const DISPUTE_OPENED = AGREEMENT_EVENTS.DISPUTE_OPENED;
/** @deprecated Prefer AGREEMENT_EVENTS.DISPUTE_RESOLVED — kept as alias for existing imports. */
export const DISPUTE_RESOLVED = AGREEMENT_EVENTS.DISPUTE_RESOLVED;

export interface DisputeOpenedEventPayload {
  disputeId: string;
  agreementId: string;
  openedByWallet: string;
  reason: string;
}

export interface DisputeResolvedEventPayload {
  disputeId: string;
  agreementId: string;
  resolvedByWallet: string;
  payerPercentage: number;
  payeePercentage: number;
  resolutionNotes: string;
}
