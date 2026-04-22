-- Add Cup and Card to unit types constraint
ALTER TABLE products 
DROP CONSTRAINT products_unit_type_check;

ALTER TABLE products
ADD CONSTRAINT products_unit_type_check CHECK (unit_type IN ('tablet', 'capsule', 'bottle', 'vial', 'injection', 'ml', 'box', 'blister', 'jar', 'tube', 'sachet', 'strip', 'bag', 'pack', 'piece', 'cup', 'card'));

-- Update comment
COMMENT ON COLUMN products.unit_type IS 'Unit type for selling: tablet, capsule, bottle, vial, injection, ml, box, blister, jar, tube, sachet, strip, bag, pack, piece, cup, card';
