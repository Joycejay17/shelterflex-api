-- Database Index Audit & Query Optimization (Issue #932)
-- Adds missing indexes identified by the audit across eight table groups.
-- Uses CONCURRENTLY to avoid production locking where supported.

-- 1. payment_disputes
-- list() filters by user_id + status, ordered by created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disputes_user_status_created
  ON payment_disputes (user_id, status, created_at DESC);
-- Partial index for active disputes (pending/under_review)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disputes_active_status
  ON payment_disputes (user_id, created_at DESC)
  WHERE status IN ('pending', 'under_review');

-- 2. audit_log
-- search() filters commonly use user_id + event_type + created_at range
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_user_event_created_idx
  ON audit_log (user_id, event_type, created_at DESC)
  WHERE user_id IS NOT NULL;
-- search() also filters by actor_type + event_type
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_actor_event_created_idx
  ON audit_log (actor_type, event_type, created_at DESC);
-- GIN index on metadata for JSONB queries (entity_id pattern stored in metadata)
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_metadata_gin_idx
  ON audit_log USING GIN (metadata jsonb_path_ops);

-- 3. user_notifications
-- Category filtering within user scope
CREATE INDEX CONCURRENTLY IF NOT EXISTS user_notifications_user_category_created_idx
  ON user_notifications (user_id, category, created_at DESC);
-- Partial index for unread notifications with category
CREATE INDEX CONCURRENTLY IF NOT EXISTS user_notifications_user_unread_category_idx
  ON user_notifications (user_id, category)
  WHERE read_at IS NULL;

-- 4. tenant_deals
-- findMany() filters by status with ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS tenant_deals_status_created_idx
  ON tenant_deals (status, created_at DESC);
-- listActiveDealsWithSchedules() queries active and at-risk deals
CREATE INDEX CONCURRENTLY IF NOT EXISTS tenant_deals_active_partial_idx
  ON tenant_deals (tenant_id, landlord_id, created_at DESC)
  WHERE status IN ('active', 'at_risk');
-- Composite index for tenant + status query pattern
CREATE INDEX CONCURRENTLY IF NOT EXISTS tenant_deals_tenant_status_idx
  ON tenant_deals (tenant_id, status, created_at DESC);
-- Composite index for landlord + status query pattern
CREATE INDEX CONCURRENTLY IF NOT EXISTS tenant_deals_landlord_status_idx
  ON tenant_deals (landlord_id, status, created_at DESC);

-- 5. landlord_payouts
-- listPayouts() filters by landlord_id + status + scheduled_date range
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_landlord_payouts_landlord_status_date
  ON landlord_payouts (landlord_id, status, scheduled_date);
-- Composite index for property + status filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_landlord_payouts_property_status
  ON landlord_payouts (property_id, status, scheduled_date);
-- Partial for exception monitoring (delayed/failed/on_hold)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_landlord_payouts_exceptions_idx
  ON landlord_payouts (landlord_id, scheduled_date)
  WHERE status IN ('delayed', 'failed', 'on_hold');

-- 6. tenant_applications
-- findByUserId() with status filter uses user_id + status + created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_applications_user_status_created
  ON tenant_applications (user_id, status, created_at DESC);
-- Composite for status + created_at for admin listing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_applications_status_created
  ON tenant_applications (status, created_at DESC);
-- Index on property_id for listing-based lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_applications_property_id
  ON tenant_applications (property_id);

-- 7. whistleblower_listings
-- list() with city/area filter + status
CREATE INDEX CONCURRENTLY IF NOT EXISTS whistleblower_listings_city_status_idx
  ON whistleblower_listings (city, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS whistleblower_listings_area_status_idx
  ON whistleblower_listings (area, status);
-- Composite for status + created_at (most common list pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS whistleblower_listings_status_created_idx
  ON whistleblower_listings (status, created_at DESC);
-- Composite for bedrooms + annual_rent_ngn (price/bedroom filtering)
CREATE INDEX CONCURRENTLY IF NOT EXISTS whistleblower_listings_bedrooms_rent_idx
  ON whistleblower_listings (bedrooms, annual_rent_ngn)
  WHERE status = 'approved';

COMMENT ON INDEX idx_disputes_user_status_created IS 'Optimizes payment_disputes list() with user+status filter ordered by creation date';
COMMENT ON INDEX audit_log_user_event_created_idx IS 'Optimizes audit_log search() with user+event_type+date range filters';
COMMENT ON INDEX tenant_deals_active_partial_idx IS 'Optimizes listActiveDealsWithSchedules() for active/at-risk deals';
COMMENT ON INDEX idx_landlord_payouts_landlord_status_date IS 'Optimizes landlord_payouts listPayouts() common filter pattern';
COMMENT ON INDEX whistleblower_listings_city_status_idx IS 'Optimizes whistleblower_listings list() with city+status filters';
