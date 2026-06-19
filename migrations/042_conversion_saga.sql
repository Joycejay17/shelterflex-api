-- Atomic fiat <-> on-chain conversion saga.
--
-- Persists each NGN -> USDC conversion as an explicit state machine so the
-- off-chain fiat leg, the LOCKED FX rate, and the on-chain (Soroban) leg never
-- end up torn. The locked rate + expiry are stored WITH the saga record so
-- crash recovery re-executes at the original price instead of re-quoting.

CREATE TABLE IF NOT EXISTS conversion_sagas (
    saga_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deposit_id       TEXT NOT NULL,
    user_id          TEXT NOT NULL,
    kind             TEXT NOT NULL DEFAULT 'deposit',          -- 'deposit' | 'staking'
    amount_ngn       BIGINT NOT NULL,
    amount_usdc      TEXT NOT NULL DEFAULT '0',
    locked_rate      DOUBLE PRECISION NOT NULL,                -- NGN per 1 USDC, captured at quote time
    rate_expires_at  TIMESTAMPTZ NOT NULL,                     -- locked quote expiry
    provider         TEXT NOT NULL,
    provider_ref     TEXT NOT NULL DEFAULT '',
    state            TEXT NOT NULL DEFAULT 'quote_locked',
    compensation_ref TEXT,                                     -- refund/reversal reference
    failure_reason   TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT conversion_sagas_state_chk CHECK (
        state IN (
            'quote_locked',
            'fiat_committed',
            'onchain_submitted',
            'onchain_confirmed',
            'completed',
            'compensating',
            'compensated',
            'failed'
        )
    )
);

-- One saga per deposit gives once-per-deposit semantics and lets recovery
-- find the in-flight saga (with its original locked rate) by deposit id.
CREATE UNIQUE INDEX IF NOT EXISTS conversion_sagas_deposit_id_uidx
    ON conversion_sagas (deposit_id);

CREATE INDEX IF NOT EXISTS conversion_sagas_user_id_idx ON conversion_sagas (user_id);
CREATE INDEX IF NOT EXISTS conversion_sagas_state_idx ON conversion_sagas (state);
