-- Add timezone support to pharmacies for accurate local date calculations
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC';

-- Create an index for efficient queries
CREATE INDEX IF NOT EXISTS idx_pharmacies_timezone ON pharmacies(timezone);

-- Update pharmacy settings function to include timezone
DROP FUNCTION IF EXISTS get_pharmacy_settings(uuid);
