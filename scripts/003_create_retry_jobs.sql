-- Migration: Create retry_jobs table for the Trustless Work retry & recovery queue
-- Persists failed/pending Trustless Work operations so they survive process restarts
-- and can be retried with exponential backoff or re-run manually by an admin.
-- See src/retry-queue — this is the single retry primitive shared by every module
-- that talks to Trustless Work (sync, webhooks, milestones, lifecycle).

CREATE TABLE IF NOT EXISTS public.retry_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL CHECK (job_type IN (
    'agreement_creation',
    'milestone_update',
    'status_sync',
    'contract_retrieval',
    'payment_execution'
  )),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Used by the poller to find due jobs: WHERE status = 'pending' AND next_attempt_at <= now()
CREATE INDEX IF NOT EXISTS idx_retry_jobs_due ON public.retry_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_retry_jobs_idempotency_key ON public.retry_jobs(idempotency_key);
-- Used to reclaim jobs orphaned by a crash mid-processing (stuck in "processing").
CREATE INDEX IF NOT EXISTS idx_retry_jobs_processing ON public.retry_jobs(status, updated_at) WHERE status = 'processing';

ALTER TABLE public.retry_jobs ENABLE ROW LEVEL SECURITY;
-- No policies defined: only the Supabase service role (used exclusively by
-- ThalosBackend) can read/write this table. It is never queried with a user's
-- session token, so RLS with zero policies correctly blocks anon/authenticated access.

COMMENT ON TABLE public.retry_jobs IS 'Persistent retry/recovery queue for failed Trustless Work operations. Shared by every backend module that talks to Trustless Work — see src/retry-queue.';
