-- Key Pollar identities on Pollar's user id, not on the email (ThalosFrontend#108).
-- NOT YET APPLIED — run this against the Supabase project before using Pollar login.
-- Moved here from ThalosFrontend/scripts/013 so all DDL lives in one repo.

-- POST /v1/tokens/verify returns a trustworthy `userId`, but carries no
-- "email verified" flag. Matching an existing Thalos account by email would
-- therefore hand that account to whoever presents a Pollar profile bearing the
-- same address. The user id is the only identifier Pollar vouches for, so it is
-- what we key on; Thalos keeps managing its own emails independently.
ALTER TABLE public.auth_users
  ADD COLUMN IF NOT EXISTS pollar_user_id TEXT;

-- One Pollar identity maps to exactly one Thalos account. Partial, because the
-- column is NULL for every account created by any other login method.
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_pollar_user_id
  ON public.auth_users(pollar_user_id)
  WHERE pollar_user_id IS NOT NULL;

COMMENT ON COLUMN public.auth_users.pollar_user_id IS 'Pollar user id (userId from POST /v1/tokens/verify). The identity Pollar logins are keyed on; NULL for accounts created any other way.';
