-- SamMia Pharm - Daily Records + Cash Closing upgrade
-- Adds operational snapshots, staff performance and end-of-day cash reconciliation.

ALTER TABLE daily_sales_reports
  ADD COLUMN IF NOT EXISTS total_transactions BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS staff_breakdown JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS approved_expenses NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_breakdown JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS cash_expenses NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recorded_returns NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_count BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_cash NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_cash NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cash NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cash_variance NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS closing_notes TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS closing_status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'daily_sales_reports_closing_status_check'
      AND conrelid = 'daily_sales_reports'::regclass
  ) THEN
    ALTER TABLE daily_sales_reports
      ADD CONSTRAINT daily_sales_reports_closing_status_check
      CHECK (closing_status IN ('open', 'closed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_daily_sales_reports_closing_status
  ON daily_sales_reports(pharmacy_id, closing_status, report_date DESC);

-- Rebuild the daily report generator so the saved record contains a useful
-- operating snapshot in addition to sales totals.
CREATE OR REPLACE FUNCTION generate_daily_sales_report(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_report_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = auth.uid()
      AND p.pharmacy_id = p_pharmacy_id
      AND p.role = 'admin'
      AND COALESCE(p.is_active, true) = true
  ) THEN
    RAISE EXCEPTION 'Not authorized to generate daily reports';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM branches b
    WHERE b.id = p_branch_id AND b.pharmacy_id = p_pharmacy_id
  ) THEN
    RAISE EXCEPTION 'Branch does not belong to this pharmacy';
  END IF;

  WITH sales_summary AS (
    SELECT
      s.id,
      s.invoice_number,
      s.customer_id,
      s.payment_method,
      s.total_amount,
      s.created_by,
      s.created_at,
      COALESCE(SUM(si.quantity), 0)::BIGINT AS item_count
    FROM sales s
    LEFT JOIN sale_items si ON si.sale_id = s.id
    WHERE s.pharmacy_id = p_pharmacy_id
      AND s.branch_id = p_branch_id
      AND DATE(s.created_at) = p_report_date
      AND s.status = 'completed'
    GROUP BY s.id, s.invoice_number, s.customer_id, s.payment_method,
             s.total_amount, s.created_by, s.created_at
  ),
  payment_totals AS (
    SELECT
      CASE
        WHEN ss.payment_method = 'cash' THEN 'cash'
        WHEN ss.payment_method = 'mobile_money' THEN 'mobile_money'
        WHEN ss.payment_method = 'card' THEN 'card'
        ELSE 'other'
      END AS method,
      COALESCE(SUM(ss.total_amount), 0)::NUMERIC AS amount
    FROM sales_summary ss
    GROUP BY 1
  ),
  payment_json AS (
    SELECT COALESCE(jsonb_object_agg(method, amount), '{}'::JSONB) AS breakdown
    FROM payment_totals
  ),
  staff_totals AS (
    SELECT
      ss.created_by AS staff_id,
      COALESCE(p.full_name, 'Unknown') AS staff_name,
      COUNT(*)::BIGINT AS transactions,
      COALESCE(SUM(ss.total_amount), 0)::NUMERIC AS total
    FROM sales_summary ss
    LEFT JOIN profiles p ON p.id = ss.created_by
    GROUP BY ss.created_by, p.full_name
  ),
  staff_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'staff_id', staff_id,
          'staff_name', staff_name,
          'transactions', transactions,
          'total', total
        ) ORDER BY total DESC
      ),
      '[]'::JSONB
    ) AS breakdown
    FROM staff_totals
  ),
  expense_rows AS (
    SELECT e.amount, e.payment_method, COALESCE(ec.category_name, 'Uncategorized') AS category_name
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    WHERE e.pharmacy_id = p_pharmacy_id
      AND e.branch_id = p_branch_id
      AND e.expense_date = p_report_date
      AND e.is_approved = true
  ),
  expense_category_totals AS (
    SELECT category_name, COALESCE(SUM(amount), 0)::NUMERIC AS total
    FROM expense_rows
    GROUP BY category_name
  ),
  expense_snapshot AS (
    SELECT
      COALESCE((SELECT SUM(amount) FROM expense_rows), 0)::NUMERIC AS total,
      COALESCE((SELECT SUM(amount) FROM expense_rows WHERE payment_method = 'cash'), 0)::NUMERIC AS cash_total,
      COALESCE((SELECT jsonb_object_agg(category_name, total) FROM expense_category_totals), '{}'::JSONB) AS breakdown
  ),
  return_snapshot AS (
    SELECT
      COALESCE(SUM(sr.total_refund), 0)::NUMERIC AS total,
      COUNT(*)::BIGINT AS count
    FROM sales_returns sr
    WHERE sr.pharmacy_id = p_pharmacy_id
      AND sr.branch_id = p_branch_id
      AND DATE(sr.created_at) = p_report_date
      AND sr.status = 'completed'
  ),
  aggregate_values AS (
    SELECT
      COALESCE((SELECT SUM(total_amount) FROM sales_summary), 0)::NUMERIC AS total_sales,
      COALESCE((SELECT SUM(item_count) FROM sales_summary), 0)::BIGINT AS total_items,
      COALESCE((SELECT COUNT(*) FROM sales_summary), 0)::BIGINT AS total_transactions,
      pj.breakdown AS payment_breakdown,
      sj.breakdown AS staff_breakdown,
      es.total AS approved_expenses,
      es.cash_total AS cash_expenses,
      es.breakdown AS expense_breakdown,
      rs.total AS recorded_returns,
      rs.count AS return_count,
      COALESCE((SELECT amount FROM payment_totals WHERE method = 'cash'), 0)::NUMERIC AS cash_sales
    FROM payment_json pj
    CROSS JOIN staff_json sj
    CROSS JOIN expense_snapshot es
    CROSS JOIN return_snapshot rs
  ),
  sales_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'invoice_number', ss.invoice_number,
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
            WHERE si.sale_id = ss.id
          ), '[]'::JSONB),
          'amount', ss.total_amount,
          'payment_method', ss.payment_method,
          'staff_name', COALESCE(p.full_name, 'Unknown'),
          'created_at', ss.created_at
        ) ORDER BY ss.created_at
      ),
      '[]'::JSONB
    ) AS data
    FROM sales_summary ss
    LEFT JOIN customers c ON c.id = ss.customer_id
    LEFT JOIN profiles p ON p.id = ss.created_by
  )
  INSERT INTO daily_sales_reports (
    pharmacy_id,
    branch_id,
    report_date,
    total_sales,
    total_items_sold,
    total_transactions,
    payment_breakdown,
    sales_data,
    staff_breakdown,
    approved_expenses,
    expense_breakdown,
    cash_expenses,
    recorded_returns,
    return_count,
    expected_cash,
    created_at,
    updated_at
  )
  SELECT
    p_pharmacy_id,
    p_branch_id,
    p_report_date,
    av.total_sales,
    av.total_items,
    av.total_transactions,
    av.payment_breakdown,
    sj.data,
    av.staff_breakdown,
    av.approved_expenses,
    av.expense_breakdown,
    av.cash_expenses,
    av.recorded_returns,
    av.return_count,
    av.cash_sales - av.cash_expenses,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM aggregate_values av
  CROSS JOIN sales_json sj
  ON CONFLICT (pharmacy_id, branch_id, report_date) DO UPDATE SET
    total_sales = EXCLUDED.total_sales,
    total_items_sold = EXCLUDED.total_items_sold,
    total_transactions = EXCLUDED.total_transactions,
    payment_breakdown = EXCLUDED.payment_breakdown,
    sales_data = EXCLUDED.sales_data,
    staff_breakdown = EXCLUDED.staff_breakdown,
    approved_expenses = EXCLUDED.approved_expenses,
    expense_breakdown = EXCLUDED.expense_breakdown,
    cash_expenses = EXCLUDED.cash_expenses,
    recorded_returns = EXCLUDED.recorded_returns,
    return_count = EXCLUDED.return_count,
    expected_cash = CASE
      WHEN daily_sales_reports.closing_status = 'open'
        THEN daily_sales_reports.opening_cash + EXCLUDED.expected_cash
      ELSE daily_sales_reports.expected_cash
    END,
    updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

