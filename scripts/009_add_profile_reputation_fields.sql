-- Migration: Add reputation-related fields to profiles (issue #147)
--
-- Adds:
--   handle          — unique public slug for builder profile URLs (/connect/[handle])
--   show_earnings   — opt-in flag: when false, total_released_usdc is hidden on public routes
--   github_verified — boolean from C6 GitHub verification (null/true when available)
--
-- Additive + idempotent + backward compatible:
--   • All columns are nullable or have defaults, so existing rows are unaffected.
--   • Safe to run more than once (IF NOT EXISTS).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS handle TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_earnings BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS github_verified BOOLEAN;

-- Unique index on handle: only enforced for non-null values (partial index).
-- This allows multiple profiles with NULL handle while keeping handles unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle
  ON public.profiles (handle)
  WHERE handle IS NOT NULL;

COMMENT ON COLUMN public.profiles.handle IS
  'Unique public slug for builder profile URLs (e.g. /connect/[handle]). Set once by the user.';
COMMENT ON COLUMN public.profiles.show_earnings IS
  'Opt-in flag: when true, total_released_usdc is visible on public reputation routes.';
COMMENT ON COLUMN public.profiles.github_verified IS
  'Whether the builders GitHub identity has been verified via C6. Null until C6 data is available.';
