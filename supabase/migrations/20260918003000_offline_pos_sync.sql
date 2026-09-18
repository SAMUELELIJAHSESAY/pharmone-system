-- SamMia Pharm offline POS synchronization foundation
-- Adds idempotent client transaction IDs and one transactional RPC that inserts
-- the sale, sale items, stock movements, and stock reconciliation conflicts.

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cash_received numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS change_due numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_payment_method_check CHECK (payment_method IN ('cash', 'mobile_money', 'card', 'split'));
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS packaging_type text NOT NULL DEFAULT 'unit';
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS packaging_quantity numeric(12,3);
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS client_transaction_id text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS sync_source text NOT NULL DEFAULT 'online';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_transaction_id_unique
  ON public.sales (client_transaction_id)
  WHERE client_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.offline_sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  sale_id uuid REFERENCES public.sales(id) ON DELETE CASCADE,
  client_transaction_id text NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL DEFAULT '',
  cached_requested_units integer NOT NULL DEFAULT 0,
  server_available_units integer NOT NULL DEFAULT 0,
  shortage_units integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_offline_sync_conflicts_pharmacy
  ON public.offline_sync_conflicts (pharmacy_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offline_sync_conflicts_transaction
  ON public.offline_sync_conflicts (client_transaction_id);

ALTER TABLE public.offline_sync_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read offline sync conflicts" ON public.offline_sync_conflicts;
CREATE POLICY "Admins can read offline sync conflicts"
  ON public.offline_sync_conflicts FOR SELECT TO authenticated
  USING (
    pharmacy_id = get_user_pharmacy_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'inventory_manager')
    )
  );

DROP POLICY IF EXISTS "Admins can update offline sync conflicts" ON public.offline_sync_conflicts;
CREATE POLICY "Admins can update offline sync conflicts"
  ON public.offline_sync_conflicts FOR UPDATE TO authenticated
  USING (
    pharmacy_id = get_user_pharmacy_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'inventory_manager')
    )
  )
  WITH CHECK (pharmacy_id = get_user_pharmacy_id());

