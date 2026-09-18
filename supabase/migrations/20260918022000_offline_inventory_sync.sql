-- SamMia Pharm Offline Inventory Phase 2
-- Idempotent inventory synchronization, metadata-version conflict detection,
-- stock-delta reconciliation, and auditable conflict resolution.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS metadata_version bigint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_product_metadata_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF ROW(
      OLD.name, OLD.category, OLD.description, OLD.price, OLD.cost_price,
      OLD.units_per_box, OLD.expiry_date, OLD.branch_id, OLD.is_active,
      OLD.low_stock_threshold, OLD.unit_type, OLD.min_sell_quantity, OLD.stock_unit_type
    ) IS DISTINCT FROM ROW(
      NEW.name, NEW.category, NEW.description, NEW.price, NEW.cost_price,
      NEW.units_per_box, NEW.expiry_date, NEW.branch_id, NEW.is_active,
      NEW.low_stock_threshold, NEW.unit_type, NEW.min_sell_quantity, NEW.stock_unit_type
    ) THEN
    NEW.metadata_version := coalesce(OLD.metadata_version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_metadata_version ON public.products;
CREATE TRIGGER trg_products_metadata_version
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.bump_product_metadata_version();

CREATE TABLE IF NOT EXISTS public.offline_inventory_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id text NOT NULL UNIQUE,
  operation_type text NOT NULL,
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('synced', 'conflict')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.offline_inventory_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id text NOT NULL,
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL DEFAULT '',
  conflict_type text NOT NULL CHECK (conflict_type IN ('metadata', 'stock')),
  base_metadata_version bigint,
  server_metadata_version bigint,
  submitted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_offline_inventory_sync_log_pharmacy
  ON public.offline_inventory_sync_log (pharmacy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offline_inventory_conflicts_pharmacy
  ON public.offline_inventory_conflicts (pharmacy_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offline_inventory_conflicts_operation
  ON public.offline_inventory_conflicts (operation_id);

ALTER TABLE public.offline_inventory_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_inventory_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Inventory staff can view offline inventory sync log" ON public.offline_inventory_sync_log;
CREATE POLICY "Inventory staff can view offline inventory sync log"
ON public.offline_inventory_sync_log FOR SELECT TO authenticated
USING (
  pharmacy_id = get_user_pharmacy_id()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'inventory_manager')
  )
);

DROP POLICY IF EXISTS "Inventory staff can view offline inventory conflicts" ON public.offline_inventory_conflicts;
CREATE POLICY "Inventory staff can view offline inventory conflicts"
ON public.offline_inventory_conflicts FOR SELECT TO authenticated
USING (
  pharmacy_id = get_user_pharmacy_id()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'inventory_manager')
  )
);

