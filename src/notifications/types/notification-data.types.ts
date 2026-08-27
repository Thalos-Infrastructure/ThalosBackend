export interface AgreementCreatedData {
  agreementId: string;
  title: string;
  description?: string;
  amount: string;
  asset: string;
  createdByWallet: string;
  createdByName?: string;
  participantWallets: string[];
}

export interface AgreementFundedData {
  agreementId: string;
  title: string;
  amount: string;
  asset: string;
  fundedByWallet: string;
  fundedByName?: string;
  transactionSignature?: string;
}

export interface EvidenceSubmittedData {
  agreementId: string;
  agreementTitle: string;
  milestoneIndex: number;
  milestoneDescription: string;
  milestoneAmount: string;
  asset: string;
  submittedByWallet: string;
  submittedByName?: string;
  evidenceDescription?: string;
  evidenceUrls?: string[];
}

export interface MilestoneApprovedData {
  agreementId: string;
  agreementTitle: string;
  milestoneIndex: number;
  milestoneDescription: string;
  milestoneAmount: string;
  asset: string;
  approvedByWallet: string;
  approvedByName?: string;
}

/**
 * Payload emitted with AGREEMENT_EVENTS.MILESTONE_RELEASED when escrow funds
 * for a milestone are released on-chain.
 */
export interface MilestoneReleasedData {
  agreementId: string;
  agreementTitle: string;
  milestoneIndex: number;
  milestoneDescription: string;
  milestoneAmount: string;
  asset: string;
  contractId?: string;
  serviceType?: string;
  actorWallet: string;
  actorName?: string;
  evidence?: string;
}

export interface DisputeOpenedData {
  agreementId: string;
  agreementTitle: string;
  disputeReason: string;
  openedByWallet: string;
  openedByName?: string;
  milestoneIndex?: number;
  milestoneDescription?: string;
}

export interface DisputeResolvedData {
  agreementId: string;
  agreementTitle: string;
  resolution: string;
  resolvedByWallet: string;
  resolvedByName?: string;
  winnerWallet?: string;
  refundAmount?: string;
  releaseAmount?: string;
  asset?: string;
}

export interface AgreementCompletedData {
  agreementId: string;
  title: string;
  totalAmount: string;
  asset: string;
  completedAt: string;
}
