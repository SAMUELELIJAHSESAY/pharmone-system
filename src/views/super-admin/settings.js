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
          <input type="url" class="form-input" id="logo-url" value="${pharmacy.logo_url || ''}" placeholder="https://example.com/logo.png" />
          <small style="color: var(--gray-500)">Enter the full URL to your pharmacy logo image</small>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Branding Color</label>
            <div style="display:flex;gap:0.5rem;align-items:center">
              <input type="color" class="form-input" id="branding-color" value="${pharmacy.branding_color || '#1976d2'}" style="width:60px;height:40px;padding:2px;cursor:pointer" />
              <span id="color-display" class="text-sm text-muted" style="font-family:monospace;font-weight:500">${(pharmacy.branding_color || '#1976d2').toUpperCase()}</span>
            </div>
            <small style="color: var(--gray-500)">This color is used throughout the application UI</small>
          </div>
          <div class="form-group">
            <label class="form-label">Currency Code</label>
            <select class="form-select" id="currency-code">
              <option value="USD" ${pharmacy.currency_code === 'USD' ? 'selected' : ''}>USD (United States Dollar)</option>
              <option value="EUR" ${pharmacy.currency_code === 'EUR' ? 'selected' : ''}>EUR (Euro)</option>
              <option value="GBP" ${pharmacy.currency_code === 'GBP' ? 'selected' : ''}>GBP (British Pound)</option>
              <option value="SLL" ${pharmacy.currency_code === 'SLL' ? 'selected' : ''}>SLL (Sierra Leonean Leone)</option>
              <option value="NGN" ${pharmacy.currency_code === 'NGN' ? 'selected' : ''}>NGN (Nigerian Naira)</option>
              <option value="ZAR" ${pharmacy.currency_code === 'ZAR' ? 'selected' : ''}>ZAR (South African Rand)</option>
            </select>
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Currency Symbol</label>
            <input type="text" class="form-input" id="currency-symbol" value="${pharmacy.currency_symbol || '$'}" placeholder="$" maxlength="3" />
            <small style="color: var(--gray-500)">Symbol displayed in all prices (e.g., $, €, £, Le)</small>
          </div>
          <div class="form-group">
            <label class="form-label">Discount Enabled</label>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem">
              <input type="checkbox" id="discount-enabled" ${pharmacy.discount_enabled ? 'checked' : ''} style="cursor:pointer;width:18px;height:18px" />
              <label for="discount-enabled" style="cursor:pointer;margin:0">Allow staff to apply discounts</label>
            </div>
          </div>
        </div>

        <div class="card" style="background:var(--gray-50);border:1px solid var(--gray-200);padding:1rem;margin:1.5rem 0;border-radius:var(--radius-sm)">
          <div class="card-title" style="margin-bottom:1rem;font-weight:600">Tax Settings</div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Tax Enabled</label>
              <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem">
                <input type="checkbox" id="tax-enabled" ${pharmacy.tax_enabled ? 'checked' : ''} style="cursor:pointer;width:18px;height:18px" />
                <label for="tax-enabled" style="cursor:pointer;margin:0">Enable automatic tax calculation</label>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Tax Rate (%)</label>
              <input type="number" class="form-input" id="tax-rate" value="${pharmacy.tax_rate || 0}" min="0" max="100" step="0.01" placeholder="0.00" />
              <small style="color: var(--gray-500)">Tax percentage applied to all sales</small>
            </div>
          </div>
        </div>

        <div class="card" style="background:var(--gray-50);border:1px solid var(--gray-200);padding:1rem;margin:1.5rem 0;border-radius:var(--radius-sm)">
          <div class="card-title" style="margin-bottom:1rem;font-weight:600">Discount Rules</div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Max Discount (%)</label>
              <input type="number" class="form-input" id="max-discount" value="${pharmacy.discount_rules?.max_discount || 10}" min="0" max="100" step="0.01" />
              <small style="color: var(--gray-500)">Maximum discount allowed per transaction</small>
            </div>
            <div class="form-group">
              <label class="form-label">Min Cart Amount</label>
              <input type="number" class="form-input" id="min-cart-amount" value="${pharmacy.discount_rules?.min_cart_amount || 0}" min="0" step="0.01" />
              <small style="color: var(--gray-500)">Minimum sale amount to qualify for discount</small>
            </div>
          </div>
        </div>

        <div class="form-actions" style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--gray-200)">
          <button type="button" class="btn btn-ghost" id="cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary" id="save-btn">Save Settings</button>
        </div>
      </form>
    `
  });

  // Setup color picker live preview
  const colorInput = document.getElementById('branding-color');
  const colorDisplay = document.getElementById('color-display');
  if (colorInput && colorDisplay) {
    colorInput.addEventListener('input', (e) => {
      colorDisplay.textContent = e.target.value.toUpperCase();
    });
  }

  // Setup event listeners
  const cancelBtn = document.getElementById('cancel-btn');
  const settingsForm = document.getElementById('settings-form');
  const saveBtn = document.getElementById('save-btn');

  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeModal);
  }

  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Disable submit button to prevent double submission
      if (saveBtn) saveBtn.disabled = true;

      const logoUrl = document.getElementById('logo-url')?.value || '';
      const brandingColor = document.getElementById('branding-color')?.value || '#1976d2';
      const currencyCode = document.getElementById('currency-code')?.value || 'USD';
      const currencySymbol = document.getElementById('currency-symbol')?.value || '$';
      const discountEnabled = document.getElementById('discount-enabled')?.checked || false;
      const taxEnabled = document.getElementById('tax-enabled')?.checked || false;
      const taxRate = parseFloat(document.getElementById('tax-rate')?.value) || 0;
      const maxDiscount = parseFloat(document.getElementById('max-discount')?.value) || 10;
      const minCartAmount = parseFloat(document.getElementById('min-cart-amount')?.value) || 0;

      // Validate inputs
      if (!brandingColor.match(/^#[0-9A-F]{6}$/i)) {
        showToast('Invalid branding color format', 'error');
        if (saveBtn) saveBtn.disabled = false;
        return;
      }

      if (taxRate < 0 || taxRate > 100) {
        showToast('Tax rate must be between 0 and 100', 'error');
        if (saveBtn) saveBtn.disabled = false;
        return;
      }

      if (maxDiscount < 0 || maxDiscount > 100) {
        showToast('Max discount must be between 0 and 100', 'error');
        if (saveBtn) saveBtn.disabled = false;
        return;
      }

      const settings = {
        logo_url: logoUrl,
        branding_color: brandingColor,
        currency_code: currencyCode,
        currency_symbol: currencySymbol,
        discount_enabled: discountEnabled,
        tax_enabled: taxEnabled,
        tax_rate: taxRate,
        discount_rules: {
          max_discount: maxDiscount,
          min_cart_amount: minCartAmount
        }
      };

      try {
        await updatePharmacySettings(pharmacy.id, settings);
        showToast('✓ Settings updated successfully', 'success');
        
        // Update the local array
        const index = allPharmacies.findIndex(p => p.id === pharmacy.id);
        if (index !== -1) {
          allPharmacies[index] = { ...allPharmacies[index], ...settings };
        }

        // Close modal and refresh
        closeModal();
        
        // Re-render the view
        setTimeout(() => {
          const pageContent = document.getElementById('page-content');
          if (pageContent) {
            renderView(pageContent, user);
          }
        }, 300);
      } catch (err) {
        console.error('Settings update error:', err);
        showToast('✗ Failed to update settings: ' + (err.message || 'Unknown error'), 'error');
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }
}
