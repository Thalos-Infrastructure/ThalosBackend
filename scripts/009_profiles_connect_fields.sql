-- Thalos Connect (Phase 1): add Builder + Project profile fields.
-- Profiles is the canonical source of truth consumed by the FE (Thalos Connect).
-- All new columns are nullable and backward-compatible. KYB stays in its own domain.
--
-- Apply:    run this file against the Supabase project (SQL editor / psql).
-- Rollback: see the "ROLLBACK" block at the bottom.

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------

-- Builder fields
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS headline TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS skills TEXT[];
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tech_stack TEXT[];
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS availability TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS portfolio_links JSONB;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_links JSONB;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS handle TEXT;

-- Project fields (a single account can be both Builder and Project)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS org_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS org_description TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS org_website TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS looking_for TEXT[];
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS org_links JSONB;

-- availability is a small closed set (nullable = not set yet)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_availability_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_availability_check CHECK (
  availability IS NULL OR availability IN ('available', 'open', 'unavailable')
);

-- handle must be a URL-safe slug (consumed by the public profile page).
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_handle_format;
ALTER TABLE profiles ADD CONSTRAINT profiles_handle_format CHECK (
  handle IS NULL
  OR (handle ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(handle) BETWEEN 3 AND 32)
);

-- handle is unique when set (partial index allows many NULLs).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_unique
  ON profiles (handle)
  WHERE handle IS NOT NULL;

-- Discovery filters (Connect Builders directory) use array overlap on these.
CREATE INDEX IF NOT EXISTS idx_profiles_skills ON profiles USING GIN (skills);
CREATE INDEX IF NOT EXISTS idx_profiles_tech_stack ON profiles USING GIN (tech_stack);

-- Only profiles with a handle appear in discovery; index the filter.
CREATE INDEX IF NOT EXISTS idx_profiles_handle_present
  ON profiles (handle)
  WHERE handle IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ROLLBACK (reversible) — run to undo this migration:
-- ---------------------------------------------------------------------------
-- DROP INDEX IF EXISTS idx_profiles_handle_present;
-- DROP INDEX IF EXISTS idx_profiles_tech_stack;
-- DROP INDEX IF EXISTS idx_profiles_skills;
-- DROP INDEX IF EXISTS profiles_handle_unique;
-- ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_handle_format;
-- ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_availability_check;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS org_links;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS looking_for;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS org_website;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS org_description;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS org_name;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS handle;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS social_links;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS portfolio_links;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS availability;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS hourly_rate;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS tech_stack;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS skills;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS bio;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS headline;
