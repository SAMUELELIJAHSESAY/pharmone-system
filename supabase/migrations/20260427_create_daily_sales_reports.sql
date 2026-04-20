-- Daily Sales Reports System
-- Automatically generates and stores daily sales reports for each branch

-- Step 1: Create daily_sales_reports table
CREATE TABLE IF NOT EXISTS daily_sales_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  total_sales NUMERIC DEFAULT 0,
  total_items_sold BIGINT DEFAULT 0,
  payment_breakdown JSONB DEFAULT '{"cash": 0, "mobile_money": 0, "card": 0, "other": 0}'::JSONB,
  sales_data JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pharmacy_id, branch_id, report_date)
);

-- Step 2: Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_daily_sales_reports_pharmacy_date ON daily_sales_reports(pharmacy_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_sales_reports_branch_date ON daily_sales_reports(branch_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_sales_reports_date ON daily_sales_reports(report_date DESC);

-- Step 3: Enable RLS on daily_sales_reports
ALTER TABLE daily_sales_reports ENABLE ROW LEVEL SECURITY;

-- Step 4: RLS Policy - Pharmacy admins can view all reports for their pharmacy
CREATE POLICY "Admin can view pharmacy reports" ON daily_sales_reports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.pharmacy_id = daily_sales_reports.pharmacy_id
        AND profiles.role = 'admin'
    )
  );

-- Step 5: RLS Policy - Salesman can view reports for their branch only
CREATE POLICY "Salesman can view branch reports" ON daily_sales_reports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      LEFT JOIN staff_branch_assignments sba ON p.id = sba.staff_id AND sba.is_active = true
      WHERE p.id = auth.uid()
        AND p.pharmacy_id = daily_sales_reports.pharmacy_id
        AND p.role = 'salesman'
        AND sba.branch_id = daily_sales_reports.branch_id
    )
  );

-- Step 6: Create function to generate daily reports
CREATE OR REPLACE FUNCTION generate_daily_sales_report(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_report_date DATE
)
RETURNS UUID AS $$
DECLARE
  v_report_id UUID;
