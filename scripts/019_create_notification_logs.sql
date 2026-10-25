-- Migration: Create notification_logs — one row per email Thalos tried to send
--
-- Email notifications had no record of any kind. When they stopped working, the
-- only evidence was a `Failed to send email` line in the server log that nobody
-- was reading, and the question "are the emails going out?" could not be
-- answered without reproducing the whole flow by hand. In production the Resend
-- API key was invalid and every send was being rejected; it went unnoticed.
--
-- This table makes that question a query. Failures are recorded as deliberately
-- as successes: a row with status = 'failed' and its error is the point, not a
-- side effect.
--
-- It records the attempt, not the delivery. Resend accepting an email does not
-- mean it reached an inbox — bounces and spam filing happen afterwards and are
-- visible only in Resend's own dashboard.

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: some notifications are not tied to an agreement, and an agreement
  -- that is later deleted must not take its delivery history with it.
  agreement_id UUID,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient_email TEXT,
  recipient_wallet TEXT,
  subject TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  -- Why a send failed, or why it was skipped (e.g. no recipients with an email).
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "What happened with this agreement's notifications?"
CREATE INDEX IF NOT EXISTS idx_notification_logs_agreement
  ON public.notification_logs(agreement_id, created_at DESC);

-- "Is anything failing right now?" — the query this table exists for.
CREATE INDEX IF NOT EXISTS idx_notification_logs_status
  ON public.notification_logs(status, created_at DESC);

COMMENT ON TABLE public.notification_logs IS
  'One row per notification Thalos attempted. Records the attempt, not the delivery.';
COMMENT ON COLUMN public.notification_logs.status IS
  'sent = the provider accepted it; failed = it was rejected; skipped = never attempted (e.g. no recipient had an email)';

-- The table may already exist from the frontend's own `009_notification_logs.sql`,
-- which has no `subject`. `CREATE TABLE IF NOT EXISTS` above would then leave it
-- as it found it, and every insert would fail with "Could not find the 'subject'
-- column" — the same way a missing `sender_id` broke the chat. Add it on its own.
ALTER TABLE public.notification_logs ADD COLUMN IF NOT EXISTS subject TEXT;

-- Same reason: an older table may predate these.
ALTER TABLE public.notification_logs ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email';
ALTER TABLE public.notification_logs ADD COLUMN IF NOT EXISTS error_message TEXT;
