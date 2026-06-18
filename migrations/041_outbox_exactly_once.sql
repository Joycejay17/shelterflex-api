-- Migration: 041_outbox_exactly_once.sql
-- Description: Exactly-once on-chain settlement: durable intent, confirmation depth, worker fencing
--
-- Adds:
--   submitted_tx_hash   — Stellar tx hash persisted *before* broadcast so a crash-after-submit
--                         can be resolved by querying the chain rather than blind resubmission.
--   submitted_ledger    — Ledger sequence where the tx landed; used for confirmation depth check.
--   confirmation_depth  — Number of ledger closes required before marking SENT (default 3).
--   claimed_by          — Worker instance UUID; prevents two concurrent workers from processing
--                         the same row (SELECT … FOR UPDATE SKIP LOCKED + atomic claim UPDATE).
--   claimed_at          — Timestamp of the claim; stale claims (>5 min) are auto-released.
--
-- New statuses:
--   confirming  — Broadcast succeeded, waiting for confirmation_depth ledger closes.
--   reopened    — Previously SENT/CONFIRMING tx not found on chain after a reorg; re-queued.

-- 1. New columns
ALTER TABLE outbox_items
  ADD COLUMN IF NOT EXISTS submitted_tx_hash  TEXT,
  ADD COLUMN IF NOT EXISTS submitted_ledger   INTEGER,
  ADD COLUMN IF NOT EXISTS confirmation_depth INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS claimed_by         TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at         TIMESTAMP WITH TIME ZONE;

-- 2. Update the status CHECK constraint to include the new values
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'outbox_items'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE outbox_items DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE outbox_items
  ADD CONSTRAINT outbox_items_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'dead', 'confirming', 'reopened'));

-- 3. Indexes for new access patterns
CREATE INDEX IF NOT EXISTS idx_outbox_submitted_tx_hash
  ON outbox_items(submitted_tx_hash)
  WHERE submitted_tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_confirming
  ON outbox_items(submitted_ledger ASC)
  WHERE status = 'confirming';

-- Claimed items that can be reclaimed after a worker crash (stale > 5 min)
CREATE INDEX IF NOT EXISTS idx_outbox_stale_claims
  ON outbox_items(claimed_at)
  WHERE claimed_by IS NOT NULL;
