
/*
  # Pharmacy Management System - Full Schema

  ## New Tables
  1. `pharmacies` - Tenant table for each pharmacy business
     - id, name, owner_id, address, phone, email, is_active, created_at

  2. `profiles` - Extended user profiles with roles
     - id (auth.users ref), email, full_name, role, pharmacy_id, is_active, created_at

  3. `branches` - Pharmacy branches
     - id, name, pharmacy_id, address, is_active, feature_settings (jsonb), created_at

  4. `products` - Drug/product inventory
     - id, name, category, description, price, cost_price, stock_boxes, stock_units,
       units_per_box, expiry_date, pharmacy_id, branch_id, is_active, created_at

  5. `customers` - Customer records per pharmacy
     - id, name, phone, email, address, pharmacy_id, created_at

  6. `sales` - Sales transactions
     - id, invoice_number, customer_id, payment_method, total_amount, discount,
       status, notes, created_by, pharmacy_id, branch_id, created_at

  7. `sale_items` - Line items for each sale
     - id, sale_id, product_id, quantity, unit_price, total_price

  8. `stock_logs` - Audit trail for all stock changes
     - id, product_id, change_type, quantity_change, notes, created_by, pharmacy_id, created_at

  ## Security
  - RLS enabled on all tables
  - Role-based policies: super_admin, admin, salesman
  - Users only access their own pharmacy data
*/

-- ==========================================
-- PHARMACIES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS pharmacies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  address text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  logo_url text DEFAULT '',
  branding_color text DEFAULT '#1976d2',
  currency_code text DEFAULT 'USD',
  currency_symbol text DEFAULT '$',
  tax_enabled boolean DEFAULT false,
  tax_rate numeric(5,2) DEFAULT 0,
  discount_enabled boolean DEFAULT true,
  discount_rules jsonb DEFAULT '{"max_discount": 10, "min_cart_amount": 0}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE pharmacies ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PROFILES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text DEFAULT '',
  role text NOT NULL DEFAULT 'salesman' CHECK (role IN ('super_admin', 'admin', 'salesman')),
  pharmacy_id uuid REFERENCES pharmacies(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- BRANCHES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  address text DEFAULT '',
  is_active boolean DEFAULT true,
  feature_settings jsonb DEFAULT '{"inventory": true, "sales": true, "customers": true, "reports": true}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PRODUCTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text DEFAULT 'General',
  description text DEFAULT '',
  price numeric(10,2) NOT NULL DEFAULT 0,
  cost_price numeric(10,2) DEFAULT 0,
  stock_boxes integer DEFAULT 0,
  stock_units integer DEFAULT 0,
  units_per_box integer DEFAULT 1,
  expiry_date date,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  low_stock_threshold integer DEFAULT 5,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PRODUCT BATCHES TABLE (For FIFO tracking)
-- ==========================================
CREATE TABLE IF NOT EXISTS product_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  batch_number text NOT NULL,
  quantity_boxes integer NOT NULL DEFAULT 0,
  quantity_units integer NOT NULL DEFAULT 0,
  units_per_box integer NOT NULL DEFAULT 1,
  cost_price numeric(10,2) DEFAULT 0,
  expiry_date date,
  received_at date NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE product_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_product_batches_product ON product_batches(product_id);
CREATE INDEX idx_product_batches_pharmacy ON product_batches(pharmacy_id);
CREATE INDEX idx_product_batches_expiry ON product_batches(expiry_date);

-- ==========================================
-- CUSTOMERS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text DEFAULT '',
  email text DEFAULT '',
  address text DEFAULT '',
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- SALES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  payment_method text DEFAULT 'cash' CHECK (payment_method IN ('cash', 'mobile_money', 'card')),
  total_amount numeric(10,2) DEFAULT 0,
  discount numeric(10,2) DEFAULT 0,
  status text DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'cancelled')),
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- SALE ITEMS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  total_price numeric(10,2) NOT NULL DEFAULT 0
);

ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- STOCK LOGS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS stock_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('sale', 'restock', 'adjustment', 'initial')),
  quantity_change integer NOT NULL,
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE stock_logs ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- HELPER FUNCTION: get current user role
-- ==========================================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_pharmacy_id()
RETURNS uuid AS $$
  SELECT pharmacy_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ==========================================
