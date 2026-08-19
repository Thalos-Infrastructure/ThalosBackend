-- 009_create_github_evidence.sql
-- Adds GitHub identity columns to profiles and creates the milestone_evidence_prs table.

-- ── 1. Extend profiles with verified GitHub identity ──────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS github_username       TEXT,
  ADD COLUMN IF NOT EXISTS github_verified_at    TIMESTAMPTZ;

COMMENT ON COLUMN profiles.github_username    IS 'GitHub username, verified via OAuth (not Supabase social auth).';
COMMENT ON COLUMN profiles.github_verified_at IS 'Timestamp when the GitHub username was verified via OAuth.';

-- ── 2. Milestone evidence PRs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS milestone_evidence_prs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id    UUID        NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  milestone_index INT         NOT NULL,
  repo            TEXT        NOT NULL,   -- "ORG/REPO"
  pr_number       INT         NOT NULL,
  title           TEXT        NOT NULL,
  url             TEXT        NOT NULL,
  merged_at       TIMESTAMPTZ NOT NULL,
  attached_by     TEXT        NOT NULL,   -- wallet address
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_milestone_pr UNIQUE (agreement_id, milestone_index, repo, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_milestone_evidence_prs_agreement
  ON milestone_evidence_prs (agreement_id, milestone_index);

COMMENT ON TABLE milestone_evidence_prs IS 'Merged PRs attached as verifiable evidence on agreement milestones.';
