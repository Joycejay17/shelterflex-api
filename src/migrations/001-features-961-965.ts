/**
 * Database migrations for new features
 * - Credit bureau reports caching (issue #961)
 * - Rental agreements and e-signatures (issue #962)
 * - Listing applications (issue #963)
 * - Deal status history (issue #965)
 */

export const migrations = [
  {
    id: "001-add-credit-bureau-reports",
    up: `
      CREATE TABLE IF NOT EXISTS credit_bureau_reports (
        id UUID PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        bvn VARCHAR(255) NOT NULL,
        nin VARCHAR(255) NOT NULL,
        report JSONB NOT NULL,
        cached_at TIMESTAMP NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        CONSTRAINT credit_bureau_reports_tenant_id_idx 
          UNIQUE (tenant_id, expires_at)
      );
      CREATE INDEX idx_credit_bureau_reports_tenant_id ON credit_bureau_reports(tenant_id);
      CREATE INDEX idx_credit_bureau_reports_expires_at ON credit_bureau_reports(expires_at);
    `,
    down: `DROP TABLE IF EXISTS credit_bureau_reports;`,
  },
  {
    id: "002-add-rental-agreements",
    up: `
      CREATE TABLE IF NOT EXISTS rental_agreements (
        id UUID PRIMARY KEY,
        deal_id VARCHAR(255) NOT NULL UNIQUE,
        pdf_key VARCHAR(1024) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        tenant_signed_at TIMESTAMP,
        landlord_signed_at TIMESTAMP,
        tenant_signature_data JSONB,
        landlord_signature_data JSONB,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
      );
      CREATE INDEX idx_rental_agreements_deal_id ON rental_agreements(deal_id);
      CREATE INDEX idx_rental_agreements_status ON rental_agreements(status);
    `,
    down: `DROP TABLE IF EXISTS rental_agreements;`,
  },
  {
    id: "003-add-listing-applications",
    up: `
      CREATE TABLE IF NOT EXISTS listing_applications (
        id UUID PRIMARY KEY,
        listing_id VARCHAR(255) NOT NULL,
        tenant_id VARCHAR(255) NOT NULL,
        landlord_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        cover_note TEXT,
        preferred_start_date DATE NOT NULL,
        payment_plan VARCHAR(50) NOT NULL,
        applied_at TIMESTAMP NOT NULL,
        reviewed_at TIMESTAMP,
        reviewed_by VARCHAR(255),
        reviewer_notes TEXT,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
      );
      CREATE INDEX idx_listing_applications_listing_id ON listing_applications(listing_id);
      CREATE INDEX idx_listing_applications_tenant_id ON listing_applications(tenant_id);
      CREATE INDEX idx_listing_applications_status ON listing_applications(status);
      CREATE UNIQUE INDEX idx_listing_applications_unique_active 
        ON listing_applications(tenant_id, listing_id) 
        WHERE status != 'rejected';
    `,
    down: `DROP TABLE IF EXISTS listing_applications;`,
  },
  {
    id: "004-add-deal-status-history",
    up: `
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS status_history JSONB DEFAULT '[]'::jsonb;
      
      CREATE INDEX idx_deals_status_history ON deals USING GIN(status_history);
    `,
    down: `
      ALTER TABLE deals 
      DROP COLUMN IF EXISTS status_history;
    `,
  },
];

export async function runMigrations() {
  // This would be called during application startup
  // For now, we're defining the migrations statically
  console.log(
    "Migrations defined:",
    migrations.map((m) => m.id),
  );
}
