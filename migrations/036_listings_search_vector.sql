-- Add full-text search vector for approved listing discovery.
ALTER TABLE whistleblower_listings
  ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(address,'') || ' ' ||
      coalesce(description,'') || ' ' ||
      coalesce(city,'') || ' ' ||
      coalesce(area,'')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_listings_search_vector
  ON whistleblower_listings USING GIN (search_vector);
