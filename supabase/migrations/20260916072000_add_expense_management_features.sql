-- SamMia Pharm: Admin Expense Management upgrade
-- Adds recurring expense templates and receipt attachments.

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  category_id uuid NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  description text NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  payment_method text DEFAULT 'cash' CHECK (payment_method IN ('cash', 'check', 'bank_transfer', 'mobile_money', 'credit_card')),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_pharmacy ON recurring_expenses(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_branch ON recurring_expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_due ON recurring_expenses(next_due_date);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_active ON recurring_expenses(is_active);

ALTER TABLE recurring_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can view recurring expenses" ON recurring_expenses;
CREATE POLICY "Admin can view recurring expenses"
  ON recurring_expenses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'super_admin' OR (p.role = 'admin' AND p.pharmacy_id = recurring_expenses.pharmacy_id))
    )
  );

DROP POLICY IF EXISTS "Admin can manage recurring expenses" ON recurring_expenses;
CREATE POLICY "Admin can manage recurring expenses"
  ON recurring_expenses FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'super_admin' OR (p.role = 'admin' AND p.pharmacy_id = recurring_expenses.pharmacy_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'super_admin' OR (p.role = 'admin' AND p.pharmacy_id = recurring_expenses.pharmacy_id))
    )
  );

DROP TRIGGER IF EXISTS recurring_expenses_updated_at ON recurring_expenses;
CREATE TRIGGER recurring_expenses_updated_at
  BEFORE UPDATE ON recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS expense_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint DEFAULT 0,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(file_path)
);

CREATE INDEX IF NOT EXISTS idx_expense_attachments_expense ON expense_attachments(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_pharmacy ON expense_attachments(pharmacy_id);

ALTER TABLE expense_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pharmacy users can view expense attachments" ON expense_attachments;
CREATE POLICY "Pharmacy users can view expense attachments"
  ON expense_attachments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      JOIN expenses e ON e.id = expense_attachments.expense_id
      WHERE p.id = auth.uid()
        AND e.pharmacy_id = expense_attachments.pharmacy_id
        AND (p.role = 'super_admin' OR p.pharmacy_id = expense_attachments.pharmacy_id)
    )
  );

DROP POLICY IF EXISTS "Pharmacy users can add expense attachments" ON expense_attachments;
CREATE POLICY "Pharmacy users can add expense attachments"
  ON expense_attachments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      JOIN expenses e ON e.id = expense_attachments.expense_id
      WHERE p.id = auth.uid()
        AND e.pharmacy_id = expense_attachments.pharmacy_id
        AND (p.role = 'super_admin' OR p.pharmacy_id = expense_attachments.pharmacy_id)
    )
  );

DROP POLICY IF EXISTS "Admins can delete expense attachments" ON expense_attachments;
CREATE POLICY "Admins can delete expense attachments"
  ON expense_attachments FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'super_admin' OR (p.role = 'admin' AND p.pharmacy_id = expense_attachments.pharmacy_id))
    )
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Pharmacy users can read expense receipts" ON storage.objects;
CREATE POLICY "Pharmacy users can read expense receipts"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'super_admin' OR p.pharmacy_id::text = split_part(name, '/', 1))
    )
  );

DROP POLICY IF EXISTS "Pharmacy users can upload expense receipts" ON storage.objects;
CREATE POLICY "Pharmacy users can upload expense receipts"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'super_admin' OR p.pharmacy_id::text = split_part(name, '/', 1))
    )
  );

DROP POLICY IF EXISTS "Admins can delete expense receipts" ON storage.objects;
CREATE POLICY "Admins can delete expense receipts"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'super_admin' OR (p.role = 'admin' AND p.pharmacy_id::text = split_part(name, '/', 1)))
    )
  );

-- Server-side expense aggregation for large ledgers. The client falls back to
-- narrow paged reads if this migration has not been applied yet.
CREATE OR REPLACE FUNCTION get_expense_filtered_summary(
  p_pharmacy_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND (p.role = 'super_admin' OR p.pharmacy_id = p_pharmacy_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized for this pharmacy';
  END IF;

  WITH filtered AS (
    SELECT e.amount, e.payment_method, e.is_approved,
           COALESCE(ec.category_name, 'Uncategorized') AS category_name
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    WHERE e.pharmacy_id = p_pharmacy_id
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
      AND (p_start_date IS NULL OR e.expense_date >= p_start_date)
      AND (p_end_date IS NULL OR e.expense_date <= p_end_date)
      AND (p_category_id IS NULL OR e.category_id = p_category_id)
      AND (p_payment_method IS NULL OR e.payment_method = p_payment_method)
      AND (
        COALESCE(p_status, 'all') = 'all'
        OR (p_status = 'approved' AND e.is_approved = true)
        OR (p_status = 'pending' AND e.is_approved = false)
      )
      AND (
        NULLIF(BTRIM(p_search), '') IS NULL
        OR e.description ILIKE '%' || p_search || '%'
        OR COALESCE(e.receipt_number, '') ILIKE '%' || p_search || '%'
        OR COALESCE(e.notes, '') ILIKE '%' || p_search || '%'
      )
  ),
  payment_totals AS (
    SELECT COALESCE(payment_method, 'other') AS payment_method, SUM(amount) AS total
    FROM filtered GROUP BY COALESCE(payment_method, 'other')
  ),
  category_totals AS (
    SELECT category_name, SUM(amount) AS total
    FROM filtered GROUP BY category_name
  )
  SELECT jsonb_build_object(
    'totalAmount', COALESCE((SELECT SUM(amount) FROM filtered), 0),
    'approvedAmount', COALESCE((SELECT SUM(amount) FROM filtered WHERE is_approved), 0),
    'pendingAmount', COALESCE((SELECT SUM(amount) FROM filtered WHERE NOT is_approved), 0),
    'count', (SELECT COUNT(*) FROM filtered),
    'approvedCount', (SELECT COUNT(*) FROM filtered WHERE is_approved),
    'pendingCount', (SELECT COUNT(*) FROM filtered WHERE NOT is_approved),
    'paymentBreakdown', COALESCE((SELECT jsonb_object_agg(payment_method, total) FROM payment_totals), '{}'::jsonb),
    'categoryBreakdown', COALESCE((SELECT jsonb_object_agg(category_name, total) FROM category_totals), '{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_expense_filtered_summary(uuid, uuid, date, date, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_expense_filtered_summary(uuid, uuid, date, date, uuid, text, text, text) TO authenticated;
