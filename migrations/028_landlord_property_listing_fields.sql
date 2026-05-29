-- Landlord property upload & management fields (issue #894)

ALTER TABLE landlord_properties
  ADD COLUMN IF NOT EXISTS property_type TEXT,
  ADD COLUMN IF NOT EXISTS amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS negotiated_landlord_rate_ngn NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS outright_price_ngn NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS installment_base_price_ngn NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS listing_id UUID,
  ADD COLUMN IF NOT EXISTS primary_photo_index INTEGER NOT NULL DEFAULT 0;

UPDATE landlord_properties SET status = 'pending_review' WHERE status = 'pending';
UPDATE landlord_properties SET status = 'approved' WHERE status = 'active';
UPDATE landlord_properties SET status = 'deactivated' WHERE status = 'inactive';

ALTER TABLE landlord_properties DROP CONSTRAINT IF EXISTS landlord_properties_status_check;
ALTER TABLE landlord_properties ADD CONSTRAINT landlord_properties_status_check
  CHECK (status IN ('pending_review', 'approved', 'rented', 'deactivated', 'pending', 'active', 'inactive'));

ALTER TABLE landlord_properties
  ADD CONSTRAINT landlord_properties_amenities_is_array CHECK (jsonb_typeof(amenities) = 'array');