-- Admin-only cash reconciliation. Expected cash is intentionally based on
-- opening cash + cash sales - approved cash expenses. Return refunds remain a
-- separate informational total until return-payment accounting is normalized.
CREATE OR REPLACE FUNCTION close_daily_sales_report(
  p_report_id UUID,
  p_opening_cash NUMERIC,
  p_actual_cash NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report daily_sales_reports%ROWTYPE;
  v_cash_sales NUMERIC := 0;
  v_expected NUMERIC := 0;
BEGIN
  SELECT dsr.* INTO v_report
  FROM daily_sales_reports dsr
  WHERE dsr.id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Daily report not found';
  END IF;

  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.pharmacy_id = v_report.pharmacy_id
      AND p.role = 'admin'
      AND COALESCE(p.is_active, true) = true
  ) THEN
    RAISE EXCEPTION 'Not authorized to close this daily report';
  END IF;

  IF p_opening_cash < 0 OR p_actual_cash < 0 THEN
    RAISE EXCEPTION 'Cash amounts cannot be negative';
  END IF;

  v_cash_sales := COALESCE((v_report.payment_breakdown ->> 'cash')::NUMERIC, 0);
  v_expected := COALESCE(p_opening_cash, 0) + v_cash_sales - COALESCE(v_report.cash_expenses, 0);

  UPDATE daily_sales_reports
  SET opening_cash = COALESCE(p_opening_cash, 0),
      expected_cash = v_expected,
      actual_cash = COALESCE(p_actual_cash, 0),
      cash_variance = COALESCE(p_actual_cash, 0) - v_expected,
      closing_notes = COALESCE(p_notes, ''),
      closing_status = 'closed',
      closed_by = auth.uid(),
      closed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  RETURN jsonb_build_object(
    'id', v_report.id,
    'opening_cash', v_report.opening_cash,
    'expected_cash', v_report.expected_cash,
    'actual_cash', v_report.actual_cash,
    'cash_variance', v_report.cash_variance,
    'closing_status', v_report.closing_status,
    'closed_at', v_report.closed_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION generate_daily_sales_report(UUID, UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION close_daily_sales_report(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;

COMMENT ON COLUMN daily_sales_reports.staff_breakdown IS 'Per-employee transaction and sales totals captured when the report is generated/refreshed.';
COMMENT ON COLUMN daily_sales_reports.approved_expenses IS 'Approved expenses for the same branch and report date.';
COMMENT ON COLUMN daily_sales_reports.recorded_returns IS 'Completed return refund totals shown separately from operating result until return accounting is normalized.';
COMMENT ON COLUMN daily_sales_reports.expected_cash IS 'Opening cash + cash sales - approved cash expenses.';
COMMENT ON FUNCTION close_daily_sales_report IS 'Admin-only end-of-day cash reconciliation for a daily branch report.';