BEGIN
  -- Attempt to insert the report - if it exists (unique constraint), update it instead
  INSERT INTO daily_sales_reports (
    pharmacy_id,
    branch_id,
    report_date,
    total_sales,
    total_items_sold,
    payment_breakdown,
    sales_data,
    created_at,
    updated_at
  ) 
  WITH sale_data AS (
    SELECT 
      s.id,
      s.invoice_number,
      s.customer_id,
      s.payment_method,
      s.total_amount,
      s.created_by,
      s.created_at,
      COUNT(si.id) as item_count
    FROM sales s
    LEFT JOIN sale_items si ON s.id = si.sale_id
    WHERE s.pharmacy_id = p_pharmacy_id
      AND s.branch_id = p_branch_id
      AND DATE(s.created_at) = p_report_date
      AND s.status = 'completed'
    GROUP BY s.id, s.invoice_number, s.customer_id, s.payment_method, s.total_amount, s.created_by, s.created_at
  )
  SELECT 
    p_pharmacy_id,
    p_branch_id,
    p_report_date,
    COALESCE(SUM(sd.total_amount), 0)::NUMERIC,
    COALESCE(SUM(sd.item_count), 0)::BIGINT,
    COALESCE(
      jsonb_object_agg(
        CASE 
          WHEN sd.payment_method = 'cash' THEN 'cash'
          WHEN sd.payment_method = 'mobile_money' THEN 'mobile_money'
          WHEN sd.payment_method = 'card' THEN 'card'
          ELSE 'other'
        END,
        SUM(sd.total_amount)
      ),
      '{"cash": 0, "mobile_money": 0, "card": 0, "other": 0}'::JSONB
    ),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'invoice_number', sd.invoice_number,
          'customer_name', COALESCE(c.name, 'Walk-in'),
          'items', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'product_name', si.product_name,
                'quantity', si.quantity,
                'unit_price', si.unit_price,
                'total_price', si.total_price
              ) ORDER BY si.id
            )
            FROM sale_items si
            WHERE si.sale_id = sd.id
          ), '[]'::JSONB),
          'amount', sd.total_amount,
          'payment_method', sd.payment_method,
          'staff_name', COALESCE(p.full_name, 'Unknown'),
          'created_at', sd.created_at
        ) ORDER BY sd.created_at
      ),
      '[]'::JSONB
    ),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM sale_data sd
  LEFT JOIN customers c ON sd.customer_id = c.id
  LEFT JOIN profiles p ON sd.created_by = p.id
            WHERE si.sale_id = sd.id
          ), '[]'::JSONB),
          'amount', sd.total_amount,
          'payment_method', sd.payment_method,
          'staff_name', COALESCE(p.full_name, 'Unknown'),
          'created_at', sd.created_at
        ) ORDER BY sd.created_at
      ),
      '[]'::JSONB
    ),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM sale_data sd
  LEFT JOIN customers c ON sd.customer_id = c.id
  LEFT JOIN profiles p ON sd.created_by = p.id
  GROUP BY p_pharmacy_id, p_branch_id, p_report_date
  ON CONFLICT (pharmacy_id, branch_id, report_date) DO UPDATE SET
    total_sales = EXCLUDED.total_sales,
    total_items_sold = EXCLUDED.total_items_sold,
    payment_breakdown = EXCLUDED.payment_breakdown,
    sales_data = EXCLUDED.sales_data,
    updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO v_report_id;

  -- If no rows were affected (no sales), still create a report
  IF v_report_id IS NULL THEN
    INSERT INTO daily_sales_reports (
      pharmacy_id,
      branch_id,
      report_date,
      total_sales,
      total_items_sold,
      payment_breakdown,
      sales_data,
      created_at,
      updated_at
    ) VALUES (
      p_pharmacy_id,
      p_branch_id,
      p_report_date,
      0,
      0,
      '{"cash": 0, "mobile_money": 0, "card": 0, "other": 0}'::JSONB,
      '[]'::JSONB,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (pharmacy_id, branch_id, report_date) DO UPDATE SET
      updated_at = CURRENT_TIMESTAMP
    RETURNING id INTO v_report_id;
  END IF;

  RETURN COALESCE(v_report_id, (
    SELECT id FROM daily_sales_reports 
    WHERE pharmacy_id = p_pharmacy_id 
      AND branch_id = p_branch_id 
      AND report_date = p_report_date
    LIMIT 1
  ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 7: Create trigger to update timestamp
CREATE OR REPLACE FUNCTION update_daily_sales_reports_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS daily_sales_reports_updated_at ON daily_sales_reports;
CREATE TRIGGER daily_sales_reports_updated_at
  BEFORE UPDATE ON daily_sales_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_sales_reports_timestamp();

-- Step 8: Create function to get daily reports with pagination
CREATE OR REPLACE FUNCTION get_daily_reports(
  p_pharmacy_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 30,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  pharmacy_id UUID,
  branch_id UUID,
  branch_name TEXT,
  report_date DATE,
  total_sales NUMERIC,
  total_items_sold BIGINT,
  payment_breakdown JSONB,
  sales_data JSONB,
  created_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dsr.id,
    dsr.pharmacy_id,
    dsr.branch_id,
    b.name as branch_name,
    dsr.report_date,
    dsr.total_sales,
    dsr.total_items_sold,
    dsr.payment_breakdown,
    dsr.sales_data,
    dsr.created_at
  FROM daily_sales_reports dsr
  LEFT JOIN branches b ON dsr.branch_id = b.id
  WHERE dsr.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR dsr.branch_id = p_branch_id)
  ORDER BY dsr.report_date DESC, dsr.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 9: Create function to get detailed report by ID
CREATE OR REPLACE FUNCTION get_daily_report_detail(p_report_id UUID)
RETURNS TABLE (
  id UUID,
  pharmacy_id UUID,
  branch_id UUID,
  report_date DATE,
  total_sales NUMERIC,
  total_items_sold BIGINT,
  payment_breakdown JSONB,
  sales_data JSONB,
  created_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dsr.id,
    dsr.pharmacy_id,
    dsr.branch_id,
    dsr.report_date,
    dsr.total_sales,
    dsr.total_items_sold,
    dsr.payment_breakdown,
    dsr.sales_data,
    dsr.created_at
  FROM daily_sales_reports dsr
  WHERE dsr.id = p_report_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 10: Documentation comments
COMMENT ON TABLE daily_sales_reports IS 'Stores daily aggregated sales data for each branch, auto-generated with JSONB format for flexible storage of sales items and payment methods';

COMMENT ON FUNCTION generate_daily_sales_report IS 'Generates or updates a daily sales report by aggregating all completed sales for a specific branch and date';

COMMENT ON FUNCTION get_daily_reports IS 'Retrieves paginated daily sales reports with optional branch filtering';

COMMENT ON FUNCTION get_daily_report_detail IS 'Retrieves detailed information for a specific daily report including full sales breakdown and payment details';
