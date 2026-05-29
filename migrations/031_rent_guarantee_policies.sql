-- Rent guarantee insurance policies for landlord protection

CREATE TABLE IF NOT EXISTS rent_guarantee_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL,
    landlord_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    policy_number TEXT NOT NULL UNIQUE,
    premium_ngn NUMERIC(20,2) NOT NULL CHECK (premium_ngn > 0),
    coverage_term_months INTEGER NOT NULL CHECK (coverage_term_months > 0),
    status TEXT NOT NULL DEFAULT 'quoted'
        CHECK (status IN ('quoted', 'active', 'cancelled', 'claimed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rent_guarantee_policies_deal_id_idx ON rent_guarantee_policies (deal_id);
CREATE INDEX IF NOT EXISTS rent_guarantee_policies_landlord_id_idx ON rent_guarantee_policies (landlord_id);
CREATE INDEX IF NOT EXISTS rent_guarantee_policies_status_idx ON rent_guarantee_policies (status);
