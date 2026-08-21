-- Migration: Record which Pollar user owns a provisioned wallet (#108)
-- PENDING: not yet applied to Supabase
--
-- Numbered 013 — per README "Database & migrations", the later branch bumps:
-- 008 (Accesly, ThalosBackend#129), 009 (profiles connect), 010 (show_earnings)
-- and 011 (opportunities) all landed on main while this PR was open, and 012 is
-- this PR's auth_users.pollar_user_id. 017 (backfill_user_wallets) was placed
-- after these on purpose: it must run once user_wallets has its final shape.
-- 008 also adds user_wallets.auth_provider, which this migration originally
-- created; since 008 runs before this one, the column and its comment are left
-- to 008 rather than duplicated here.

-- Wallets provisioned through a social/email login (Pollar) are indistinguishable
-- from any other 'custodial' row today: wallet_type says HOW the key is held, not
-- WHO authenticated the user. auth_provider (008) records the login method; this
-- column records the identity behind it, so a support query can tell a
-- Pollar-provisioned wallet from one created by another custodial path, and so
-- the Pollar user can be looked up from the wallet.
ALTER TABLE public.user_wallets
  ADD COLUMN IF NOT EXISTS pollar_user_id TEXT;

-- Reverse lookup: given a Pollar user, find the wallet(s) linked to them. Partial
-- index because the column is NULL for every wallet not provisioned by Pollar.
CREATE INDEX IF NOT EXISTS idx_user_wallets_pollar_user_id
  ON public.user_wallets(pollar_user_id)
  WHERE pollar_user_id IS NOT NULL;

COMMENT ON COLUMN public.user_wallets.pollar_user_id IS 'Pollar user id (userId from POST /v1/tokens/verify) that owns this wallet. NULL for wallets not provisioned through Pollar.';
