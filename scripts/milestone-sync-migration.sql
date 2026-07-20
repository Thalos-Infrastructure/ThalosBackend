-- Milestone Synchronization Service: database migration
-- Run this in the Supabase SQL editor before deploying the sync service.

-- -------------------------------------------------------
-- 1. milestone_sync_log
--    Idempotency store: one row per (idempotency_key).
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS milestone_sync_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key   TEXT NOT NULL UNIQUE,
  agreement_id      UUID NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  milestone_index   INTEGER NOT NULL,
  direction         TEXT NOT NULL CHECK (direction IN ('thalos_to_tw', 'tw_to_thalos')),
  thalos_status     TEXT NOT NULL,
  tw_status         TEXT,
  outcome           TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'already_applied', 'conflict')),
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_log_agreement
  ON milestone_sync_log(agreement_id, milestone_index);

-- -------------------------------------------------------
-- 2. milestone_sync_queue
--    Retry queue and dead-letter store.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS milestone_sync_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id      UUID NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  contract_id       TEXT NOT NULL,
  milestone_index   INTEGER NOT NULL,
  thalos_status     TEXT NOT NULL,
  actor_wallet      TEXT NOT NULL,
  service_type      TEXT NOT NULL CHECK (service_type IN ('single-release', 'multi-release')),
  evidence          TEXT,
  idempotency_key   TEXT NOT NULL,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'dead_letter')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_pending
  ON milestone_sync_queue(status, next_attempt_at)
  WHERE status = 'pending';

-- -------------------------------------------------------
-- 3. milestone_sync_conflicts
--    Audit table for detected divergences between systems.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS milestone_sync_conflicts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id      UUID NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  milestone_index   INTEGER NOT NULL,
  thalos_status     TEXT NOT NULL,
  tw_status         TEXT NOT NULL,
  detected_at       TIMESTAMPTZ NOT NULL,
  resolved          BOOLEAN NOT NULL DEFAULT false,
  resolved_at       TIMESTAMPTZ,
  resolution_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_agreement
  ON milestone_sync_conflicts(agreement_id, resolved);
