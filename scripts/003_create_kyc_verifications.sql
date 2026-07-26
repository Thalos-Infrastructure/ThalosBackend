-- Migration: Create kyc_verifications table for KYC provider integration
-- EXECUTED: Apply to Supabase

CREATE TYPE kyc_status AS ENUM ('pending', 'in_review', 'verified', 'rejected', 'expired');

CREATE TABLE IF NOT EXISTS public.kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_verification_id TEXT NOT NULL UNIQUE,
  status kyc_status NOT NULL DEFAULT 'pending',
  metadata JSONB DEFAULT '{}',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyc_verifications_user_id ON public.kyc_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_provider_verification_id ON public.kyc_verifications(provider_verification_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_status ON public.kyc_verifications(status);

ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own KYC verifications" ON public.kyc_verifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can insert KYC verifications" ON public.kyc_verifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update KYC verifications" ON public.kyc_verifications FOR UPDATE USING (true);

COMMENT ON TABLE public.kyc_verifications IS 'Stores KYC verification sessions created through the identity provider abstraction.';
COMMENT ON COLUMN public.kyc_verifications.provider IS 'Name of the KYC provider that handled this verification';
COMMENT ON COLUMN public.kyc_verifications.provider_verification_id IS 'Provider-side verification session identifier';
COMMENT ON COLUMN public.kyc_verifications.status IS 'Current verification status: pending, in_review, verified, rejected, expired';
