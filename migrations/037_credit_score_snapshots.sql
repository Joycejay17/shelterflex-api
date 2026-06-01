CREATE TABLE IF NOT EXISTS credit_score_snapshots (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  band TEXT NOT NULL CHECK (band IN ('poor', 'fair', 'good', 'excellent')),
  factors JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_score_snapshots_user_computed_at
  ON credit_score_snapshots (user_id, computed_at DESC);
