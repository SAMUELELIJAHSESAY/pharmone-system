// Patient Management View
import { getPatients, searchPatients, createPatient, updatePatient, getPatientDetails, getPatientVisits, createPatientVisit, getTreatmentPayments, createTreatmentPayment } from '../../database.js';
import { supabase } from '../../config.js';

// Global context for patient operations
let currentPatientUser = null;
let currentPatientPharmacyId = null;
let currentPatientBranchId = null;
let currentPatientList = [];

export async function renderPatientManagementView(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;
  const branchId = user?.profile?.branch_id;
  
  // Store user context globally for onclick handlers
  currentPatientUser = user;
  currentPatientPharmacyId = pharmacyId;
  currentPatientBranchId = branchId;
  
  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked to your account.</div>`;
    return;
  }
  
  try {
    const patients = await getPatients(pharmacyId, branchId);
    currentPatientList = patients;
    renderView(container, patients, user, pharmacyId, branchId);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load patients: ${err.message}</div>`;
  }
}

function renderView(container, patients, user, pharmacyId, branchId) {
  const mainContent = container;
  currentPatientList = patients;
  
  mainContent.innerHTML = `
    <div class="patient-management-container">
      <div class="page-header">
        <h1>👨‍⚕️ Patient Management</h1>
        <button class="btn btn-primary" onclick="openAddPatientModal()">+ Register Patient</button>
      </div>
      
      <!-- Patient Search -->
      <div class="section">
        <h3>Search Patients</h3>
        <div class="search-bar">
          <input type="text" id="patient-search" class="search-input" placeholder="Search by name, phone, or ID..." onkeyup="searchPatientList()">
          <button class="btn btn-secondary" onclick="clearPatientSearch()">Clear</button>
        </div>
      </div>
      
      <!-- Patient List -->
      <div class="section">
        <h3>Patient Directory</h3>
        <table class="data-table">
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
            <tr><td colspan="7">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    
    <!-- Add Patient Modal -->
    <div id="add-patient-modal" class="modal" style="display: none;">
      <div class="modal-content large">
        <div class="modal-close" onclick="closeModal('add-patient-modal')">×</div>
        <h2>Register New Patient</h2>
        
        <form onsubmit="savePatient(event)">
          <div class="form-row">
            <div class="form-group">
              <label>Full Name</label>
              <input type="text" id="patient-name" class="form-control" required>
            </div>
            <div class="form-group">
              <label>Phone</label>
              <input type="tel" id="patient-phone" class="form-control" required>
            </div>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="patient-email" class="form-control">
            </div>
            <div class="form-group">
              <label>Gender</label>
              <select id="patient-gender" class="form-control">
                <option value="">-- Select --</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label>Date of Birth</label>
              <input type="date" id="patient-dob" class="form-control">
            </div>
            <div class="form-group">
              <label>Patient ID Number (Optional)</label>
              <input type="text" id="patient-id-number" class="form-control" placeholder="Insurance or hospital ID">
            </div>
          </div>
          
          <div class="form-group">
            <label>Address</label>
            <input type="text" id="patient-address" class="form-control">
          </div>
          
          <div class="section-divider"><h4>Insurance Information</h4></div>
          
          <div class="form-row">
            <div class="form-group">
              <label>Insurance Provider</label>
              <input type="text" id="patient-insurance-provider" class="form-control">
            </div>
            <div class="form-group">
              <label>Insurance Number</label>
              <input type="text" id="patient-insurance-number" class="form-control">
            </div>
          </div>
          
          <div class="section-divider"><h4>Emergency Contact</h4></div>
          
          <div class="form-row">
            <div class="form-group">
              <label>Contact Name</label>
              <input type="text" id="patient-emergency-contact" class="form-control">
            </div>
            <div class="form-group">
              <label>Contact Phone</label>
              <input type="tel" id="patient-emergency-phone" class="form-control">
            </div>
          </div>
          
          <div class="section-divider"><h4>Medical Information</h4></div>
          
          <div class="form-group">
            <label>Known Allergies</label>
            <textarea id="patient-allergies" class="form-control" rows="2" placeholder="List any known allergies..."></textarea>
          </div>
          
          <div class="form-group">
            <label>Medical Notes</label>
            <textarea id="patient-medical-notes" class="form-control" rows="3" placeholder="Any relevant medical history..."></textarea>
          </div>
          
          <button type="submit" class="btn btn-primary">Register Patient</button>
        </form>
      </div>
    </div>
    
    <!-- Patient Details Modal -->
    <div id="patient-details-modal" class="modal" style="display: none;">
      <div class="modal-content large">
        <div class="modal-close" onclick="closeModal('patient-details-modal')">×</div>
        <h2 id="modal-patient-name">Patient Details</h2>
        
        <div class="tabs">
          <button class="tab-btn active" onclick="switchPatientTab('overview')">📋 Overview</button>
          <button class="tab-btn" onclick="switchPatientTab('visits')">👨‍⚕️ Visits</button>
          <button class="tab-btn" onclick="switchPatientTab('treatments')">💉 Treatments</button>
          <button class="tab-btn" onclick="switchPatientTab('prescriptions')">💊 Prescriptions</button>
          <button class="tab-btn" onclick="switchPatientTab('payments')">💰 Payments</button>
        </div>
        
        <!-- Overview Tab -->
        <div id="overview-tab" class="tab-content">
          <div class="patient-summary-cards">
            <div class="summary-card">
              <h4>Total Visits</h4>
              <p class="summary-value" id="total-visits">0</p>
            </div>
            <div class="summary-card">
              <h4>Last Visit</h4>
              <p class="summary-value" id="last-visit">-</p>
            </div>
            <div class="summary-card">
              <h4>Total Payments</h4>
              <p class="summary-value" id="total-payments">₦0.00</p>
            </div>
          </div>
          
          <div class="info-grid">
            <div class="info-item">
              <label>Name:</label>
              <span id="detail-name">-</span>
            </div>
            <div class="info-item">
              <label>Phone:</label>
              <span id="detail-phone">-</span>
            </div>
            <div class="info-item">
              <label>Email:</label>
              <span id="detail-email">-</span>
            </div>
            <div class="info-item">
              <label>Age:</label>
              <span id="detail-age">-</span>
            </div>
            <div class="info-item">
              <label>Gender:</label>
              <span id="detail-gender">-</span>
            </div>
            <div class="info-item">
              <label>Insurance:</label>
              <span id="detail-insurance">-</span>
            </div>
            <div class="info-item full">
              <label>Address:</label>
              <span id="detail-address">-</span>
            </div>
            <div class="info-item full">
              <label>Allergies:</label>
              <span id="detail-allergies">-</span>
            </div>
            <div class="info-item full">
              <label>Medical Notes:</label>
              <span id="detail-medical-notes">-</span>
            </div>
          </div>
          <button class="btn btn-primary" onclick="editPatient()">Edit Information</button>
        </div>
        
        <!-- Visits Tab -->
        <div id="visits-tab" class="tab-content" style="display: none;">
          <button class="btn btn-primary" onclick="openAddVisitModal()">+ Record Visit</button>
          <div id="visits-list" class="visits-timeline">
            <p>Loading...</p>
          </div>
        </div>
        
        <!-- Treatments Tab -->
        <div id="treatments-tab" class="tab-content" style="display: none;">
          <button class="btn btn-primary" onclick="openTreatmentPaymentModal()">+ Record Treatment</button>
          <div id="treatments-list" class="treatments-timeline">
            <p>Loading...</p>
          </div>
        </div>
        
        <!-- Prescriptions Tab -->
        <div id="prescriptions-tab" class="tab-content" style="display: none;">
          <div id="prescriptions-list" class="prescriptions-list">
            <p>Loading...</p>
          </div>
        </div>
        
        <!-- Payments Tab -->
        <div id="payments-tab" class="tab-content" style="display: none;">
          <div id="payments-list" class="payments-list">
            <p>Loading...</p>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Add Visit Modal -->
    <div id="add-visit-modal" class="modal" style="display: none;">
      <div class="modal-content">
        <div class="modal-close" onclick="closeModal('add-visit-modal')">×</div>
        <h2>Record Patient Visit</h2>
        
        <form onsubmit="savePatientVisit(event)">
          <div class="form-group">
            <label>Doctor/Clinician</label>
            <input type="text" id="visit-doctor-name" class="form-control" placeholder="Doctor name..." required>
          </div>
          
          <div class="form-group">
            <label>Doctor Specialty</label>
            <input type="text" id="visit-doctor-specialty" class="form-control" placeholder="e.g., Pharmacy, Clinic, General...">
          </div>
          
          <div class="form-group">
            <label>Symptoms</label>
            <textarea id="visit-symptoms" class="form-control" rows="3" placeholder="Describe the patient symptoms..." required></textarea>
          </div>
          
          <div class="form-group">
            <label>Diagnosis</label>
            <textarea id="visit-diagnosis" class="form-control" rows="3" placeholder="Medical diagnosis (if applicable)..." required></textarea>
          </div>
          
          <div class="form-group">
            <label>Notes</label>
            <textarea id="visit-notes" class="form-control" rows="3" placeholder="Additional notes..."></textarea>
          </div>
          
          <button type="submit" class="btn btn-primary">Save Visit</button>
        </form>
      </div>
    </div>
    
    <!-- Treatment Payment Modal -->
    <div id="treatment-payment-modal" class="modal" style="display: none;">
      <div class="modal-content">
        <div class="modal-close" onclick="closeModal('treatment-payment-modal')">×</div>
        <h2>Record Treatment Payment</h2>
        
        <form onsubmit="saveTreatmentPayment(event)">
          <div class="form-group">
            <label>Select Visit</label>
            <select id="payment-visit-id" class="form-control" required>
              <option value="">-- Select a visit --</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Treatment Description</label>
            <input type="text" id="payment-description" class="form-control" placeholder="e.g., Consultation, Injection, Sutures..." required>
          </div>
          
          <div class="form-group">
            <label>Amount (₦)</label>
            <input type="number" id="payment-amount" class="form-control" step="0.01" placeholder="0.00" required>
          </div>
          
          <div class="form-group">
            <label>Payment Method</label>
            <select id="payment-method" class="form-control" required>
              <option value="">-- Select method --</option>
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="check">Check</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Payment Date</label>
            <input type="date" id="payment-date" class="form-control" required>
          </div>
          
          <div class="form-group">
            <label>Notes</label>
            <textarea id="payment-notes" class="form-control" rows="2" placeholder="Optional notes..."></textarea>
          </div>
          
          <button type="submit" class="btn btn-primary">Record Payment</button>
        </form>
      </div>
    </div>
  `;
  
  // Setup event listeners and load data
  displayPatients(patients);
  setupPatientEventListeners(mainContent, pharmacyId, branchId);
}

