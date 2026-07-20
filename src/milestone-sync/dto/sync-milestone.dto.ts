import type { ServiceType } from '../../internal-trustless/dto/escrow-write.dto';

export interface SyncMilestoneContext {
  agreementId: string;
  contractId: string;
  milestoneIndex: number;
  thalosStatus: 'pending' | 'approved' | 'released';
  actorWallet: string;
  evidence?: string;
  serviceType: ServiceType;
  /** sha256(agreementId:milestoneIndex:thalosStatus:5minBucket) */
  idempotencyKey: string;
}

export interface ConflictDetails {
  thalosStatus: string;
  twStatus: string;
  detectedAt: string;
}

export interface SyncResult {
  success: boolean;
  direction: 'thalos_to_tw' | 'tw_to_thalos';
  agreementId: string;
  milestoneIndex: number;
  reason?: string;
  conflictDetails?: ConflictDetails;
}

/** Shape of a milestone entry inside agreements.milestones JSON array. */
export interface MilestoneRecord {
  description: string;
  amount: string;
  status: 'pending' | 'approved' | 'released';
  evidence_description?: string;
  evidence_urls?: string[];
  evidence_submitted_at?: string;
  sync_state?: 'idle' | 'awaiting_signature' | 'synced' | 'conflict';
  last_synced_at?: string;
  tw_status?: string;
}

/** Payload emitted with milestone.released event. */
export interface MilestoneReleasedPayload {
  agreementId: string;
  agreementTitle: string;
  milestoneIndex: number;
  milestoneDescription: string;
  milestoneAmount: string;
  asset: string;
  contractId: string | null;
  serviceType: string | null;
  actorWallet: string;
  evidence?: string;
}
