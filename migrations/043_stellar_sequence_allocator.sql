-- Sequence allocator for Stellar/Soroban transactions
-- Prevents tx_bad_seq errors by coordinating sequence number allocation across concurrent requests

CREATE TABLE IF NOT EXISTS stellar_sequence_allocators (
    account_address TEXT PRIMARY KEY,
    last_allocated_sequence BIGINT NOT NULL,
    last_chain_sequence BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Track allocated sequence numbers for hole detection and recovery
CREATE TABLE IF NOT EXISTS stellar_sequence_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_address TEXT NOT NULL,
    allocated_sequence BIGINT NOT NULL,
    transaction_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS stellar_sequence_allocations_account_idx 
    ON stellar_sequence_allocations (account_address, allocated_sequence);

CREATE INDEX IF NOT EXISTS stellar_sequence_allocations_status_idx 
    ON stellar_sequence_allocations (account_address, status, created_at);

-- Index for finding holes (pending allocations older than threshold)
CREATE INDEX IF NOT EXISTS stellar_sequence_allocations_holes_idx 
    ON stellar_sequence_allocations (account_address, status, created_at) 
    WHERE status = 'pending';
