-- Fix alerts RLS: Add INSERT policy and populate system triggers to create alerts
-- This resolves the 406/403 errors when trying to create alerts

-- Step 1: Add INSERT policy for alerts (so system functions can create alerts)
CREATE POLICY "System can create alerts" 
  ON alerts FOR INSERT 
  TO authenticated 
  WITH CHECK (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin staff can create alerts"
  ON alerts FOR INSERT
  TO authenticated
  WITH CHECK (
    pharmacy_id = get_user_pharmacy_id() 
    AND get_user_role() IN ('admin', 'super_admin')
  );

-- Step 2: Verify branch_id column exists (should be from previous migration)
-- If it doesn't exist, it was added via 20260418_add_branch_id_to_alerts.sql

-- Step 3: Ensure stock check triggers create alerts with correct schema
-- This function will be used by triggers to create low stock alerts
CREATE OR REPLACE FUNCTION trigger_create_low_stock_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_pharmacy_id uuid;
  v_branch_id uuid;
  v_product_name text;
BEGIN
  -- Get pharmacy and branch info from branch_inventory
  SELECT branch_id INTO v_branch_id FROM branch_inventory WHERE id = NEW.branch_inventory_id LIMIT 1;
  SELECT pharmacy_id INTO v_pharmacy_id FROM branches WHERE id = v_branch_id LIMIT 1;
  SELECT name INTO v_product_name FROM products WHERE id = NEW.product_id LIMIT 1;
  
  -- Only create alert if stock is low
  IF NEW.quantity_available <= NEW.reorder_level THEN
    INSERT INTO alerts (pharmacy_id, branch_id, product_id, alert_type, message, is_read, created_at)
    VALUES (
      v_pharmacy_id,
      v_branch_id,
      NEW.product_id,
      'low_stock',
      v_product_name || ' stock is low (' || NEW.quantity_available || ' units)',
      false,
      now()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Ensure expiry check triggers create alerts with correct schema
CREATE OR REPLACE FUNCTION trigger_create_expiry_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_pharmacy_id uuid;
  v_branch_id uuid;
  v_product_name text;
  v_days_until_expiry int;
BEGIN
  -- Get pharmacy and branch info
  SELECT pharmacy_id INTO v_pharmacy_id FROM products WHERE id = NEW.product_id LIMIT 1;
  SELECT name INTO v_product_name FROM products WHERE id = NEW.product_id LIMIT 1;
  
  -- For batch tracking, branch_id would come from branch_inventory
  SELECT branch_id INTO v_branch_id FROM branch_inventory WHERE id = NEW.branch_inventory_id LIMIT 1;
  
  v_days_until_expiry := (NEW.expiry_date::date - CURRENT_DATE);
  
  -- Create alert if expiry is within 30 days
  IF v_days_until_expiry <= 30 AND v_days_until_expiry > 0 THEN
    INSERT INTO alerts (pharmacy_id, branch_id, product_id, alert_type, message, is_read, created_at)
    VALUES (
      v_pharmacy_id,
      v_branch_id,
      NEW.product_id,
      'expiry_warning',
      v_product_name || ' expires in ' || v_days_until_expiry || ' days',
      false,
      now()
    );
  ELSIF v_days_until_expiry <= 0 THEN
    INSERT INTO alerts (pharmacy_id, branch_id, product_id, alert_type, message, is_read, created_at)
    VALUES (
      v_pharmacy_id,
      v_branch_id,
      NEW.product_id,
      'expired',
      v_product_name || ' has expired',
      true,
      now()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
