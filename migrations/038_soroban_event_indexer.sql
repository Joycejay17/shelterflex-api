-- Soroban Event Indexer Tables
-- Stores indexed contract events and indexer state

CREATE TABLE IF NOT EXISTS indexed_contract_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id TEXT NOT NULL,
    ledger_sequence BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    event_type TEXT NOT NULL,
    topic_1 TEXT,
    topic_2 TEXT,
    data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS indexed_contract_events_contract_id_idx ON indexed_contract_events(contract_id);
CREATE INDEX IF NOT EXISTS indexed_contract_events_ledger_sequence_idx ON indexed_contract_events(ledger_sequence);
CREATE INDEX IF NOT EXISTS indexed_contract_events_transaction_hash_idx ON indexed_contract_events(transaction_hash);
CREATE INDEX IF NOT EXISTS indexed_contract_events_event_type_idx ON indexed_contract_events(event_type);
CREATE INDEX IF NOT EXISTS indexed_contract_events_topic_1_idx ON indexed_contract_events(topic_1);
CREATE INDEX IF NOT EXISTS indexed_contract_events_indexed_at_idx ON indexed_contract_events(indexed_at DESC);

-- Unique constraint to prevent duplicate events (same transaction + event index)
CREATE UNIQUE INDEX IF NOT EXISTS indexed_contract_events_unique_event 
    ON indexed_contract_events(transaction_hash, ledger_sequence);

CREATE TABLE IF NOT EXISTS indexer_state (
    contract_id TEXT PRIMARY KEY,
    last_ledger_sequence BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS indexer_state_updated_at_idx ON indexer_state(updated_at DESC);