-- RLS POLICIES: PHARMACIES
-- ==========================================
CREATE POLICY "Super admin can view all pharmacies"
  ON pharmacies FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Admin can view own pharmacy"
  ON pharmacies FOR SELECT
  TO authenticated
  USING (id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Salesman can view own pharmacy"
  ON pharmacies FOR SELECT
  TO authenticated
  USING (id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

CREATE POLICY "Super admin can insert pharmacies"
  ON pharmacies FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "Super admin can update pharmacies"
  ON pharmacies FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "Admin can update own pharmacy"
  ON pharmacies FOR UPDATE
  TO authenticated
  USING (id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Super admin can delete pharmacies"
  ON pharmacies FOR DELETE
  TO authenticated
  USING (get_user_role() = 'super_admin');

-- ==========================================
-- RLS POLICIES: PROFILES
-- ==========================================
CREATE POLICY "Super admin can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Admin can view own pharmacy profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "User can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "Super admin can insert any profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "Admin can insert profiles for own pharmacy"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "User can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Super admin can update any profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "Admin can update profiles in own pharmacy"
  ON profiles FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- ==========================================
-- RLS POLICIES: BRANCHES
-- ==========================================
CREATE POLICY "Super admin can view all branches"
  ON branches FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Admin and salesman can view own pharmacy branches"
  ON branches FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin can insert branches"
  ON branches FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can update own branches"
  ON branches FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Super admin can manage all branches"
  ON branches FOR DELETE
  TO authenticated
  USING (get_user_role() = 'super_admin');

-- ==========================================
-- RLS POLICIES: PRODUCTS
-- ==========================================
CREATE POLICY "Super admin can view all products"
  ON products FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own products"
  ON products FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin can insert products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admin can update products"
  ON products FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Super admin can update any product"
  ON products FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "Admin can delete products"
  ON products FOR DELETE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- ==========================================
-- RLS POLICIES: PRODUCT BATCHES
-- ==========================================
CREATE POLICY "Super admin can view all batches"
  ON product_batches FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own batches"
  ON product_batches FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin can insert batches"
  ON product_batches FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admin can update own batches"
  ON product_batches FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Super admin can manage all batches"
  ON product_batches FOR DELETE
  TO authenticated
  USING (get_user_role() = 'super_admin');

-- ==========================================
-- RLS POLICIES: CUSTOMERS
-- ==========================================
CREATE POLICY "Super admin can view all customers"
  ON customers FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own customers"
  ON customers FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin and salesman can insert customers"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin and salesman can update customers"
  ON customers FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id())
  WITH CHECK (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin can delete customers"
  ON customers FOR DELETE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- ==========================================
-- RLS POLICIES: SALES
-- ==========================================
CREATE POLICY "Super admin can view all sales"
  ON sales FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own sales"
  ON sales FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Pharmacy users can insert sales"
  ON sales FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND created_by = auth.uid());

CREATE POLICY "Admin can update own pharmacy sales"
  ON sales FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can delete own pharmacy sales"
  ON sales FOR DELETE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- ==========================================
-- RLS POLICIES: SALE ITEMS
-- ==========================================
CREATE POLICY "Super admin can view all sale items"
  ON sale_items FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own sale items"
  ON sale_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sales
      WHERE sales.id = sale_items.sale_id
      AND sales.pharmacy_id = get_user_pharmacy_id()
    )
  );

CREATE POLICY "Pharmacy users can insert sale items"
  ON sale_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales
      WHERE sales.id = sale_items.sale_id
      AND sales.pharmacy_id = get_user_pharmacy_id()
    )
  );

-- ==========================================
-- RLS POLICIES: STOCK LOGS
-- ==========================================
CREATE POLICY "Super admin can view all stock logs"
  ON stock_logs FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own stock logs"
  ON stock_logs FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Pharmacy users can insert stock logs"
  ON stock_logs FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id());

-- ==========================================
-- AUTO-UPDATE updated_at TRIGGER
-- ==========================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER pharmacies_updated_at
  BEFORE UPDATE ON pharmacies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- BUSINESS LOGIC FUNCTIONS
-- ==========================================

-- FIFO Deduction: Deduct stock from oldest non-expired batch first
CREATE OR REPLACE FUNCTION deduct_stock_fifo(p_product_id uuid, p_quantity integer, p_pharmacy_id uuid)
RETURNS TABLE (deducted integer, expired_found boolean) AS $$
DECLARE
  v_remaining integer := p_quantity;
  v_expired_found boolean := false;
  v_batch record;
  v_to_deduct integer;
BEGIN
  -- Check for expired batches first
  IF EXISTS (SELECT 1 FROM product_batches WHERE product_id = p_product_id AND expiry_date < now()::date) THEN
    v_expired_found := true;
  END IF;

  -- Deduct from oldest non-expired batches (FIFO)
  FOR v_batch IN 
    SELECT id, quantity_boxes, quantity_units, units_per_box 
    FROM product_batches 
    WHERE product_id = p_product_id 
      AND pharmacy_id = p_pharmacy_id
      AND (expiry_date IS NULL OR expiry_date >= now()::date)
    ORDER BY received_at ASC
  LOOP
    IF v_remaining <= 0 THEN EXIT; END IF;
    
    -- Calculate total units in batch
    v_to_deduct := LEAST(v_remaining, (v_batch.quantity_boxes * v_batch.units_per_box) + v_batch.quantity_units);
    
    -- Update batch
    UPDATE product_batches 
    SET quantity_units = quantity_units - (v_to_deduct % units_per_box),
        quantity_boxes = GREATEST(0, quantity_boxes - (v_to_deduct / units_per_box))
    WHERE id = v_batch.id;
    
    v_remaining := v_remaining - v_to_deduct;
  END LOOP;

  RETURN QUERY SELECT p_quantity - v_remaining, v_expired_found;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Prevent negative stock constraint
