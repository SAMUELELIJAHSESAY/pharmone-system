-- Add stock_unit_type column to track what unit stock is stored as
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_unit_type VARCHAR(50) DEFAULT 'box';

-- Update existing records to have 'box' as the default unit type
UPDATE products SET stock_unit_type = 'box' WHERE stock_unit_type IS NULL;

-- Add comment to explain the column
COMMENT ON COLUMN products.stock_unit_type IS 'The unit type in which stock is stored and displayed (box, strip, cup, card, packet, etc)';
