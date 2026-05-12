import { getSalesmanFeatures, updateSalesmanFeatures } from '../../database.js';
import { showToast, showConfirm } from '../../utils.js';
import { createModal } from '../../components/modal.js';

/**
 * Admin panel to control which features salesman can see
 * Features that can be toggled:
 * - pos: Point of Sale
 * - customers: Customers management
 * - patients: Patient registration
 * - expenses: Expenses tracking
 * - returns_request: Return requests
 * - dashboard: Salesman dashboard
 * - sales_history: Sales history view
 * - daily_records: Daily records/reports
 */
export async function renderSalesmanFeatures(container, user) {
  if (user.profile?.role !== 'admin') {
    container.innerHTML = `<div class="alert alert-danger">Access denied. Only admins can manage salesman features.</div>`;
    return;
  }

  try {
    const pharmacyId = user.profile.pharmacy_id;
    const features = await getSalesmanFeatures(pharmacyId);
    
    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">Salesman Features</div>
            <div class="page-subtitle">Control which features are visible to salesman users in your pharmacy</div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <span class="card-title">Feature Controls</span>
              <span class="badge badge-primary">Production Ready</span>
            </div>
            <div class="card-body">
              <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <!-- Sales Section -->
                <div style="border-bottom: 1px solid var(--gray-200); padding-bottom: 1rem;">
                  <div class="text-sm font-semibold" style="margin-bottom: 1rem; color: var(--gray-700); text-transform: uppercase; letter-spacing: 0.05em;">Sales</div>
                  
                  <div class="feature-toggle-item">
                    <div>
                      <div class="feature-name">Point of Sale</div>
                      <div class="feature-desc">Allow salesman to process customer transactions</div>
                    </div>
                    <label class="toggle">
                      <input type="checkbox" class="feature-toggle" data-feature="pos" ${features.pos ? 'checked' : ''} />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>

                  <div class="feature-toggle-item">
                    <div>
                      <div class="feature-name">Dashboard</div>
                      <div class="feature-desc">Show salesman their personal dashboard with overview stats</div>
                    </div>
                    <label class="toggle">
                      <input type="checkbox" class="feature-toggle" data-feature="dashboard" ${features.dashboard ? 'checked' : ''} />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>

                  <div class="feature-toggle-item">
                    <div>
                      <div class="feature-name">Sales History</div>
                      <div class="feature-desc">Allow salesman to view their transaction history</div>
                    </div>
                    <label class="toggle">
                      <input type="checkbox" class="feature-toggle" data-feature="sales_history" ${features.sales_history ? 'checked' : ''} />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>

                  <div class="feature-toggle-item">
                    <div>
                      <div class="feature-name">Daily Records</div>
                      <div class="feature-desc">Show daily sales reports and records</div>
                    </div>
                    <label class="toggle">
                      <input type="checkbox" class="feature-toggle" data-feature="daily_records" ${features.daily_records ? 'checked' : ''} />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>

                <!-- Management Section -->
                <div style="border-bottom: 1px solid var(--gray-200); padding-bottom: 1rem;">
                  <div class="text-sm font-semibold" style="margin-bottom: 1rem; color: var(--gray-700); text-transform: uppercase; letter-spacing: 0.05em;">Management</div>
                  
                  <div class="feature-toggle-item">
                    <div>
                      <div class="feature-name">Customers</div>
                      <div class="feature-desc">Allow salesman to create and manage customers</div>
                    </div>
                    <label class="toggle">
                      <input type="checkbox" class="feature-toggle" data-feature="customers" ${features.customers ? 'checked' : ''} />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>

                <!-- Clinic Section -->
                <div style="border-bottom: 1px solid var(--gray-200); padding-bottom: 1rem;">
                  <div class="text-sm font-semibold" style="margin-bottom: 1rem; color: var(--gray-700); text-transform: uppercase; letter-spacing: 0.05em;">Clinic</div>
                  
                  <div class="feature-toggle-item">
                    <div>
                      <div class="feature-name">Patients</div>
                      <div class="feature-desc">Allow salesman to register and manage patients</div>
                    </div>
                    <label class="toggle">
                      <input type="checkbox" class="feature-toggle" data-feature="patients" ${features.patients ? 'checked' : ''} />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>

                <!-- Operations Section -->
                <div>
                  <div class="text-sm font-semibold" style="margin-bottom: 1rem; color: var(--gray-700); text-transform: uppercase; letter-spacing: 0.05em;">Operations</div>
                  
                  <div class="feature-toggle-item">
                    <div>
                      <div class="feature-name">Return Requests</div>
                      <div class="feature-desc">Allow salesman to handle product returns</div>
                    </div>
                    <label class="toggle">
                      <input type="checkbox" class="feature-toggle" data-feature="returns_request" ${features.returns_request ? 'checked' : ''} />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>

                  <div class="feature-toggle-item">
                    <div>
                      <div class="feature-name">Expenses</div>
                      <div class="feature-desc">Allow salesman to record and track expenses</div>
                    </div>
                    <label class="toggle">
                      <input type="checkbox" class="feature-toggle" data-feature="expenses" ${features.expenses ? 'checked' : ''} />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Information</span>
            </div>
            <div class="card-body">
              <div style="background: var(--blue-50); border: 1px solid var(--blue-200); border-radius: var(--radius-sm); padding: 1rem; margin-bottom: 1rem;">
                <div style="font-weight: 600; color: var(--blue-900); margin-bottom: 0.5rem">💡 Quick Tips</div>
                <ul style="margin: 0; padding-left: 1.5rem; color: var(--blue-800); font-size: 0.9rem; line-height: 1.6;">
                  <li>Changes apply immediately to all salesman accounts</li>
                  <li>Disabled features won't appear in the salesman menu</li>
                  <li>Salesman cannot bypass disabled features by direct URL</li>
                  <li>Use "Point of Sale" as the main feature for salesman</li>
                </ul>
              </div>

              <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-sm); padding: 1rem;">
                <div style="font-weight: 600; color: var(--gray-900); margin-bottom: 0.5rem">Default Configuration</div>
                <div style="font-size: 0.9rem; color: var(--gray-700); line-height: 1.6;">
                  <p>All features are enabled by default. You can customize this based on your pharmacy's workflow.</p>
                  <p style="margin-bottom: 0;"><strong>Recommended for basic salesman:</strong> Enable only POS, Customers, Patients, and Expenses. Disable Dashboard, Sales History, and Daily Records.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style="margin-top: 2rem; display: flex; gap: 1rem; justify-content: flex-end;">
          <button class="btn btn-ghost" id="reset-features-btn">Reset to Defaults</button>
          <button class="btn btn-primary" id="save-features-btn">Save Changes</button>
        </div>
      </div>
    `;

    bindFeatureToggleEvents(container, user.profile.pharmacy_id, features);
  } catch (err) {
    console.error('Error rendering salesman features:', err);
    container.innerHTML = `<div class="alert alert-danger">Failed to load salesman features: ${err.message}</div>`;
  }
}

function bindFeatureToggleEvents(container, pharmacyId, initialFeatures) {
  const saveBtn = container.querySelector('#save-features-btn');
  const resetBtn = container.querySelector('#reset-features-btn');
  const toggles = container.querySelectorAll('.feature-toggle');

  // Track changes
  let hasChanges = false;
  toggles.forEach(toggle => {
    toggle.addEventListener('change', () => {
      hasChanges = true;
      saveBtn.textContent = 'Save Changes ●';
      saveBtn.style.fontWeight = '600';
    });
  });

  saveBtn.addEventListener('click', async () => {
    if (!hasChanges) {
      showToast('No changes to save');
      return;
    }

    // Collect current feature states
    const features = {};
    toggles.forEach(toggle => {
      features[toggle.dataset.feature] = toggle.checked;
    });

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      await updateSalesmanFeatures(pharmacyId, features);
      showToast('✓ Salesman features updated successfully', 'success');
      hasChanges = false;
      saveBtn.textContent = 'Save Changes';
      saveBtn.style.fontWeight = 'normal';
    } catch (err) {
      console.error('Error updating features:', err);
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  resetBtn.addEventListener('click', async () => {
    const confirmed = await showConfirm('Reset all salesman features to defaults? All features will be enabled.');
    if (!confirmed) return;

    const defaultFeatures = {
      pos: true,
      customers: true,
      patients: true,
      expenses: true,
      returns_request: true,
      dashboard: true,
      sales_history: true,
      daily_records: true
    };

    toggles.forEach(toggle => {
      toggle.checked = defaultFeatures[toggle.dataset.feature] !== false;
    });

    hasChanges = true;
    saveBtn.textContent = 'Save Changes ●';
    saveBtn.style.fontWeight = '600';
    showToast('All features reset to defaults. Click "Save Changes" to apply.');
  });
}
