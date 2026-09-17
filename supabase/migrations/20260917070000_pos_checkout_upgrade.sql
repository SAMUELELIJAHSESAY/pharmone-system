-- SamMia Pharm POS checkout upgrade
-- Adds split-payment metadata, change tracking, packaging metadata and held-sale persistence.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cash_received numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_due numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales
  ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash', 'mobile_money', 'card', 'split'));

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS packaging_type text NOT NULL DEFAULT 'unit';
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS packaging_quantity numeric(12,3);

CREATE TABLE IF NOT EXISTS pos_held_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT 'Held sale',
  cart_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_held_sales_owner
  ON pos_held_sales (pharmacy_id, branch_id, created_by, created_at DESC);

ALTER TABLE pos_held_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "POS staff can read own held sales" ON pos_held_sales;
CREATE POLICY "POS staff can read own held sales"
  ON pos_held_sales FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    AND pharmacy_id = get_user_pharmacy_id()
  );

DROP POLICY IF EXISTS "POS staff can create own held sales" ON pos_held_sales;
CREATE POLICY "POS staff can create own held sales"
  ON pos_held_sales FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND pharmacy_id = get_user_pharmacy_id()
  );

DROP POLICY IF EXISTS "POS staff can update own held sales" ON pos_held_sales;
CREATE POLICY "POS staff can update own held sales"
  ON pos_held_sales FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND pharmacy_id = get_user_pharmacy_id())
  WITH CHECK (created_by = auth.uid() AND pharmacy_id = get_user_pharmacy_id());

DROP POLICY IF EXISTS "POS staff can delete own held sales" ON pos_held_sales;
CREATE POLICY "POS staff can delete own held sales"
  ON pos_held_sales FOR DELETE TO authenticated
  USING (created_by = auth.uid() AND pharmacy_id = get_user_pharmacy_id());
