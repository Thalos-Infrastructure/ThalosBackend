-- Migration: Create applications table for Thalos Connect — Issue #139
-- A builder applies to an opportunity; the owning Project accepts or rejects.
-- On acceptance the frontend re-uses the existing agreement creation flow (no new
-- on-chain path is introduced here).

CREATE TABLE IF NOT EXISTS public.applications (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID        NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  builder_id     UUID        NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
  message        TEXT        NOT NULL DEFAULT '',
  status         TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One application per (opportunity, builder) — duplicate prevention at DB level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_opportunity_builder
  ON public.applications (opportunity_id, builder_id);

CREATE INDEX IF NOT EXISTS idx_applications_opportunity_id
  ON public.applications (opportunity_id);

CREATE INDEX IF NOT EXISTS idx_applications_builder_id
  ON public.applications (builder_id);

CREATE INDEX IF NOT EXISTS idx_applications_status
  ON public.applications (status);

-- Auto-update updated_at on every row change.
CREATE OR REPLACE FUNCTION public.set_applications_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_updated_at ON public.applications;
CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_applications_updated_at();

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
-- Access is controlled exclusively through the service-role key used by
-- ThalosBackend; no direct client access is expected.

COMMENT ON TABLE public.applications IS
  'Builder applications to Connect opportunities. One row per (opportunity, builder). '
  'Status: pending → accepted | rejected. Issue #139.';

COMMENT ON COLUMN public.applications.opportunity_id IS
  'FK to opportunities(id). The opportunity the builder is applying to.';

COMMENT ON COLUMN public.applications.builder_id IS
  'FK to auth_users(id). The authenticated builder who submitted the application.';

COMMENT ON COLUMN public.applications.status IS
  'pending (default) → accepted | rejected. Only pending can be transitioned. On accept, '
  'the opportunity status is set to filled and remaining pending applications are rejected.';
