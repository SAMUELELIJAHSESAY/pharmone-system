-- ==========================================
-- UPDATE: Set default currency to Sierra Leone Leone (NLE)
-- ==========================================
-- Update the pharmacies table to use NLE as default currency

-- For new pharmacies created after this migration
ALTER TABLE pharmacies 
ALTER COLUMN currency_code SET DEFAULT 'NLE';

ALTER TABLE pharmacies 
ALTER COLUMN currency_symbol SET DEFAULT 'Le';

-- Update existing pharmacies that still have USD default (optional - comment out if you want to preserve existing settings)
UPDATE pharmacies 
SET currency_code = 'NLE', currency_symbol = 'Le' 
WHERE currency_code = 'USD' AND currency_symbol = '$';
