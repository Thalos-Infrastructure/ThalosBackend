export enum RetryJobType {
  AGREEMENT_CREATION = 'agreement_creation',
  MILESTONE_UPDATE = 'milestone_update',
  STATUS_SYNC = 'status_sync',
  CONTRACT_RETRIEVAL = 'contract_retrieval',
  PAYMENT_EXECUTION = 'payment_execution',
  WEBHOOK_EVENT_PROCESSING = 'webhook_event_processing',
}

export enum RetryJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

export interface RetryJob {
  id: string;
  job_type: RetryJobType;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: RetryJobStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/**
 * A handler executes the real work for one job type (e.g. calling Trustless Work).
 * It must throw to signal failure — the queue treats any rejection as retryable.
 */
export type RetryJobHandler<TPayload = Record<string, unknown>> = (
  payload: TPayload,
  attempt: number,
) => Promise<unknown>;

export interface EnqueueOptions {
  maxAttempts?: number;
}
