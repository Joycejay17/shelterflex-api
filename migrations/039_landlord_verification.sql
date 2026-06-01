-- Add verification fields to landlord_profiles
ALTER TABLE landlord_profiles
  ADD COLUMN IF NOT EXISTS verification_level TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ NULL;

-- Comment
COMMENT ON COLUMN landlord_profiles.verification_level IS 'One of: unverified, id_verified, id_and_property_verified, premium';
COMMENT ON COLUMN landlord_profiles.verified_at IS 'Timestamp when landlord was last verified by admin';
