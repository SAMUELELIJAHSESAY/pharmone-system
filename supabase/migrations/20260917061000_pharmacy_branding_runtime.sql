-- SamMia Pharm: live tenant branding, secure logo uploads, and Admin branding controls.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pharmacy-branding',
  'pharmacy-branding',
  true,
  2097152,
  ARRAY['image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Pharmacy branding logos are readable" ON storage.objects;
CREATE POLICY "Pharmacy branding logos are readable"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'pharmacy-branding'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'super_admin' OR p.pharmacy_id::text = split_part(name, '/', 1))
    )
  );

DROP POLICY IF EXISTS "Admins can upload pharmacy branding logos" ON storage.objects;
CREATE POLICY "Admins can upload pharmacy branding logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'pharmacy-branding'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'super_admin'
          OR (p.role = 'admin' AND p.pharmacy_id::text = split_part(name, '/', 1))
        )
    )
  );

DROP POLICY IF EXISTS "Admins can update pharmacy branding logos" ON storage.objects;
CREATE POLICY "Admins can update pharmacy branding logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'pharmacy-branding'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'super_admin'
          OR (p.role = 'admin' AND p.pharmacy_id::text = split_part(name, '/', 1))
        )
    )
  )
  WITH CHECK (
    bucket_id = 'pharmacy-branding'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'super_admin'
          OR (p.role = 'admin' AND p.pharmacy_id::text = split_part(name, '/', 1))
        )
    )
  );

DROP POLICY IF EXISTS "Admins can delete pharmacy branding logos" ON storage.objects;
CREATE POLICY "Admins can delete pharmacy branding logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pharmacy-branding'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'super_admin'
          OR (p.role = 'admin' AND p.pharmacy_id::text = split_part(name, '/', 1))
        )
    )
  );

CREATE OR REPLACE FUNCTION public.update_pharmacy_branding(
  p_pharmacy_id uuid,
  p_settings jsonb,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_old public.pharmacies%ROWTYPE;
  v_new public.pharmacies%ROWTYPE;
  v_branding text;
  v_logo text;
  v_operational jsonb;
  v_branch_footers jsonb;
  v_key text;
  v_value text;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'Authenticated profile required'; END IF;
  IF v_actor.role NOT IN ('admin','super_admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF v_actor.role = 'admin' AND v_actor.pharmacy_id IS DISTINCT FROM p_pharmacy_id THEN
    RAISE EXCEPTION 'You can only manage your own pharmacy branding';
  END IF;

  SELECT * INTO v_old FROM public.pharmacies WHERE id = p_pharmacy_id FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;

  v_branding := COALESCE(NULLIF(trim(p_settings->>'branding_color'), ''), v_old.branding_color, '#2563eb');
  IF v_branding !~ '^#[0-9A-Fa-f]{6}$' THEN RAISE EXCEPTION 'Branding color must be a six digit hex color'; END IF;

  v_logo := CASE WHEN p_settings ? 'logo_url'
    THEN COALESCE(trim(p_settings->>'logo_url'), '')
    ELSE COALESCE(v_old.logo_url, '')
  END;
  IF length(v_logo) > 800 THEN RAISE EXCEPTION 'Logo URL is too long'; END IF;

  v_operational := '{"default_low_stock_threshold":5,"receipt_footer":"Thank you for choosing {branch_name}.","branch_receipt_footers":{}}'::jsonb
    || COALESCE(v_old.operational_settings, '{}'::jsonb)
    || COALESCE(p_settings->'operational_settings', '{}'::jsonb);

  IF length(COALESCE(v_operational->>'receipt_footer', '')) > 300 THEN
    RAISE EXCEPTION 'Receipt footer must be 300 characters or fewer';
  END IF;

  v_branch_footers := COALESCE(v_operational->'branch_receipt_footers', '{}'::jsonb);
  IF jsonb_typeof(v_branch_footers) <> 'object' THEN
    RAISE EXCEPTION 'Branch receipt footers must be an object';
  END IF;

  FOR v_key, v_value IN SELECT key, value #>> '{}' FROM jsonb_each(v_branch_footers)
  LOOP
    IF length(COALESCE(v_value, '')) > 300 THEN RAISE EXCEPTION 'Branch receipt footer must be 300 characters or fewer'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id::text = v_key AND b.pharmacy_id = p_pharmacy_id
    ) THEN
      RAISE EXCEPTION 'Invalid branch receipt footer configuration';
    END IF;
  END LOOP;

  UPDATE public.pharmacies
  SET branding_color = v_branding,
      logo_url = v_logo,
      operational_settings = v_operational,
      updated_at = now()
  WHERE id = p_pharmacy_id
  RETURNING * INTO v_new;

  IF to_regclass('public.super_admin_settings_audit_logs') IS NOT NULL THEN
    INSERT INTO public.super_admin_settings_audit_logs (
      actor_id, pharmacy_id, scope, section, action, note, previous_values, new_values
    ) VALUES (
      auth.uid(),
      p_pharmacy_id,
      'pharmacy',
      CASE WHEN v_actor.role = 'super_admin' THEN 'super_admin_branding' ELSE 'admin_branding' END,
      'update_branding',
      NULLIF(trim(COALESCE(p_note, '')), ''),
      jsonb_build_object(
        'branding_color', v_old.branding_color,
        'logo_url', v_old.logo_url,
        'operational_settings', v_old.operational_settings
      ),
      jsonb_build_object(
        'branding_color', v_new.branding_color,
        'logo_url', v_new.logo_url,
        'operational_settings', v_new.operational_settings
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_new.id,
    'name', v_new.name,
    'branding_color', v_new.branding_color,
    'logo_url', v_new.logo_url,
    'operational_settings', v_new.operational_settings,
    'updated_at', v_new.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_pharmacy_branding(uuid, jsonb, text) TO authenticated;

-- Upgrade the unchanged legacy system default to a branch-aware template.
UPDATE public.platform_settings
SET receipt_footer = 'Thank you for choosing {branch_name}.', updated_at = now()
WHERE receipt_footer = 'Thank you for choosing SamMia Pharm.';

UPDATE public.pharmacies
SET operational_settings = jsonb_set(
      COALESCE(operational_settings, '{}'::jsonb),
      '{receipt_footer}',
      to_jsonb('Thank you for choosing {branch_name}.'::text),
      true
    ),
    updated_at = now()
WHERE COALESCE(operational_settings->>'receipt_footer', '') = 'Thank you for choosing SamMia Pharm.';
