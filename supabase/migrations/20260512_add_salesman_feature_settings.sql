/*
  # Salesman Feature Settings - May 12, 2026
  
  This migration adds feature visibility settings for salesman role.
  Allows admin to toggle which features salesman can see:
  - dashboard (salesman dashboard)
  - sales_history (my sales history)
  - daily_records (daily records/reports)
  
  Default: all enabled for backward compatibility
*/

-- Add salesman_features column to pharmacies table
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS salesman_features jsonb 
  DEFAULT '{
    "pos": true,
    "customers": true,
    "patients": true,
    "expenses": true,
    "returns_request": true,
    "dashboard": true,
    "sales_history": true,
    "daily_records": true
  }'::jsonb;

-- Create helper function to get salesman features for a pharmacy
CREATE OR REPLACE FUNCTION get_salesman_features(pharmacy_id uuid)
RETURNS jsonb AS $$
  SELECT COALESCE(salesman_features, '{
    "pos": true,
    "customers": true,
    "patients": true,
    "expenses": true,
    "returns_request": true,
    "dashboard": true,
    "sales_history": true,
    "daily_records": true
  }'::jsonb)
  FROM pharmacies
  WHERE id = pharmacy_id;
$$ LANGUAGE SQL;

-- Create function to update salesman features
CREATE OR REPLACE FUNCTION update_salesman_features(
  pharmacy_id uuid,
  features jsonb
)
RETURNS boolean AS $$
BEGIN
  UPDATE pharmacies
  SET salesman_features = features, updated_at = now()
  WHERE id = pharmacy_id;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Add audit logging for feature changes
CREATE TABLE IF NOT EXISTS feature_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  old_features jsonb,
  new_features jsonb,
  changed_at timestamptz DEFAULT now()
);

ALTER TABLE feature_change_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only admin can view their own pharmacy's audit logs
CREATE POLICY "Admin can view own pharmacy feature audit"
  ON feature_change_audit FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- RLS Policy: Super admin can view all audit logs
CREATE POLICY "Super admin can view all feature audit"
  ON feature_change_audit FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_feature_audit_pharmacy ON feature_change_audit(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_feature_audit_changed_at ON feature_change_audit(changed_at DESC);
