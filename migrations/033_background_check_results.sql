-- Background Check Results Table
-- Stores employment, income, and bank statement verification results for tenant screening

CREATE TABLE IF NOT EXISTS background_check_results (
  id TEXT PRIMARY KEY DEFAULT ('BGCK-' || EXTRACT(EPOCH FROM NOW())::BIGINT || '-' || floor(random() * 1000)::INT),
  tenant_id TEXT NOT NULL,
  application_id TEXT,
  
  -- Employment verification
  employment_verified BOOLEAN,
  employer_name TEXT,
  job_title TEXT,
  employment_start_date TIMESTAMPTZ,
  employment_type TEXT CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'self_employed')),
  employment_monthly_income NUMERIC(15, 2),
  employment_verification_date TIMESTAMPTZ,
  
  -- Income verification
  income_average_monthly NUMERIC(15, 2),
  income_stability TEXT CHECK (income_stability IN ('stable', 'variable', 'unstable')),
  income_last_salary_date TIMESTAMPTZ,
  income_transaction_count_3m INTEGER,
  income_verification_date TIMESTAMPTZ,
  
  -- Bank statement verification
  bank_average_balance NUMERIC(15, 2),
  bank_monthly_inflow NUMERIC(15, 2),
  bank_monthly_outflow NUMERIC(15, 2),
  bank_overdraft_count INTEGER,
  bank_statement_start_date TIMESTAMPTZ,
  bank_statement_end_date TIMESTAMPTZ,
  bank_verification_date TIMESTAMPTZ,
  
  -- Overall status
  overall_status TEXT CHECK (overall_status IN ('pending', 'completed', 'failed')) NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL DEFAULT 'mock',
  
  -- Metadata
  verification_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_background_check_results_tenant_id ON background_check_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_background_check_results_application_id ON background_check_results(application_id);
CREATE INDEX IF NOT EXISTS idx_background_check_results_overall_status ON background_check_results(overall_status);
CREATE INDEX IF NOT EXISTS idx_background_check_results_created_at ON background_check_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_background_check_results_tenant_status ON background_check_results(tenant_id, overall_status);

-- Comments
COMMENT ON TABLE background_check_results IS 'Background check verification results for tenant screening';
COMMENT ON COLUMN background_check_results.id IS 'Unique background check identifier';
COMMENT ON COLUMN background_check_results.tenant_id IS 'Tenant being verified';
COMMENT ON COLUMN background_check_results.application_id IS 'Associated rental application (optional)';
COMMENT ON COLUMN background_check_results.employment_verified IS 'Whether employment was successfully verified';
COMMENT ON COLUMN background_check_results.employer_name IS 'Verified employer name';
COMMENT ON COLUMN background_check_results.job_title IS 'Verified job title';
COMMENT ON COLUMN background_check_results.employment_start_date IS 'Employment start date';
COMMENT ON COLUMN background_check_results.employment_type IS 'Type of employment';
COMMENT ON COLUMN background_check_results.employment_monthly_income IS 'Verified monthly income from employment';
COMMENT ON COLUMN background_check_results.employment_verification_date IS 'When employment verification was performed';
COMMENT ON COLUMN background_check_results.income_average_monthly IS 'Average monthly income from bank analysis';
COMMENT ON COLUMN background_check_results.income_stability IS 'Income stability assessment';
COMMENT ON COLUMN background_check_results.income_last_salary_date IS 'Date of last salary credit';
COMMENT ON COLUMN background_check_results.income_transaction_count_3m IS 'Number of transactions in last 3 months';
COMMENT ON COLUMN background_check_results.income_verification_date IS 'When income verification was performed';
COMMENT ON COLUMN background_check_results.bank_average_balance IS 'Average bank balance over statement period';
COMMENT ON COLUMN background_check_results.bank_monthly_inflow IS 'Average monthly inflow';
COMMENT ON COLUMN background_check_results.bank_monthly_outflow IS 'Average monthly outflow';
COMMENT ON COLUMN background_check_results.bank_overdraft_count IS 'Number of overdraft incidents';
COMMENT ON COLUMN background_check_results.bank_statement_start_date IS 'Bank statement period start';
COMMENT ON COLUMN background_check_results.bank_statement_end_date IS 'Bank statement period end';
COMMENT ON COLUMN background_check_results.bank_verification_date IS 'When bank statement analysis was performed';
COMMENT ON COLUMN background_check_results.overall_status IS 'Overall verification status';
COMMENT ON COLUMN background_check_results.provider IS 'Background check provider used (mock, mono, okra, etc.)';
COMMENT ON COLUMN background_check_results.verification_metadata IS 'Additional metadata from verification process';
COMMENT ON COLUMN background_check_results.created_at IS 'Record creation timestamp';
COMMENT ON COLUMN background_check_results.updated_at IS 'Record last update timestamp';
