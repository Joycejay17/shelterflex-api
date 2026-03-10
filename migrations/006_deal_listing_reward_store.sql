-- Persistent storage for tenant deals, whistleblower listings, and rewards

-- Listings submitted by whistleblowers
CREATE TABLE IF NOT EXISTS whistleblower_listings (
    listing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    whistleblower_id TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT,
    area TEXT,
    bedrooms INTEGER NOT NULL CHECK (bedrooms >= 0),
    bathrooms INTEGER NOT NULL CHECK (bathrooms >= 0),
    annual_rent_ngn NUMERIC(20,2) NOT NULL CHECK (annual_rent_ngn > 0),
    description TEXT,
    photos JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected', 'rented')),
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    deal_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT photos_must_be_array CHECK (jsonb_typeof(photos) = 'array'),
    CONSTRAINT photos_min_length CHECK (jsonb_array_length(photos) >= 3)
);

CREATE INDEX IF NOT EXISTS whistleblower_listings_whistleblower_id_idx
    ON whistleblower_listings (whistleblower_id);
CREATE INDEX IF NOT EXISTS whistleblower_listings_status_idx
    ON whistleblower_listings (status);
CREATE INDEX IF NOT EXISTS whistleblower_listings_created_at_idx
    ON whistleblower_listings (created_at DESC);
CREATE INDEX IF NOT EXISTS whistleblower_listings_deal_id_idx
    ON whistleblower_listings (deal_id);
CREATE INDEX IF NOT EXISTS whistleblower_listings_search_idx
    ON whistleblower_listings
    USING GIN (to_tsvector('english', coalesce(address,'') || ' ' || coalesce(city,'') || ' ' || coalesce(area,'') || ' ' || coalesce(description,'')));


-- Deals between tenants and landlords
CREATE TABLE IF NOT EXISTS tenant_deals (
    deal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    landlord_id TEXT NOT NULL,
    listing_id UUID REFERENCES whistleblower_listings(listing_id) ON DELETE SET NULL,
    annual_rent_ngn NUMERIC(20,2) NOT NULL CHECK (annual_rent_ngn > 0),
    deposit_ngn NUMERIC(20,2) NOT NULL CHECK (deposit_ngn >= 0),
    financed_amount_ngn NUMERIC(20,2) NOT NULL CHECK (financed_amount_ngn >= 0),
    term_months INTEGER NOT NULL CHECK (term_months > 0),
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed', 'defaulted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_deals_tenant_id_idx ON tenant_deals (tenant_id);
CREATE INDEX IF NOT EXISTS tenant_deals_landlord_id_idx ON tenant_deals (landlord_id);
CREATE INDEX IF NOT EXISTS tenant_deals_status_idx ON tenant_deals (status);
CREATE INDEX IF NOT EXISTS tenant_deals_created_at_idx ON tenant_deals (created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_deals_listing_id_idx ON tenant_deals (listing_id);


-- Normalized repayment schedules per deal
CREATE TABLE IF NOT EXISTS tenant_deal_schedules (
    deal_id UUID NOT NULL REFERENCES tenant_deals(deal_id) ON DELETE CASCADE,
    period INTEGER NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    amount_ngn NUMERIC(20,2) NOT NULL CHECK (amount_ngn >= 0),
    status TEXT NOT NULL CHECK (status IN ('upcoming', 'due', 'paid', 'late')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (deal_id, period)
);

CREATE INDEX IF NOT EXISTS tenant_deal_schedules_status_idx ON tenant_deal_schedules (status);


-- Rewards payable to whistleblowers
CREATE TABLE IF NOT EXISTS whistleblower_rewards (
    reward_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    whistleblower_id TEXT NOT NULL,
    deal_id UUID NOT NULL REFERENCES tenant_deals(deal_id) ON DELETE CASCADE,
    listing_id UUID NOT NULL REFERENCES whistleblower_listings(listing_id) ON DELETE CASCADE,
    amount_usdc NUMERIC(20,6) NOT NULL CHECK (amount_usdc > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'payable', 'paid', 'cancelled')),
    payment_tx_id TEXT,
    external_ref_source TEXT,
    external_ref TEXT,
    metadata JSONB,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS whistleblower_rewards_status_idx ON whistleblower_rewards (status);
CREATE INDEX IF NOT EXISTS whistleblower_rewards_deal_id_idx ON whistleblower_rewards (deal_id);
CREATE INDEX IF NOT EXISTS whistleblower_rewards_listing_id_idx ON whistleblower_rewards (listing_id);
CREATE INDEX IF NOT EXISTS whistleblower_rewards_whistleblower_id_idx ON whistleblower_rewards (whistleblower_id);
CREATE INDEX IF NOT EXISTS whistleblower_rewards_created_at_idx ON whistleblower_rewards (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS whistleblower_rewards_external_ref_unique
    ON whistleblower_rewards (external_ref_source, external_ref)
    WHERE external_ref_source IS NOT NULL AND external_ref IS NOT NULL;
