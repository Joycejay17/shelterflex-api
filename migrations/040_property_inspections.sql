-- Property inspection system for freelance property inspectors

-- Inspector profiles
CREATE TABLE IF NOT EXISTS inspector_profiles (
    user_id TEXT PRIMARY KEY,
    verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'verified', 'suspended')),
    bio TEXT,
    service_areas JSONB NOT NULL DEFAULT '[]'::jsonb,
    completed_inspections INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inspector_profiles_verification_status_idx ON inspector_profiles (verification_status);
CREATE INDEX IF NOT EXISTS inspector_profiles_service_areas_idx ON inspector_profiles USING GIN (service_areas);

-- Property inspections
CREATE TABLE IF NOT EXISTS property_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES whistleblower_listings(listing_id) ON DELETE CASCADE,
    inspector_id TEXT NOT NULL REFERENCES inspector_profiles(user_id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'submitted', 'approved', 'rejected')),
    scheduled_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    inspector_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS property_inspections_listing_id_idx ON property_inspections (listing_id);
CREATE INDEX IF NOT EXISTS property_inspections_inspector_id_idx ON property_inspections (inspector_id);
CREATE INDEX IF NOT EXISTS property_inspections_status_idx ON property_inspections (status);

-- Inspection checklist items
CREATE TABLE IF NOT EXISTS inspection_checklist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES property_inspections(id) ON DELETE CASCADE,
    category TEXT NOT NULL
        CHECK (category IN ('structural', 'plumbing', 'electrical', 'safety', 'exterior')),
    item TEXT NOT NULL,
    result TEXT NOT NULL
        CHECK (result IN ('pass', 'fail', 'na')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inspection_checklist_items_inspection_id_idx ON inspection_checklist_items (inspection_id);
CREATE INDEX IF NOT EXISTS inspection_checklist_items_category_idx ON inspection_checklist_items (category);

-- Inspection photos
CREATE TABLE IF NOT EXISTS inspection_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES property_inspections(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    caption TEXT,
    taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inspection_photos_inspection_id_idx ON inspection_photos (inspection_id);

-- Add trust score fields to whistleblower_listings
ALTER TABLE whistleblower_listings 
ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 50 CHECK (trust_score >= 0 AND trust_score <= 100),
ADD COLUMN IF NOT EXISTS has_verified_inspection BOOLEAN DEFAULT FALSE;