CREATE OR REPLACE FUNCTION prevent_negative_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stock_boxes < 0 OR NEW.stock_units < 0 THEN
    RAISE EXCEPTION 'Stock cannot be negative';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_negative_stock
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION prevent_negative_stock();

-- Prevent expired drug sales
-- DISABLED: prevent_expired_sales() - Application validates expired products
-- This function and trigger were causing issues because BEFORE INSERT trigger 
-- tried to access NEW.id before the sale was created. Application-level 
-- validation in createSale() is sufficient.
-- 
-- CREATE OR REPLACE FUNCTION prevent_expired_sales()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM sale_items si
--     JOIN products p ON si.product_id = p.id
--     WHERE si.sale_id = NEW.id
--       AND p.expiry_date < now()::date
--   ) THEN
--     RAISE EXCEPTION 'Cannot sell expired products';
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
-- 
-- CREATE TRIGGER enforce_no_expired_sales
--   BEFORE INSERT ON sales
--   FOR EACH ROW EXECUTE FUNCTION prevent_expired_sales();

-- ==========================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ==========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'super_admin')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- SUPPLIERS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text DEFAULT '',
  email text DEFAULT '',
  phone text DEFAULT '',
  address text DEFAULT '',
  payment_terms text DEFAULT 'COD' CHECK (payment_terms IN ('COD', 'NET 7', 'NET 14', 'NET 30', 'NET 60')),
  notes text DEFAULT '',
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_suppliers_pharmacy ON suppliers(pharmacy_id);

-- ==========================================
-- PURCHASES TABLE (Stock In)
-- ==========================================
CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_number text NOT NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  total_cost numeric(10,2) DEFAULT 0,
  payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid')),
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_purchases_pharmacy ON purchases(pharmacy_id);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);

-- ==========================================
-- PURCHASE ITEMS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity_boxes integer NOT NULL DEFAULT 0,
  quantity_units integer NOT NULL DEFAULT 0,
  units_per_box integer NOT NULL DEFAULT 1,
  cost_price numeric(10,2) NOT NULL DEFAULT 0,
  batch_number text DEFAULT '',
  expiry_date date,
  total_cost numeric(10,2) NOT NULL DEFAULT 0
);

ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);

-- ==========================================
-- SALES RETURNS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number text NOT NULL,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  reason text DEFAULT 'Defective' CHECK (reason IN ('Defective', 'Expired', 'Wrong Item', 'Customer Request', 'Other')),
  total_refund numeric(10,2) DEFAULT 0,
  status text DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'cancelled')),
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_sales_returns_pharmacy ON sales_returns(pharmacy_id);
CREATE INDEX idx_sales_returns_sale ON sales_returns(sale_id);

-- ==========================================
-- RETURN ITEMS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  total_price numeric(10,2) NOT NULL DEFAULT 0
);

ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- STOCK ADJUSTMENTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  adjustment_quantity integer NOT NULL,
  reason text DEFAULT 'Inventory Count' CHECK (reason IN ('Inventory Count', 'Damaged', 'Expired', 'Theft', 'Other')),
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_stock_adjustments_pharmacy ON stock_adjustments(pharmacy_id);
CREATE INDEX idx_stock_adjustments_product ON stock_adjustments(product_id);

-- ==========================================
-- ALERTS TABLE (Low Stock & Expiry)
-- ==========================================
CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL CHECK (alert_type IN ('low_stock', 'expiry', 'expiry_30_days', 'out_of_stock')),
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  current_stock integer DEFAULT 0,
  threshold_value integer DEFAULT 0,
  days_to_expiry integer DEFAULT 0,
  is_read boolean DEFAULT false,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_alerts_pharmacy ON alerts(pharmacy_id);
CREATE INDEX idx_alerts_product ON alerts(product_id);
CREATE INDEX idx_alerts_unread ON alerts(is_read, pharmacy_id);

-- ==========================================
-- RLS POLICIES: SUPPLIERS
-- ==========================================
CREATE POLICY "Super admin can view all suppliers"
  ON suppliers FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own suppliers"
  ON suppliers FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin can insert suppliers"
  ON suppliers FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can update own suppliers"
  ON suppliers FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can delete suppliers"
  ON suppliers FOR DELETE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- ==========================================
-- RLS POLICIES: PURCHASES
-- ==========================================
CREATE POLICY "Super admin can view all purchases"
  ON purchases FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own purchases"
  ON purchases FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin can insert purchases"
  ON purchases FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can update own purchases"
  ON purchases FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can delete own purchases"
  ON purchases FOR DELETE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- ==========================================
