-- User display currency preference (issue #914)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_currency TEXT NOT NULL DEFAULT 'NGN'
    CHECK (display_currency IN ('NGN', 'USDC'));

COMMENT ON COLUMN users.display_currency IS 'Preferred currency for displaying monetary amounts in the UI';
