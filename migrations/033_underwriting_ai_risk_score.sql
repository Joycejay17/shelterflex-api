-- AI risk score on underwriting decision traces (advisory signal audit trail)

ALTER TABLE underwriting_decision_traces
  ADD COLUMN IF NOT EXISTS ai_risk_score JSONB;

COMMENT ON COLUMN underwriting_decision_traces.ai_risk_score IS
  'Optional AI tenant risk score (score, confidence, riskBand, contributingFactors, modelVersion)';
