-- Add RLS policies for return_items table
-- This migration fixes the RLS policy violation when inserting return items

-- Allow admins to view return items for their pharmacy
CREATE POLICY "Admin can view return items for pharmacy"
  ON return_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sales_returns sr
      WHERE sr.id = return_items.return_id
        AND sr.pharmacy_id = get_user_pharmacy_id()
        AND get_user_role() = 'admin'
    )
  );

-- Allow admins to insert return items
CREATE POLICY "Admin can insert return items"
  ON return_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales_returns sr
      WHERE sr.id = return_items.return_id
        AND sr.pharmacy_id = get_user_pharmacy_id()
        AND get_user_role() = 'admin'
    )
  );

-- Allow admins to update return items
CREATE POLICY "Admin can update return items"
  ON return_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sales_returns sr
      WHERE sr.id = return_items.return_id
        AND sr.pharmacy_id = get_user_pharmacy_id()
        AND get_user_role() = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales_returns sr
      WHERE sr.id = return_items.return_id
        AND sr.pharmacy_id = get_user_pharmacy_id()
        AND get_user_role() = 'admin'
    )
  );

-- Allow super admins to view all return items
CREATE POLICY "Super admin can view all return items"
  ON return_items FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');
