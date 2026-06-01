-- Erasure requests for NDPA/GDPR right-to-erasure workflow
-- Admin must confirm within 30 days of user request.

CREATE TABLE IF NOT EXISTS erasure_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirm_by TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS erasure_requests_user_id_idx ON erasure_requests (user_id);
CREATE INDEX IF NOT EXISTS erasure_requests_status_idx ON erasure_requests (status);

-- Account deactivation flag for erased users
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_deactivated_at_idx ON users (deactivated_at)
  WHERE deactivated_at IS NOT NULL;