async function loadPatientData(pharmacyId, branchId) {
  try {
    const patients = await getPatients(pharmacyId, branchId);
    displayPatients(patients);
  } catch (error) {
    console.error('Error loading patient data:', error);
  }
}

function setupPatientEventListeners(container, pharmacyId, branchId) {
  // This function sets up scoped event listeners for patient module
  // The onclick handlers in HTML are still global, so we need to ensure they exist in window scope
  window.patientContextPharmacyId = pharmacyId;
  window.patientContextBranchId = branchId;
}

function displayPatients(patients) {
  const tbody = document.getElementById('patient-table');
  
  if (patients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No patients registered</td></tr>';
    return;
  }
  
  // Get last visit for each patient (simplified - in real app would join data)
  tbody.innerHTML = patients.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.phone}</td>
      <td>${p.gender || '-'}</td>
      <td>${p.age || '-'}</td>
      <td>${p.patient_id_number || '-'}</td>
      <td>-</td>
      <td>
        <button class="btn btn-small btn-info" onclick="openPatientDetails('${p.id}')">View</button>
        <button class="btn btn-small btn-secondary" onclick="editPatientForm('${p.id}')">Edit</button>
      </td>
    </tr>
  `).join('');
}

async function searchPatientList() {
  const searchTerm = document.getElementById('patient-search').value;
  
  if (!currentPatientPharmacyId) {
    alert('Pharmacy information not available. Please refresh the page.');
    return;
  }
  
  if (!searchTerm) {
    const patients = await getPatients(currentPatientPharmacyId, currentPatientBranchId);
    currentPatientList = patients;
    displayPatients(patients);
    return;
  }
  
  try {
    const results = await searchPatients(currentPatientPharmacyId, searchTerm);
    displayPatients(results);
  } catch (error) {
    console.error('Error searching patients:', error);
    alert('Error searching patients: ' + error.message);
  }
}

function clearPatientSearch() {
  document.getElementById('patient-search').value = '';
  searchPatientList();
}

function openAddPatientModal() {
  document.getElementById('add-patient-modal').style.display = 'block';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

async function savePatient(event) {
  event.preventDefault();
  
  try {
    // Disable submit button to prevent double submission
    const submitBtn = event.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
    
    if (!currentPatientUser) {
      throw new Error('User context not available. Please refresh the page.');
    }
    
    if (!currentPatientPharmacyId) {
      throw new Error('Pharmacy information not found. Please contact your administrator.');
    }
    
    const patient = {
      name: document.getElementById('patient-name')?.value || '',
      phone: document.getElementById('patient-phone')?.value || '',
      email: document.getElementById('patient-email')?.value || null,
      gender: document.getElementById('patient-gender')?.value || null,
      date_of_birth: document.getElementById('patient-dob')?.value || null,
      address: document.getElementById('patient-address')?.value || null,
      patient_id_number: document.getElementById('patient-id-number')?.value || null,
      insurance_provider: document.getElementById('patient-insurance-provider')?.value || null,
      insurance_number: document.getElementById('patient-insurance-number')?.value || null,
      emergency_contact: document.getElementById('patient-emergency-contact')?.value || null,
      emergency_phone: document.getElementById('patient-emergency-phone')?.value || null,
      allergies: document.getElementById('patient-allergies')?.value || null,
      medical_notes: document.getElementById('patient-medical-notes')?.value || null,
      pharmacy_id: currentPatientPharmacyId,
      branch_id: currentPatientBranchId,
      is_active: true,
      created_at: new Date().toISOString()
    };
    
    // Validate required fields
    if (!patient.name || !patient.phone) {
      throw new Error('Name and Phone are required fields');
    }
    
    const savedPatient = await createPatient(patient);
    
    if (savedPatient && savedPatient.id) {
      alert('Patient registered successfully!');
      closeModal('add-patient-modal');
      
      // Clear form
      document.getElementById('patient-name').value = '';
      document.getElementById('patient-phone').value = '';
      document.getElementById('patient-email').value = '';
      document.getElementById('patient-gender').value = '';
      document.getElementById('patient-dob').value = '';
      document.getElementById('patient-address').value = '';
      document.getElementById('patient-id-number').value = '';
      document.getElementById('patient-insurance-provider').value = '';
      document.getElementById('patient-insurance-number').value = '';
      document.getElementById('patient-emergency-contact').value = '';
      document.getElementById('patient-emergency-phone').value = '';
      document.getElementById('patient-allergies').value = '';
      document.getElementById('patient-medical-notes').value = '';
      
      // Reload patient list
      const patients = await getPatients(currentPatientPharmacyId, currentPatientBranchId);
      currentPatientList = patients;
      displayPatients(patients);
    } else {
      throw new Error('Failed to save patient - no ID returned from database');
    }
    
  } catch (error) {
    console.error('Error saving patient:', error);
    alert('Error saving patient: ' + error.message);
  } finally {
    // Re-enable submit button
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register Patient';
    }
  }
}

async function openPatientDetails(patientId) {
  try {
    const patient = await getPatientDetails(patientId);
    const visits = await getPatientVisits(patientId);
    const payments = await getTreatmentPayments(patientId);
    
    // Populate overview tab
    document.getElementById('modal-patient-name').textContent = patient.name;
    document.getElementById('detail-name').textContent = patient.name;
    document.getElementById('detail-phone').textContent = patient.phone;
    document.getElementById('detail-email').textContent = patient.email || '-';
    document.getElementById('detail-age').textContent = patient.age || '-';
    document.getElementById('detail-gender').textContent = patient.gender || '-';
    document.getElementById('detail-insurance').textContent = patient.insurance_provider || '-';
    document.getElementById('detail-address').textContent = patient.address || '-';
    document.getElementById('detail-allergies').textContent = patient.allergies || 'None known';
    document.getElementById('detail-medical-notes').textContent = patient.medical_notes || '-';
    
    // Calculate and display summary stats
    document.getElementById('total-visits').textContent = visits.length;
    const lastVisit = visits.length > 0 ? new Date(visits[0].visit_date).toLocaleDateString() : '-';
    document.getElementById('last-visit').textContent = lastVisit;
    const totalPayments = payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    document.getElementById('total-payments').textContent = '₦' + totalPayments.toFixed(2);
    
    // Store patient ID for later use
    document.getElementById('patient-details-modal').dataset.patientId = patientId;
    
    // Load visits with doctor info
    if (visits.length > 0) {
      document.getElementById('visits-list').innerHTML = visits.map(v => `
        <div class="visit-item">
          <div class="visit-date">${new Date(v.visit_date).toLocaleDateString()}</div>
          <div class="visit-details">
            <strong>Doctor:</strong> ${v.doctor_name || 'N/A'} ${v.doctor_specialty ? '(' + v.doctor_specialty + ')' : ''}<br>
            <strong>Symptoms:</strong> ${v.symptoms}<br>
            <strong>Diagnosis:</strong> ${v.diagnosis}<br>
            <strong>Notes:</strong> ${v.notes || '-'}
          </div>
        </div>
      `).join('');
    } else {
      document.getElementById('visits-list').innerHTML = '<p>No visits recorded yet</p>';
    }
    
    // Load treatments/payments
    if (payments.length > 0) {
      document.getElementById('treatments-list').innerHTML = payments.map(p => `
        <div class="treatment-item">
          <div class="treatment-date">${new Date(p.payment_date).toLocaleDateString()}</div>
          <div class="treatment-details">
            <strong>Payment #:</strong> ${p.payment_number}<br>
            <strong>Description:</strong> ${p.description}<br>
            <strong>Amount:</strong> ₦${parseFloat(p.amount).toFixed(2)}<br>
            <strong>Method:</strong> ${p.payment_method.replace('_', ' ').toUpperCase()}<br>
            ${p.notes ? '<strong>Notes:</strong> ' + p.notes + '<br>' : ''}
          </div>
        </div>
      `).join('');
    } else {
      document.getElementById('treatments-list').innerHTML = '<p>No treatments recorded yet</p>';
    }
    
    // Populate payments list
    document.getElementById('payments-list').innerHTML = payments.length > 0 
      ? `<table class="data-table">
          <thead>
            <tr>
              <th>Payment #</th>
              <th>Date</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            ${payments.map(p => `
              <tr>
                <td>${p.payment_number}</td>
                <td>${new Date(p.payment_date).toLocaleDateString()}</td>
                <td>${p.description}</td>
                <td>₦${parseFloat(p.amount).toFixed(2)}</td>
                <td>${p.payment_method.replace('_', ' ').toUpperCase()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      : '<p>No payments recorded</p>';
    
    // Load visits for the treatment payment modal dropdown
    const visitSelect = document.getElementById('payment-visit-id');
    if (visitSelect && visits.length > 0) {
      visitSelect.innerHTML = '<option value="">-- Select a visit --</option>' + visits.map(v => `
        <option value="${v.id}">${new Date(v.visit_date).toLocaleDateString()} - ${v.doctor_name || 'Visit'}</option>
      `).join('');
    }
    
    // Set default date to today
    document.getElementById('payment-date').valueAsDate = new Date();
    
    document.getElementById('patient-details-modal').style.display = 'block';
    
  } catch (error) {
    console.error('Error loading patient details:', error);
    alert('Error: ' + error.message);
  }
}

function openAddVisitModal() {
  document.getElementById('add-visit-modal').style.display = 'block';
}

function openTreatmentPaymentModal() {
  document.getElementById('treatment-payment-modal').style.display = 'block';
}

async function saveTreatmentPayment(event) {
  event.preventDefault();
  
  try {
    const submitBtn = event.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
    
    const patientId = document.getElementById('patient-details-modal').dataset.patientId;
    
    if (!patientId) {
      throw new Error('Patient ID not found');
    }
    
    const visitId = document.getElementById('payment-visit-id').value;
    if (!visitId) {
      throw new Error('Please select a visit');
    }
    
    if (!currentPatientUser) {
      throw new Error('User context not available');
    }
    
    const payment = {
      visit_id: visitId,
      patient_id: patientId,
      amount: document.getElementById('payment-amount').value,
      payment_method: document.getElementById('payment-method').value,
      description: document.getElementById('payment-description').value,
      payment_date: document.getElementById('payment-date').value,
      recorded_by: currentPatientUser.id,
      notes: document.getElementById('payment-notes').value || null,
      pharmacy_id: currentPatientPharmacyId,
      branch_id: currentPatientBranchId
    };
    
    await createTreatmentPayment(payment);
    
    alert('Treatment payment recorded successfully!');
    closeModal('treatment-payment-modal');
    // Reload the patient details
    openPatientDetails(patientId);
    
  } catch (error) {
    console.error('Error saving treatment payment:', error);
    alert('Error: ' + error.message);
  } finally {
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Record Payment';
    }
  }
}

async function savePatientVisit(event) {
  event.preventDefault();
  
  try {
    const submitBtn = event.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
    
    const patientId = document.getElementById('patient-details-modal').dataset.patientId;
    
    if (!patientId) {
      throw new Error('Patient ID not found');
    }
    
    if (!currentPatientUser) {
      throw new Error('User context not available');
    }
    
    const visit = {
      patient_id: patientId,
      visit_date: new Date().toISOString().split('T')[0],
      doctor_name: document.getElementById('visit-doctor-name').value,
      doctor_specialty: document.getElementById('visit-doctor-specialty').value || null,
      symptoms: document.getElementById('visit-symptoms').value,
      diagnosis: document.getElementById('visit-diagnosis').value,
      notes: document.getElementById('visit-notes').value,
      visited_by: currentPatientUser.id,
      pharmacy_id: currentPatientPharmacyId,
      branch_id: currentPatientBranchId
    };
    
    await createPatientVisit(visit);
    
    alert('Visit recorded successfully!');
    closeModal('add-visit-modal');
    // Reload the visits section
    openPatientDetails(patientId);
    
  } catch (error) {
    console.error('Error saving visit:', error);
    alert('Error: ' + error.message);
  } finally {
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Record Visit';
    }
  }
}

function switchPatientTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(tabName + '-tab').style.display = 'block';
  event.target.classList.add('active');
}

function editPatient() {
  alert('Open edit patient form');
  // TODO: Implement edit functionality
}

function editPatientForm(patientId) {
  alert('Edit patient: ' + patientId);
  // TODO: Implement edit patient modal
}

function getCurrentPharmacyId() {
  return currentPatientPharmacyId || '';
}

// Export functions globally for onclick handlers
window.openAddPatientModal = openAddPatientModal;
window.closeModal = closeModal;
window.savePatient = savePatient;
window.openPatientDetails = openPatientDetails;
window.openAddVisitModal = openAddVisitModal;
window.openTreatmentPaymentModal = openTreatmentPaymentModal;
window.saveTreatmentPayment = saveTreatmentPayment;
window.savePatientVisit = savePatientVisit;
window.switchPatientTab = switchPatientTab;
window.editPatient = editPatient;
window.editPatientForm = editPatientForm;
window.searchPatientList = searchPatientList;
window.clearPatientSearch = clearPatientSearch;
window.displayPatients = displayPatients;

// Make functions globally accessible for onclick handlers
window.openAddPatientModal = openAddPatientModal;
window.closeModal = closeModal;
window.openPatientDetails = openPatientDetails;
window.openAddVisitModal = openAddVisitModal;
window.openTreatmentPaymentModal = openTreatmentPaymentModal;
window.switchPatientTab = switchPatientTab;
window.editPatient = editPatient;
