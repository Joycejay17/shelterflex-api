-- Tenant Referral Programme (issue #1044)

CREATE TABLE referral_codes (
  id VARCHAR(128) PRIMARY KEY DEFAULT CONCAT('REF-', EXTRACT(EPOCH FROM NOW())::bigint, '-', nextval('referral_codes_seq')),
  tenant_id VARCHAR(128) NOT NULL UNIQUE,
  code VARCHAR(8) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE SEQUENCE IF NOT EXISTS referral_codes_seq;

CREATE TABLE referral_conversions (
  id VARCHAR(128) PRIMARY KEY DEFAULT CONCAT('REFCONV-', EXTRACT(EPOCH FROM NOW())::bigint, '-', nextval('referral_conversions_seq')),
  referral_code_id VARCHAR(128) NOT NULL,
  referrer_tenant_id VARCHAR(128) NOT NULL,
  referred_tenant_id VARCHAR(128) NOT NULL,
  deal_id VARCHAR(128),
  reward_amount_ngn BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'applied', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (referral_code_id) REFERENCES referral_codes(id) ON DELETE CASCADE,
  FOREIGN KEY (referrer_tenant_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (referred_tenant_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE SEQUENCE IF NOT EXISTS referral_conversions_seq;

CREATE INDEX IF NOT EXISTS idx_referral_codes_tenant_id ON referral_codes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_conversions_referrer_id ON referral_conversions(referrer_tenant_id);
CREATE INDEX IF NOT EXISTS idx_referral_conversions_referred_id ON referral_conversions(referred_tenant_id);
CREATE INDEX IF NOT EXISTS idx_referral_conversions_deal_id ON referral_conversions(deal_id);
CREATE INDEX IF NOT EXISTS idx_referral_conversions_status ON referral_conversions(status);
