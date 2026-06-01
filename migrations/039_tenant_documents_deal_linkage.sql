-- Tenant documents deal linkage and landlord-uploaded support (issue #1039)

ALTER TABLE tenant_documents
  ADD COLUMN IF NOT EXISTS deal_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS is_landlord_uploaded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS read_only BOOLEAN NOT NULL DEFAULT FALSE;

-- Drop and recreate category constraint to add new values
ALTER TABLE tenant_documents DROP CONSTRAINT IF EXISTS tenant_documents_category_check;
ALTER TABLE tenant_documents ADD CONSTRAINT tenant_documents_category_check
  CHECK (category IN (
    'identification','receipt','agreement','insurance','utility','other',
    'lease_agreement','payment_receipt','identity_document','inspection_report'
  ));

CREATE INDEX IF NOT EXISTS idx_tenant_documents_deal_id ON tenant_documents (deal_id) WHERE deal_id IS NOT NULL;
