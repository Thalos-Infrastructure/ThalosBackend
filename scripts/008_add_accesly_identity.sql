-- ThalosFrontend#109 — Accesly (passkey, non-custodial) identity persistence.
-- Reuses the auth_provider column planned for the Pollar social login
-- (ThalosFrontend#108); columns are guarded with IF NOT EXISTS so whichever
-- migration runs first wins.

-- user_wallets.user_id must reference the backend's public.auth_users: the
-- API authenticates against auth_users (custom JWT), not Supabase Auth's
-- auth.users, so 001's FK rejects every insert the backend attempts.
ALTER TABLE public.user_wallets
  DROP CONSTRAINT IF EXISTS user_wallets_user_id_fkey;
ALTER TABLE public.user_wallets
  ADD CONSTRAINT user_wallets_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;

-- 001's CHECK predates Accesly — recreate it so wallet_type accepts 'accesly'
-- (mirrors the LinkWalletDto whitelist).
ALTER TABLE public.user_wallets
  DROP CONSTRAINT IF EXISTS user_wallets_wallet_type_check;
ALTER TABLE public.user_wallets
  ADD CONSTRAINT user_wallets_wallet_type_check
  CHECK (wallet_type IN ('custodial', 'freighter', 'lobstr', 'xbull', 'albedo', 'accesly', 'other'));

-- Login method that produced the wallet: 'accesly', 'pollar', etc.
ALTER TABLE public.user_wallets
  ADD COLUMN IF NOT EXISTS auth_provider text;

-- Smart Account contract address (C…) for account-abstraction wallets.
-- wallet_address keeps the classic G-address — Trustless Work role matching
-- (by-signer / by-role) stays keyed on the G-address.
ALTER TABLE public.user_wallets
  ADD COLUMN IF NOT EXISTS c_address text;

-- Login method on the auth user, echoed back by /api/auth/me so the frontend
-- can route signing to the right provider after a reload.
ALTER TABLE public.auth_users
  ADD COLUMN IF NOT EXISTS wallet_provider text;

-- One Smart Account maps to exactly one linked wallet row.
CREATE UNIQUE INDEX IF NOT EXISTS user_wallets_c_address_key
  ON public.user_wallets (c_address)
  WHERE c_address IS NOT NULL;

COMMENT ON COLUMN public.user_wallets.auth_provider IS 'Login method that produced this wallet (accesly, pollar, …). NULL for externally connected wallets.';
COMMENT ON COLUMN public.user_wallets.c_address IS 'Soroban Smart Account address (C…) when the wallet is account-abstracted; wallet_address holds the derived G-address.';
