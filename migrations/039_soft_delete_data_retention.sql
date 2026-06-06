-- Migration: 039_soft_delete_data_retention.sql
-- Description: Add soft delete and data retention columns for NDPA compliance
-- Adds deleted_at columns with partial indexes to core tables for soft delete functionality
-- Retention period: 7 years for hard delete

-- Users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users (deleted_at) WHERE deleted_at IS NOT NULL;

-- Sessions table
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at ON sessions (deleted_at) WHERE deleted_at IS NOT NULL;

-- Wallets table
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_wallets_deleted_at ON wallets (deleted_at) WHERE deleted_at IS NOT NULL;

-- Linked addresses table
ALTER TABLE linked_addresses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_linked_addresses_deleted_at ON linked_addresses (deleted_at) WHERE deleted_at IS NOT NULL;

-- Landlord profiles table
ALTER TABLE landlord_profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_landlord_profiles_deleted_at ON landlord_profiles (deleted_at) WHERE deleted_at IS NOT NULL;

-- Tenant applications table
ALTER TABLE tenant_applications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_applications_deleted_at ON tenant_applications (deleted_at) WHERE deleted_at IS NOT NULL;

-- Whistleblower listings table
ALTER TABLE whistleblower_listings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_whistleblower_listings_deleted_at ON whistleblower_listings (deleted_at) WHERE deleted_at IS NOT NULL;

-- Tenant deals table
ALTER TABLE tenant_deals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_deals_deleted_at ON tenant_deals (deleted_at) WHERE deleted_at IS NOT NULL;

-- Landlord properties table
ALTER TABLE landlord_properties ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_landlord_properties_deleted_at ON landlord_properties (deleted_at) WHERE deleted_at IS NOT NULL;

-- NGN deposits table (financial data)
ALTER TABLE ngn_deposits ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_ngn_deposits_deleted_at ON ngn_deposits (deleted_at) WHERE deleted_at IS NOT NULL;

-- Conversions table (financial data)
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_conversions_deleted_at ON conversions (deleted_at) WHERE deleted_at IS NOT NULL;

-- Webhook events table
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_deleted_at ON webhook_events (deleted_at) WHERE deleted_at IS NOT NULL;

-- Webhook replay attempts table
ALTER TABLE webhook_replay_attempts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_replay_attempts_deleted_at ON webhook_replay_attempts (deleted_at) WHERE deleted_at IS NOT NULL;

-- OTP challenges table
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_otp_challenges_deleted_at ON otp_challenges (deleted_at) WHERE deleted_at IS NOT NULL;

-- Wallet challenges table
ALTER TABLE wallet_challenges ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_challenges_deleted_at ON wallet_challenges (deleted_at) WHERE deleted_at IS NOT NULL;

-- KYC documents table
ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_kyc_documents_deleted_at ON kyc_documents (deleted_at) WHERE deleted_at IS NOT NULL;

-- Tenant documents table
ALTER TABLE tenant_documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_documents_deleted_at ON tenant_documents (deleted_at) WHERE deleted_at IS NOT NULL;

-- Property photos table
ALTER TABLE property_photos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_property_photos_deleted_at ON property_photos (deleted_at) WHERE deleted_at IS NOT NULL;

-- Support messages table
ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_support_messages_deleted_at ON support_messages (deleted_at) WHERE deleted_at IS NOT NULL;
