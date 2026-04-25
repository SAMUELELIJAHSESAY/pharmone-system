-- Add functions for monthly and yearly date range calculations
-- These functions handle date calculations on the server side using the pharmacy's timezone

-- Get month's date range (from start of month to end of today) in the pharmacy's timezone
CREATE OR REPLACE FUNCTION get_month_date_range(pharmacy_id uuid DEFAULT NULL)
RETURNS TABLE(
  start timestamptz,
  "end" timestamptz
) AS $$
DECLARE
  v_timezone text := 'UTC';
  v_today_start timestamptz;
  v_month_start timestamptz;
  v_today_end timestamptz;
BEGIN
  -- Get pharmacy timezone if provided, otherwise use UTC
  IF pharmacy_id IS NOT NULL THEN
    SELECT timezone INTO v_timezone FROM pharmacies WHERE id = pharmacy_id;
    IF v_timezone IS NULL THEN
      v_timezone := 'UTC';
    END IF;
  END IF;
  
  -- Calculate month range in the pharmacy's timezone
  v_today_start := date_trunc('day', now() AT TIME ZONE v_timezone) AT TIME ZONE v_timezone;
  v_month_start := date_trunc('month', v_today_start);
  v_today_end := v_today_start + interval '1 day';
  
  -- Convert back to UTC for database storage
  RETURN QUERY SELECT 
    v_month_start AT TIME ZONE 'UTC',
    v_today_end AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE;

-- Get year's date range (from start of year to end of today) in the pharmacy's timezone
CREATE OR REPLACE FUNCTION get_year_date_range(pharmacy_id uuid DEFAULT NULL)
RETURNS TABLE(
  start timestamptz,
  "end" timestamptz
) AS $$
DECLARE
  v_timezone text := 'UTC';
  v_today_start timestamptz;
  v_year_start timestamptz;
  v_today_end timestamptz;
BEGIN
  -- Get pharmacy timezone if provided, otherwise use UTC
  IF pharmacy_id IS NOT NULL THEN
    SELECT timezone INTO v_timezone FROM pharmacies WHERE id = pharmacy_id;
    IF v_timezone IS NULL THEN
      v_timezone := 'UTC';
    END IF;
  END IF;
  
  -- Calculate year range in the pharmacy's timezone
  v_today_start := date_trunc('day', now() AT TIME ZONE v_timezone) AT TIME ZONE v_timezone;
  v_year_start := date_trunc('year', v_today_start);
  v_today_end := v_today_start + interval '1 day';
  
  -- Convert back to UTC for database storage
  RETURN QUERY SELECT 
    v_year_start AT TIME ZONE 'UTC',
    v_today_end AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_month_date_range(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_year_date_range(uuid) TO authenticated;
