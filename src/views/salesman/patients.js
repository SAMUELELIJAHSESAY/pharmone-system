// Salesman Patient Management View - Patient registration and tracking
import { getPatients, searchPatients, createPatient, updatePatient, getPatientDetails, getPatientVisits, createPatientVisit } from '../../database.js';
import { formatDate, showToast } from '../../utils.js';

export async function renderSalesmanPatients(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;
  const branchId = user?.profile?.branch_id;

  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked to your account.</div>`;
    return;
  }

  try {
    const patients = await getPatients(pharmacyId, branchId);
    renderPatientView(container, patients, user, pharmacyId, branchId);
  } catch (err) {
    console.error('Error loading patients:', err);
    container.innerHTML = `<div class="alert alert-danger">Failed to load patients: ${err.message}</div>`;
  }
}

function renderPatientView(container, initialPatients, user, pharmacyId, branchId) {
  const mainContent = container;

  function renderView(patients) {
    mainContent.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">👨‍⚕️ Patient Records</div>
            <div class="page-subtitle">Register and manage patient information</div>
          </div>
          <button class="btn btn-primary" id="register-patient-btn">+ Register Patient</button>
        </div>

        <!-- Search Section -->
        <div class="card" style="margin-bottom:1.5rem">
          <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
            <input type="text" id="patient-search-input" class="form-control" placeholder="Search by name, phone, or ID..." style="flex:1;min-width:200px">
            <button class="btn btn-ghost" id="clear-search-btn">Clear</button>
          </div>
        </div>

        <!-- Patients Table -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Patient Directory (${patients.length} patients)</span>
          </div>
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Gender</th>
                  <th>Age</th>
                  <th>Patient ID</th>
                  <th>Last Visit</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="patient-table">
                ${renderPatientTable(patients)}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Register Patient Modal -->
      <div id="register-modal" class="modal" style="display:none">
        <div class="modal-content large">
          <div class="modal-close" onclick="closePatientModal()">×</div>
          <h2>Register New Patient</h2>

          <form id="patient-form" onsubmit="savePatientRecord(event)">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
              <div class="form-group">
                <label>Full Name *</label>
                <input type="text" id="pf-name" class="form-control" required>
              </div>
              <div class="form-group">
                <label>Phone *</label>
                <input type="tel" id="pf-phone" class="form-control" required>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
              <div class="form-group">
                <label>Email</label>
                <input type="email" id="pf-email" class="form-control">
              </div>
              <div class="form-group">
                <label>Gender</label>
                <select id="pf-gender" class="form-control">
                  <option value="">-- Select --</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
              <div class="form-group">
                <label>Date of Birth</label>
                <input type="date" id="pf-dob" class="form-control">
              </div>
              <div class="form-group">
                <label>Patient ID Number</label>
                <input type="text" id="pf-id-number" class="form-control" placeholder="Insurance or hospital ID">
              </div>
            </div>

            <div class="form-group">
              <label>Address</label>
              <input type="text" id="pf-address" class="form-control">
            </div>

            <div style="border-top:1px solid var(--gray-200);margin:1.5rem 0;padding-top:1rem">
              <h4 style="margin-bottom:0.75rem">Insurance Information</h4>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
                <div class="form-group">
                  <label>Insurance Provider</label>
                  <input type="text" id="pf-insurance-provider" class="form-control">
                </div>
                <div class="form-group">
                  <label>Insurance Number</label>
                  <input type="text" id="pf-insurance-number" class="form-control">
                </div>
              </div>
            </div>

            <div style="border-top:1px solid var(--gray-200);margin:1.5rem 0;padding-top:1rem">
              <h4 style="margin-bottom:0.75rem">Emergency Contact</h4>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
                <div class="form-group">
                  <label>Contact Name</label>
                  <input type="text" id="pf-emergency-contact" class="form-control">
                </div>
                <div class="form-group">
                  <label>Contact Phone</label>
                  <input type="tel" id="pf-emergency-phone" class="form-control">
                </div>
              </div>
            </div>

            <div style="border-top:1px solid var(--gray-200);margin:1.5rem 0;padding-top:1rem">
              <h4 style="margin-bottom:0.75rem">Medical Information</h4>
              <div class="form-group">
                <label>Known Allergies</label>
                <textarea id="pf-allergies" class="form-control" rows="2" placeholder="List any known allergies..."></textarea>
              </div>
              <div class="form-group">
                <label>Medical Notes</label>
                <textarea id="pf-medical-notes" class="form-control" rows="3" placeholder="Any relevant medical history..."></textarea>
              </div>
            </div>

            <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1.5rem">
              <button type="button" class="btn btn-ghost" onclick="closePatientModal()">Cancel</button>
              <button type="submit" class="btn btn-primary">Register Patient</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Patient Details Modal -->
      <div id="patient-details-modal" class="modal" style="display:none">
        <div class="modal-content large">
          <div class="modal-close" onclick="closeDetailsModal()">×</div>
          <h2 id="detail-patient-name">Patient Details</h2>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin:1.5rem 0">
            <div>
              <h4>Basic Information</h4>
              <div style="font-size:0.9rem;line-height:2">
                <div><strong>Phone:</strong> <span id="detail-phone">-</span></div>
                <div><strong>Email:</strong> <span id="detail-email">-</span></div>
                <div><strong>Gender:</strong> <span id="detail-gender">-</span></div>
                <div><strong>Age:</strong> <span id="detail-age">-</span></div>
                <div><strong>Patient ID:</strong> <span id="detail-patient-id">-</span></div>
              </div>
            </div>
            <div>
              <h4>Insurance</h4>
              <div style="font-size:0.9rem;line-height:2">
                <div><strong>Provider:</strong> <span id="detail-insurance-provider">-</span></div>
                <div><strong>Number:</strong> <span id="detail-insurance-number">-</span></div>
              </div>
            </div>
          </div>

          <div style="border-top:1px solid var(--gray-200);padding-top:1rem;margin-top:1rem">
            <h4>Visits</h4>
            <div id="visits-list" style="max-height:300px;overflow-y:auto">
              <div style="text-align:center;color:var(--gray-500);padding:1rem">No visits recorded</div>
            </div>
          </div>

          <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1.5rem">
            <button class="btn btn-ghost" onclick="closeDetailsModal()">Close</button>
            <button class="btn btn-primary" id="add-visit-btn">+ Record Visit</button>
          </div>
        </div>
      </div>

      <!-- Record Visit Modal -->
      <div id="visit-modal" class="modal" style="display:none">
        <div class="modal-content">
          <div class="modal-close" onclick="closeVisitModal()">×</div>
          <h2>Record Patient Visit</h2>

          <form id="visit-form" onsubmit="saveVisitRecord(event)">
            <div class="form-group">
              <label>Visit Reason *</label>
              <textarea id="visit-reason" class="form-control" rows="3" required placeholder="Why did the patient visit?"></textarea>
            </div>

            <div class="form-group">
              <label>Doctor/Consultant Name</label>
              <input type="text" id="visit-doctor" class="form-control" placeholder="Name of healthcare provider">
            </div>

            <div class="form-group">
              <label>Diagnosis/Notes</label>
              <textarea id="visit-notes" class="form-control" rows="3" placeholder="Medical findings and notes..."></textarea>
            </div>

            <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1.5rem">
              <button type="button" class="btn btn-ghost" onclick="closeVisitModal()">Cancel</button>
              <button type="submit" class="btn btn-primary">Record Visit</button>
            </div>
          </form>
        </div>
      </div>
    `;

    // Register event listeners
    document.getElementById('register-patient-btn').addEventListener('click', () => {
      document.getElementById('patient-form').reset();
      document.getElementById('register-modal').style.display = 'flex';
    });

    document.getElementById('clear-search-btn').addEventListener('click', () => {
      document.getElementById('patient-search-input').value = '';
      document.getElementById('patient-table').innerHTML = renderPatientTable(patients);
    });

    document.getElementById('patient-search-input').addEventListener('keyup', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      if (!searchTerm) {
        document.getElementById('patient-table').innerHTML = renderPatientTable(patients);
        return;
      }

      const filtered = patients.filter(p =>
        (p.name || '').toLowerCase().includes(searchTerm) ||
        (p.phone || '').includes(searchTerm) ||
        (p.patient_id_number || '').toLowerCase().includes(searchTerm)
      );

      document.getElementById('patient-table').innerHTML = renderPatientTable(filtered);
    });

    // Make functions global
    window.closePatientModal = () => {
      document.getElementById('register-modal').style.display = 'none';
    };

    window.closeDetailsModal = () => {
      document.getElementById('patient-details-modal').style.display = 'none';
    };

    window.closeVisitModal = () => {
      document.getElementById('visit-modal').style.display = 'none';
    };

    window.savePatientRecord = async (event) => {
      event.preventDefault();

      try {
        const patient = {
          name: document.getElementById('pf-name').value,
          phone: document.getElementById('pf-phone').value,
          email: document.getElementById('pf-email').value || null,
          gender: document.getElementById('pf-gender').value || null,
          date_of_birth: document.getElementById('pf-dob').value || null,
          address: document.getElementById('pf-address').value || null,
          patient_id_number: document.getElementById('pf-id-number').value || null,
          insurance_provider: document.getElementById('pf-insurance-provider').value || null,
          insurance_number: document.getElementById('pf-insurance-number').value || null,
          emergency_contact: document.getElementById('pf-emergency-contact').value || null,
          emergency_phone: document.getElementById('pf-emergency-phone').value || null,
          allergies: document.getElementById('pf-allergies').value || null,
          medical_notes: document.getElementById('pf-medical-notes').value || null,
          pharmacy_id: pharmacyId,
          branch_id: branchId,
          is_active: true,
          created_at: new Date().toISOString()
        };

        const savedPatient = await createPatient(patient);

        if (savedPatient && savedPatient.id) {
          showToast('Patient registered successfully!', 'success');
          window.closePatientModal();
          const updatedPatients = await getPatients(pharmacyId, branchId);
          renderView(updatedPatients);
        } else {
          showToast('Failed to register patient', 'error');
        }
      } catch (error) {
        console.error('Error saving patient:', error);
        showToast('Error: ' + error.message, 'error');
      }
    };

    window.viewPatientDetails = async (patientId) => {
      try {
        const patient = await getPatientDetails(patientId);
        const visits = await getPatientVisits(patientId);

        document.getElementById('detail-patient-name').textContent = patient.name;
        document.getElementById('detail-phone').textContent = patient.phone || '-';
        document.getElementById('detail-email').textContent = patient.email || '-';
        document.getElementById('detail-gender').textContent = patient.gender || '-';
        document.getElementById('detail-patient-id').textContent = patient.patient_id_number || '-';
        document.getElementById('detail-insurance-provider').textContent = patient.insurance_provider || '-';
        document.getElementById('detail-insurance-number').textContent = patient.insurance_number || '-';

        if (patient.date_of_birth) {
          const age = new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear();
          document.getElementById('detail-age').textContent = age;
        } else {
          document.getElementById('detail-age').textContent = '-';
        }

        // Display visits
        const visitsList = document.getElementById('visits-list');
        if (visits && visits.length > 0) {
          visitsList.innerHTML = visits.map(v => `
            <div style="padding:0.75rem;border-bottom:1px solid var(--gray-200);font-size:0.9rem">
              <div><strong>${new Date(v.visit_date).toLocaleDateString()}</strong></div>
              <div style="color:var(--gray-600);margin-top:0.25rem">${v.visit_reason || '-'}</div>
              ${v.doctor_name ? `<div style="color:var(--blue-600);margin-top:0.25rem">Dr. ${v.doctor_name}</div>` : ''}
            </div>
          `).join('');
        } else {
          visitsList.innerHTML = '<div style="text-align:center;color:var(--gray-500);padding:1rem">No visits recorded</div>';
        }

        // Set up add visit button
        document.getElementById('add-visit-btn').onclick = () => {
          window.currentPatientId = patientId;
          document.getElementById('visit-form').reset();
          window.closeDetailsModal();
          document.getElementById('visit-modal').style.display = 'flex';
        };

        document.getElementById('patient-details-modal').style.display = 'flex';
      } catch (error) {
        console.error('Error loading patient details:', error);
        showToast('Error: ' + error.message, 'error');
      }
    };

    window.saveVisitRecord = async (event) => {
      event.preventDefault();

      try {
        const visit = {
          patient_id: window.currentPatientId,
          visit_reason: document.getElementById('visit-reason').value,
          doctor_name: document.getElementById('visit-doctor').value || null,
          notes: document.getElementById('visit-notes').value || null,
          visit_date: new Date().toISOString(),
          pharmacy_id: pharmacyId,
          branch_id: branchId
        };

        const savedVisit = await createPatientVisit(visit);

        if (savedVisit && savedVisit.id) {
          showToast('Visit recorded successfully!', 'success');
          window.closeVisitModal();
          const updatedPatients = await getPatients(pharmacyId, branchId);
          renderView(updatedPatients);
        } else {
          showToast('Failed to record visit', 'error');
        }
      } catch (error) {
        console.error('Error saving visit:', error);
        showToast('Error: ' + error.message, 'error');
      }
    };
  }

  renderView(initialPatients);
}

function renderPatientTable(patients) {
  if (!patients || patients.length === 0) {
    return `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--gray-500)">No patients found</td></tr>`;
  }

  return patients.map(p => {
    const age = p.date_of_birth ? new Date().getFullYear() - new Date(p.date_of_birth).getFullYear() : '-';
    return `
      <tr>
        <td><strong>${p.name}</strong></td>
        <td>${p.phone || '-'}</td>
        <td>${p.gender || '-'}</td>
        <td>${age}</td>
        <td>${p.patient_id_number || '-'}</td>
        <td>${p.last_visit_date ? new Date(p.last_visit_date).toLocaleDateString() : 'Never'}</td>
        <td>
          <button class="btn btn-sm btn-ghost" onclick="window.viewPatientDetails('${p.id}')" title="View Details">
            👁️ View
          </button>
        </td>
      </tr>
    `;
  }).join('');
}