CREATE OR REPLACE FUNCTION public.sync_offline_inventory_operation(
  p_operation_id text,
  p_operation jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_operation_type text := coalesce(p_operation->>'operation_type', '');
  v_pharmacy_id uuid := nullif(p_operation->>'pharmacy_id', '')::uuid;
  v_branch_id uuid := nullif(p_operation->>'branch_id', '')::uuid;
  v_product_id uuid := nullif(p_operation->>'product_id', '')::uuid;
  v_payload jsonb := coalesce(p_operation->'payload', '{}'::jsonb);
  v_existing_log public.offline_inventory_sync_log%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_conflict public.offline_inventory_conflicts%ROWTYPE;
  v_result jsonb;
  v_base_version bigint := greatest(1, coalesce((p_operation->>'base_metadata_version')::bigint, 1));
  v_force boolean := coalesce((p_operation->>'force')::boolean, false);
  v_delta integer := coalesce((p_operation->>'stock_delta_units')::integer, 0);
  v_available integer;
  v_next integer;
  v_actual_delta integer;
  v_shortage integer := 0;
  v_units_per_box integer;
  v_change_type text := coalesce(nullif(p_operation->>'change_type', ''), 'adjustment');
  v_notes text := coalesce(p_operation->>'notes', '');
  v_target_branch uuid;
  v_server_conflict_id uuid := nullif(p_operation->>'server_conflict_id', '')::uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF coalesce(trim(p_operation_id), '') = '' THEN RAISE EXCEPTION 'Operation ID is required'; END IF;

  SELECT * INTO v_existing_log
  FROM public.offline_inventory_sync_log
  WHERE operation_id = p_operation_id
  LIMIT 1;
  IF FOUND THEN RETURN v_existing_log.result; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND OR NOT coalesce(v_profile.is_active, true) THEN RAISE EXCEPTION 'Active user profile required'; END IF;
  IF v_profile.role NOT IN ('admin', 'inventory_manager', 'super_admin') THEN RAISE EXCEPTION 'Inventory permission required'; END IF;
  IF v_pharmacy_id IS NULL OR v_branch_id IS NULL OR v_product_id IS NULL THEN RAISE EXCEPTION 'Pharmacy, branch and product are required'; END IF;
  IF v_profile.role <> 'super_admin' AND v_profile.pharmacy_id IS DISTINCT FROM v_pharmacy_id THEN RAISE EXCEPTION 'Pharmacy access denied'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = v_branch_id AND b.pharmacy_id = v_pharmacy_id AND coalesce(b.is_active, true)
  ) THEN RAISE EXCEPTION 'Branch is not available'; END IF;

  IF v_profile.role = 'inventory_manager' AND NOT EXISTS (
    SELECT 1 FROM public.staff_branch_assignments sba
    WHERE sba.staff_id = v_user_id
      AND sba.pharmacy_id = v_pharmacy_id
      AND sba.branch_id = v_branch_id
      AND sba.is_active = true
  ) THEN RAISE EXCEPTION 'You are not assigned to this branch'; END IF;

  IF v_operation_type = 'create_product' THEN
    SELECT * INTO v_product FROM public.products WHERE id = v_product_id;
    IF FOUND THEN
      IF v_product.pharmacy_id IS DISTINCT FROM v_pharmacy_id THEN RAISE EXCEPTION 'Product ID already belongs to another pharmacy'; END IF;
      v_result := jsonb_build_object('status', 'duplicate', 'conflict_count', 0, 'product', to_jsonb(v_product));
    ELSE
      INSERT INTO public.products (
        id, name, category, description, price, cost_price,
        stock_boxes, stock_units, units_per_box, expiry_date,
        pharmacy_id, branch_id, is_active, low_stock_threshold,
        unit_type, min_sell_quantity, stock_unit_type, metadata_version
      ) VALUES (
        v_product_id,
        coalesce(nullif(trim(v_payload->>'name'), ''), 'Unnamed Product'),
        coalesce(nullif(v_payload->>'category', ''), 'General'),
        coalesce(v_payload->>'description', ''),
        greatest(0, coalesce((v_payload->>'price')::numeric, 0)),
        greatest(0, coalesce((v_payload->>'cost_price')::numeric, 0)),
        greatest(0, coalesce((v_payload->>'stock_boxes')::integer, 0)),
        greatest(0, coalesce((v_payload->>'stock_units')::integer, 0)),
        greatest(1, coalesce((v_payload->>'units_per_box')::integer, 1)),
        nullif(v_payload->>'expiry_date', '')::date,
        v_pharmacy_id,
        v_branch_id,
        coalesce((v_payload->>'is_active')::boolean, true),
        greatest(0, coalesce((v_payload->>'low_stock_threshold')::integer, 5)),
        coalesce(nullif(v_payload->>'unit_type', ''), 'box'),
        greatest(1, coalesce((v_payload->>'min_sell_quantity')::integer, 1)),
        coalesce(nullif(v_payload->>'stock_unit_type', ''), 'box'),
        1
      ) RETURNING * INTO v_product;

      IF coalesce(v_product.stock_boxes, 0) > 0 OR coalesce(v_product.stock_units, 0) > 0 THEN
        INSERT INTO public.stock_logs (
          product_id, product_name, change_type, quantity_change, notes,
          created_by, pharmacy_id, branch_id
        ) VALUES (
          v_product.id, v_product.name, 'initial',
          (coalesce(v_product.stock_boxes, 0) * greatest(1, coalesce(v_product.units_per_box, 1))) + coalesce(v_product.stock_units, 0),
          'Offline-created product initial stock', v_user_id, v_pharmacy_id, v_branch_id
        );
      END IF;
      v_result := jsonb_build_object('status', 'synced', 'conflict_count', 0, 'product', to_jsonb(v_product));
    END IF;

  ELSIF v_operation_type = 'update_product' THEN
    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_product_id AND pharmacy_id = v_pharmacy_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product no longer exists'; END IF;
    IF v_product.branch_id IS DISTINCT FROM v_branch_id THEN RAISE EXCEPTION 'Product branch changed before synchronization'; END IF;

    IF NOT v_force AND coalesce(v_product.metadata_version, 1) <> v_base_version THEN
      INSERT INTO public.offline_inventory_conflicts (
        operation_id, pharmacy_id, branch_id, product_id, product_name,
        conflict_type, base_metadata_version, server_metadata_version,
        submitted_payload, details
      ) VALUES (
        p_operation_id, v_pharmacy_id, v_branch_id, v_product.id, v_product.name,
        'metadata', v_base_version, coalesce(v_product.metadata_version, 1),
        v_payload,
        jsonb_build_object('message', 'Product details changed on the server while this device was offline.')
      ) RETURNING * INTO v_conflict;

      v_result := jsonb_build_object(
        'status', 'conflict',
        'conflict_count', 1,
        'conflict_id', v_conflict.id,
        'conflict_type', 'metadata',
        'message', 'Product details changed on the server while this device was offline.',
        'server_product', to_jsonb(v_product),
        'submitted_patch', v_payload
      );
    ELSE
      v_target_branch := CASE WHEN v_payload ? 'branch_id' THEN nullif(v_payload->>'branch_id', '')::uuid ELSE v_product.branch_id END;
      IF v_target_branch IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.branches b WHERE b.id = v_target_branch AND b.pharmacy_id = v_pharmacy_id AND coalesce(b.is_active, true)
      ) THEN RAISE EXCEPTION 'Target branch is not available'; END IF;

      UPDATE public.products SET
        name = CASE WHEN v_payload ? 'name' THEN coalesce(nullif(trim(v_payload->>'name'), ''), name) ELSE name END,
        category = CASE WHEN v_payload ? 'category' THEN coalesce(nullif(v_payload->>'category', ''), 'General') ELSE category END,
        description = CASE WHEN v_payload ? 'description' THEN coalesce(v_payload->>'description', '') ELSE description END,
        price = CASE WHEN v_payload ? 'price' THEN greatest(0, coalesce((v_payload->>'price')::numeric, 0)) ELSE price END,
        cost_price = CASE WHEN v_payload ? 'cost_price' THEN greatest(0, coalesce((v_payload->>'cost_price')::numeric, 0)) ELSE cost_price END,
        unit_type = CASE WHEN v_payload ? 'unit_type' THEN coalesce(nullif(v_payload->>'unit_type', ''), unit_type) ELSE unit_type END,
        min_sell_quantity = CASE WHEN v_payload ? 'min_sell_quantity' THEN greatest(1, coalesce((v_payload->>'min_sell_quantity')::integer, 1)) ELSE min_sell_quantity END,
        units_per_box = CASE WHEN v_payload ? 'units_per_box' THEN greatest(1, coalesce((v_payload->>'units_per_box')::integer, 1)) ELSE units_per_box END,
        stock_unit_type = CASE WHEN v_payload ? 'stock_unit_type' THEN coalesce(nullif(v_payload->>'stock_unit_type', ''), stock_unit_type) ELSE stock_unit_type END,
        expiry_date = CASE WHEN v_payload ? 'expiry_date' THEN nullif(v_payload->>'expiry_date', '')::date ELSE expiry_date END,
        low_stock_threshold = CASE WHEN v_payload ? 'low_stock_threshold' THEN greatest(0, coalesce((v_payload->>'low_stock_threshold')::integer, 0)) ELSE low_stock_threshold END,
        branch_id = v_target_branch,
        is_active = CASE WHEN v_payload ? 'is_active' THEN coalesce((v_payload->>'is_active')::boolean, is_active) ELSE is_active END
      WHERE id = v_product_id
      RETURNING * INTO v_product;

      IF v_server_conflict_id IS NOT NULL THEN
        UPDATE public.offline_inventory_conflicts
        SET status = 'resolved', resolution = 'use_offline_changes', resolved_at = now(), resolved_by = v_user_id
        WHERE id = v_server_conflict_id AND pharmacy_id = v_pharmacy_id AND status = 'open';
      END IF;

      v_result := jsonb_build_object('status', 'synced', 'conflict_count', 0, 'product', to_jsonb(v_product));
    END IF;

  ELSIF v_operation_type = 'stock_delta' THEN
    IF v_delta = 0 THEN RAISE EXCEPTION 'Stock delta must not be zero'; END IF;
    IF v_change_type NOT IN ('restock', 'adjustment') THEN v_change_type := 'adjustment'; END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_product_id AND pharmacy_id = v_pharmacy_id AND branch_id = v_branch_id AND coalesce(is_active, true)
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product is not available in this branch'; END IF;

    v_units_per_box := greatest(1, coalesce(v_product.units_per_box, 1));
    v_available := greatest(0, coalesce(v_product.stock_boxes, 0) * v_units_per_box + coalesce(v_product.stock_units, 0));
    v_next := greatest(0, v_available + v_delta);
    v_actual_delta := v_next - v_available;
    IF v_delta < 0 AND abs(v_delta) > v_available THEN
      v_shortage := abs(v_delta) - v_available;
    END IF;

    UPDATE public.products
    SET stock_boxes = floor(v_next::numeric / v_units_per_box)::integer,
        stock_units = (v_next % v_units_per_box),
        stock_unit_type = coalesce(nullif(p_operation->>'stock_unit_type', ''), stock_unit_type)
    WHERE id = v_product_id
    RETURNING * INTO v_product;

    INSERT INTO public.stock_logs (
      product_id, product_name, change_type, quantity_change, notes,
      created_by, pharmacy_id, branch_id
    ) VALUES (
      v_product.id, v_product.name, v_change_type, v_actual_delta,
      trim(both from coalesce(v_notes, '') || CASE WHEN v_notes = '' THEN '' ELSE ' ' END || '[offline sync]'),
      v_user_id, v_pharmacy_id, v_branch_id
    );

    IF v_shortage > 0 THEN
      INSERT INTO public.offline_inventory_conflicts (
        operation_id, pharmacy_id, branch_id, product_id, product_name,
        conflict_type, submitted_payload, details
      ) VALUES (
        p_operation_id, v_pharmacy_id, v_branch_id, v_product.id, v_product.name,
        'stock', jsonb_build_object('requested_delta_units', v_delta),
        jsonb_build_object(
          'message', 'Offline stock reduction exceeded the stock available on the server.',
          'server_available_units', v_available,
          'requested_reduction_units', abs(v_delta),
          'shortage_units', v_shortage
        )
      ) RETURNING * INTO v_conflict;
    END IF;

    v_result := jsonb_build_object(
      'status', 'synced',
      'conflict_count', CASE WHEN v_shortage > 0 THEN 1 ELSE 0 END,
      'product', to_jsonb(v_product),
      'conflict', CASE WHEN v_shortage > 0 THEN jsonb_build_object(
        'id', v_conflict.id,
        'product_name', v_product.name,
        'message', 'Offline stock reduction exceeded the stock available on the server.',
        'shortage_units', v_shortage
      ) ELSE NULL END
    );
  ELSE
    RAISE EXCEPTION 'Unsupported inventory operation: %', v_operation_type;
  END IF;

  INSERT INTO public.offline_inventory_sync_log (
    operation_id, operation_type, pharmacy_id, branch_id, product_id, user_id, status, result
  ) VALUES (
    p_operation_id, v_operation_type, v_pharmacy_id, v_branch_id, v_product_id, v_user_id,
    CASE WHEN v_result->>'status' = 'conflict' THEN 'conflict' ELSE 'synced' END,
    v_result
  );

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_offline_inventory_conflict(
  p_conflict_id uuid,
  p_resolution text DEFAULT 'keep_server'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_conflict public.offline_inventory_conflicts%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('admin', 'inventory_manager', 'super_admin') THEN RAISE EXCEPTION 'Inventory permission required'; END IF;

  SELECT * INTO v_conflict FROM public.offline_inventory_conflicts WHERE id = p_conflict_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_profile.role <> 'super_admin' AND v_conflict.pharmacy_id IS DISTINCT FROM v_profile.pharmacy_id THEN RAISE EXCEPTION 'Pharmacy access denied'; END IF;

  UPDATE public.offline_inventory_conflicts
  SET status = 'resolved', resolution = coalesce(nullif(p_resolution, ''), 'keep_server'),
      resolved_at = now(), resolved_by = v_user_id
  WHERE id = p_conflict_id
  RETURNING * INTO v_conflict;

  RETURN to_jsonb(v_conflict);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_offline_inventory_operation(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_offline_inventory_operation(text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_offline_inventory_conflict(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_offline_inventory_conflict(uuid, text) TO authenticated;
