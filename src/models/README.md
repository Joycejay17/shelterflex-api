# Whistleblower Listings - Database Migration Guide

## Current Implementation (MVP)

The listing store is currently implemented as an in-memory store for rapid development and testing. This is suitable for MVP but should be migrated to a database for production.

## Database Schema

### Listings Table

```sql
CREATE TABLE listings (
  listing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whistleblower_id VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  city VARCHAR(255),
  area VARCHAR(255),
  bedrooms INTEGER NOT NULL CHECK (bedrooms >= 0),
  bathrooms INTEGER NOT NULL CHECK (bathrooms >= 0),
  annual_rent_ngn INTEGER NOT NULL CHECK (annual_rent_ngn > 0),
  description TEXT,
  photos JSONB NOT NULL, -- Array of photo URLs
  status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
  rejection_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_status CHECK (status IN ('pending_review', 'approved', 'rejected', 'rented')),
  CONSTRAINT min_photos CHECK (jsonb_array_length(photos) >= 3)
);

CREATE INDEX idx_listings_whistleblower_id ON listings(whistleblower_id);
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_created_at ON listings(created_at DESC);
CREATE INDEX idx_listings_city ON listings(city);
CREATE INDEX idx_listings_search ON listings USING gin(to_tsvector('english', address || ' ' || COALESCE(city, '') || ' ' || COALESCE(area, '') || ' ' || COALESCE(description, '')));
```

### Monthly Reports Tracking Table

```sql
CREATE TABLE whistleblower_monthly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whistleblower_id VARCHAR(255) NOT NULL,
  report_date TIMESTAMP NOT NULL DEFAULT NOW(),
  listing_id UUID NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  
  CONSTRAINT unique_listing_report UNIQUE (listing_id)
);

CREATE INDEX idx_monthly_reports_whistleblower ON whistleblower_monthly_reports(whistleblower_id, report_date);

-- Function to check monthly limit
CREATE OR REPLACE FUNCTION check_monthly_limit()
RETURNS TRIGGER AS $$
DECLARE
  report_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO report_count
  FROM whistleblower_monthly_reports
  WHERE whistleblower_id = NEW.whistleblower_id
    AND EXTRACT(YEAR FROM report_date) = EXTRACT(YEAR FROM NEW.report_date)
    AND EXTRACT(MONTH FROM report_date) = EXTRACT(MONTH FROM NEW.report_date);
  
  IF report_count >= 2 THEN
    RAISE EXCEPTION 'Monthly listing limit reached (max 2 per month)';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_monthly_limit
  BEFORE INSERT ON whistleblower_monthly_reports
  FOR EACH ROW
  EXECUTE FUNCTION check_monthly_limit();
```

## Migration Steps

1. **Create Database Tables**
   ```bash
   psql -U postgres -d shelterflex < migrations/001_create_listings.sql
   ```

2. **Update Environment Variables**
   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/shelterflex
   ```

3. **Replace In-Memory Store**
   
   Update `listingStore.ts` to use database:
   
   ```typescript
   import { Pool } from 'pg'
   
   const pool = new Pool({
     connectionString: process.env.DATABASE_URL,
   })
   
   class ListingStore {
     async create(input: CreateListingInput): Promise<Listing> {
       const client = await pool.connect()
       try {
         await client.query('BEGIN')
         
         // Insert listing
         const result = await client.query(
           `INSERT INTO listings (
             whistleblower_id, address, city, area, bedrooms, bathrooms,
             annual_rent_ngn, description, photos
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
           [
             input.whistleblowerId,
             input.address,
             input.city,
             input.area,
             input.bedrooms,
             input.bathrooms,
             input.annualRentNgn,
             input.description,
             JSON.stringify(input.photos),
           ]
         )
         
         const listing = result.rows[0]
         
         // Track monthly report
         await client.query(
           `INSERT INTO whistleblower_monthly_reports (
             whistleblower_id, listing_id
           ) VALUES ($1, $2)`,
           [input.whistleblowerId, listing.listing_id]
         )
         
         await client.query('COMMIT')
         return this.mapRow(listing)
       } catch (error) {
         await client.query('ROLLBACK')
         throw error
       } finally {
         client.release()
       }
     }
     
     // ... other methods
   }
   ```

4. **Add Connection Pooling**
   ```typescript
   // config/database.ts
   import { Pool } from 'pg'
   
   export const pool = new Pool({
     connectionString: process.env.DATABASE_URL,
     max: 20,
     idleTimeoutMillis: 30000,
     connectionTimeoutMillis: 2000,
   })
   ```

5. **Update Tests**
   - Use test database
   - Add database cleanup in beforeEach
   - Consider using transactions for test isolation

## Performance Considerations

- Add indexes on frequently queried columns
- Use connection pooling
- Consider read replicas for high traffic
- Implement caching for frequently accessed listings
- Use full-text search for query optimization

## Monitoring

- Track query performance
- Monitor connection pool usage
- Set up alerts for slow queries
- Log database errors
