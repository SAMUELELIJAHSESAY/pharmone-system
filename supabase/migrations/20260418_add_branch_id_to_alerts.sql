-- Add branch_id to alerts table for branch-level alert filtering (if not already present)
DO $$ 
BEGIN
  -- Add branch_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'alerts' AND column_name = 'branch_id'
  ) THEN
    ALTER TABLE alerts ADD COLUMN branch_id uuid REFERENCES branches(id) ON DELETE CASCADE;
  END IF;
  
  -- Add index if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'alerts' AND indexname = 'idx_alerts_branch'
  ) THEN
    CREATE INDEX idx_alerts_branch ON alerts(branch_id);
  END IF;
END $$;

-- Add branch_id to stock_logs table for branch-level inventory tracking (if not already present)
DO $$ 
BEGIN
  -- Add branch_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'stock_logs' AND column_name = 'branch_id'
  ) THEN
    ALTER TABLE stock_logs ADD COLUMN branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
  END IF;
  
  -- Add index if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'stock_logs' AND indexname = 'idx_stock_logs_branch'
  ) THEN
    CREATE INDEX idx_stock_logs_branch ON stock_logs(branch_id);
  END IF;
END $$;
