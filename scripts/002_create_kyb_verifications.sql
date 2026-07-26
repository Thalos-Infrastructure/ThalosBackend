-- Migration: Create kyb_verifications table for business/organization KYB workflow

CREATE TABLE IF NOT EXISTS public.kyb_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company', 'startup', 'organization', 'legal_entity')),
  business_name TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'verified', 'rejected')),
  provider TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  rejection_reason TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id)
);

CREATE INDEX IF NOT EXISTS idx_kyb_verifications_requested_by ON public.kyb_verifications(requested_by);
CREATE INDEX IF NOT EXISTS idx_kyb_verifications_status ON public.kyb_verifications(status);

ALTER TABLE public.kyb_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requesters can view their own KYB verifications" ON public.kyb_verifications
  FOR SELECT USING (auth.uid() = requested_by);
CREATE POLICY "Requesters can insert their own KYB verifications" ON public.kyb_verifications
  FOR INSERT WITH CHECK (auth.uid() = requested_by);

COMMENT ON TABLE public.kyb_verifications IS 'Know Your Business (KYB) verification records for companies/startups/organizations/legal entities. Provider-agnostic: see IdentityProvider abstraction in src/kyb.';
