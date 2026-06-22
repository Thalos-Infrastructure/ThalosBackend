export const DISPUTE_OPENED = "dispute.opened";
export const DISPUTE_RESOLVED = "dispute.resolved";

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
