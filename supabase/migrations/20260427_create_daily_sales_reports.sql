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
  payment_breakdown JSONB, -- {cash: 0, mobile_money: 0, card: 0}
  sales_data JSONB NOT NULL, -- Array of {customer_name, items, amount, payment_method, staff_name}
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_daily_sales_reports_pharmacy_date ON daily_sales_reports(pharmacy_id, report_date);
CREATE INDEX IF NOT EXISTS idx_daily_sales_reports_branch_date ON daily_sales_reports(branch_id, report_date);
CREATE INDEX IF NOT EXISTS idx_daily_sales_reports_date ON daily_sales_reports(report_date);

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
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.pharmacy_id = daily_sales_reports.pharmacy_id
        AND profiles.role = 'salesman'
        AND profiles.branch_id = daily_sales_reports.branch_id
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
  v_sales_data JSONB;
  v_total_sales NUMERIC := 0;
  v_total_items BIGINT := 0;
  v_payment_breakdown JSONB := '{"cash": 0, "mobile_money": 0, "card": 0, "other": 0}'::JSONB;
BEGIN
  -- Get all sales for the branch on the given date
  WITH daily_sales AS (
    SELECT 
      s.id,
      s.invoice_number,
      s.total_amount,
      s.payment_method,
      s.created_at,
      c.name as customer_name,
      p.full_name as staff_name,
      jsonb_agg(
        jsonb_build_object(
          'product_name', si.product_name,
          'quantity', si.quantity,
          'unit_price', si.unit_price,
          'total_price', si.total_price
        )
      ) as items
    FROM sales s
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN profiles p ON s.created_by = p.id
    LEFT JOIN sale_items si ON s.id = si.sale_id
    WHERE s.pharmacy_id = p_pharmacy_id
      AND s.branch_id = p_branch_id
      AND DATE(s.created_at) = p_report_date
      AND s.status = 'completed'
    GROUP BY s.id, s.invoice_number, s.total_amount, s.payment_method, s.created_at, c.name, p.full_name
  )
  SELECT 
    jsonb_agg(
      jsonb_build_object(
        'invoice_number', invoice_number,
        'customer_name', COALESCE(customer_name, 'Walk-in'),
        'items', COALESCE(items, '[]'::JSONB),
        'amount', total_amount,
        'payment_method', payment_method,
        'staff_name', COALESCE(staff_name, 'Unknown'),
        'created_at', created_at
      )
    ),
    SUM(total_amount),
    SUM(CASE WHEN (items IS NOT NULL) THEN jsonb_array_length(items) ELSE 0 END)
  INTO v_sales_data, v_total_sales, v_total_items
  FROM daily_sales;

  -- Update payment breakdown
  UPDATE LATERAL (
    SELECT 
      CASE WHEN payment_method = 'cash' THEN 'cash'
           WHEN payment_method = 'mobile_money' THEN 'mobile_money'
           WHEN payment_method = 'card' THEN 'card'
           ELSE 'other' END as method,
      SUM(total_amount) as amount
    FROM sales
    WHERE pharmacy_id = p_pharmacy_id
      AND branch_id = p_branch_id
      AND DATE(created_at) = p_report_date
      AND status = 'completed'
    GROUP BY payment_method
  ) payment_summary
  SET v_payment_breakdown = v_payment_breakdown || 
    jsonb_build_object(payment_summary.method, payment_summary.amount);

  -- Check if report already exists
  SELECT id INTO v_report_id 
  FROM daily_sales_reports 
  WHERE pharmacy_id = p_pharmacy_id 
    AND branch_id = p_branch_id 
    AND report_date = p_report_date;

  -- Insert or update report
  IF v_report_id IS NULL THEN
    INSERT INTO daily_sales_reports (
      pharmacy_id, branch_id, report_date, total_sales, 
      total_items_sold, payment_breakdown, sales_data
    ) VALUES (
      p_pharmacy_id, p_branch_id, p_report_date, COALESCE(v_total_sales, 0),
      COALESCE(v_total_items, 0), v_payment_breakdown, COALESCE(v_sales_data, '[]'::JSONB)
    )
    RETURNING id INTO v_report_id;
  ELSE
    UPDATE daily_sales_reports
    SET total_sales = COALESCE(v_total_sales, 0),
        total_items_sold = COALESCE(v_total_items, 0),
        payment_breakdown = v_payment_breakdown,
        sales_data = COALESCE(v_sales_data, '[]'::JSONB),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_report_id;
  END IF;

  RETURN v_report_id;
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_daily_sales_report IS 'Generates or updates a daily sales report for a specific branch and date, aggregating all completed sales with customer and item details';
COMMENT ON FUNCTION get_daily_reports IS 'Retrieves daily sales reports with optional branch filtering and pagination support';
