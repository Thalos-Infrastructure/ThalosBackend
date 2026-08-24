-- 013_backfill_user_wallets.sql
--
-- Consolidates `user_wallets` as the source of truth for wallet ownership.
--
-- Context: access to agreements used to be resolved from the single
-- `auth_users.wallet_public_key` field. Users who connected a second wallet
-- lost sight of agreements created with the first one. The API now resolves
-- every wallet a user owns from `user_wallets`, so any wallet that only exists
-- on `auth_users` must be copied over or its agreements become unreachable.
--
-- Safe to run repeatedly: ON CONFLICT DO NOTHING plus the UNIQUE(user_id,
-- wallet_address) constraint from 001 make this idempotent. Nothing is
-- deleted and `auth_users.wallet_public_key` is intentionally left in place as
-- a fallback.

-- 1. Report: wallets that exist only on auth_users (the rows at risk).
--    Run this first to see the blast radius before writing anything.
SELECT
  count(*) AS orphan_wallets
FROM public.auth_users au
WHERE au.wallet_public_key IS NOT NULL
  AND au.wallet_public_key <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_wallets uw
    WHERE uw.user_id = au.id
      AND uw.wallet_address = au.wallet_public_key
  );

-- 2. Backfill. Legacy wallets are marked verified because they were already
--    trusted as the user's sole identity by the previous access model.
INSERT INTO public.user_wallets (
  user_id,
  wallet_address,
  label,
  is_primary,
  is_verified,
  verified_at
)
SELECT
  au.id,
  au.wallet_public_key,
  'Wallet principal',
  -- Only claim primary if the user has no primary wallet yet; the partial
  -- unique index idx_user_wallets_primary allows exactly one per user.
  NOT EXISTS (
    SELECT 1
    FROM public.user_wallets uw
    WHERE uw.user_id = au.id
      AND uw.is_primary = true
  ),
  true,
  now()
FROM public.auth_users au
WHERE au.wallet_public_key IS NOT NULL
  AND au.wallet_public_key <> ''
ON CONFLICT (user_id, wallet_address) DO NOTHING;

-- 3. Verify: this must return 0 rows once the backfill has run.
SELECT
  au.id AS user_id,
  au.wallet_public_key
FROM public.auth_users au
WHERE au.wallet_public_key IS NOT NULL
  AND au.wallet_public_key <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_wallets uw
    WHERE uw.user_id = au.id
      AND uw.wallet_address = au.wallet_public_key
  );
