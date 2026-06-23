-- Signing Key Rotation State Machine
-- Tracks the state of key rotation operations with crash-safe durability

CREATE TABLE IF NOT EXISTS signing_key_rotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_type TEXT NOT NULL, -- 'admin' or 'custodial_wallet'
    account_address TEXT NOT NULL, -- Stellar account address
    
    -- State machine state
    state TEXT NOT NULL CHECK (state IN (
        'new_key_provisioned',
        'new_key_authorized_on_chain',
        'active_pointer_cutover',
        'old_key_deauthorized_on_chain',
        'old_key_destroyed',
        'completed',
        'failed'
    )),
    
    -- Key identifiers (never store actual secrets)
    old_key_id TEXT NOT NULL,
    new_key_id TEXT NOT NULL,
    
    -- On-chain signer management
    old_signer_added_at TIMESTAMPTZ,
    new_signer_added_at TIMESTAMPTZ,
    old_signer_removed_at TIMESTAMPTZ,
    
    -- Active key pointer (atomic cutover)
    active_key_id TEXT NOT NULL,
    active_key_cutover_at TIMESTAMPTZ,
    
    -- Sequence coordination
    sequence_at_rotation_start BIGINT,
    
    -- Metadata
    initiated_by TEXT NOT NULL,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    failure_reason TEXT,
    
    -- Audit trail
    audit_log JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure only one active rotation per key type/account
CREATE UNIQUE INDEX IF NOT EXISTS signing_key_rotations_active_idx 
    ON signing_key_rotations (key_type, account_address) 
    WHERE state NOT IN ('completed', 'failed');

-- Index for crash recovery
CREATE INDEX IF NOT EXISTS signing_key_rotations_state_idx 
    ON signing_key_rotations (state, updated_at);

-- Index for audit queries
CREATE INDEX IF NOT EXISTS signing_key_rotations_initiated_at_idx 
    ON signing_key_rotations (initiated_at DESC);

-- Track valid signers for zero-signer-window prevention
CREATE TABLE IF NOT EXISTS signing_key_valid_signers (
    account_address TEXT NOT NULL,
    key_id TEXT NOT NULL,
    signer_public_key TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    PRIMARY KEY (account_address, key_id)
);

-- Index for active signers query
CREATE INDEX IF NOT EXISTS signing_key_valid_signers_active_idx 
    ON signing_key_valid_signers (account_address, is_active) 
    WHERE is_active = true;

-- Index for historical queries
CREATE INDEX IF NOT EXISTS signing_key_valid_signers_removed_idx 
    ON signing_key_valid_signers (account_address, removed_at);
