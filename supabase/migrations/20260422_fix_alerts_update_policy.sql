-- Ensure alerts RLS UPDATE policy is correct for all roles
-- This fixes the issue where markAlertAsRead fails

-- Drop old UPDATE policy if it exists to replace with better one
DROP POLICY IF EXISTS "Pharmacy users can update own alerts" ON alerts;

-- Create comprehensive UPDATE policy
CREATE POLICY "Users can update alerts in their pharmacy"
  ON alerts FOR UPDATE
  TO authenticated
  USING (
    pharmacy_id = get_user_pharmacy_id() 
    OR get_user_role() = 'super_admin'
  )
  WITH CHECK (
    pharmacy_id = get_user_pharmacy_id() 
    OR get_user_role() = 'super_admin'
  );

-- Ensure there are no conflicting policies
DROP POLICY IF EXISTS "Admin staff can manage alerts" ON alerts;

-- Add explicit delete policy for admins to clean up old alerts
CREATE POLICY "Admins can delete alerts"
  ON alerts FOR DELETE
  TO authenticated
  USING (
    pharmacy_id = get_user_pharmacy_id()
    AND get_user_role() IN ('admin', 'super_admin')
  );
