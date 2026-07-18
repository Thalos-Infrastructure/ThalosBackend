import type { ServiceType } from '../internal-trustless/dto/escrow-write.dto';

export const MILESTONE_SYNC_EVENTS = {
  SYNC_STARTED: 'milestone.sync.started',
  SYNC_SUCCEEDED: 'milestone.sync.succeeded',
  SYNC_FAILED: 'milestone.sync.failed',
  SYNC_CONFLICT: 'milestone.sync.conflict',
  SYNC_DEAD_LETTER: 'milestone.sync.dead_letter',
} as const;

export type MilestoneSyncEvent =
  (typeof MILESTONE_SYNC_EVENTS)[keyof typeof MILESTONE_SYNC_EVENTS];

/** Thalos milestone status → TW newStatus used in API calls. */
export const THALOS_TO_TW_STATUS: Record<string, string> = {
  released: 'completed',
  approved: 'approved',
};

/** TW milestone status → Thalos milestone status. */
export const TW_TO_THALOS_STATUS: Record<string, 'pending' | 'approved' | 'released'> = {
  completed: 'released',
  approved: 'approved',
  rejected: 'pending',
  cancelled: 'pending',
};

/** TW webhook event types that carry milestone-level state changes. */
export const TW_MILESTONE_EVENTS = [
  'milestone.completed',
  'milestone.approved',
  'milestone.rejected',
  'milestone.cancelled',
] as const;

export type TwMilestoneEvent = (typeof TW_MILESTONE_EVENTS)[number];

export const SYNC_RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 500,
} as const;

export type MilestoneSyncState = 'idle' | 'awaiting_signature' | 'synced' | 'conflict';

export type { ServiceType };
