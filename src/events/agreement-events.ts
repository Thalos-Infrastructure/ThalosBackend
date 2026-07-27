import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import type {
  AgreementCompletedData,
  AgreementCreatedData,
  AgreementFundedData,
  DisputeOpenedData,
  DisputeResolvedData,
  EvidenceSubmittedData,
  MilestoneApprovedData,
} from '../notifications/types/notification-data.types';

/**
 * Typed registry of agreement domain event names.
 * Values are sourced from the canonical AGREEMENT_EVENTS constants.
 */
export const AgreementEventName = {
  Created: AGREEMENT_EVENTS.CREATED,
  Funded: AGREEMENT_EVENTS.FUNDED,
  Completed: AGREEMENT_EVENTS.COMPLETED,
  EvidenceSubmitted: AGREEMENT_EVENTS.EVIDENCE_SUBMITTED,
  MilestoneApproved: AGREEMENT_EVENTS.MILESTONE_APPROVED,
  DisputeOpened: AGREEMENT_EVENTS.DISPUTE_OPENED,
  DisputeResolved: AGREEMENT_EVENTS.DISPUTE_RESOLVED,
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
