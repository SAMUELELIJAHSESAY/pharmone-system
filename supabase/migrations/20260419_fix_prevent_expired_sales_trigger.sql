-- Fix prevent_expired_sales trigger - It causes checkout errors
-- The trigger is BEFORE INSERT and tries to access NEW.id via sale_items join
-- but NEW.id doesn't exist yet (sale not inserted), causing "record has no field" error
-- 
-- The application validates expired products in createSale() function
-- so this database-level trigger is redundant and causing problems

-- Drop trigger if it exists
DROP TRIGGER IF EXISTS enforce_no_expired_sales ON sales;

-- Drop the function if it exists  
DROP FUNCTION IF EXISTS prevent_expired_sales();
