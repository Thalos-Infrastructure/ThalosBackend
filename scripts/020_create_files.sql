-- Migration: file storage for Thalos, and its first consumer — chat attachments
--
-- Nothing in Thalos stored a file before this: milestone evidence is a text
-- field holding a URL, and avatars are a URL too. `files` is deliberately
-- generic so the next feature that needs an upload (evidence, KYB documents)
-- reuses it instead of growing a second, parallel mechanism.
--
-- The bytes live in Supabase Storage, in a PRIVATE bucket. This table is the
-- index: who uploaded what, how big, and — through `agreement_id` — who is
-- allowed to read it. Nothing is ever served from a public URL; the backend
-- checks access and mints a short-lived signed URL per request.

CREATE TABLE IF NOT EXISTS public.files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Path inside the storage bucket. Unique: two rows pointing at the same
  -- object would let one be deleted while the other still promises it exists.
  storage_path TEXT NOT NULL UNIQUE,
  -- The name the uploader saw. Never used to build the storage path — a
  -- filename from a browser is attacker-controlled and may contain '../'.
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  -- What the file belongs to, and therefore who may read it. Nullable so a
  -- later feature can scope files another way without a migration.
  agreement_id UUID REFERENCES public.agreements(id) ON DELETE CASCADE,
  uploaded_by_user UUID NOT NULL,
  uploaded_by_wallet TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_files_agreement ON public.files(agreement_id, created_at DESC);

COMMENT ON TABLE public.files IS
  'Index of objects in the private storage bucket. Access is granted by the backend, never by a public URL.';

-- A message can carry several files, and a file is reachable through the
-- message it was sent in. Kept as a join table rather than an array column so
-- the reference is enforced and a deleted file cannot leave a dangling id.
CREATE TABLE IF NOT EXISTS public.agreement_message_attachments (
  message_id UUID NOT NULL REFERENCES public.agreement_messages(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_file
  ON public.agreement_message_attachments(file_id);

-- `agreement_messages.message` stays NOT NULL on purpose: an attachment-only
-- message is sent as an empty string, which the column already allows. Making
-- it nullable would mean altering a live column for no behaviour we need.
