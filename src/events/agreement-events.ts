import type {
  AgreementCompletedData,
  AgreementCreatedData,
  AgreementFundedData,
  DisputeOpenedData,
  DisputeResolvedData,
  EvidenceSubmittedData,
  MilestoneApprovedData,
} from '../notifications/types/notification-data.types';

/** Central registry of agreement domain event names. */
export const AgreementEventName = {
  Created: 'agreement.created',
  Funded: 'agreement.funded',
  Completed: 'agreement.completed',
  EvidenceSubmitted: 'evidence.submitted',
  MilestoneApproved: 'milestone.approved',
  DisputeOpened: 'dispute.opened',
  DisputeResolved: 'dispute.resolved',
} as const;

export type AgreementEventName = (typeof AgreementEventName)[keyof typeof AgreementEventName];

/** Maps each event name to its payload type (notification data interfaces). */
export type AgreementEventPayloadMap = {
  [AgreementEventName.Created]: AgreementCreatedData;
  [AgreementEventName.Funded]: AgreementFundedData;
  [AgreementEventName.Completed]: AgreementCompletedData;
  [AgreementEventName.EvidenceSubmitted]: EvidenceSubmittedData;
  [AgreementEventName.MilestoneApproved]: MilestoneApprovedData;
  [AgreementEventName.DisputeOpened]: DisputeOpenedData;
  [AgreementEventName.DisputeResolved]: DisputeResolvedData;
};

export type AgreementEventPayload<T extends AgreementEventName> = AgreementEventPayloadMap[T];
