import { getPharmacies, updatePharmacySettings } from '../../database.js';
import { showToast, showConfirm } from '../../utils.js';
import { createModal } from '../../components/modal.js';

let allPharmacies = [];

export async function renderSettings(container, user) {
  if (user.profile?.role !== 'super_admin') {
    container.innerHTML = `<div class="alert alert-danger">Access denied. Only super admins can manage settings.</div>`;
    return;
  }

  try {
    allPharmacies = await getPharmacies();
    renderView(container, user);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load pharmacies: ${err.message}</div>`;
  }
}

function renderView(container, user) {
  container.innerHTML = `
    <div class="animate-in">
      <div class="page-header">
        <div>
          <div class="page-title">Pharmacy Settings</div>
          <div class="page-subtitle">Configure branding, currency, tax, and discount for each pharmacy</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Pharmacies</span>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Pharmacy Name</th>
                <th>Currency</th>
                <th>Tax Rate</th>
                <th>Branding Color</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${renderPharmacyRows(allPharmacies)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  bindActions(container, user);
}

function renderPharmacyRows(pharmacies) {
  if (!pharmacies.length) return `<tr><td colspan="5"><div class="empty-state"><div class="empty-state-title">No pharmacies found</div></div></td></tr>`;

  return pharmacies.map(p => `
    <tr>
      <td>
        <div class="font-semibold">${p.name}</div>
        <div class="text-xs text-muted">${p.address || '—'}</div>
      </td>
      <td><span class="badge badge-gray">${p.currency_code} ${p.currency_symbol}</span></td>
      <td><span class="badge ${p.tax_enabled ? 'badge-success' : 'badge-gray'}">${p.tax_enabled ? p.tax_rate + '%' : 'Disabled'}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:0.5rem">
          <div style="width:24px;height:24px;border-radius:50%;background:${p.branding_color || '#1976d2'};border:1px solid #ddd"></div>
          <span class="text-xs">${p.branding_color || '#1976d2'}</span>
        </div>
      </td>
      <td>
        <button class="btn btn-ghost btn-sm edit-pharmacy-btn" data-id="${p.id}">Edit Settings</button>
      </td>
    </tr>
  `).join('');
}

function bindActions(container, user) {
  document.querySelectorAll('.edit-pharmacy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pharmacyId = btn.dataset.id;
      const pharmacy = allPharmacies.find(p => p.id === pharmacyId);
      if (pharmacy) showSettingsModal(pharmacy, user);
    });
  });
}

function showSettingsModal(pharmacy, user) {
  const { overlay, closeModal } = createModal({
    id: 'pharmacy-settings-modal',
    title: `Settings: ${pharmacy.name}`,
    size: 'modal-lg',
    body: `
      <form id="settings-form">
        <div class="form-group">
          <label class="form-label">Pharmacy Logo URL</label>
          <input type="url" class="form-input" id="logo-url" value="${pharmacy.logo_url || ''}" placeholder="https://..." />
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Branding Color</label>
            <div style="display:flex;gap:0.5rem;align-items:center">
              <input type="color" class="form-input" id="branding-color" value="${pharmacy.branding_color || '#1976d2'}" style="width:60px;height:40px;padding:2px" />
              <span id="color-display" class="text-sm text-muted">${pharmacy.branding_color || '#1976d2'}</span>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Currency Code</label>
            <select class="form-select" id="currency-code">
              <option value="USD" ${pharmacy.currency_code === 'USD' ? 'selected' : ''}>USD ($)</option>
              <option value="EUR" ${pharmacy.currency_code === 'EUR' ? 'selected' : ''}>EUR (€)</option>
              <option value="GBP" ${pharmacy.currency_code === 'GBP' ? 'selected' : ''}>GBP (£)</option>
              <option value="SLL" ${pharmacy.currency_code === 'SLL' ? 'selected' : ''}>SLL (Le)</option>
              <option value="NGN" ${pharmacy.currency_code === 'NGN' ? 'selected' : ''}>NGN (₦)</option>
              <option value="ZAR" ${pharmacy.currency_code === 'ZAR' ? 'selected' : ''}>ZAR (R)</option>
            </select>
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Currency Symbol</label>
            <input type="text" class="form-input" id="currency-symbol" value="${pharmacy.currency_symbol || '$'}" placeholder="$" maxlength="3" />
          </div>
          <div class="form-group">
            <label class="form-label">Discount Enabled</label>
            <div style="display:flex;align-items:center;gap:0.5rem">
              <input type="checkbox" id="discount-enabled" ${pharmacy.discount_enabled ? 'checked' : ''} />
              <span class="text-sm">Allow discounts</span>
            </div>
          </div>
        </div>

        <div class="card" style="background:var(--gray-50);border:1px solid var(--gray-200);padding:1rem;margin:1rem 0">
          <div class="card-title" style="margin-bottom:1rem">Tax Settings</div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Tax Enabled</label>
              <div style="display:flex;align-items:center;gap:0.5rem">
                <input type="checkbox" id="tax-enabled" ${pharmacy.tax_enabled ? 'checked' : ''} />
                <span class="text-sm">Enable tax calculation</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Tax Rate (%)</label>
              <input type="number" class="form-input" id="tax-rate" value="${pharmacy.tax_rate || 0}" min="0" max="100" step="0.01" placeholder="0.00" />
            </div>
          </div>
        </div>

        <div class="card" style="background:var(--gray-50);border:1px solid var(--gray-200);padding:1rem;margin:1rem 0">
          <div class="card-title" style="margin-bottom:1rem">Discount Rules</div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Max Discount (%)</label>
              <input type="number" class="form-input" id="max-discount" value="${pharmacy.discount_rules?.max_discount || 10}" min="0" max="100" step="0.01" />
            </div>
            <div class="form-group">
              <label class="form-label">Min Cart Amount</label>
              <input type="number" class="form-input" id="min-cart-amount" value="${pharmacy.discount_rules?.min_cart_amount || 0}" min="0" step="0.01" />
            </div>
          </div>
        </div>

        <div class="form-actions" style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:2rem">
          <button type="button" class="btn btn-ghost" id="cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Settings</button>
        </div>
      </form>
    `
  });

  const colorInput = document.getElementById('branding-color');
  const colorDisplay = document.getElementById('color-display');
  colorInput?.addEventListener('input', (e) => {
    colorDisplay.textContent = e.target.value.toUpperCase();
  });

  document.getElementById('cancel-btn').addEventListener('click', closeModal);
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const settings = {
      logo_url: document.getElementById('logo-url').value,
      branding_color: document.getElementById('branding-color').value,
      currency_code: document.getElementById('currency-code').value,
      currency_symbol: document.getElementById('currency-symbol').value,
      discount_enabled: document.getElementById('discount-enabled').checked,
      tax_enabled: document.getElementById('tax-enabled').checked,
      tax_rate: parseFloat(document.getElementById('tax-rate').value) || 0,
      discount_rules: {
        max_discount: parseFloat(document.getElementById('max-discount').value) || 10,
        min_cart_amount: parseFloat(document.getElementById('min-cart-amount').value) || 0
      }
    };

    try {
      await updatePharmacySettings(pharmacy.id, settings);
      showToast('Settings updated successfully');
      closeModal();
      allPharmacies = await getPharmacies();
      renderView(document.getElementById('page-content') || document.body, user);
    } catch (err) {
      showToast('Failed to update settings: ' + err.message, 'error');
    }
  });
}
