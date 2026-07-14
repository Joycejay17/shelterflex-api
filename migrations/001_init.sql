-- Enable UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- DEALS

CREATE TABLE deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_external_ref_v1 TEXT NOT NULL,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX deals_canonical_external_ref_v1_uidx
ON deals (canonical_external_ref_v1);

CREATE INDEX deals_status_idx ON deals (status);


-- LISTINGS

CREATE TABLE listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX listings_deal_id_idx ON listings (deal_id);
CREATE INDEX listings_status_idx ON listings (status);


-- REWARDS

CREATE TABLE rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX rewards_listing_id_idx ON rewards (listing_id);
CREATE INDEX rewards_status_idx ON rewards (status);


-- OUTBOX

-- outbox_items is defined in 005_outbox.sql (superseded this early stub before any
-- intervening migration referenced it)