-- RLS POLICIES: PURCHASE ITEMS
-- ==========================================
CREATE POLICY "Super admin can view all purchase items"
  ON purchase_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM purchases
      WHERE purchases.id = purchase_items.purchase_id
      AND (get_user_role() = 'super_admin' OR purchases.pharmacy_id = get_user_pharmacy_id())
    )
  );

CREATE POLICY "Pharmacy users can insert purchase items"
  ON purchase_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchases
      WHERE purchases.id = purchase_items.purchase_id
      AND purchases.pharmacy_id = get_user_pharmacy_id()
    )
  );

-- ==========================================
-- RLS POLICIES: SALES RETURNS
-- ==========================================
CREATE POLICY "Super admin can view all returns"
  ON sales_returns FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own returns"
  ON sales_returns FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin can insert returns"
  ON sales_returns FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can update own returns"
  ON sales_returns FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- ==========================================
-- RLS POLICIES: STOCK ADJUSTMENTS
-- ==========================================
CREATE POLICY "Super admin can view all adjustments"
  ON stock_adjustments FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own adjustments"
  ON stock_adjustments FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin can insert adjustments"
  ON stock_adjustments FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- ==========================================
-- RLS POLICIES: ALERTS
-- ==========================================
CREATE POLICY "Super admin can view all alerts"
  ON alerts FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own alerts"
  ON alerts FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Pharmacy users can update own alerts"
  ON alerts FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id())
  WITH CHECK (pharmacy_id = get_user_pharmacy_id());

-- ==========================================
-- TRIGGERS FOR UPDATED_AT
-- ==========================================
CREATE TRIGGER suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER purchases_updated_at
  BEFORE UPDATE ON purchases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- BUSINESS LOGIC: PROCESS PURCHASE
-- ==========================================
CREATE OR REPLACE FUNCTION process_purchase(
  p_purchase_id uuid
)
RETURNS void AS $$
DECLARE
  v_item record;
  v_product record;
  v_new_boxes integer;
  v_new_units integer;
