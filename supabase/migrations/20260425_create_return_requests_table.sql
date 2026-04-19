-- Create return_requests table for salesman return requests
-- This table stores return requests from salesman that need admin approval

CREATE TABLE IF NOT EXISTS return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES sales(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  requested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  request_number TEXT NOT NULL UNIQUE,
  items_count INTEGER NOT NULL,
  requested_amount DECIMAL(10, 2) NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_notes TEXT,
  approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries
CREATE INDEX idx_return_requests_pharmacy ON return_requests(pharmacy_id);
CREATE INDEX idx_return_requests_branch ON return_requests(branch_id);
CREATE INDEX idx_return_requests_requested_by ON return_requests(requested_by);
CREATE INDEX idx_return_requests_status ON return_requests(status);
CREATE INDEX idx_return_requests_invoice ON return_requests(invoice_id);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_return_requests_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER return_requests_updated_at
  BEFORE UPDATE ON return_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_return_requests_timestamp();

-- Enable RLS
ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;

-- Salesman can view their own return requests
CREATE POLICY "Salesman can view own return requests" ON return_requests
  FOR SELECT USING (
    requested_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Salesman can create return requests
CREATE POLICY "Salesman can create return requests" ON return_requests
  FOR INSERT WITH CHECK (
    requested_by = auth.uid()
  );

-- Salesman can update their own pending requests (cancel)
CREATE POLICY "Salesman can update own pending requests" ON return_requests
  FOR UPDATE USING (
    requested_by = auth.uid() AND status = 'pending'
  );

-- Admin can view all return requests for their pharmacy
CREATE POLICY "Admin can view pharmacy return requests" ON return_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND 
            profiles.pharmacy_id = return_requests.pharmacy_id AND
            profiles.role = 'admin'
    )
  );

-- Admin can update return requests (approve/reject)
CREATE POLICY "Admin can update return requests" ON return_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND 
            profiles.pharmacy_id = return_requests.pharmacy_id AND
            profiles.role = 'admin'
    )
  );
