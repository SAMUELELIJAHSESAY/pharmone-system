-- Super Admin configuration center: platform defaults, pharmacy overrides,
-- enforced module availability, and an auditable settings history.

CREATE OR REPLACE FUNCTION public.sammia_default_module_features()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '{
    "inventory": true,
    "sales": true,
    "customers": true,
    "patients": true,
    "suppliers": true,
    "purchases": true,
    "returns": true,
    "alerts": true,
    "stock_transfers": true,
    "staff": true,
    "branches": true,
    "expenses": true,
    "reports": true,
    "sales_reports": true,
    "daily_records": true
  }'::jsonb;
$$;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS module_features jsonb NOT NULL DEFAULT public.sammia_default_module_features(),
  ADD COLUMN IF NOT EXISTS operational_settings jsonb NOT NULL DEFAULT '{
    "default_low_stock_threshold": 5,
    "receipt_footer": "Thank you for choosing SamMia Pharm."
  }'::jsonb;

UPDATE public.pharmacies
SET module_features = public.sammia_default_module_features() || COALESCE(module_features, '{}'::jsonb),
    operational_settings = '{
      "default_low_stock_threshold": 5,
      "receipt_footer": "Thank you for choosing SamMia Pharm."
    }'::jsonb || COALESCE(operational_settings, '{}'::jsonb);

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  branding_color text NOT NULL DEFAULT '#2563eb',
  currency_code text NOT NULL DEFAULT 'NLE',
  currency_symbol text NOT NULL DEFAULT 'Le',
  timezone text NOT NULL DEFAULT 'Africa/Freetown',
  tax_enabled boolean NOT NULL DEFAULT false,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  discount_enabled boolean NOT NULL DEFAULT true,
  discount_rules jsonb NOT NULL DEFAULT '{"max_discount":10,"min_cart_amount":0}'::jsonb,
  default_low_stock_threshold integer NOT NULL DEFAULT 5,
  receipt_footer text NOT NULL DEFAULT 'Thank you for choosing SamMia Pharm.',
  module_features jsonb NOT NULL DEFAULT public.sammia_default_module_features(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin can view platform settings" ON public.platform_settings;
CREATE POLICY "Super admin can view platform settings"
  ON public.platform_settings FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'super_admin');

CREATE TABLE IF NOT EXISTS public.super_admin_settings_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pharmacy_id uuid REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  scope text NOT NULL CHECK (scope IN ('platform','pharmacy')),
  section text NOT NULL DEFAULT 'general',
  action text NOT NULL,
  note text,
  previous_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settings_audit_created_at
  ON public.super_admin_settings_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settings_audit_pharmacy
  ON public.super_admin_settings_audit_logs(pharmacy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settings_audit_scope
  ON public.super_admin_settings_audit_logs(scope, created_at DESC);

ALTER TABLE public.super_admin_settings_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin can view settings audit logs" ON public.super_admin_settings_audit_logs;
CREATE POLICY "Super admin can view settings audit logs"
  ON public.super_admin_settings_audit_logs FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'super_admin');

CREATE OR REPLACE FUNCTION public.get_super_admin_platform_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_settings public.platform_settings%ROWTYPE;
  v_summary jsonb;
