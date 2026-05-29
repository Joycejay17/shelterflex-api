-- Two-tier pricing for whistleblower listings

ALTER TABLE whistleblower_listings
  ADD COLUMN IF NOT EXISTS outright_price_ngn NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS installment_base_price_ngn NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS negotiated_landlord_rate_ngn NUMERIC(20, 2);

-- Backfill outright_price_ngn and installment_base_price_ngn from annual_rent_ngn for existing rows
UPDATE whistleblower_listings
SET outright_price_ngn = annual_rent_ngn,
    installment_base_price_ngn = annual_rent_ngn
WHERE outright_price_ngn IS NULL
  AND installment_base_price_ngn IS NULL;