BEGIN
  -- Process each item in purchase
  FOR v_item IN
    SELECT * FROM purchase_items WHERE purchase_id = p_purchase_id
  LOOP
    -- Get current product stock
    SELECT stock_boxes, stock_units, units_per_box 
    INTO v_product FROM products WHERE id = v_item.product_id;
    
    -- Calculate new stock
    v_new_boxes := COALESCE(v_product.stock_boxes, 0) + v_item.quantity_boxes;
    v_new_units := COALESCE(v_product.stock_units, 0) + v_item.quantity_units;
    
    -- Normalize: convert excess units to boxes
    IF v_new_units >= v_item.units_per_box THEN
      v_new_boxes := v_new_boxes + (v_new_units / v_item.units_per_box);
      v_new_units := v_new_units % v_item.units_per_box;
    END IF;
    
    -- Update product stock
    UPDATE products 
    SET stock_boxes = v_new_boxes, stock_units = v_new_units
    WHERE id = v_item.product_id;
    
    -- Create product batch for FIFO tracking
    INSERT INTO product_batches (
      product_id, pharmacy_id, batch_number, quantity_boxes, 
      quantity_units, units_per_box, cost_price, expiry_date, received_at
    ) VALUES (
      v_item.product_id,
      (SELECT pharmacy_id FROM purchases WHERE id = p_purchase_id),
      v_item.batch_number,
      v_item.quantity_boxes,
      v_item.quantity_units,
      v_item.units_per_box,
      v_item.cost_price,
      v_item.expiry_date,
      now()::date
    );
    
    -- Log stock change
    INSERT INTO stock_logs (
      product_id, product_name, change_type, quantity_change,
      notes, created_by, pharmacy_id
    ) VALUES (
      v_item.product_id,
      v_item.product_name,
      'restock',
      (v_item.quantity_boxes * v_item.units_per_box) + v_item.quantity_units,
      'Purchase: ' || (SELECT purchase_number FROM purchases WHERE id = p_purchase_id),
      (SELECT created_by FROM purchases WHERE id = p_purchase_id),
      (SELECT pharmacy_id FROM purchases WHERE id = p_purchase_id)
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- AUTO-GENERATE INVOICE NUMBERS
-- ==========================================
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1000;

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS text AS $$
BEGIN
  RETURN 'INV-' || LPAD(nextval('invoice_seq')::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- BRANCH ENHANCEMENTS: STAFF & CONTACT INFO
-- ==========================================
ALTER TABLE branches ADD COLUMN IF NOT EXISTS phone text DEFAULT '';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS email text DEFAULT '';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS contact_person text DEFAULT '';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE TRIGGER branches_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- STAFF BRANCH ASSIGNMENTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS staff_branch_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  role_in_branch text DEFAULT 'salesman' CHECK (role_in_branch IN ('manager', 'pharmacist', 'salesman', 'cashier')),
  assigned_date date DEFAULT now(),
  is_active boolean DEFAULT true,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  UNIQUE(staff_id, branch_id)
);

ALTER TABLE staff_branch_assignments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_staff_branch_assignments_staff ON staff_branch_assignments(staff_id);
CREATE INDEX idx_staff_branch_assignments_branch ON staff_branch_assignments(branch_id);
CREATE INDEX idx_staff_branch_assignments_pharmacy ON staff_branch_assignments(pharmacy_id);

-- ==========================================
-- STAFF PERFORMANCE TRACKING TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS staff_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  total_sales numeric(12,2) DEFAULT 0,
  transaction_count integer DEFAULT 0,
  average_transaction numeric(10,2) DEFAULT 0,
  total_items_sold integer DEFAULT 0,
  last_sale_date date,
  period_date date DEFAULT now()::date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE staff_performance ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_staff_performance_staff ON staff_performance(staff_id);
CREATE INDEX idx_staff_performance_branch ON staff_performance(branch_id);
CREATE INDEX idx_staff_performance_pharmacy ON staff_performance(pharmacy_id);
CREATE INDEX idx_staff_performance_period ON staff_performance(period_date);

CREATE TRIGGER staff_performance_updated_at
  BEFORE UPDATE ON staff_performance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- AUTO-UPDATE STAFF PERFORMANCE TRIGGER
-- ==========================================
CREATE OR REPLACE FUNCTION update_staff_performance()
RETURNS TRIGGER AS $$
DECLARE
  v_staff_id uuid;
  v_branch_id uuid;
  v_pharmacy_id uuid;
BEGIN
  -- Get staff from sale
  SELECT created_by, branch_id, pharmacy_id INTO v_staff_id, v_branch_id, v_pharmacy_id FROM sales WHERE id = NEW.sale_id;
  
  IF v_staff_id IS NOT NULL THEN
    -- Upsert staff performance for today
    INSERT INTO staff_performance (staff_id, branch_id, pharmacy_id, total_sales, transaction_count, average_transaction, period_date)
    VALUES (v_staff_id, v_branch_id, v_pharmacy_id, NEW.total_amount, 1, NEW.total_amount, now()::date)
    ON CONFLICT DO NOTHING;
    
    -- Update totals
    UPDATE staff_performance
    SET total_sales = total_sales + NEW.total_amount,
        transaction_count = transaction_count + 1,
        average_transaction = (total_sales + NEW.total_amount) / (transaction_count + 1),
        last_sale_date = now()::date
    WHERE staff_id = v_staff_id AND period_date = now()::date AND pharmacy_id = v_pharmacy_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_staff_performance_on_sale
  AFTER INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION update_staff_performance();

-- ==========================================
-- BRANCH STOCK TRANSFERS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS branch_stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number text NOT NULL,
  from_branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  to_branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  total_items integer DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'in_transit', 'received', 'cancelled')),
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  initiated_date date DEFAULT now()::date,
  received_date date,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE branch_stock_transfers ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_branch_stock_transfers_from_branch ON branch_stock_transfers(from_branch_id);
CREATE INDEX idx_branch_stock_transfers_to_branch ON branch_stock_transfers(to_branch_id);
CREATE INDEX idx_branch_stock_transfers_pharmacy ON branch_stock_transfers(pharmacy_id);
CREATE INDEX idx_branch_stock_transfers_status ON branch_stock_transfers(status);

CREATE TRIGGER branch_stock_transfers_updated_at
  BEFORE UPDATE ON branch_stock_transfers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- BRANCH TRANSFER ITEMS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS branch_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES branch_stock_transfers(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity_boxes integer NOT NULL DEFAULT 0,
  quantity_units integer NOT NULL DEFAULT 0,
  units_per_box integer NOT NULL DEFAULT 1,
  batch_number text DEFAULT ''
);

ALTER TABLE branch_transfer_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_branch_transfer_items_transfer ON branch_transfer_items(transfer_id);

-- ==========================================
-- AUTO-GENERATE TRANSFER NUMBERS
-- ==========================================
CREATE SEQUENCE IF NOT EXISTS transfer_seq START 5000;

