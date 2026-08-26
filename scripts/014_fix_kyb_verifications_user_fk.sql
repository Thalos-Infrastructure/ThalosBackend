-- Point kyb_verifications.requested_by at auth_users, like scripts/008 (Accesly)
-- already does for user_wallets. NOT YET APPLIED — run this against the Supabase
-- project.
--
-- Same defect, same cause: the column was declared REFERENCES auth.users(id),
-- Supabase Auth's own table, but the value written is the JWT `sub`, which is
-- an auth_users id. KybService itself proves it — isAdmin() resolves the very
-- same userId with `.from('auth_users').eq('id', userId)`. The two id spaces
-- never coincide, so inserting a KYB session could only fail on the constraint.
--
-- auth_users(id) is the convention everywhere else in this schema:
-- linked_wallets, password_reset_tokens and agreement_messages.sender_id all
-- reference it. user_wallets and kyb_verifications were the two exceptions.

-- Rebuilt only while the constraint is missing or still points at auth.users.
-- An unconditional DROP + re-ADD would be worse than not idempotent: there is no
-- migration runner or ledger here, so re-applying scripts/ from the top is the
-- documented workflow — and after an operator has run VALIDATE CONSTRAINT, that
-- second pass would silently drop the validated constraint and put back a
-- NOT VALID one, losing the guarantee that existing rows are clean, with no
-- error and no output to notice it by.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class rt ON rt.oid = c.confrelid
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE c.conname = 'kyb_verifications_requested_by_fkey'
      AND n.nspname = 'public'
      AND t.relname = 'kyb_verifications'
      AND rn.nspname = 'public'
      AND rt.relname = 'auth_users'
  ) THEN
    ALTER TABLE public.kyb_verifications
      DROP CONSTRAINT IF EXISTS kyb_verifications_requested_by_fkey;

    -- NOT VALID so the migration cannot fail on rows predating the fix, while
    -- still enforcing every insert and update from here on. Once any legacy rows
    -- are reconciled, run:
    --   ALTER TABLE public.kyb_verifications
    --     VALIDATE CONSTRAINT kyb_verifications_requested_by_fkey;
    ALTER TABLE public.kyb_verifications
      ADD CONSTRAINT kyb_verifications_requested_by_fkey
      FOREIGN KEY (requested_by) REFERENCES public.auth_users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.kyb_verifications.requested_by IS 'auth_users.id — the same id the app JWT carries in `sub`. NOT auth.users(id).';