BEGIN
  IF public.get_user_role() <> 'super_admin' THEN
    RAISE EXCEPTION 'Super Admin access required';
  END IF;

  SELECT * INTO v_settings FROM public.platform_settings WHERE id = 'default';

  SELECT jsonb_build_object(
    'total_pharmacies', count(*),
    'tax_enabled_pharmacies', count(*) FILTER (WHERE tax_enabled = true),
    'custom_branding_pharmacies', count(*) FILTER (WHERE branding_color IS DISTINCT FROM v_settings.branding_color),
    'restricted_pharmacies', count(*) FILTER (WHERE (public.sammia_default_module_features() || COALESCE(module_features,'{}'::jsonb)) IS DISTINCT FROM public.sammia_default_module_features())
  ) INTO v_summary
  FROM public.pharmacies
  WHERE COALESCE(platform_status, CASE WHEN is_active THEN 'active' ELSE 'disabled' END) <> 'archived';

  RETURN jsonb_build_object(
    'settings', jsonb_build_object(
      'branding_color', v_settings.branding_color,
      'currency_code', v_settings.currency_code,
      'currency_symbol', v_settings.currency_symbol,
      'timezone', v_settings.timezone,
      'tax_enabled', v_settings.tax_enabled,
      'tax_rate', v_settings.tax_rate,
      'discount_enabled', v_settings.discount_enabled,
      'discount_rules', v_settings.discount_rules,
      'default_low_stock_threshold', v_settings.default_low_stock_threshold,
      'receipt_footer', v_settings.receipt_footer,
      'module_features', public.sammia_default_module_features() || COALESCE(v_settings.module_features,'{}'::jsonb),
      'updated_at', v_settings.updated_at
    ),
    'summary', COALESCE(v_summary, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.super_admin_update_platform_settings(
  p_settings jsonb,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_old public.platform_settings%ROWTYPE;
  v_new public.platform_settings%ROWTYPE;
  v_branding text;
  v_currency_code text;
  v_currency_symbol text;
  v_timezone text;
  v_tax_enabled boolean;
  v_tax_rate numeric;
  v_discount_enabled boolean;
  v_discount_rules jsonb;
  v_threshold integer;
  v_receipt text;
  v_modules jsonb;
BEGIN
  IF public.get_user_role() <> 'super_admin' THEN
    RAISE EXCEPTION 'Super Admin access required';
  END IF;
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'Settings object is required';
  END IF;

  SELECT * INTO v_old FROM public.platform_settings WHERE id = 'default' FOR UPDATE;

  v_branding := COALESCE(NULLIF(trim(p_settings->>'branding_color'),''), v_old.branding_color);
  v_currency_code := upper(COALESCE(NULLIF(trim(p_settings->>'currency_code'),''), v_old.currency_code));
  v_currency_symbol := COALESCE(NULLIF(trim(p_settings->>'currency_symbol'),''), v_old.currency_symbol);
  v_timezone := COALESCE(NULLIF(trim(p_settings->>'timezone'),''), v_old.timezone);
  v_tax_enabled := CASE WHEN p_settings ? 'tax_enabled' THEN (p_settings->>'tax_enabled')::boolean ELSE v_old.tax_enabled END;
  v_tax_rate := CASE WHEN p_settings ? 'tax_rate' THEN COALESCE((p_settings->>'tax_rate')::numeric,0) ELSE v_old.tax_rate END;
  v_discount_enabled := CASE WHEN p_settings ? 'discount_enabled' THEN (p_settings->>'discount_enabled')::boolean ELSE v_old.discount_enabled END;
  v_discount_rules := COALESCE(p_settings->'discount_rules', v_old.discount_rules, '{}'::jsonb);
  v_threshold := CASE WHEN p_settings ? 'default_low_stock_threshold' THEN COALESCE((p_settings->>'default_low_stock_threshold')::integer,5) ELSE v_old.default_low_stock_threshold END;
  v_receipt := CASE WHEN p_settings ? 'receipt_footer' THEN COALESCE(trim(p_settings->>'receipt_footer'),'') ELSE v_old.receipt_footer END;
  v_modules := public.sammia_default_module_features() || COALESCE(p_settings->'module_features', v_old.module_features, '{}'::jsonb);

  IF v_branding !~ '^#[0-9A-Fa-f]{6}$' THEN RAISE EXCEPTION 'Branding color must be a six digit hex color'; END IF;
  IF length(v_currency_code) < 3 OR length(v_currency_code) > 5 THEN RAISE EXCEPTION 'Currency code is invalid'; END IF;
  IF length(v_currency_symbol) < 1 OR length(v_currency_symbol) > 6 THEN RAISE EXCEPTION 'Currency symbol is invalid'; END IF;
  IF v_tax_rate < 0 OR v_tax_rate > 100 THEN RAISE EXCEPTION 'Tax rate must be between 0 and 100'; END IF;
  IF COALESCE((v_discount_rules->>'max_discount')::numeric,0) < 0 OR COALESCE((v_discount_rules->>'max_discount')::numeric,0) > 100 THEN
    RAISE EXCEPTION 'Maximum discount must be between 0 and 100';
  END IF;
  IF COALESCE((v_discount_rules->>'min_cart_amount')::numeric,0) < 0 THEN RAISE EXCEPTION 'Minimum cart amount cannot be negative'; END IF;
  IF v_threshold < 0 OR v_threshold > 1000000 THEN RAISE EXCEPTION 'Default low stock threshold is invalid'; END IF;
  IF length(v_receipt) > 300 THEN RAISE EXCEPTION 'Receipt footer must be 300 characters or fewer'; END IF;

  UPDATE public.platform_settings
  SET branding_color = v_branding,
      currency_code = v_currency_code,
      currency_symbol = v_currency_symbol,
      timezone = v_timezone,
      tax_enabled = v_tax_enabled,
      tax_rate = v_tax_rate,
      discount_enabled = v_discount_enabled,
      discount_rules = v_discount_rules,
      default_low_stock_threshold = v_threshold,
      receipt_footer = v_receipt,
      module_features = v_modules,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = 'default'
  RETURNING * INTO v_new;

  INSERT INTO public.super_admin_settings_audit_logs(
    actor_id, scope, section, action, note, previous_values, new_values
  ) VALUES (
    auth.uid(), 'platform', 'platform_defaults', 'update_platform_defaults',
    NULLIF(trim(COALESCE(p_note,'')),''), to_jsonb(v_old), to_jsonb(v_new)
  );

  RETURN public.get_super_admin_platform_settings();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_super_admin_pharmacy_configuration(p_pharmacy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF public.get_user_role() <> 'super_admin' THEN RAISE EXCEPTION 'Super Admin access required'; END IF;

  SELECT jsonb_build_object(
    'pharmacy', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'logo_url', p.logo_url,
      'branding_color', p.branding_color,
      'currency_code', p.currency_code,
      'currency_symbol', p.currency_symbol,
      'timezone', COALESCE(p.timezone,'Africa/Freetown'),
      'tax_enabled', p.tax_enabled,
      'tax_rate', p.tax_rate,
      'discount_enabled', p.discount_enabled,
      'discount_rules', p.discount_rules,
      'module_features', public.sammia_default_module_features() || COALESCE(p.module_features,'{}'::jsonb),
      'operational_settings', '{"default_low_stock_threshold":5,"receipt_footer":"Thank you for choosing SamMia Pharm."}'::jsonb || COALESCE(p.operational_settings,'{}'::jsonb),
      'updated_at', p.updated_at,
      'platform_status', COALESCE(p.platform_status, CASE WHEN p.is_active THEN 'active' ELSE 'disabled' END)
    ),
    'platform_defaults', (public.get_super_admin_platform_settings()->'settings'),
    'recent_changes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'action', l.action,
        'section', l.section,
        'note', l.note,
        'created_at', l.created_at,
        'actor_name', ap.full_name
      ) ORDER BY l.created_at DESC)
      FROM (
        SELECT * FROM public.super_admin_settings_audit_logs
        WHERE pharmacy_id = p.id
        ORDER BY created_at DESC
        LIMIT 10
      ) l
      LEFT JOIN public.profiles ap ON ap.id = l.actor_id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.pharmacies p
  WHERE p.id = p_pharmacy_id;

  IF v_result IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.super_admin_update_pharmacy_configuration(
  p_pharmacy_id uuid,
  p_settings jsonb,
  p_note text DEFAULT NULL,
  p_section text DEFAULT 'pharmacy_overrides'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_old public.pharmacies%ROWTYPE;
  v_new public.pharmacies%ROWTYPE;
  v_branding text;
  v_currency_code text;
  v_currency_symbol text;
  v_timezone text;
  v_tax_enabled boolean;
  v_tax_rate numeric;
  v_discount_enabled boolean;
  v_discount_rules jsonb;
  v_modules jsonb;
  v_operational jsonb;
  v_logo text;
BEGIN
  IF public.get_user_role() <> 'super_admin' THEN RAISE EXCEPTION 'Super Admin access required'; END IF;
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN RAISE EXCEPTION 'Settings object is required'; END IF;

  SELECT * INTO v_old FROM public.pharmacies WHERE id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;

  v_branding := COALESCE(NULLIF(trim(p_settings->>'branding_color'),''), v_old.branding_color);
  v_currency_code := upper(COALESCE(NULLIF(trim(p_settings->>'currency_code'),''), v_old.currency_code));
  v_currency_symbol := COALESCE(NULLIF(trim(p_settings->>'currency_symbol'),''), v_old.currency_symbol);
  v_timezone := COALESCE(NULLIF(trim(p_settings->>'timezone'),''), v_old.timezone, 'Africa/Freetown');
  v_logo := CASE WHEN p_settings ? 'logo_url' THEN COALESCE(trim(p_settings->>'logo_url'),'') ELSE COALESCE(v_old.logo_url,'') END;
  v_tax_enabled := CASE WHEN p_settings ? 'tax_enabled' THEN (p_settings->>'tax_enabled')::boolean ELSE v_old.tax_enabled END;
  v_tax_rate := CASE WHEN p_settings ? 'tax_rate' THEN COALESCE((p_settings->>'tax_rate')::numeric,0) ELSE v_old.tax_rate END;
  v_discount_enabled := CASE WHEN p_settings ? 'discount_enabled' THEN (p_settings->>'discount_enabled')::boolean ELSE v_old.discount_enabled END;
  v_discount_rules := COALESCE(p_settings->'discount_rules', v_old.discount_rules, '{}'::jsonb);
  v_modules := public.sammia_default_module_features() || COALESCE(p_settings->'module_features', v_old.module_features, '{}'::jsonb);
  v_operational := '{"default_low_stock_threshold":5,"receipt_footer":"Thank you for choosing SamMia Pharm."}'::jsonb || COALESCE(v_old.operational_settings,'{}'::jsonb) || COALESCE(p_settings->'operational_settings','{}'::jsonb);

  IF v_branding !~ '^#[0-9A-Fa-f]{6}$' THEN RAISE EXCEPTION 'Branding color must be a six digit hex color'; END IF;
  IF length(v_currency_code) < 3 OR length(v_currency_code) > 5 THEN RAISE EXCEPTION 'Currency code is invalid'; END IF;
  IF length(v_currency_symbol) < 1 OR length(v_currency_symbol) > 6 THEN RAISE EXCEPTION 'Currency symbol is invalid'; END IF;
  IF v_tax_rate < 0 OR v_tax_rate > 100 THEN RAISE EXCEPTION 'Tax rate must be between 0 and 100'; END IF;
  IF COALESCE((v_discount_rules->>'max_discount')::numeric,0) < 0 OR COALESCE((v_discount_rules->>'max_discount')::numeric,0) > 100 THEN RAISE EXCEPTION 'Maximum discount must be between 0 and 100'; END IF;
  IF COALESCE((v_discount_rules->>'min_cart_amount')::numeric,0) < 0 THEN RAISE EXCEPTION 'Minimum cart amount cannot be negative'; END IF;
  IF COALESCE((v_operational->>'default_low_stock_threshold')::integer,5) < 0 THEN RAISE EXCEPTION 'Low stock threshold cannot be negative'; END IF;
  IF length(COALESCE(v_operational->>'receipt_footer','')) > 300 THEN RAISE EXCEPTION 'Receipt footer must be 300 characters or fewer'; END IF;

  UPDATE public.pharmacies
  SET logo_url = v_logo,
      branding_color = v_branding,
      currency_code = v_currency_code,
      currency_symbol = v_currency_symbol,
      timezone = v_timezone,
      tax_enabled = v_tax_enabled,
      tax_rate = v_tax_rate,
      discount_enabled = v_discount_enabled,
      discount_rules = v_discount_rules,
      module_features = v_modules,
      operational_settings = v_operational,
      updated_at = now()
  WHERE id = p_pharmacy_id
  RETURNING * INTO v_new;

  INSERT INTO public.super_admin_settings_audit_logs(
    actor_id, pharmacy_id, scope, section, action, note, previous_values, new_values
  ) VALUES (
    auth.uid(), p_pharmacy_id, 'pharmacy', COALESCE(NULLIF(trim(p_section),''),'pharmacy_overrides'),
    'update_pharmacy_configuration', NULLIF(trim(COALESCE(p_note,'')),''),
    to_jsonb(v_old), to_jsonb(v_new)
  );

  RETURN public.get_super_admin_pharmacy_configuration(p_pharmacy_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.super_admin_reset_pharmacy_configuration(
  p_pharmacy_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_old public.pharmacies%ROWTYPE;
  v_new public.pharmacies%ROWTYPE;
  v_defaults public.platform_settings%ROWTYPE;
BEGIN
  IF public.get_user_role() <> 'super_admin' THEN RAISE EXCEPTION 'Super Admin access required'; END IF;

  SELECT * INTO v_old FROM public.pharmacies WHERE id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  SELECT * INTO v_defaults FROM public.platform_settings WHERE id = 'default';

  UPDATE public.pharmacies
  SET branding_color = v_defaults.branding_color,
      currency_code = v_defaults.currency_code,
      currency_symbol = v_defaults.currency_symbol,
      timezone = v_defaults.timezone,
      tax_enabled = v_defaults.tax_enabled,
      tax_rate = v_defaults.tax_rate,
      discount_enabled = v_defaults.discount_enabled,
      discount_rules = v_defaults.discount_rules,
      module_features = public.sammia_default_module_features() || COALESCE(v_defaults.module_features,'{}'::jsonb),
      operational_settings = jsonb_build_object(
        'default_low_stock_threshold', v_defaults.default_low_stock_threshold,
        'receipt_footer', v_defaults.receipt_footer
      ),
      updated_at = now()
  WHERE id = p_pharmacy_id
  RETURNING * INTO v_new;

  INSERT INTO public.super_admin_settings_audit_logs(
    actor_id, pharmacy_id, scope, section, action, note, previous_values, new_values
  ) VALUES (
    auth.uid(), p_pharmacy_id, 'pharmacy', 'pharmacy_overrides', 'reset_to_platform_defaults',
    NULLIF(trim(COALESCE(p_note,'')),''), to_jsonb(v_old), to_jsonb(v_new)
  );

  RETURN public.get_super_admin_pharmacy_configuration(p_pharmacy_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_super_admin_settings_audit_page(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 30,
  p_scope text DEFAULT 'all',
  p_pharmacy_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_page integer := GREATEST(COALESCE(p_page,1),1);
  v_size integer := CASE WHEN p_page_size IN (25,30,50) THEN p_page_size ELSE 30 END;
  v_offset integer;
  v_count bigint;
  v_rows jsonb;
BEGIN
  IF public.get_user_role() <> 'super_admin' THEN RAISE EXCEPTION 'Super Admin access required'; END IF;
  v_offset := (v_page - 1) * v_size;

  SELECT count(*) INTO v_count
  FROM public.super_admin_settings_audit_logs l
  WHERE (COALESCE(p_scope,'all') = 'all' OR l.scope = p_scope)
    AND (p_pharmacy_id IS NULL OR l.pharmacy_id = p_pharmacy_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'scope', q.scope,
    'section', q.section,
    'action', q.action,
    'note', q.note,
    'created_at', q.created_at,
    'actor_id', q.actor_id,
    'actor_name', ap.full_name,
    'pharmacy_id', q.pharmacy_id,
    'pharmacy_name', ph.name,
    'previous_values', q.previous_values,
    'new_values', q.new_values
  ) ORDER BY q.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT * FROM public.super_admin_settings_audit_logs l
    WHERE (COALESCE(p_scope,'all') = 'all' OR l.scope = p_scope)
      AND (p_pharmacy_id IS NULL OR l.pharmacy_id = p_pharmacy_id)
    ORDER BY l.created_at DESC
    LIMIT v_size OFFSET v_offset
  ) q
  LEFT JOIN public.profiles ap ON ap.id = q.actor_id
  LEFT JOIN public.pharmacies ph ON ph.id = q.pharmacy_id;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'count', v_count,
    'page', v_page,
    'page_size', v_size,
    'page_count', GREATEST(1, CEIL(v_count::numeric / v_size)::integer)
  );
END;
$$;

-- New pharmacies inherit the current platform defaults. The create-pharmacy UI
-- only supplies identity/contact fields, so this keeps financial/display/module
-- defaults centralized without requiring client-side duplication.
CREATE OR REPLACE FUNCTION public.apply_platform_defaults_to_new_pharmacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_defaults public.platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_defaults FROM public.platform_settings WHERE id = 'default';
  IF NOT FOUND THEN RETURN NEW; END IF;

  NEW.branding_color := v_defaults.branding_color;
  NEW.currency_code := v_defaults.currency_code;
  NEW.currency_symbol := v_defaults.currency_symbol;
  NEW.timezone := v_defaults.timezone;
  NEW.tax_enabled := v_defaults.tax_enabled;
  NEW.tax_rate := v_defaults.tax_rate;
  NEW.discount_enabled := v_defaults.discount_enabled;
  NEW.discount_rules := v_defaults.discount_rules;
  NEW.module_features := public.sammia_default_module_features() || COALESCE(v_defaults.module_features,'{}'::jsonb);
  NEW.operational_settings := jsonb_build_object(
    'default_low_stock_threshold', v_defaults.default_low_stock_threshold,
    'receipt_footer', v_defaults.receipt_footer
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_platform_defaults_to_new_pharmacy ON public.pharmacies;
CREATE TRIGGER trg_apply_platform_defaults_to_new_pharmacy
BEFORE INSERT ON public.pharmacies
FOR EACH ROW EXECUTE FUNCTION public.apply_platform_defaults_to_new_pharmacy();

GRANT EXECUTE ON FUNCTION public.get_super_admin_platform_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_update_platform_settings(jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_super_admin_pharmacy_configuration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_update_pharmacy_configuration(uuid,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_reset_pharmacy_configuration(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_super_admin_settings_audit_page(integer,integer,text,uuid) TO authenticated;