CREATE OR REPLACE FUNCTION generate_transfer_number()
RETURNS text AS $$
BEGIN
  RETURN 'TRF-' || LPAD(nextval('transfer_seq')::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- PATIENTS TABLE (NEW MODULE)
-- ==========================================
CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text DEFAULT '',
  email text DEFAULT '',
  gender text CHECK (gender IN ('Male', 'Female', 'Other')),
  date_of_birth date,
  age integer,
  address text DEFAULT '',
  patient_id_number text UNIQUE,
  insurance_provider text DEFAULT '',
  insurance_number text DEFAULT '',
  emergency_contact text DEFAULT '',
  emergency_phone text DEFAULT '',
  allergies text DEFAULT '',
  medical_notes text DEFAULT '',
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_patients_pharmacy ON patients(pharmacy_id);
CREATE INDEX idx_patients_branch ON patients(branch_id);
CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_patients_patient_id ON patients(patient_id_number);

CREATE TRIGGER patients_updated_at
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- PATIENT VISITS TABLE (WITH DOCTOR TRACKING)
-- ==========================================
CREATE TABLE IF NOT EXISTS patient_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_date date DEFAULT now(),
  symptoms text DEFAULT '',
  diagnosis text DEFAULT '',
  notes text DEFAULT '',
  visited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  doctor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  doctor_name text DEFAULT '',
  doctor_specialty text DEFAULT '',
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE patient_visits ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_patient_visits_patient ON patient_visits(patient_id);
CREATE INDEX idx_patient_visits_pharmacy ON patient_visits(pharmacy_id);
CREATE INDEX idx_patient_visits_branch ON patient_visits(branch_id);
CREATE INDEX idx_patient_visits_date ON patient_visits(visit_date);
CREATE INDEX idx_patient_visits_doctor ON patient_visits(doctor_id);

CREATE TRIGGER patient_visits_updated_at
  BEFORE UPDATE ON patient_visits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- PRESCRIPTIONS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id uuid REFERENCES patient_visits(id) ON DELETE SET NULL,
  drug_name text NOT NULL,
  dosage text DEFAULT '',
  duration text DEFAULT '',
  frequency text DEFAULT 'As needed' CHECK (frequency IN ('Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'As needed', 'Custom')),
  quantity_prescribed integer DEFAULT 1,
  refillable boolean DEFAULT true,
  refills_allowed integer DEFAULT 3,
  prescribed_date date DEFAULT now(),
  expiry_date date,
  status text DEFAULT 'active' CHECK (status IN ('active', 'filled', 'expired', 'cancelled')),
  prescribed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text DEFAULT '',
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX idx_prescriptions_visit ON prescriptions(visit_id);
CREATE INDEX idx_prescriptions_pharmacy ON prescriptions(pharmacy_id);
CREATE INDEX idx_prescriptions_branch ON prescriptions(branch_id);
CREATE INDEX idx_prescriptions_status ON prescriptions(status);

CREATE TRIGGER prescriptions_updated_at
  BEFORE UPDATE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- PRESCRIPTION TO POS LINK TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS prescription_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  quantity_filled integer NOT NULL DEFAULT 1,
  filled_date date DEFAULT now(),
  refill_number integer DEFAULT 1,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE
);

ALTER TABLE prescription_sales ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_prescription_sales_prescription ON prescription_sales(prescription_id);
CREATE INDEX idx_prescription_sales_sale ON prescription_sales(sale_id);
CREATE INDEX idx_prescription_sales_pharmacy ON prescription_sales(pharmacy_id);

-- ==========================================
-- TREATMENT PAYMENTS TABLE (CLINIC REVENUE - SEPARATE FROM PHARMACY)
-- ==========================================
-- This table tracks PATIENT TREATMENT payments (consultation, injection, etc.)
-- NOT pharmacy drug sales (which are tracked in sales table)
-- CRITICAL: Keep these 2 financial systems completely separate
CREATE TABLE IF NOT EXISTS treatment_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text NOT NULL,
  visit_id uuid NOT NULL REFERENCES patient_visits(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'mobile_money', 'card', 'bank_transfer', 'check')),
  description text DEFAULT '', -- e.g., 'Consultation', 'Injection', 'Sutures'
  payment_date date DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text DEFAULT '',
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE treatment_payments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_treatment_payments_visit ON treatment_payments(visit_id);
CREATE INDEX idx_treatment_payments_patient ON treatment_payments(patient_id);
CREATE INDEX idx_treatment_payments_pharmacy ON treatment_payments(pharmacy_id);
CREATE INDEX idx_treatment_payments_branch ON treatment_payments(branch_id);
CREATE INDEX idx_treatment_payments_date ON treatment_payments(payment_date);

CREATE TRIGGER treatment_payments_updated_at
  BEFORE UPDATE ON treatment_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- AUTO-GENERATE PAYMENT NUMBERS
-- ==========================================
CREATE SEQUENCE IF NOT EXISTS payment_seq START 2000;

CREATE OR REPLACE FUNCTION generate_payment_number()
RETURNS text AS $$
BEGIN
  RETURN 'PAY-' || LPAD(nextval('payment_seq')::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- EXPENSE CATEGORIES TABLE (ADMIN MANAGED)
-- ==========================================
CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  category_name text NOT NULL,
  description text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(pharmacy_id, category_name)
);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_expense_categories_pharmacy ON expense_categories(pharmacy_id);
CREATE INDEX idx_expense_categories_active ON expense_categories(is_active);

CREATE TRIGGER expense_categories_updated_at
  BEFORE UPDATE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- EXPENSES TABLE (NEW MODULE)
-- ==========================================
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date DEFAULT now(),
  category_id uuid NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  description text NOT NULL,
  amount numeric(10,2) NOT NULL,
  payment_method text DEFAULT 'cash' CHECK (payment_method IN ('cash', 'check', 'bank_transfer', 'mobile_money', 'credit_card')),
  receipt_number text DEFAULT '',
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_approved boolean DEFAULT false,
  notes text DEFAULT '',
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_expenses_pharmacy ON expenses(pharmacy_id);
CREATE INDEX idx_expenses_branch ON expenses(branch_id);
CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_expenses_approved ON expenses(is_approved);

CREATE TRIGGER expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- RLS POLICIES: STAFF BRANCH ASSIGNMENTS
-- ==========================================
CREATE POLICY "Super admin can view all staff assignments"
  ON staff_branch_assignments FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Admin can view own pharmacy assignments"
  ON staff_branch_assignments FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Staff can view own assignment"
  ON staff_branch_assignments FOR SELECT
  TO authenticated
  USING (staff_id = auth.uid());

CREATE POLICY "Admin can manage staff assignments"
  ON staff_branch_assignments FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can update staff assignments"
  ON staff_branch_assignments FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- ==========================================
-- RLS POLICIES: STAFF PERFORMANCE
-- ==========================================
CREATE POLICY "Super admin can view all performance"
  ON staff_performance FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Admin can view own pharmacy performance"
  ON staff_performance FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Staff can view own performance"
  ON staff_performance FOR SELECT
  TO authenticated
  USING (staff_id = auth.uid());

-- ==========================================
-- RLS POLICIES: BRANCH STOCK TRANSFERS
-- ==========================================
CREATE POLICY "Super admin can view all transfers"
  ON branch_stock_transfers FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Admin can view own pharmacy transfers"
  ON branch_stock_transfers FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Admin can create transfers"
  ON branch_stock_transfers FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can update transfers"
  ON branch_stock_transfers FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- ==========================================
-- RLS POLICIES: TRANSFER ITEMS
-- ==========================================
CREATE POLICY "Super admin can view all transfer items"
  ON branch_transfer_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branch_stock_transfers
      WHERE branch_stock_transfers.id = branch_transfer_items.transfer_id
      AND (get_user_role() = 'super_admin' OR branch_stock_transfers.pharmacy_id = get_user_pharmacy_id())
    )
  );

