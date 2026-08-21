-- Migration: Add sender_id to agreement_messages for chat functionality
-- Adds nullable sender_id column to track message authors

-- Add sender_id column to agreement_messages if it doesn't already exist
-- Using NULL default to allow backfill of existing rows
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'agreement_messages'
    AND column_name = 'sender_id'
  ) THEN
    ALTER TABLE public.agreement_messages ADD COLUMN sender_id UUID NULL REFERENCES public.auth_users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create index on sender_id for query performance.
-- Was guarded by a lookup in information_schema.statistics, which is a MySQL
-- view: Postgres has no such relation, so this aborted with SQLSTATE 42P01 and
-- took every migration queued behind it down with it. CREATE INDEX IF NOT
-- EXISTS is the native equivalent and needs no guard at all.
CREATE INDEX IF NOT EXISTS idx_agreement_messages_sender_id
  ON public.agreement_messages(sender_id);
