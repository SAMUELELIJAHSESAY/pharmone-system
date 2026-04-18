import { getBranches, createBranch, updateBranch } from '../../database.js';
import { formatDate, showToast, showConfirm } from '../../utils.js';
import { createModal } from '../../components/modal.js';

export async function renderBranches(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) { container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`; return; }

  try {
    const branches = await getBranches(pharmacyId);
    renderView(container, branches, user);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load branches: ${err.message}</div>`;
  }
}

function renderView(container, branches, user) {
  container.innerHTML = `
    <div class="animate-in">
      <div class="page-header">
        <div>
          <div class="page-title">Branches</div>
          <div class="page-subtitle">Manage your pharmacy locations and feature settings</div>
        </div>
        <button class="btn btn-primary" id="add-branch-btn">+ Add Branch</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem" id="branches-grid">
        ${renderBranchCards(branches)}
      </div>
    </div>
  `;

  const reload = () => renderBranches(container, user);
  document.getElementById('add-branch-btn').addEventListener('click', () => showBranchModal(null, user, reload));
  bindActions(branches, user, reload);
}

function renderBranchCards(branches) {
  if (!branches.length) return `
    <div class="empty-state" style="grid-column:1/-1">
      <div class="empty-state-icon">&#127968;</div>
      <div class="empty-state-title">No branches yet</div>
      <div class="empty-state-desc">Add your first branch location</div>
    </div>
  `;

  return branches.map(b => {
    const features = b.feature_settings || {};
    return `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">${b.name}</div>
            <div class="text-xs text-muted">${b.address || 'No address'}</div>
          </div>
          <div class="flex gap-2">
            <span class="badge ${b.is_active ? 'badge-success' : 'badge-danger'}">${b.is_active ? 'Active' : 'Inactive'}</span>
          </div>
        </div>
        <div class="card-body">
          <p class="text-xs text-muted font-semibold" style="margin-bottom:0.75rem;text-transform:uppercase;letter-spacing:0.05em">Features</p>
          <div>
            ${['inventory', 'sales', 'customers', 'reports'].map(feat => `
              <div class="feature-row">
                <div>
                  <div class="feature-label">${feat.charAt(0).toUpperCase() + feat.slice(1)}</div>
                </div>
                <span class="badge ${features[feat] ? 'badge-success' : 'badge-gray'}">${features[feat] ? 'Enabled' : 'Disabled'}</span>
              </div>
            `).join('')}
          </div>
          <div class="flex gap-2" style="margin-top:1rem">
            <button class="btn btn-primary btn-sm view-branch-btn" data-id="${b.id}" style="flex:1">View Details</button>
            <button class="btn btn-ghost btn-sm edit-branch-btn" data-id="${b.id}" style="flex:1">Edit</button>
            <button class="btn btn-ghost btn-sm toggle-branch-btn" data-id="${b.id}" data-active="${b.is_active}" style="flex:1">
              ${b.is_active ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function bindActions(branches, user, reload) {
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b]));

  document.querySelectorAll('.view-branch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { navigate } = await import('../app.js');
      navigate('branch-details', { 
        branchId: btn.dataset.id, 
        pharmacyId: user.profile.pharmacy_id 
      });
    });
  });

  document.querySelectorAll('.edit-branch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const branch = branchMap[btn.dataset.id];
      if (branch) showBranchModal(branch, user, reload);
    });
  });

  document.querySelectorAll('.toggle-branch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const isActive = btn.dataset.active === 'true';
      const confirmed = await showConfirm(`${isActive ? 'Disable' : 'Enable'} this branch?`);
      if (!confirmed) return;
      try {
        await updateBranch(btn.dataset.id, { is_active: !isActive });
        showToast(`Branch ${isActive ? 'disabled' : 'enabled'}`);
        reload();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function showBranchModal(branch, user, reload) {
  const isEdit = !!branch;
  const features = branch?.feature_settings || { inventory: true, sales: true, customers: true, reports: true };

  const { overlay, closeModal } = createModal({
    id: 'branch-modal',
    title: isEdit ? 'Edit Branch' : 'Add Branch',
    body: `
      <form id="branch-form">
        <div class="form-group">
          <label class="form-label">Branch Name *</label>
          <input type="text" class="form-input" id="branch-name" value="${branch?.name || ''}" placeholder="Main Branch" required />
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" class="form-input" id="branch-addr" value="${branch?.address || ''}" placeholder="123 Health St" />
        </div>
        <hr class="divider" />
        <p class="text-sm font-semibold" style="margin-bottom:0.75rem;color:var(--gray-700)">Feature Settings</p>
        ${['inventory', 'sales', 'customers', 'reports'].map(feat => `
          <div class="feature-row">
            <div>
              <div class="feature-label">${feat.charAt(0).toUpperCase() + feat.slice(1)}</div>
              <div class="feature-desc">Enable/disable ${feat} module</div>
            </div>
            <label class="toggle">
              <input type="checkbox" id="feat-${feat}" ${features[feat] ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
          </div>
        `).join('')}
        <div id="branch-err" class="alert alert-danger hidden" style="margin-top:1rem"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-branch">Cancel</button>
      <button class="btn btn-primary" id="save-branch">${isEdit ? 'Save Changes' : 'Add Branch'}</button>
    `
  });

  overlay.querySelector('#cancel-branch').addEventListener('click', closeModal);
  overlay.querySelector('#save-branch').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-branch');
    const errEl = overlay.querySelector('#branch-err');
    errEl.classList.add('hidden');

    const name = overlay.querySelector('#branch-name').value.trim();
    if (!name) { errEl.textContent = 'Branch name is required.'; errEl.classList.remove('hidden'); return; }

    const featureSettings = {};
    ['inventory', 'sales', 'customers', 'reports'].forEach(feat => {
      featureSettings[feat] = overlay.querySelector(`#feat-${feat}`).checked;
    });

    const payload = {
      name,
      address: overlay.querySelector('#branch-addr').value.trim(),
      feature_settings: featureSettings,
      pharmacy_id: user.profile.pharmacy_id
    };

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      if (isEdit) {
        await updateBranch(branch.id, payload);
        showToast('Branch updated');
      } else {
        await createBranch(payload);
        showToast('Branch added');
      }
      closeModal();
      reload();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Add Branch';
    }
  });
}
