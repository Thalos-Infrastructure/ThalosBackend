-- Migration: Index the columns GET /v1/agreements filters and scopes on (issue #141)
--
-- The endpoint resolves the caller's wallets, collects the agreements they created
-- or participate in, then narrows by status / agreement_type and orders by
-- created_at DESC. Each index below backs one step of that query:
--
--   agreements.created_by             → "agreements I created" (IN over owned wallets)
--   agreement_participants.wallet_address → "agreements I take part in"
--   agreements.status / agreement_type    → the ?status= and ?type= filters
--   agreements.created_at DESC            → the ordering
--
-- Additive + idempotent: only indexes, no schema or data changes, safe to re-run.
-- Some of these may already exist from the frontend repo's 002_create_agreements.sql,
-- which is why every statement is IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_agreements_status ON public.agreements(status);
CREATE INDEX IF NOT EXISTS idx_agreements_agreement_type ON public.agreements(agreement_type);
CREATE INDEX IF NOT EXISTS idx_agreements_created_by ON public.agreements(created_by);
CREATE INDEX IF NOT EXISTS idx_agreements_created_at ON public.agreements(created_at DESC);

-- Composite for the common case of both filters at once; Postgres prefers this
-- over bitmap-ANDing the two single-column indexes.
CREATE INDEX IF NOT EXISTS idx_agreements_status_type
  ON public.agreements(status, agreement_type);

CREATE INDEX IF NOT EXISTS idx_agreement_participants_wallet_address
  ON public.agreement_participants(wallet_address);
