-- Authentication Tables Migration
-- Addresses issue #239: Move auth state to Postgres-backed stores

-- USERS TABLE
-- Stores user accounts with roles and wallet linkage
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('tenant', 'landlord', 'agent')),
    wallet_address TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for users
CREATE INDEX users_email_idx ON users (email);
CREATE INDEX users_wallet_address_idx ON users (wallet_address) WHERE wallet_address IS NOT NULL;

-- SESSIONS TABLE
-- Stores hashed session tokens for authentication
-- NEVER stores plaintext session tokens
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash of the session token
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ, -- NULL if not revoked
    -- Audit fields
    created_ip TEXT,
    user_agent TEXT
);

-- Indexes for sessions
CREATE INDEX sessions_token_hash_idx ON sessions (token_hash);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX sessions_revoked_at_idx ON sessions (revoked_at) WHERE revoked_at IS NOT NULL;

-- OTP_CHALLENGES TABLE
-- Stores OTP challenges for email-based authentication
-- NEVER stores plaintext OTPs
CREATE TABLE otp_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    otp_hash TEXT NOT NULL, -- SHA-256 hash of salt:otp
    salt TEXT NOT NULL, -- Salt for OTP hashing
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Audit fields
    created_ip TEXT,
    user_agent TEXT
);

-- Indexes for otp_challenges
CREATE INDEX otp_challenges_email_idx ON otp_challenges (email);
CREATE INDEX otp_challenges_expires_at_idx ON otp_challenges (expires_at);

-- WALLET_CHALLENGES TABLE
-- Stores wallet authentication challenges
CREATE TABLE wallet_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address TEXT NOT NULL,
    nonce TEXT NOT NULL,
    challenge_xdr TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used_at TIMESTAMPTZ, -- NULL if not used
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Audit fields
    created_ip TEXT,
    user_agent TEXT
);

-- Indexes for wallet_challenges
CREATE INDEX wallet_challenges_address_idx ON wallet_challenges (address);
CREATE INDEX wallet_challenges_expires_at_idx ON wallet_challenges (expires_at);
CREATE INDEX wallet_challenges_used_at_idx ON wallet_challenges (used_at) WHERE used_at IS NOT NULL;

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM sessions 
    WHERE expires_at < NOW() OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days');
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired challenges
CREATE OR REPLACE FUNCTION cleanup_expired_challenges()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Clean expired OTP challenges
    DELETE FROM otp_challenges WHERE expires_at < NOW();
    
    -- Clean expired wallet challenges
    DELETE FROM wallet_challenges WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE users IS 'User accounts with roles and optional wallet linkage';
COMMENT ON TABLE sessions IS 'User sessions with hashed tokens - never stores plaintext tokens';
COMMENT ON TABLE otp_challenges is 'OTP challenges for email authentication - never stores plaintext OTPs';
COMMENT ON TABLE wallet_challenges is 'Wallet authentication challenges with nonces';

COMMENT ON COLUMN sessions.token_hash IS 'SHA-256 hash of the session token for security';
COMMENT ON COLUMN otp_challenges.otp_hash IS 'SHA-256 hash of salt:otp for security';
COMMENT ON COLUMN otp_challenges.salt IS 'Unique salt per OTP challenge for secure hashing';
COMMENT ON COLUMN wallet_challenges.nonce IS 'Cryptographic nonce for wallet challenge verification';
COMMENT ON COLUMN wallet_challenges.challenge_xdr IS 'XDR-encoded challenge for wallet signing';
