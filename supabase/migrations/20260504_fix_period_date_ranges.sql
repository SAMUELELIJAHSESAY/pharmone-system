-- Fix period date range calculations for proper period resets
-- This migration corrects the week, month, and year date range functions
-- to properly reset at period boundaries (Monday for weeks, 1st for months, Jan 1 for years)

-- Get week's date range (from Monday of current week to end of next Sunday) in the pharmacy's timezone
-- This ensures weekly sales reset every Monday at 00:00
CREATE OR REPLACE FUNCTION get_week_date_range(pharmacy_id uuid DEFAULT NULL)
RETURNS TABLE(
  start timestamptz,
  "end" timestamptz
) AS $$
DECLARE
  v_timezone text := 'UTC';
  v_today_start timestamptz;
  v_week_start timestamptz;
  v_week_end timestamptz;
  v_day_of_week integer;
BEGIN
  -- Get pharmacy timezone if provided, otherwise use UTC
  IF pharmacy_id IS NOT NULL THEN
    SELECT timezone INTO v_timezone FROM pharmacies WHERE id = pharmacy_id;
    IF v_timezone IS NULL THEN
      v_timezone := 'UTC';
    END IF;
  END IF;
  
  -- Calculate week range in the pharmacy's timezone
  v_today_start := date_trunc('day', now() AT TIME ZONE v_timezone) AT TIME ZONE v_timezone;
  
  -- Calculate Monday of the current week (0 = Sunday, 1 = Monday, etc.)
  -- Get day of week (0-6 where 0 is Sunday)
  v_day_of_week := extract(dow from v_today_start)::integer;
  
  -- If today is Sunday (0), go back 6 days to Monday of this week
  -- Otherwise, go back (day_of_week - 1) days to Monday
  IF v_day_of_week = 0 THEN
    v_week_start := v_today_start - interval '6 days';
  ELSE
    v_week_start := v_today_start - (v_day_of_week - 1)::text || ' days'::interval;
  END IF;
  
  -- Week ends on the next Sunday at 23:59:59, which is the same as Monday + 7 days
  v_week_end := v_week_start + interval '7 days';
  
  -- Convert back to UTC for database storage
  RETURN QUERY SELECT 
    v_week_start AT TIME ZONE 'UTC',
    v_week_end AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE;

-- Get month's date range (from 1st of current month to last day of current month) in the pharmacy's timezone
-- This ensures monthly sales reset every 1st at 00:00
CREATE OR REPLACE FUNCTION get_month_date_range(pharmacy_id uuid DEFAULT NULL)
RETURNS TABLE(
  start timestamptz,
  "end" timestamptz
) AS $$
DECLARE
  v_timezone text := 'UTC';
  v_today_start timestamptz;
  v_month_start timestamptz;
  v_month_end timestamptz;
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
  
  -- Month starts on the 1st of current month
  v_month_start := date_trunc('month', v_today_start);
  
  -- Month ends on the last day of current month at 23:59:59
  v_month_end := (date_trunc('month', v_today_start) + interval '1 month' - interval '1 day')::date + interval '1 day';
  
  -- Convert back to UTC for database storage
  RETURN QUERY SELECT 
    v_month_start AT TIME ZONE 'UTC',
    v_month_end AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE;

-- Get year's date range (from January 1st of current year to December 31st of current year) in the pharmacy's timezone
-- This ensures yearly sales reset every January 1st at 00:00
CREATE OR REPLACE FUNCTION get_year_date_range(pharmacy_id uuid DEFAULT NULL)
RETURNS TABLE(
  start timestamptz,
  "end" timestamptz
) AS $$
DECLARE
  v_timezone text := 'UTC';
  v_today_start timestamptz;
  v_year_start timestamptz;
  v_year_end timestamptz;
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
  
  -- Year starts on January 1st of current year
  v_year_start := date_trunc('year', v_today_start);
  
  -- Year ends on December 31st of current year at 23:59:59
  v_year_end := (date_trunc('year', v_today_start) + interval '1 year' - interval '1 day')::date + interval '1 day';
  
  -- Convert back to UTC for database storage
  RETURN QUERY SELECT 
    v_year_start AT TIME ZONE 'UTC',
    v_year_end AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE;

-- Ensure permissions are granted
GRANT EXECUTE ON FUNCTION get_week_date_range(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_month_date_range(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_year_date_range(uuid) TO authenticated;
