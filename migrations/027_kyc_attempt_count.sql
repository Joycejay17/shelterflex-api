-- Migration: Add attempt_count to kyc_documents
-- Tracks re-submission attempts so the system can enforce a 3-attempt limit.

ALTER TABLE kyc_documents
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1;
