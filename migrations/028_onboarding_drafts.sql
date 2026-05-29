-- Migration: Tenant Onboarding Drafts
-- Stores resumable multi-step onboarding wizard state per tenant.

CREATE TABLE IF NOT EXISTS onboarding_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  personal_info JSONB,
  employment_info JSONB,
  documents JSONB,
  wallet_info JSONB,
  completed_steps TEXT[] NOT NULL DEFAULT '{}',
  current_step VARCHAR(50) NOT NULL DEFAULT 'personal_info',
  submitted BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_onboarding_user_id ON onboarding_drafts(user_id);
CREATE INDEX idx_onboarding_submitted ON onboarding_drafts(submitted);
