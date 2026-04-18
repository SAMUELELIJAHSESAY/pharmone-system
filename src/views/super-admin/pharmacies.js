import { getPharmacies, createPharmacy, updatePharmacy } from '../../database.js';
import { signUp } from '../../auth.js';
import { formatDate, showToast, showConfirm } from '../../utils.js';
import { createModal } from '../../components/modal.js';
import { supabase } from '../../config.js';

export async function renderPharmacies(container, user) {
  try {
    const pharmacies = await getPharmacies();

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">Pharmacies</div>
            <div class="page-subtitle">Manage all registered pharmacies on the platform</div>
          </div>
          <button class="btn btn-primary" id="add-pharmacy-btn">+ New Pharmacy</button>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">All Pharmacies (${pharmacies.length})</span>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="pharmacies-tbody">
                ${renderRows(pharmacies)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('add-pharmacy-btn').addEventListener('click', showAddPharmacyModal);
    bindRowActions(pharmacies, user);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load pharmacies: ${err.message}</div>`;
  }
}

function renderRows(pharmacies) {
  if (!pharmacies.length) return `
    <tr><td colspan="6">
      <div class="empty-state">
        <div class="empty-state-icon">&#127978;</div>
        <div class="empty-state-title">No pharmacies yet</div>
        <div class="empty-state-desc">Click "New Pharmacy" to add the first one</div>
      </div>
    </td></tr>
  `;
  return pharmacies.map(p => `
    <tr>
      <td><span class="font-semibold">${p.name}</span></td>
      <td class="text-sm text-muted">${p.email || '—'}</td>
      <td class="text-sm text-muted">${p.phone || '—'}</td>
      <td><span class="badge ${p.is_active ? 'badge-success' : 'badge-danger'}">${p.is_active ? 'Active' : 'Disabled'}</span></td>
      <td class="text-sm text-muted">${formatDate(p.created_at)}</td>
      <td>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm edit-pharmacy-btn" data-id="${p.id}" data-pharmacy='${JSON.stringify(p)}'>
            Edit
          </button>
          <button class="btn btn-ghost btn-sm toggle-status-btn" data-id="${p.id}" data-active="${p.is_active}">
            ${p.is_active ? 'Disable' : 'Enable'}
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function bindRowActions(pharmacies, user) {
  // Edit button handlers
  document.querySelectorAll('.edit-pharmacy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pharmacy = JSON.parse(btn.dataset.pharmacy);
      showEditPharmacyModal(pharmacy, () => {
        import('../app.js').then(m => m.navigate('pharmacies'));
      });
    });
  });

  // Toggle status button handlers
  document.querySelectorAll('.toggle-status-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const isActive = btn.dataset.active === 'true';
      const confirmed = await showConfirm(`Are you sure you want to ${isActive ? 'disable' : 'enable'} this pharmacy?`);
      if (!confirmed) return;
      try {
        await updatePharmacy(id, { is_active: !isActive });
        showToast(`Pharmacy ${isActive ? 'disabled' : 'enabled'} successfully`);
        import('../app.js').then(m => m.navigate('pharmacies'));
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

export function showAddPharmacyModal() {
  const { overlay, closeModal } = createModal({
    id: 'add-pharmacy',
    title: 'Add New Pharmacy',
    body: `
      <form id="add-pharmacy-form">
        <div class="form-group">
          <label class="form-label">Pharmacy Name *</label>
          <input type="text" class="form-input" id="p-name" placeholder="City Health Pharmacy" required />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="p-email" placeholder="pharmacy@example.com" />
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="text" class="form-input" id="p-phone" placeholder="+1 555 0000" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" class="form-input" id="p-address" placeholder="123 Main St, City" />
        </div>
        <hr class="divider" />
        <p class="text-sm font-semibold" style="margin-bottom:0.75rem;color:var(--gray-700)">Admin Account</p>
        <div class="form-group">
          <label class="form-label">Admin Full Name *</label>
          <input type="text" class="form-input" id="p-admin-name" placeholder="John Smith" required />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Admin Email *</label>
            <input type="email" class="form-input" id="p-admin-email" required placeholder="admin@pharmacy.com" />
          </div>
          <div class="form-group">
            <label class="form-label">Password *</label>
            <input type="password" class="form-input" id="p-admin-pass" required placeholder="Min 8 chars" minlength="8" />
          </div>
        </div>
        <div id="pharmacy-form-error" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-pharmacy">Cancel</button>
      <button class="btn btn-primary" id="save-pharmacy">Create Pharmacy</button>
    `
  });

  overlay.querySelector('#cancel-pharmacy').addEventListener('click', closeModal);

  overlay.querySelector('#save-pharmacy').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-pharmacy');
    const errEl = overlay.querySelector('#pharmacy-form-error');
    errEl.classList.add('hidden');

    const name = overlay.querySelector('#p-name').value.trim();
    const email = overlay.querySelector('#p-email').value.trim();
    const phone = overlay.querySelector('#p-phone').value.trim();
    const address = overlay.querySelector('#p-address').value.trim();
    const adminName = overlay.querySelector('#p-admin-name').value.trim();
    const adminEmail = overlay.querySelector('#p-admin-email').value.trim();
    const adminPass = overlay.querySelector('#p-admin-pass').value;

    if (!name || !adminName || !adminEmail || !adminPass) {
      errEl.textContent = 'Please fill all required fields.';
      errEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Creating...';

    try {
      const pharmacy = await createPharmacy({ name, email, phone, address });
      await signUp(adminEmail, adminPass, adminName, 'admin', pharmacy.id);
      const { getCurrentUser } = await import('../../auth.js');
      const currentUser = await getCurrentUser();
      if (currentUser) await updatePharmacy(pharmacy.id, { owner_id: currentUser.id });
      showToast('Pharmacy created successfully!');
      closeModal();
      import('../app.js').then(m => m.navigate('pharmacies'));
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Create Pharmacy';
    }
  });
}

export function showEditPharmacyModal(pharmacy, onSave) {
  const { overlay, closeModal } = createModal({
    id: 'edit-pharmacy',
    title: 'Edit Pharmacy Information',
    body: `
      <form id="edit-pharmacy-form">
        <div class="form-group">
          <label class="form-label">Pharmacy Name *</label>
          <input type="text" class="form-input" id="ep-name" value="${pharmacy.name}" required />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="ep-email" value="${pharmacy.email || ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="text" class="form-input" id="ep-phone" value="${pharmacy.phone || ''}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" class="form-input" id="ep-address" value="${pharmacy.address || ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Currency Code</label>
          <input type="text" class="form-input" id="ep-currency" value="${pharmacy.currency_code || 'USD'}" placeholder="USD" />
        </div>
        <div class="form-group">
          <label class="form-label">Currency Symbol</label>
          <input type="text" class="form-input" id="ep-symbol" value="${pharmacy.currency_symbol || '$'}" placeholder="$" />
        </div>
        <div id="edit-pharmacy-error" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-edit-pharmacy">Cancel</button>
      <button class="btn btn-primary" id="save-edit-pharmacy">Save Changes</button>
    `
  });

  overlay.querySelector('#cancel-edit-pharmacy').addEventListener('click', closeModal);

  overlay.querySelector('#save-edit-pharmacy').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-edit-pharmacy');
    const errEl = overlay.querySelector('#edit-pharmacy-error');
    errEl.classList.add('hidden');

    const name = overlay.querySelector('#ep-name').value.trim();
    const email = overlay.querySelector('#ep-email').value.trim();
    const phone = overlay.querySelector('#ep-phone').value.trim();
    const address = overlay.querySelector('#ep-address').value.trim();
    const currencyCode = overlay.querySelector('#ep-currency').value.trim();
    const currencySymbol = overlay.querySelector('#ep-symbol').value.trim();

    if (!name) {
      errEl.textContent = 'Pharmacy name is required.';
      errEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      await updatePharmacy(pharmacy.id, { 
        name, 
        email, 
        phone, 
        address,
        currency_code: currencyCode,
        currency_symbol: currencySymbol
      });
      showToast('Pharmacy updated successfully!');
      closeModal();
      onSave();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });
}
