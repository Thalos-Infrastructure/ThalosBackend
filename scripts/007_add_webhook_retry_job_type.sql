-- Migration: add 'webhook_event_processing' to the retry_jobs.job_type CHECK constraint.
-- WebhooksService now enqueues inbound Trustless Work webhook processing onto the
-- shared retry queue instead of its own in-memory retry loop — see src/webhooks/webhooks.service.ts.

ALTER TABLE public.retry_jobs DROP CONSTRAINT IF EXISTS retry_jobs_job_type_check;

ALTER TABLE public.retry_jobs ADD CONSTRAINT retry_jobs_job_type_check CHECK (job_type IN (
  'agreement_creation',
  'milestone_update',
  'status_sync',
  'contract_retrieval',
  'payment_execution',
  'webhook_event_processing'
));
