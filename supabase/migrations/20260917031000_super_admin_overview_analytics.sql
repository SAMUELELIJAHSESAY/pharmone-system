-- Super Admin Overview analytics
-- Aggregates platform-wide metrics server-side so the overview does not download
-- the complete sales history into the browser.

CREATE OR REPLACE FUNCTION public.get_super_admin_overview(
  p_start timestamptz,
  p_end timestamptz,
  p_prev_start timestamptz DEFAULT NULL,
  p_prev_end timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
      AND COALESCE(is_active, true) = true
  ) THEN
    RAISE EXCEPTION 'Super administrator access required';
  END IF;

  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'total_pharmacies', (SELECT count(*) FROM public.pharmacies),
      'active_pharmacies', (SELECT count(*) FROM public.pharmacies WHERE is_active = true),
      'total_users', (SELECT count(*) FROM public.profiles),
      'active_users', (SELECT count(*) FROM public.profiles WHERE COALESCE(is_active, true) = true),
      'period_revenue', COALESCE((
        SELECT sum(total_amount) FROM public.sales
        WHERE status = 'completed' AND created_at >= p_start AND created_at < p_end
      ), 0),
      'period_transactions', (
        SELECT count(*) FROM public.sales
        WHERE status = 'completed' AND created_at >= p_start AND created_at < p_end
      ),
      'previous_revenue', CASE WHEN p_prev_start IS NULL THEN NULL ELSE COALESCE((
        SELECT sum(total_amount) FROM public.sales
        WHERE status = 'completed' AND created_at >= p_prev_start AND created_at < p_prev_end
      ), 0) END,
      'previous_transactions', CASE WHEN p_prev_start IS NULL THEN NULL ELSE (
        SELECT count(*) FROM public.sales
        WHERE status = 'completed' AND created_at >= p_prev_start AND created_at < p_prev_end
      ) END
    ),
    'pharmacies', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'email', p.email,
          'is_active', p.is_active,
          'created_at', p.created_at,
          'user_count', COALESCE(u.user_count, 0),
          'active_user_count', COALESCE(u.active_user_count, 0),
          'branch_count', COALESCE(b.branch_count, 0),
          'period_revenue', COALESCE(s.period_revenue, 0),
          'period_transactions', COALESCE(s.period_transactions, 0),
          'last_sale_at', s.last_sale_at
        )
        ORDER BY p.created_at DESC
      )
      FROM public.pharmacies p
      LEFT JOIN LATERAL (
        SELECT
          count(*) AS user_count,
          count(*) FILTER (WHERE COALESCE(is_active, true) = true) AS active_user_count
        FROM public.profiles pr
        WHERE pr.pharmacy_id = p.id
      ) u ON true
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE is_active = true) AS branch_count
        FROM public.branches br
        WHERE br.pharmacy_id = p.id
      ) b ON true
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(sum(total_amount) FILTER (
            WHERE status = 'completed' AND created_at >= p_start AND created_at < p_end
          ), 0) AS period_revenue,
          count(*) FILTER (
            WHERE status = 'completed' AND created_at >= p_start AND created_at < p_end
          ) AS period_transactions,
          max(created_at) FILTER (WHERE status = 'completed') AS last_sale_at
        FROM public.sales sl
        WHERE sl.pharmacy_id = p.id
      ) s ON true
    ), '[]'::jsonb),
    'revenue_trend', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'date', d.day::date,
          'revenue', COALESCE(x.revenue, 0),
          'transactions', COALESCE(x.transactions, 0)
        ) ORDER BY d.day
      )
      FROM generate_series(
        date_trunc('day', now()) - interval '6 days',
        date_trunc('day', now()),
        interval '1 day'
      ) AS d(day)
      LEFT JOIN LATERAL (
        SELECT sum(total_amount) AS revenue, count(*) AS transactions
        FROM public.sales sl
        WHERE sl.status = 'completed'
          AND sl.created_at >= d.day
          AND sl.created_at < d.day + interval '1 day'
      ) x ON true
    ), '[]'::jsonb),
    'activity', COALESCE((
      SELECT jsonb_agg(activity_row ORDER BY activity_time DESC)
      FROM (
        SELECT jsonb_build_object(
          'type', 'pharmacy_created',
          'time', p.created_at,
          'title', 'Pharmacy registered',
          'detail', p.name,
          'pharmacy_id', p.id
        ) AS activity_row,
        p.created_at AS activity_time
        FROM public.pharmacies p

        UNION ALL

        SELECT jsonb_build_object(
          'type', 'user_created',
          'time', pr.created_at,
          'title', 'User joined',
          'detail', concat_ws(' · ', NULLIF(pr.full_name, ''), pr.role, ph.name),
          'pharmacy_id', pr.pharmacy_id
        ),
        pr.created_at
        FROM public.profiles pr
        LEFT JOIN public.pharmacies ph ON ph.id = pr.pharmacy_id

        UNION ALL

        SELECT jsonb_build_object(
          'type', 'sale_completed',
          'time', sl.created_at,
          'title', 'Sale completed',
          'detail', concat_ws(' · ', ph.name, sl.invoice_number, sl.total_amount::text),
          'pharmacy_id', sl.pharmacy_id,
          'amount', sl.total_amount
        ),
        sl.created_at
        FROM public.sales sl
        LEFT JOIN public.pharmacies ph ON ph.id = sl.pharmacy_id
        WHERE sl.status = 'completed'
        ORDER BY activity_time DESC
        LIMIT 15
      ) recent
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_super_admin_overview(timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_admin_overview(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;
