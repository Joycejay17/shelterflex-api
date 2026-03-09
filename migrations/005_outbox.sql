-- Migration: 005_outbox.sql
-- Description: Persistent outbox table for reliable chain writes with idempotency

CREATE TABLE IF NOT EXISTS outbox_items (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_id                    CHAR(64) NOT NULL,          -- SHA-256 hex of canonical ref
    tx_type                  TEXT NOT NULL,
    canonical_external_ref_v1 TEXT NOT NULL UNIQUE,      -- idempotency key
    status                   TEXT NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'sent', 'failed')),
    retry_count              INTEGER NOT NULL DEFAULT 0,
    next_retry_at            TIMESTAMP WITH TIME ZONE,
    processed_at             TIMESTAMP WITH TIME ZONE,
    last_error               TEXT NOT NULL DEFAULT '',
    attempts                 INTEGER NOT NULL DEFAULT 0,
    aggregate_type           TEXT NOT NULL DEFAULT '',
    aggregate_id             TEXT NOT NULL DEFAULT '',
    event_type               TEXT NOT NULL DEFAULT '',
    payload                  JSONB NOT NULL DEFAULT '{}',
    created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS idx_outbox_status        ON outbox_items(status);
CREATE INDEX IF NOT EXISTS idx_outbox_tx_id         ON outbox_items(tx_id);
CREATE INDEX IF NOT EXISTS idx_outbox_next_retry    ON outbox_items(next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbox_payload_deal  ON outbox_items((payload->>'dealId'));
CREATE INDEX IF NOT EXISTS idx_outbox_created_at    ON outbox_items(created_at);

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION update_outbox_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_outbox_updated_at'
    ) THEN
        CREATE TRIGGER trg_outbox_updated_at
        BEFORE UPDATE ON outbox_items
        FOR EACH ROW EXECUTE FUNCTION update_outbox_updated_at();
    END IF;
END;
$$;