-- The original staff-performance trigger referenced NEW.sale_id even though it
-- fires on the sales table. Correct it here because every synchronized sale must
-- be able to insert atomically without the legacy trigger aborting the transaction.
CREATE OR REPLACE FUNCTION public.update_staff_performance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_performance_id uuid;
BEGIN
  IF NEW.created_by IS NULL OR NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT sp.id INTO v_performance_id
  FROM public.staff_performance sp
  WHERE sp.staff_id = NEW.created_by
    AND sp.pharmacy_id = NEW.pharmacy_id
    AND sp.branch_id IS NOT DISTINCT FROM NEW.branch_id
    AND sp.period_date = (NEW.created_at AT TIME ZONE 'UTC')::date
  ORDER BY sp.created_at ASC
  LIMIT 1;

  IF v_performance_id IS NULL THEN
    INSERT INTO public.staff_performance (
      staff_id, branch_id, pharmacy_id, total_sales, transaction_count,
      average_transaction, last_sale_date, period_date
    ) VALUES (
      NEW.created_by, NEW.branch_id, NEW.pharmacy_id, NEW.total_amount, 1,
      NEW.total_amount, (NEW.created_at AT TIME ZONE 'UTC')::date,
      (NEW.created_at AT TIME ZONE 'UTC')::date
    );
  ELSE
    UPDATE public.staff_performance
    SET total_sales = coalesce(total_sales, 0) + NEW.total_amount,
        transaction_count = coalesce(transaction_count, 0) + 1,
        average_transaction = (coalesce(total_sales, 0) + NEW.total_amount) / (coalesce(transaction_count, 0) + 1),
        last_sale_date = (NEW.created_at AT TIME ZONE 'UTC')::date,
        updated_at = now()
    WHERE id = v_performance_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_offline_pos_sale(
  p_client_transaction_id text,
  p_invoice_number text,
  p_sale jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_pharmacy_id uuid;
  v_branch_id uuid;
  v_existing public.sales%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_units_per_box integer;
  v_available integer;
  v_requested integer;
  v_remaining integer;
  v_shortage integer;
  v_conflicts integer := 0;
  v_payment_method text;
  v_total numeric(12,2);
  v_discount numeric(12,2);
  v_cash_received numeric(12,2);
  v_change_due numeric(12,2);
  v_created_at timestamptz;
  v_invoice text;
  v_tax_enabled boolean := false;
  v_tax_rate numeric := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF coalesce(trim(p_client_transaction_id), '') = '' THEN
    RAISE EXCEPTION 'Client transaction ID is required';
  END IF;
  IF jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Sale must contain at least one item';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND OR NOT coalesce(v_profile.is_active, true) THEN
    RAISE EXCEPTION 'Active user profile required';
  END IF;

  v_pharmacy_id := nullif(p_sale->>'pharmacy_id', '')::uuid;
  v_branch_id := nullif(p_sale->>'branch_id', '')::uuid;
  IF v_pharmacy_id IS NULL OR v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Pharmacy and branch are required';
  END IF;
  IF v_profile.role <> 'super_admin' AND v_profile.pharmacy_id IS DISTINCT FROM v_pharmacy_id THEN
    RAISE EXCEPTION 'Pharmacy access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = v_branch_id AND b.pharmacy_id = v_pharmacy_id AND coalesce(b.is_active, true)
  ) THEN
    RAISE EXCEPTION 'Branch is not available';
  END IF;

  IF v_profile.role NOT IN ('admin', 'super_admin') AND NOT EXISTS (
    SELECT 1 FROM public.staff_branch_assignments sba
    WHERE sba.staff_id = v_user_id
      AND sba.pharmacy_id = v_pharmacy_id
      AND sba.branch_id = v_branch_id
      AND sba.is_active = true
  ) THEN
    RAISE EXCEPTION 'You are not assigned to this branch';
  END IF;

  SELECT * INTO v_existing
  FROM public.sales
  WHERE client_transaction_id = p_client_transaction_id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'duplicate',
      'conflict_count', (
        SELECT count(*) FROM public.offline_sync_conflicts c
        WHERE c.client_transaction_id = p_client_transaction_id AND c.status = 'open'
      ),
      'sale', to_jsonb(v_existing)
    );
  END IF;

  v_payment_method := coalesce(nullif(p_sale->>'payment_method', ''), 'cash');
  IF v_payment_method NOT IN ('cash', 'mobile_money', 'card', 'split') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;
  v_total := greatest(0, coalesce((p_sale->>'total_amount')::numeric, 0));
  SELECT coalesce(tax_enabled, false), coalesce(tax_rate, 0)
    INTO v_tax_enabled, v_tax_rate
  FROM public.pharmacies WHERE id = v_pharmacy_id;
  IF v_tax_enabled AND v_tax_rate > 0 THEN
    v_total := v_total + ((v_total * v_tax_rate) / 100);
  END IF;
  v_discount := greatest(0, coalesce((p_sale->>'discount')::numeric, 0));
  v_cash_received := greatest(0, coalesce((p_sale->>'cash_received')::numeric, 0));
  v_change_due := greatest(0, coalesce((p_sale->>'change_due')::numeric, 0));
  v_created_at := coalesce(nullif(p_sale->>'created_at', '')::timestamptz, now());
  v_invoice := coalesce(nullif(trim(p_invoice_number), ''), 'OFF-' || to_char(v_created_at, 'YYMMDD-HH24MISS'));

  IF nullif(p_sale->>'customer_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = nullif(p_sale->>'customer_id', '')::uuid AND c.pharmacy_id = v_pharmacy_id
  ) THEN
    RAISE EXCEPTION 'Customer does not belong to this pharmacy';
  END IF;

  INSERT INTO public.sales (
    invoice_number, customer_id, payment_method, total_amount, discount, status, notes,
    created_by, pharmacy_id, branch_id, created_at, payment_details, cash_received,
    change_due, client_transaction_id, sync_source
  ) VALUES (
    v_invoice,
    nullif(p_sale->>'customer_id', '')::uuid,
    v_payment_method,
    v_total,
    v_discount,
    'completed',
    coalesce(p_sale->>'notes', ''),
    v_user_id,
    v_pharmacy_id,
    v_branch_id,
    v_created_at,
    coalesce(p_sale->'payment_details', '{}'::jsonb),
    v_cash_received,
    v_change_due,
    p_client_transaction_id,
    CASE WHEN v_invoice LIKE 'OFF-%' THEN 'offline' ELSE 'online' END
  ) RETURNING * INTO v_sale;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_requested := greatest(0, coalesce((v_item->>'quantity')::integer, 0));
    IF v_requested <= 0 THEN
      RAISE EXCEPTION 'Invalid sale item quantity';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = nullif(v_item->>'product_id', '')::uuid
      AND pharmacy_id = v_pharmacy_id
      AND branch_id = v_branch_id
      AND coalesce(is_active, true)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product is no longer available in this branch: %', coalesce(v_item->>'product_name', 'Unknown product');
    END IF;
    IF v_product.expiry_date IS NOT NULL AND v_product.expiry_date < current_date THEN
      RAISE EXCEPTION 'Cannot sync sale for expired product: %', v_product.name;
    END IF;

    v_units_per_box := greatest(1, coalesce(v_product.units_per_box, 1));
    v_available := greatest(0, coalesce(v_product.stock_boxes, 0) * v_units_per_box + coalesce(v_product.stock_units, 0));
    v_shortage := greatest(v_requested - v_available, 0);
    v_remaining := greatest(v_available - v_requested, 0);

    INSERT INTO public.sale_items (
      sale_id, product_id, product_name, quantity, unit_price, total_price,
      packaging_type, packaging_quantity
    ) VALUES (
      v_sale.id,
      v_product.id,
      coalesce(v_item->>'product_name', v_product.name),
      v_requested,
      coalesce((v_item->>'unit_price')::numeric, 0),
      coalesce((v_item->>'unit_price')::numeric, 0) * v_requested,
      coalesce(nullif(v_item->>'packaging_type', ''), 'unit'),
      coalesce((v_item->>'packaging_quantity')::numeric, v_requested)
    );

    UPDATE public.products
    SET stock_boxes = floor(v_remaining::numeric / v_units_per_box)::integer,
        stock_units = (v_remaining % v_units_per_box),
        updated_at = now()
    WHERE id = v_product.id;

    INSERT INTO public.stock_logs (
      product_id, product_name, change_type, quantity_change, notes,
      created_by, pharmacy_id, branch_id
    ) VALUES (
      v_product.id, v_product.name, 'sale', -v_requested,
      'POS sale: ' || v_sale.invoice_number,
      v_user_id, v_pharmacy_id, v_branch_id
    );

    IF v_shortage > 0 THEN
      v_conflicts := v_conflicts + 1;
      INSERT INTO public.offline_sync_conflicts (
        pharmacy_id, branch_id, sale_id, client_transaction_id, product_id,
        product_name, cached_requested_units, server_available_units, shortage_units,
        details
      ) VALUES (
        v_pharmacy_id, v_branch_id, v_sale.id, p_client_transaction_id,
        v_product.id, v_product.name, v_requested, v_available, v_shortage,
        jsonb_build_object(
          'message', 'Offline sale exceeded stock available on the server at synchronization time.',
          'invoice_number', v_sale.invoice_number,
          'synced_at', now()
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'synced',
    'conflict_count', v_conflicts,
    'sale', to_jsonb(v_sale)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_offline_pos_sale(text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_offline_pos_sale(text, text, jsonb, jsonb) TO authenticated;
