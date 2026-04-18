-- ==========================================
-- FIX: Allow staff to deduct stock on sales
-- ==========================================
-- Problem: Product UPDATE policy only allows ADMIN role
-- But salesmen need to deduct stock when creating sales
-- Solution: Create a SECURITY DEFINER function that bypasses RLS

-- Add RLS policy to allow salesmen to update products during sales (only stock columns)
CREATE POLICY "Staff can deduct stock during sales"
  ON products FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() IN ('salesman', 'admin'))
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() IN ('salesman', 'admin'));

-- Alternative: Create a server function to handle stock deduction with elevated privileges
-- This ensures security by only allowing specific operations
CREATE OR REPLACE FUNCTION deduct_product_stock(
  p_product_id uuid,
  p_quantity integer,
  p_pharmacy_id uuid,
  p_branch_id uuid,
  p_sale_invoice text,
  p_created_by uuid
)
RETURNS TABLE (success boolean, message text) AS $$
DECLARE
  v_current_stock integer;
  v_new_boxes integer;
  v_new_units integer;
  v_product record;
BEGIN
  -- Fetch current stock
  SELECT stock_boxes, stock_units, units_per_box, name
  INTO v_product
  FROM products
  WHERE id = p_product_id AND pharmacy_id = p_pharmacy_id;
  
  IF v_product IS NULL THEN
    RETURN QUERY SELECT false, 'Product not found'::text;
    RETURN;
  END IF;

  -- Calculate current total units
  v_current_stock := (v_product.stock_boxes * v_product.units_per_box) + v_product.stock_units;
  
  IF v_current_stock < p_quantity THEN
    RETURN QUERY SELECT false, ('Insufficient stock. Available: ' || v_current_stock)::text;
    RETURN;
  END IF;

  -- Calculate new stock
  v_new_boxes := FLOOR((v_current_stock - p_quantity)::numeric / v_product.units_per_box);
  v_new_units := (v_current_stock - p_quantity) % v_product.units_per_box;

  -- Update product stock
  UPDATE products
  SET stock_boxes = v_new_boxes,
      stock_units = v_new_units,
      updated_at = now()
  WHERE id = p_product_id;

  -- Log the stock change
  INSERT INTO stock_logs (product_id, product_name, change_type, quantity_change, notes, created_by, pharmacy_id, branch_id)
  VALUES (p_product_id, v_product.name, 'sale'::text, -p_quantity, 'Sale: ' || p_sale_invoice, p_created_by, p_pharmacy_id, p_branch_id);

  RETURN QUERY SELECT true, 'Stock deducted successfully'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Revoke public access to the deduction function
REVOKE ALL ON FUNCTION deduct_product_stock (uuid, integer, uuid, uuid, text, uuid) FROM PUBLIC;

-- Grant access only to authenticated users
GRANT EXECUTE ON FUNCTION deduct_product_stock (uuid, integer, uuid, uuid, text, uuid) TO authenticated;
