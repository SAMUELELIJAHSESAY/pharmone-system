-- Create functions for timezone-aware date range calculations
-- These functions handle date calculations on the server side using the pharmacy's timezone

-- Get today's date range in the pharmacy's timezone
CREATE OR REPLACE FUNCTION get_today_date_range(pharmacy_id uuid DEFAULT NULL)
RETURNS TABLE(
  start timestamptz,
  "end" timestamptz,
  date_str text
) AS $$
DECLARE
  v_timezone text := 'UTC';
  v_today_start timestamptz;
  v_today_end timestamptz;
BEGIN
  -- Get pharmacy timezone if provided, otherwise use UTC
  IF pharmacy_id IS NOT NULL THEN
    SELECT timezone INTO v_timezone FROM pharmacies WHERE id = pharmacy_id;
    IF v_timezone IS NULL THEN
      v_timezone := 'UTC';
    END IF;
  END IF;
  
  -- Calculate today's start and end in the pharmacy's timezone
  v_today_start := date_trunc('day', now() AT TIME ZONE v_timezone) AT TIME ZONE v_timezone;
  v_today_end := v_today_start + interval '1 day';
  
  -- Convert back to UTC for database storage
  RETURN QUERY SELECT 
    v_today_start AT TIME ZONE 'UTC',
    v_today_end AT TIME ZONE 'UTC',
    to_char(v_today_start, 'YYYY-MM-DD');
END;
$$ LANGUAGE plpgsql STABLE;

-- Get week's date range (last 7 days) in the pharmacy's timezone
CREATE OR REPLACE FUNCTION get_week_date_range(pharmacy_id uuid DEFAULT NULL)
RETURNS TABLE(
  start timestamptz,
  "end" timestamptz
) AS $$
DECLARE
  v_timezone text := 'UTC';
  v_today_start timestamptz;
  v_week_start timestamptz;
  v_today_end timestamptz;
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
  v_week_start := v_today_start - interval '7 days';
  v_today_end := v_today_start + interval '1 day';
  
  -- Convert back to UTC for database storage
  RETURN QUERY SELECT 
    v_week_start AT TIME ZONE 'UTC',
    v_today_end AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE;

-- Create index on pharmacies timezone column for fast lookups
CREATE INDEX IF NOT EXISTS idx_pharmacies_timezone ON pharmacies(timezone);

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_today_date_range(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_week_date_range(uuid) TO authenticated;
