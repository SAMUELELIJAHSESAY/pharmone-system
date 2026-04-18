/*
  # Demo Data Seed

  ## Purpose
  Creates a demo pharmacy so the app has data to display on first login.
  Demo user accounts need to be created via Supabase Auth (handled by the setup script).

  ## Tables Modified
  - `pharmacies` - Adds a demo pharmacy record
  - `products` - Adds sample drug inventory
  - `branches` - Adds a main branch for the demo pharmacy

  ## Notes
  - This uses a placeholder UUID for the demo pharmacy
  - Products include common drug categories with realistic stock levels
  - Run this only once during initial setup
*/

DO $$
DECLARE
  demo_pharmacy_id uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  demo_branch_id uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
BEGIN
  INSERT INTO pharmacies (id, name, address, phone, email, is_active)
  VALUES (
    demo_pharmacy_id,
    'PharmaCare Demo',
    '123 Health Avenue, Medical City',
    '+1 (555) 100-2000',
    'demo@pharmacare.com',
    true
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO branches (id, name, pharmacy_id, address, is_active, feature_settings)
  VALUES (
    demo_branch_id,
    'Main Branch',
    demo_pharmacy_id,
    '123 Health Avenue, Medical City',
    true,
    '{"inventory": true, "sales": true, "customers": true, "reports": true}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO products (name, category, description, price, cost_price, stock_boxes, stock_units, units_per_box, expiry_date, pharmacy_id, branch_id, low_stock_threshold)
  VALUES
    ('Amoxicillin 500mg', 'Antibiotics', 'Broad-spectrum penicillin antibiotic', 12.99, 6.50, 45, 8, 30, '2026-06-30', demo_pharmacy_id, demo_branch_id, 10),
    ('Paracetamol 500mg', 'Analgesics', 'Common pain reliever and fever reducer', 5.49, 2.00, 120, 0, 24, '2026-12-31', demo_pharmacy_id, demo_branch_id, 20),
    ('Ibuprofen 400mg', 'Analgesics', 'Non-steroidal anti-inflammatory', 8.99, 3.50, 60, 12, 20, '2026-09-15', demo_pharmacy_id, demo_branch_id, 10),
    ('Omeprazole 20mg', 'Gastrointestinal', 'Proton pump inhibitor for acid reflux', 14.50, 7.00, 30, 0, 28, '2025-03-31', demo_pharmacy_id, demo_branch_id, 5),
    ('Metformin 500mg', 'Diabetes', 'Oral diabetes medication', 9.99, 4.00, 55, 5, 60, '2026-11-30', demo_pharmacy_id, demo_branch_id, 10),
    ('Lisinopril 10mg', 'Cardiovascular', 'ACE inhibitor for hypertension', 11.25, 5.50, 40, 0, 30, '2026-08-31', demo_pharmacy_id, demo_branch_id, 8),
    ('Cetirizine 10mg', 'Antihistamines', 'Antihistamine for allergies', 7.99, 3.00, 75, 10, 20, '2027-01-31', demo_pharmacy_id, demo_branch_id, 15),
    ('Vitamin C 500mg', 'Vitamins', 'Ascorbic acid supplement', 6.49, 2.50, 4, 0, 60, '2026-10-31', demo_pharmacy_id, demo_branch_id, 5),
    ('Aspirin 75mg', 'Cardiovascular', 'Low-dose aspirin for heart health', 4.99, 1.75, 90, 0, 30, '2027-03-31', demo_pharmacy_id, demo_branch_id, 20),
    ('Azithromycin 250mg', 'Antibiotics', 'Macrolide antibiotic', 18.99, 9.00, 3, 6, 6, '2025-12-31', demo_pharmacy_id, demo_branch_id, 5),
    ('Diclofenac 50mg', 'Analgesics', 'NSAID pain reliever', 10.50, 4.25, 35, 0, 30, '2026-07-31', demo_pharmacy_id, demo_branch_id, 8),
    ('Losartan 50mg', 'Cardiovascular', 'ARB for blood pressure', 15.99, 7.50, 28, 0, 30, '2026-05-31', demo_pharmacy_id, demo_branch_id, 6),
    ('Zinc Supplement', 'Vitamins', 'Zinc for immune support', 8.75, 3.00, 2, 5, 30, '2026-09-30', demo_pharmacy_id, demo_branch_id, 5),
    ('Multivitamin Daily', 'Vitamins', 'Daily complete multivitamin', 12.00, 5.00, 40, 0, 30, '2027-06-30', demo_pharmacy_id, demo_branch_id, 10),
    ('Cough Syrup 100ml', 'Respiratory', 'Multi-symptom cough relief', 9.25, 4.00, 20, 0, 1, '2025-11-30', demo_pharmacy_id, demo_branch_id, 5)
  ON CONFLICT DO NOTHING;

  INSERT INTO customers (name, phone, email, address, pharmacy_id)
  VALUES
    ('Alice Johnson', '+1 555-1001', 'alice@example.com', '45 Oak Street', demo_pharmacy_id),
    ('Bob Smith', '+1 555-1002', 'bob@example.com', '78 Pine Avenue', demo_pharmacy_id),
    ('Carol Davis', '+1 555-1003', 'carol@example.com', '12 Maple Drive', demo_pharmacy_id),
    ('David Wilson', '+1 555-1004', '', '99 Elm Court', demo_pharmacy_id),
    ('Emma Brown', '+1 555-1005', 'emma@example.com', '33 Birch Road', demo_pharmacy_id)
  ON CONFLICT DO NOTHING;
END $$;
