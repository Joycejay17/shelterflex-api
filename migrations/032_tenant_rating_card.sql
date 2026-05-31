-- Tenant Rating Card - portable reputation profile for tenants

CREATE TABLE IF NOT EXISTS tenant_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    landlord_id TEXT NOT NULL,
    deal_id UUID NOT NULL,
    payment_timeliness INTEGER NOT NULL CHECK (payment_timeliness BETWEEN 1 AND 5),
    property_care INTEGER NOT NULL CHECK (property_care BETWEEN 1 AND 5),
    communication INTEGER NOT NULL CHECK (communication BETWEEN 1 AND 5),
    overall INTEGER NOT NULL CHECK (overall BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tenant_ratings_unique UNIQUE (tenant_id, landlord_id, deal_id),
    CONSTRAINT tenant_ratings_comment_max CHECK (char_length(COALESCE(comment, '')) <= 500)
);

CREATE INDEX IF NOT EXISTS tenant_ratings_tenant_id_idx ON tenant_ratings (tenant_id);
CREATE INDEX IF NOT EXISTS tenant_ratings_landlord_id_idx ON tenant_ratings (landlord_id);
CREATE INDEX IF NOT EXISTS tenant_ratings_deal_id_idx ON tenant_ratings (deal_id);

CREATE TABLE IF NOT EXISTS rating_card_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rating_card_tokens_tenant_id_idx ON rating_card_tokens (tenant_id);
CREATE INDEX IF NOT EXISTS rating_card_tokens_token_idx ON rating_card_tokens (token);
