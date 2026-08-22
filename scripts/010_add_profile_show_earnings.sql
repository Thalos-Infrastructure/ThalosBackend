-- Migration 010: Add show_earnings opt-in flag to profiles (issue #147)
--
-- Adds:
--   show_earnings — opt-in flag: when false, total_released_usdc is hidden
--                   on public reputation routes.
--
-- NOTE: `handle` is owned by migration 009 (PR #159 / Connect fields).
--       `github_verified` is derived from `github_verified_at IS NOT NULL`
--       once C6 GitHub evidence (PR #157) lands — no dedicated boolean needed.
--
-- Additive + idempotent + backward compatible:
--   • Column has a DEFAULT, so existing rows are unaffected.
--   • Safe to run more than once (IF NOT EXISTS).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_earnings BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.show_earnings IS
  'Opt-in flag: when true, total_released_usdc is visible on public reputation routes.';
