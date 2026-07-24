-- Migration: Create verifications table (KYC/KYB compliance status)
-- Issue: #74 — Create Verification Status & Compliance API
-- NOT YET APPLIED — run this against the Supabase project before using /v1/verification/*
--
-- Single source of truth for compliance data. One subject (a user or a business)
-- may have several rows, one per identity provider (Sumsub, Persona, Veriff,
-- manual review, ...). The Verification API aggregates them into a standardized
-- response, so callers never care which provider produced the data.

CREATE TABLE IF NOT EXISTS public.verifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type       TEXT NOT NULL CHECK (subject_type IN ('user', 'business')),
  subject_id         UUID NOT NULL,
  provider           TEXT,
  provider_reference TEXT,
  status             TEXT NOT NULL DEFAULT 'unverified'
                       CHECK (status IN ('unverified', 'pending', 'verified', 'expired', 'rejected')),
  level              TEXT NOT NULL DEFAULT 'none'
                       CHECK (level IN ('none', 'basic', 'standard', 'advanced')),
  verified_at        TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verifications_subject
  ON public.verifications (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_verifications_status ON public.verifications (status);
CREATE INDEX IF NOT EXISTS idx_verifications_provider ON public.verifications (provider);

-- At most one row per (subject, provider); a subject may still use several providers.
CREATE UNIQUE INDEX IF NOT EXISTS idx_verifications_subject_provider
  ON public.verifications (subject_type, subject_id, provider)
  WHERE provider IS NOT NULL;

ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;

-- The API reads through the service role, which bypasses RLS. This policy only
-- scopes *direct* client access: an individual user may read their own KYC rows.
-- Business (KYB) rows stay service-role-only until org membership exists.
CREATE POLICY "Users can view their own verifications"
  ON public.verifications FOR SELECT
  USING (subject_type = 'user' AND subject_id = auth.uid());

COMMENT ON TABLE public.verifications IS
  'KYC (user) and KYB (business) compliance status, aggregated across identity providers. Single source of truth for verification. See issue #74.';
