-- Enhanced Returns Management with Partial Returns Support
-- This migration adds support for partial returns, receipt management, and advanced return workflows

-- Step 1: Add new columns to sales_returns table
ALTER TABLE sales_returns
  ADD COLUMN IF NOT EXISTS return_type TEXT DEFAULT 'full' CHECK (return_type IN ('full', 'partial', 'walk_in')),
  ADD COLUMN IF NOT EXISTS returned_items JSONB,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

-- Step 2: Add status column to sales table to track returned receipts
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'returned', 'voided'));

-- Step 3: Create function to handle partial returns
CREATE OR REPLACE FUNCTION process_partial_return(
  p_return_id UUID,
  p_sale_id UUID,
  p_returned_items JSONB,
  p_refund_amount NUMERIC,
  p_new_total NUMERIC
)
RETURNS void AS $$
BEGIN
  -- Update sale to reflect only remaining items
  UPDATE sales
  SET total_amount = p_new_total,
      status = CASE 
        WHEN p_new_total <= 0 THEN 'returned'
        ELSE 'completed'
      END,
      notes = CONCAT(
        COALESCE(notes, ''),
        E'\n[PARTIAL RETURN ',
        TO_CHAR(NOW(), 'YYYY-MM-DD HH:MI:SS'),
        ' - Refund: ₦',
        p_refund_amount,
        ']'
      ),
      updated_at = NOW()
  WHERE id = p_sale_id;
  
  -- Update return record with return type
  UPDATE sales_returns
  SET return_type = 'partial',
      updated_at = NOW()
  WHERE id = p_return_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Create function to handle full returns
CREATE OR REPLACE FUNCTION process_full_return(
  p_return_id UUID,
  p_sale_id UUID,
  p_refund_amount NUMERIC
)
RETURNS void AS $$
BEGIN
  -- Mark sale as returned
  UPDATE sales
  SET status = 'returned',
      notes = CONCAT(
        COALESCE(notes, ''),
        E'\n[FULL RETURN ',
        TO_CHAR(NOW(), 'YYYY-MM-DD HH:MI:SS'),
        ' - Refund: ₦',
        p_refund_amount,
        ']'
      ),
      updated_at = NOW()
  WHERE id = p_sale_id;
  
  -- Update return record
  UPDATE sales_returns
  SET return_type = 'full',
      updated_at = NOW()
  WHERE id = p_return_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Create function to calculate return statistics by branch
CREATE OR REPLACE FUNCTION get_branch_return_stats(
  p_pharmacy_id UUID,
  p_branch_id UUID
)
RETURNS TABLE (
  total_returns BIGINT,
  total_refunded NUMERIC,
  full_returns BIGINT,
  partial_returns BIGINT,
  pending_returns BIGINT,
  completed_returns BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_returns,
    COALESCE(SUM(sr.total_refund), 0)::NUMERIC as total_refunded,
    COUNT(*) FILTER (WHERE sr.return_type = 'full')::BIGINT as full_returns,
    COUNT(*) FILTER (WHERE sr.return_type = 'partial')::BIGINT as partial_returns,
    COUNT(*) FILTER (WHERE sr.status = 'pending')::BIGINT as pending_returns,
    COUNT(*) FILTER (WHERE sr.status = 'completed')::BIGINT as completed_returns
  FROM sales_returns sr
  WHERE sr.pharmacy_id = p_pharmacy_id
    AND sr.branch_id = p_branch_id;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_sales_returns_return_type ON sales_returns(return_type);
CREATE INDEX IF NOT EXISTS idx_sales_returns_branch ON sales_returns(branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_branch ON sales(branch_id);

-- Step 7: Update RLS policies for sales to include status check
CREATE POLICY "Admin can view all sales in branch" ON sales
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.pharmacy_id = sales.pharmacy_id
        AND profiles.role = 'admin'
    )
  );

-- Step 8: Add audit logging for returns
CREATE TABLE IF NOT EXISTS return_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  return_id UUID REFERENCES sales_returns(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  performed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_return_audit_log_return ON return_audit_log(return_id);
CREATE INDEX idx_return_audit_log_pharmacy ON return_audit_log(pharmacy_id);
CREATE INDEX idx_return_audit_log_branch ON return_audit_log(branch_id);

-- Enable RLS on audit log
ALTER TABLE return_audit_log ENABLE ROW LEVEL SECURITY;

-- Step 9: Create trigger to log return changes
CREATE OR REPLACE FUNCTION log_return_changes()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO return_audit_log (
    pharmacy_id, branch_id, return_id, action, old_data, new_data, performed_by
  ) VALUES (
    NEW.pharmacy_id,
    NEW.branch_id,
    NEW.id,
    CASE 
      WHEN TG_OP = 'INSERT' THEN 'created'
      WHEN TG_OP = 'UPDATE' THEN 'updated'
      WHEN TG_OP = 'DELETE' THEN 'deleted'
    END,
    CASE WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD) ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN row_to_json(NEW) ELSE NULL END,
    auth.uid()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS return_audit_trigger ON sales_returns;
CREATE TRIGGER return_audit_trigger
  AFTER INSERT OR UPDATE ON sales_returns
  FOR EACH ROW
  EXECUTE FUNCTION log_return_changes();

-- Step 10: Update sales_returns table schema
ALTER TABLE sales_returns
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_sales_returns_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_returns_updated_at ON sales_returns;
CREATE TRIGGER sales_returns_updated_at
  BEFORE UPDATE ON sales_returns
  FOR EACH ROW
  EXECUTE FUNCTION update_sales_returns_timestamp();

COMMENT ON FUNCTION process_partial_return IS 'Handles partial return processing - updates sale to reflect only remaining items and calculates new total';
COMMENT ON FUNCTION process_full_return IS 'Handles full return processing - marks entire sale as returned';
COMMENT ON FUNCTION get_branch_return_stats IS 'Returns comprehensive return statistics for a specific branch';
