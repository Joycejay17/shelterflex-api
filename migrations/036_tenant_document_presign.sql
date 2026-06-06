-- Presigned upload flow for tenant documents (issue #969)

ALTER TABLE tenant_documents
  ADD COLUMN IF NOT EXISTS doc_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS content_type VARCHAR(128),
  ADD COLUMN IF NOT EXISTS upload_status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
    CHECK (upload_status IN ('pending', 'confirmed'));

ALTER TABLE tenant_documents
  ALTER COLUMN file_name DROP NOT NULL,
  ALTER COLUMN file_format DROP NOT NULL,
  ALTER COLUMN file_size_bytes DROP NOT NULL;

ALTER TABLE tenant_documents
  DROP CONSTRAINT IF EXISTS tenant_documents_file_size_bytes_check;

ALTER TABLE tenant_documents
  ADD CONSTRAINT tenant_documents_file_size_bytes_check
    CHECK (file_size_bytes IS NULL OR (file_size_bytes > 0 AND file_size_bytes <= 26214400));

CREATE INDEX IF NOT EXISTS idx_tenant_documents_upload_status
  ON tenant_documents (user_id, upload_status);
