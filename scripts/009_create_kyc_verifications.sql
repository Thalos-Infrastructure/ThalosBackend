-- Migration: Create kyc_verifications table for individual KYC workflow

CREATE TABLE IF NOT EXISTS public.kyc_verifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'pending' 
                       CHECK (status IN ('pending', 'in_review', 'verified', 'rejected', 'expired')),
  provider           TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  rejection_reason   TEXT,
  verified_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_kyc_verifications_user_id ON public.kyc_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_status ON public.kyc_verifications(status);

ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own KYC verifications" ON public.kyc_verifications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own KYC verifications" ON public.kyc_verifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.kyc_verifications IS 'Know Your Customer (KYC) verification records for individuals. Provider-agnostic.';
