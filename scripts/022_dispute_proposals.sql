-- Migration: party-to-party settlement proposals on an open dispute
--
-- Both sides can propose a split (percentages). When the other side accepts,
-- Thalos records the agreement. Nest does not sign Trustless Work: the
-- wallets still have to authorize resolve_dispute.

CREATE TABLE IF NOT EXISTS public.dispute_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES public.disputes(id) ON DELETE CASCADE,
  proposed_by TEXT NOT NULL,
  payer_percentage INTEGER NOT NULL CHECK (payer_percentage >= 0 AND payer_percentage <= 100),
  payee_percentage INTEGER NOT NULL CHECK (payee_percentage >= 0 AND payee_percentage <= 100),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  responded_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dispute_proposals_percentages_sum CHECK (payer_percentage + payee_percentage = 100)
);

CREATE INDEX IF NOT EXISTS idx_dispute_proposals_dispute
  ON public.dispute_proposals(dispute_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispute_proposals_one_pending
  ON public.dispute_proposals(dispute_id)
  WHERE status = 'pending';

COMMENT ON TABLE public.dispute_proposals IS
  'Off-chain split offers between the parties. Accepting does not move funds.';
