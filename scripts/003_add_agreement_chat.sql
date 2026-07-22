-- Migration: Add agreement chat and participant tracking
-- Adds sender_id to agreement_messages and ensures agreement tables have proper structure

-- Create agreement_participants table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.agreement_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  role TEXT NOT NULL,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agreement_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_agreement_participants_agreement_id ON public.agreement_participants(agreement_id);
CREATE INDEX IF NOT EXISTS idx_agreement_participants_wallet_address ON public.agreement_participants(wallet_address);

ALTER TABLE public.agreement_participants ENABLE ROW LEVEL SECURITY;

-- Create agreement_messages table with sender_id support
CREATE TABLE IF NOT EXISTS public.agreement_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agreement_messages_agreement_id ON public.agreement_messages(agreement_id);
CREATE INDEX IF NOT EXISTS idx_agreement_messages_sender_id ON public.agreement_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_agreement_messages_created_at ON public.agreement_messages(created_at);

ALTER TABLE public.agreement_messages ENABLE ROW LEVEL SECURITY;

-- Create agreement_activity table for audit trail
CREATE TABLE IF NOT EXISTS public.agreement_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  actor_wallet TEXT NOT NULL,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agreement_activity_agreement_id ON public.agreement_activity(agreement_id);
CREATE INDEX IF NOT EXISTS idx_agreement_activity_created_at ON public.agreement_activity(created_at);

ALTER TABLE public.agreement_activity ENABLE ROW LEVEL SECURITY;

-- Add sender_id column to agreement_messages if it doesn't already exist
-- (For tables that might have been created without this column)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'agreement_messages'
    AND column_name = 'sender_id'
  ) THEN
    ALTER TABLE public.agreement_messages ADD COLUMN sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
    CREATE INDEX idx_agreement_messages_sender_id ON public.agreement_messages(sender_id);
  END IF;
END $$;
