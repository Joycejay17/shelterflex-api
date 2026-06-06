-- Migration: 016_outbox_dlq_columns.sql
-- Description: Add dead-letter queue metadata columns to outbox_items.
--   dead_lettered_at  — timestamp when the item was promoted to the DLQ
--   dead_letter_reason — same as last_error, kept as an explicit column for clarity
-- Related: Issue #1048 — Outbox Processor: Exponential Backoff & Dead-Letter Queue

ALTER TABLE outbox_items
  ADD COLUMN IF NOT EXISTS dead_lettered_at   TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT;

-- Back-fill existing dead items so the new column is consistent
UPDATE outbox_items
SET dead_lettered_at   = updated_at,
    dead_letter_reason = last_error
WHERE status = 'dead'
  AND dead_lettered_at IS NULL;

-- Index to speed up DLQ admin queries ordered by time of death
CREATE INDEX IF NOT EXISTS idx_outbox_dead_lettered_at
  ON outbox_items(dead_lettered_at DESC)
  WHERE status = 'dead';
