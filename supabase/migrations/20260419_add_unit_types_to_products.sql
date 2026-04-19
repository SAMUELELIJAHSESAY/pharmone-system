-- Add unit_type and min_sell_quantity to products table
ALTER TABLE products 
ADD COLUMN unit_type VARCHAR(50) DEFAULT 'box' CHECK (unit_type IN ('tablet', 'capsule', 'bottle', 'vial', 'injection', 'ml', 'box', 'blister', 'jar', 'tube', 'sachet', 'strip', 'bag', 'pack', 'piece'));

ALTER TABLE products
ADD COLUMN min_sell_quantity INTEGER DEFAULT 1;

-- Add comment explaining unit types
COMMENT ON COLUMN products.unit_type IS 'Unit type for selling: tablet, capsule, bottle, vial, injection, ml, box, blister, jar, tube, sachet, strip, bag, pack, piece';
COMMENT ON COLUMN products.min_sell_quantity IS 'Minimum quantity that can be sold in one transaction';
