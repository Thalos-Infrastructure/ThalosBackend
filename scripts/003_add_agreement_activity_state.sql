-- Migration: Add previous_state / new_state to agreement_activity (issue #61)
--
-- Extends the agreement activity log so status/milestone transitions record what
-- the state changed FROM and TO, for a more complete, trustworthy audit trail.
--
-- Additive + idempotent + backward compatible:
--   • Columns are nullable, so all existing rows are unaffected (NULL states).
--   • Safe to run more than once (IF NOT EXISTS).

ALTER TABLE public.agreement_activity
  ADD COLUMN IF NOT EXISTS previous_state TEXT;

ALTER TABLE public.agreement_activity
  ADD COLUMN IF NOT EXISTS new_state TEXT;
