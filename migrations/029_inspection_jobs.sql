-- Inspection job lifecycle for freelance property inspectors

CREATE TABLE IF NOT EXISTS inspection_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES whistleblower_listings(listing_id) ON DELETE CASCADE,
    inspector_id TEXT,
    status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'claimed', 'in_progress', 'submitted', 'approved', 'rejected')),
    offered_fee_ngn NUMERIC(20,2) NOT NULL CHECK (offered_fee_ngn > 0),
    claim_deadline TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inspection_jobs_listing_id_idx ON inspection_jobs (listing_id);
CREATE INDEX IF NOT EXISTS inspection_jobs_inspector_id_idx ON inspection_jobs (inspector_id);
CREATE INDEX IF NOT EXISTS inspection_jobs_status_idx ON inspection_jobs (status);

CREATE TABLE IF NOT EXISTS inspection_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES inspection_jobs(id) ON DELETE CASCADE,
    overall_grade TEXT NOT NULL CHECK (overall_grade IN ('A', 'B', 'C', 'D')),
    room_checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
    photo_keys TEXT[] NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT inspection_reports_photo_keys_min CHECK (array_length(photo_keys, 1) >= 3),
    CONSTRAINT inspection_reports_notes_min CHECK (char_length(notes) >= 20)
);

CREATE INDEX IF NOT EXISTS inspection_reports_job_id_idx ON inspection_reports (job_id);