CREATE POLICY "Admin can manage transfer items"
  ON branch_transfer_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM branch_stock_transfers
      WHERE branch_stock_transfers.id = branch_transfer_items.transfer_id
      AND branch_stock_transfers.pharmacy_id = get_user_pharmacy_id()
    )
  );

-- ==========================================
-- RLS POLICIES: PATIENTS
-- Permission Model:
-- Salesman (clinic_operator): CREATE, READ, UPDATE, DELETE patients
-- Admin: READ ONLY (can filter by branch)
-- ==========================================
CREATE POLICY "Super admin can view all patients"
  ON patients FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Admin can view own pharmacy patients (filtered)"
  ON patients FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Salesman can view all patients in pharmacy"
  ON patients FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

CREATE POLICY "Salesman can create patients"
  ON patients FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

CREATE POLICY "Salesman can update own pharmacy patients"
  ON patients FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

CREATE POLICY "Salesman can delete own pharmacy patients"
  ON patients FOR DELETE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

-- ==========================================
-- RLS POLICIES: PATIENT VISITS
-- ==========================================
CREATE POLICY "Super admin can view all visits"
  ON patient_visits FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Admin can view own pharmacy visits (read-only)"
  ON patient_visits FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Salesman can view all visits"
  ON patient_visits FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

CREATE POLICY "Salesman can create visits"
  ON patient_visits FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

CREATE POLICY "Salesman can update visits"
  ON patient_visits FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

-- ==========================================
-- RLS POLICIES: PRESCRIPTIONS
-- ==========================================
CREATE POLICY "Super admin can view all prescriptions"
  ON prescriptions FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Admin can view own pharmacy prescriptions (read-only)"
  ON prescriptions FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Salesman can view all prescriptions"
  ON prescriptions FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

CREATE POLICY "Salesman can create prescriptions"
  ON prescriptions FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

CREATE POLICY "Salesman can update prescriptions"
  ON prescriptions FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

-- ==========================================
-- RLS POLICIES: TREATMENT PAYMENTS (CLINIC REVENUE - SEPARATE FROM PHARMACY)
-- ==========================================
CREATE POLICY "Super admin can view all treatment payments"
  ON treatment_payments FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Admin can view own pharmacy treatment payments (read-only)"
  ON treatment_payments FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Salesman can view all treatment payments"
  ON treatment_payments FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

CREATE POLICY "Salesman can create treatment payments"
  ON treatment_payments FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

