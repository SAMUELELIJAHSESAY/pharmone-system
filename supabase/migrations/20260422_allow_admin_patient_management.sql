-- Allow admins to create patients (currently only allows salesman)

DROP POLICY "Salesman can create patients" ON patients;

CREATE POLICY "Salesman and admin can create patients"
  ON patients FOR INSERT
  TO authenticated
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() IN ('salesman', 'admin'));

-- Also allow admin to update patients (currently only allows salesman)
DROP POLICY "Salesman can update own pharmacy patients" ON patients;

CREATE POLICY "Salesman and admin can update patients"
  ON patients FOR UPDATE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() IN ('salesman', 'admin'))
  WITH CHECK (pharmacy_id = get_user_pharmacy_id() AND get_user_role() IN ('salesman', 'admin'));

-- Allow admin to delete patients
CREATE POLICY "Salesman and admin can delete patients"
  ON patients FOR DELETE
  TO authenticated
  USING (pharmacy_id = get_user_pharmacy_id() AND get_user_role() IN ('salesman', 'admin'));
