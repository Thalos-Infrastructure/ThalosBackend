-- Migration: typed agreement chat (user / system / event) and file hashes
--
-- Chat attachments already live in `files` + `agreement_message_attachments`.
-- This adds the message kinds Manu's timeline needs, and a SHA-256 on every
-- new upload so a file can be used as evidence without a second mechanism.

ALTER TABLE public.agreement_messages
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS event_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.agreement_messages
  DROP CONSTRAINT IF EXISTS agreement_messages_kind_check;

ALTER TABLE public.agreement_messages
  ADD CONSTRAINT agreement_messages_kind_check
  CHECK (kind IN ('user', 'system', 'event'));

ALTER TABLE public.agreement_messages
  DROP CONSTRAINT IF EXISTS agreement_messages_event_type_check;

ALTER TABLE public.agreement_messages
  ADD CONSTRAINT agreement_messages_event_type_check
  CHECK (
    (kind = 'event' AND event_type IS NOT NULL)
    OR (kind <> 'event' AND event_type IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_agreement_messages_kind
  ON public.agreement_messages(agreement_id, kind, created_at);

COMMENT ON COLUMN public.agreement_messages.kind IS
  'user = written by a participant; system = notice from Thalos; event = agreement lifecycle.';

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS sha256_hex TEXT NULL;

COMMENT ON COLUMN public.files.sha256_hex IS
  'SHA-256 of the bytes at upload time. Null only on rows created before this migration.';
