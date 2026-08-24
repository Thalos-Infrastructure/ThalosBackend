-- Migration: Create opportunities table for Thalos Connect (issue #138)
-- New entity. Do not extend or reuse legacy bounties tables.

CREATE TABLE IF NOT EXISTS public.opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  skills_required TEXT[] NOT NULL DEFAULT '{}',
  budget_amount NUMERIC NOT NULL CHECK (budget_amount > 0),
  budget_asset TEXT NOT NULL DEFAULT 'USDC',
  engagement_type TEXT NOT NULL CHECK (engagement_type IN ('fixed', 'milestone', 'hourly')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'filled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_project_id ON public.opportunities(project_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON public.opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_engagement_type ON public.opportunities(engagement_type);
CREATE INDEX IF NOT EXISTS idx_opportunities_budget_amount ON public.opportunities(budget_amount);
CREATE INDEX IF NOT EXISTS idx_opportunities_created_at ON public.opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_skills_required ON public.opportunities USING GIN (skills_required);

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

-- Nest uses SUPABASE_SERVICE_ROLE_KEY and bypasses RLS.
-- These policies only apply if a non-service-role client ever reads the table.
CREATE POLICY "Authenticated clients can read open opportunities"
  ON public.opportunities
  FOR SELECT
  USING (status = 'open');

COMMENT ON TABLE public.opportunities IS
  'Roles/tasks a Project publishes for builders to discover in Thalos Connect. Separate from legacy bounties.';
COMMENT ON COLUMN public.opportunities.project_id IS
  'Owning Project profile (profiles.id).';
COMMENT ON COLUMN public.opportunities.engagement_type IS
  'fixed | milestone | hourly.';
COMMENT ON COLUMN public.opportunities.status IS
  'open (discoverable) | closed | filled. Transitions: open → closed, open → filled.';
