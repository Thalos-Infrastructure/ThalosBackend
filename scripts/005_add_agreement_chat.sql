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

-- Create index on sender_id for query performance (only if column was just added)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = 'public'
    AND table_name = 'agreement_messages'
    AND index_name = 'idx_agreement_messages_sender_id'
  ) THEN
    CREATE INDEX idx_agreement_messages_sender_id ON public.agreement_messages(sender_id);
  END IF;
END $$;
