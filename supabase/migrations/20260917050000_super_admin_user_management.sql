-- Super Admin user management, security status and audit history.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

UPDATE public.profiles
SET account_status = 'disabled'
WHERE is_active = false AND COALESCE(account_status, 'active') = 'active';

UPDATE public.profiles
SET account_status = 'active'
WHERE is_active = true AND (account_status IS NULL OR account_status NOT IN ('active','disabled','locked'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_check CHECK (account_status IN ('active','disabled','locked'));

-- The application already supports inventory_manager. Keep the database constraint aligned.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('super_admin','admin','inventory_manager','salesman'));

CREATE INDEX IF NOT EXISTS idx_profiles_account_status ON public.profiles(account_status);
CREATE INDEX IF NOT EXISTS idx_profiles_last_activity_at ON public.profiles(last_activity_at DESC);

CREATE TABLE IF NOT EXISTS public.super_admin_user_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  note text,
  previous_values jsonb DEFAULT '{}'::jsonb,
  new_values jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_super_admin_user_audit_target
  ON public.super_admin_user_audit_logs(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_super_admin_user_audit_actor
  ON public.super_admin_user_audit_logs(actor_id, created_at DESC);

ALTER TABLE public.super_admin_user_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin can view user audit logs" ON public.super_admin_user_audit_logs;
CREATE POLICY "Super admin can view user audit logs"
  ON public.super_admin_user_audit_logs FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'super_admin');

-- Prevent ordinary users from changing privileged profile fields through the broad
-- "update own profile" policy. Super Admin keeps platform-wide control; Admin may
-- manage staff in their own pharmacy but cannot elevate users to platform roles.
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor_role text;
  actor_pharmacy uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role, pharmacy_id INTO actor_role, actor_pharmacy
  FROM public.profiles WHERE id = auth.uid();

  IF actor_role = 'super_admin' THEN
    RETURN NEW;
  END IF;

  IF actor_role = 'admin' THEN
    IF OLD.pharmacy_id IS DISTINCT FROM actor_pharmacy OR NEW.pharmacy_id IS DISTINCT FROM OLD.pharmacy_id THEN
      RAISE EXCEPTION 'Admins cannot move user accounts between pharmacies';
    END IF;
    IF NEW.role IN ('super_admin','admin') AND NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Admins cannot grant platform or admin roles';
    END IF;
    IF NEW.id = auth.uid() AND (
      NEW.role IS DISTINCT FROM OLD.role OR
      NEW.is_active IS DISTINCT FROM OLD.is_active OR
      NEW.account_status IS DISTINCT FROM OLD.account_status OR
      NEW.pharmacy_id IS DISTINCT FROM OLD.pharmacy_id
    ) THEN
      RAISE EXCEPTION 'You cannot change your own privileged account fields';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
    OR NEW.pharmacy_id IS DISTINCT FROM OLD.pharmacy_id
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
    OR NEW.account_status IS DISTINCT FROM OLD.account_status
    OR NEW.status_reason IS DISTINCT FROM OLD.status_reason
    OR NEW.status_changed_at IS DISTINCT FROM OLD.status_changed_at
    OR NEW.status_changed_by IS DISTINCT FROM OLD.status_changed_by THEN
    RAISE EXCEPTION 'You cannot change privileged account fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileged_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_fields();

CREATE OR REPLACE FUNCTION public.get_super_admin_users_page(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 30,
  p_search text DEFAULT '',
  p_role text DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_pharmacy_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
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
  IF public.get_user_role() <> 'super_admin' THEN
    RAISE EXCEPTION 'Super Admin access required';
  END IF;
  v_offset := (v_page - 1) * v_size;

  WITH filtered AS (
    SELECT p.*
    FROM public.profiles p
    LEFT JOIN public.pharmacies ph ON ph.id = p.pharmacy_id
    WHERE
      (COALESCE(trim(p_search),'') = '' OR
       p.full_name ILIKE '%' || trim(p_search) || '%' OR
       p.email ILIKE '%' || trim(p_search) || '%' OR
       ph.name ILIKE '%' || trim(p_search) || '%')
      AND (p_role IS NULL OR p_role = '' OR p.role = p_role)
      AND (p_pharmacy_id IS NULL OR p.pharmacy_id = p_pharmacy_id)
      AND (
        COALESCE(p_status,'all') = 'all' OR
        (p_status = 'active' AND COALESCE(p.account_status, CASE WHEN p.is_active THEN 'active' ELSE 'disabled' END) = 'active' AND p.is_active = true) OR
        (p_status = 'disabled' AND (COALESCE(p.account_status,'disabled') = 'disabled' OR p.is_active = false)) OR
        (p_status = 'locked' AND p.account_status = 'locked')
      )
      AND (p_branch_id IS NULL OR EXISTS (
        SELECT 1 FROM public.staff_branch_assignments sba
        WHERE sba.staff_id = p.id AND sba.branch_id = p_branch_id AND sba.is_active = true
      ))
  )
  SELECT count(*) INTO v_count FROM filtered;

  WITH filtered AS (
    SELECT p.*
    FROM public.profiles p
    LEFT JOIN public.pharmacies ph ON ph.id = p.pharmacy_id
    WHERE
      (COALESCE(trim(p_search),'') = '' OR
       p.full_name ILIKE '%' || trim(p_search) || '%' OR
       p.email ILIKE '%' || trim(p_search) || '%' OR
       ph.name ILIKE '%' || trim(p_search) || '%')
      AND (p_role IS NULL OR p_role = '' OR p.role = p_role)
      AND (p_pharmacy_id IS NULL OR p.pharmacy_id = p_pharmacy_id)
      AND (
        COALESCE(p_status,'all') = 'all' OR
        (p_status = 'active' AND COALESCE(p.account_status, CASE WHEN p.is_active THEN 'active' ELSE 'disabled' END) = 'active' AND p.is_active = true) OR
        (p_status = 'disabled' AND (COALESCE(p.account_status,'disabled') = 'disabled' OR p.is_active = false)) OR
        (p_status = 'locked' AND p.account_status = 'locked')
      )
      AND (p_branch_id IS NULL OR EXISTS (
        SELECT 1 FROM public.staff_branch_assignments sba
        WHERE sba.staff_id = p.id AND sba.branch_id = p_branch_id AND sba.is_active = true
      ))
    ORDER BY p.created_at DESC
    LIMIT v_size OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', f.id,
      'full_name', f.full_name,
      'email', f.email,
      'role', f.role,
      'pharmacy_id', f.pharmacy_id,
      'pharmacy_name', ph.name,
      'is_active', f.is_active,
      'account_status', COALESCE(f.account_status, CASE WHEN f.is_active THEN 'active' ELSE 'disabled' END),
      'status_reason', f.status_reason,
      'created_at', f.created_at,
      'last_activity_at', f.last_activity_at,
      'last_sign_in_at', au.last_sign_in_at,
      'email_confirmed_at', au.email_confirmed_at,
      'branch_assignments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'branch_id', b.id,
          'branch_name', b.name,
          'role_in_branch', sba.role_in_branch
        ) ORDER BY b.name)
        FROM public.staff_branch_assignments sba
        JOIN public.branches b ON b.id = sba.branch_id
        WHERE sba.staff_id = f.id AND sba.is_active = true
      ), '[]'::jsonb)
    ) ORDER BY f.created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM filtered f
  LEFT JOIN public.pharmacies ph ON ph.id = f.pharmacy_id
  LEFT JOIN auth.users au ON au.id = f.id;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'count', v_count,
    'page', v_page,
    'page_size', v_size,
    'page_count', GREATEST(1, CEIL(v_count::numeric / v_size)::integer)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_super_admin_user_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF public.get_user_role() <> 'super_admin' THEN
    RAISE EXCEPTION 'Super Admin access required';
  END IF;

  SELECT jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'email', p.email,
      'role', p.role,
      'pharmacy_id', p.pharmacy_id,
      'pharmacy_name', ph.name,
      'is_active', p.is_active,
      'account_status', COALESCE(p.account_status, CASE WHEN p.is_active THEN 'active' ELSE 'disabled' END),
      'status_reason', p.status_reason,
      'status_changed_at', p.status_changed_at,
      'created_at', p.created_at,
      'last_activity_at', p.last_activity_at
    ),
    'security', jsonb_build_object(
      'last_sign_in_at', au.last_sign_in_at,
      'email_confirmed_at', au.email_confirmed_at,
      'auth_created_at', au.created_at,
      'phone', au.phone
    ),
    'branches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'branch_id', b.id,
        'branch_name', b.name,
        'role_in_branch', sba.role_in_branch,
        'assigned_date', sba.assigned_date
      ) ORDER BY b.name)
      FROM public.staff_branch_assignments sba
      JOIN public.branches b ON b.id = sba.branch_id
      WHERE sba.staff_id = p.id AND sba.is_active = true
    ), '[]'::jsonb),
    'sales', jsonb_build_object(
      'transactions', (SELECT count(*) FROM public.sales s WHERE s.created_by = p.id AND s.status = 'completed'),
      'total_sales', COALESCE((SELECT sum(s.total_amount) FROM public.sales s WHERE s.created_by = p.id AND s.status = 'completed'),0),
      'last_sale_at', (SELECT max(s.created_at) FROM public.sales s WHERE s.created_by = p.id AND s.status = 'completed')
    ),
    'audit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'action', l.action,
        'note', l.note,
        'created_at', l.created_at,
        'actor_name', ap.full_name,
        'previous_values', l.previous_values,
        'new_values', l.new_values
      ) ORDER BY l.created_at DESC)
      FROM (
        SELECT * FROM public.super_admin_user_audit_logs
        WHERE target_user_id = p.id
        ORDER BY created_at DESC
        LIMIT 50
      ) l
      LEFT JOIN public.profiles ap ON ap.id = l.actor_id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.profiles p
  LEFT JOIN public.pharmacies ph ON ph.id = p.pharmacy_id
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE p.id = p_user_id;

  IF v_result IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.super_admin_set_user_account_state(
  p_target_user uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_old public.profiles%ROWTYPE;
  v_new public.profiles%ROWTYPE;
BEGIN
  IF public.get_user_role() <> 'super_admin' THEN RAISE EXCEPTION 'Super Admin access required'; END IF;
  IF p_status NOT IN ('active','disabled','locked') THEN RAISE EXCEPTION 'Invalid account status'; END IF;
  IF p_target_user = auth.uid() AND p_status <> 'active' THEN
    RAISE EXCEPTION 'You cannot disable or lock your own Super Admin account';
  END IF;

  SELECT * INTO v_old FROM public.profiles WHERE id = p_target_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  UPDATE public.profiles
  SET account_status = p_status,
      is_active = (p_status = 'active'),
      status_reason = NULLIF(trim(COALESCE(p_reason,'')),''),
      status_changed_at = now(),
      status_changed_by = auth.uid()
  WHERE id = p_target_user
  RETURNING * INTO v_new;

  INSERT INTO public.super_admin_user_audit_logs(actor_id,target_user_id,action,note,previous_values,new_values)
  VALUES (
    auth.uid(), p_target_user, 'account_status_changed', NULLIF(trim(COALESCE(p_reason,'')),''),
    jsonb_build_object('account_status',COALESCE(v_old.account_status,'active'),'is_active',v_old.is_active),
    jsonb_build_object('account_status',v_new.account_status,'is_active',v_new.is_active)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.super_admin_change_user_role(
  p_target_user uuid,
  p_role text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_old_role text;
BEGIN
  IF public.get_user_role() <> 'super_admin' THEN RAISE EXCEPTION 'Super Admin access required'; END IF;
  IF p_role NOT IN ('admin','inventory_manager','salesman') THEN RAISE EXCEPTION 'Platform Super Admin roles are bootstrap-protected'; END IF;
  IF p_target_user = auth.uid() THEN RAISE EXCEPTION 'You cannot change your own Super Admin role'; END IF;

  SELECT role INTO v_old_role FROM public.profiles WHERE id = p_target_user FOR UPDATE;
  IF v_old_role IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_old_role = 'super_admin' THEN RAISE EXCEPTION 'Platform Super Admin roles are bootstrap-protected'; END IF;

  UPDATE public.profiles SET role = p_role WHERE id = p_target_user;
  INSERT INTO public.super_admin_user_audit_logs(actor_id,target_user_id,action,note,previous_values,new_values)
  VALUES(auth.uid(),p_target_user,'role_changed',NULLIF(trim(COALESCE(p_reason,'')),''),jsonb_build_object('role',v_old_role),jsonb_build_object('role',p_role));
END;
$$;

CREATE OR REPLACE FUNCTION public.super_admin_revoke_user_sessions(p_target_user uuid, p_reason text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF public.get_user_role() <> 'super_admin' THEN RAISE EXCEPTION 'Super Admin access required'; END IF;
  IF p_target_user = auth.uid() THEN RAISE EXCEPTION 'You cannot revoke your current Super Admin sessions from this screen'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target_user) THEN RAISE EXCEPTION 'User not found'; END IF;

  -- Supabase Auth stores refreshable sessions in auth.sessions. Existing short-lived
  -- access tokens may remain valid until they expire, but refresh is revoked.
  DELETE FROM auth.sessions WHERE user_id = p_target_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.super_admin_user_audit_logs(actor_id,target_user_id,action,note,new_values)
  VALUES(auth.uid(),p_target_user,'sessions_revoked',NULLIF(trim(COALESCE(p_reason,'')),''),jsonb_build_object('sessions_revoked',v_count));
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_super_admin_users_page(integer,integer,text,text,text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_super_admin_user_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_set_user_account_state(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_change_user_role(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_revoke_user_sessions(uuid,text) TO authenticated;
