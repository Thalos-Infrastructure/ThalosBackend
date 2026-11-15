-- ThalosBackend#197 / ThalosFrontend#213 — drop Accesly wallet support.
-- Trustless Work V1 cannot use C-addresses as escrow parties. Pollar + Kit remain.
-- 008 added wallet_type 'accesly'; this undoes that CHECK value and the rows.

DELETE FROM public.user_wallets
WHERE wallet_type = 'accesly' OR auth_provider = 'accesly';

UPDATE public.auth_users
SET wallet_provider = NULL
WHERE wallet_provider = 'accesly';

ALTER TABLE public.user_wallets
  DROP CONSTRAINT IF EXISTS user_wallets_wallet_type_check;
ALTER TABLE public.user_wallets
  ADD CONSTRAINT user_wallets_wallet_type_check
  CHECK (wallet_type IN ('custodial', 'freighter', 'lobstr', 'xbull', 'albedo', 'other'));

COMMENT ON COLUMN public.user_wallets.auth_provider IS
  'Login method that produced this wallet (pollar). NULL for externally connected wallets.';