CREATE POLICY "Salesman can update treatment payments"
  ON treatment_payments FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'salesman');

-- ==========================================
-- RLS POLICIES: PRESCRIPTION SALES
-- ==========================================
CREATE POLICY "Super admin can view all prescription sales"
  ON prescription_sales FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Pharmacy users can view own prescription sales"
  ON prescription_sales FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id());

CREATE POLICY "Pharmacy users can insert prescription sales"
  ON prescription_sales FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id());

-- ==========================================
-- RLS POLICIES: EXPENSE CATEGORIES (ADMIN ONLY)
-- ==========================================
CREATE POLICY "Admin can view all expense categories"
  ON expense_categories FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND (get_user_role() = 'admin' OR get_user_role() = 'super_admin'));

CREATE POLICY "Salesman can view active expense categories"
  ON expense_categories FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND is_active = true AND get_user_role() = 'salesman');

CREATE POLICY "Admin can create expense categories"
  ON expense_categories FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can update expense categories"
  ON expense_categories FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can delete expense categories"
  ON expense_categories FOR DELETE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- RLS POLICIES: EXPENSES
-- ==========================================
CREATE POLICY "Super admin can view all expenses"
  ON expenses FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Admin can view and manage all pharmacy expenses"
  ON expenses FOR SELECT
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Salesman can view own recorded expenses"
  ON expenses FOR SELECT
  TO authenticated
  USING (created_by = auth.uid() AND get_user_role() = 'salesman');

CREATE POLICY "Salesman can create expenses (select from categories)"
  ON expenses FOR INSERT
  TO authenticated
  WITH CHECK (
    pharmacy_id = get_user_pharmacy_id() AND 
    get_user_role() = 'salesman' AND
    created_by = auth.uid()
  );

CREATE POLICY "Admin can create expenses"
  ON expenses FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can update and delete expenses"
  ON expenses FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin')
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

CREATE POLICY "Admin can delete expenses"
  ON expenses FOR DELETE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() = 'admin');

-- ==========================================
-- FUNCTION: CREATE DEFAULT EXPENSE CATEGORIES
-- ==========================================
CREATE OR REPLACE FUNCTION create_default_expense_categories(p_pharmacy_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO expense_categories (pharmacy_id, category_name, description)
  VALUES
    (p_pharmacy_id, 'Rent', 'Rent payments for premises'),
    (p_pharmacy_id, 'Electricity', 'Electricity bills'),
    (p_pharmacy_id, 'Water', 'Water supply bills'),
    (p_pharmacy_id, 'Internet', 'Internet and connectivity costs'),
    (p_pharmacy_id, 'Salaries', 'Staff salaries and wages'),
    (p_pharmacy_id, 'Supplies', 'Office and pharmacy supplies'),
    (p_pharmacy_id, 'Maintenance', 'Equipment maintenance and repairs'),
    (p_pharmacy_id, 'Insurance', 'Business insurance premiums'),
    (p_pharmacy_id, 'Transport', 'Transportation and logistics'),
    (p_pharmacy_id, 'Miscellaneous', 'Other miscellaneous expenses')
  ON CONFLICT (pharmacy_id, category_name) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- FUNCTION: PROCESS BRANCH STOCK TRANSFER
-- ==========================================
CREATE OR REPLACE FUNCTION process_branch_transfer(
  p_transfer_id uuid
)
RETURNS void AS $$
DECLARE
  v_item record;
  v_from_branch uuid;
  v_to_branch uuid;
  v_product record;
  v_new_boxes integer;
  v_new_units integer;
BEGIN
  -- Get branch info
  SELECT from_branch_id, to_branch_id INTO v_from_branch, v_to_branch
  FROM branch_stock_transfers WHERE id = p_transfer_id;
  
  -- Process each transferred item
  FOR v_item IN
    SELECT * FROM branch_transfer_items WHERE transfer_id = p_transfer_id
  LOOP
    -- Deduct from source branch
    UPDATE products
    SET stock_boxes = stock_boxes - v_item.quantity_boxes,
        stock_units = stock_units - v_item.quantity_units
    WHERE id = v_item.product_id AND branch_id = v_from_branch;
    
    -- Add to destination branch
    UPDATE products
    SET stock_boxes = stock_boxes + v_item.quantity_boxes,
        stock_units = stock_units + v_item.quantity_units
    WHERE id = v_item.product_id AND branch_id = v_to_branch;
  END LOOP;
  
  -- Mark transfer as received
  UPDATE branch_stock_transfers
  SET status = 'received', received_date = now()::date
  WHERE id = p_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- FUNCTION: AUTO-UPDATE PATIENT AGE
-- ==========================================
CREATE OR REPLACE FUNCTION update_patient_age()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.date_of_birth IS NOT NULL THEN
    NEW.age := EXTRACT(YEAR FROM AGE(NEW.date_of_birth));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_patient_age
  BEFORE INSERT OR UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_patient_age();
