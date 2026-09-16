import { getBranches, createBranch, updateBranch, getBranchDashboard } from '../../database.js';
import { showToast, showConfirm, formatCurrency } from '../../utils.js';
import { createModal } from '../../components/modal.js';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export async function renderBranches(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`;
    return;
  }

  try {
    const branches = await getBranches(pharmacyId);
    renderView(container, branches, user);
    hydrateBranchMetrics(container, branches, pharmacyId);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load branches: ${escapeHtml(err.message)}</div>`;
  }
}

function renderView(container, branches, user) {
  const activeCount = branches.filter(branch => branch.is_active).length;
  const inactiveCount = branches.length - activeCount;

  container.innerHTML = `
    <div class="animate-in admin-branches-page">
      <div class="page-header">
        <div>
          <div class="page-title">Branches</div>
          <div class="page-subtitle">Monitor branch performance, staff, stock and feature settings</div>
        </div>
        <button class="btn btn-primary" id="add-branch-btn">+ Add Branch</button>
      </div>

      <div class="branch-summary-grid">
        <button type="button" class="branch-summary-card is-selected" data-branch-status="all">
          <span>Total Branches</span><strong>${branches.length}</strong>
        </button>
        <button type="button" class="branch-summary-card" data-branch-status="active">
          <span>Active</span><strong>${activeCount}</strong>
        </button>
        <button type="button" class="branch-summary-card" data-branch-status="inactive">
          <span>Inactive</span><strong>${inactiveCount}</strong>
        </button>
      </div>

      <div class="branch-directory-toolbar card">
        <div class="branch-search-wrap">
          <span aria-hidden="true">🔎</span>
          <input id="branch-search" class="form-input" type="search" placeholder="Search branch name or address..." autocomplete="off" />
        </div>
        <select id="branch-status-filter" class="form-select" aria-label="Filter branches by status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div class="branch-cards-grid" id="branches-grid">
        ${renderBranchCards(branches)}
      </div>
      <div id="branch-filter-empty" class="empty-state hidden">
        <div class="empty-state-icon">🏪</div>
        <div class="empty-state-title">No branches match these filters</div>
        <div class="empty-state-desc">Try another name, address or status.</div>
      </div>
    </div>
  `;

  const reload = () => renderBranches(container, user);
  document.getElementById('add-branch-btn')?.addEventListener('click', () => showBranchModal(null, user, reload));
  bindActions(branches, user, reload);
  bindBranchFilters(container);
}

function renderBranchCards(branches) {
  if (!branches.length) return `
    <div class="empty-state" style="grid-column:1/-1">
      <div class="empty-state-icon">🏪</div>
      <div class="empty-state-title">No branches yet</div>
      <div class="empty-state-desc">Add your first branch location.</div>
    </div>
  `;

  return branches.map(branch => {
    const features = branch.feature_settings || {};
    return `
      <article
        class="card branch-performance-card"
        data-branch-card="${branch.id}"
        data-name="${escapeHtml(String(branch.name || '').toLowerCase())}"
        data-address="${escapeHtml(String(branch.address || '').toLowerCase())}"
        data-status="${branch.is_active ? 'active' : 'inactive'}"
      >
        <div class="card-header branch-card-header">
          <div class="branch-card-heading">
            <div class="card-title">${escapeHtml(branch.name)}</div>
            <div class="text-xs text-muted">${escapeHtml(branch.address || 'No address')}</div>
          </div>
          <span class="badge ${branch.is_active ? 'badge-success' : 'badge-danger'}">${branch.is_active ? 'Active' : 'Inactive'}</span>
        </div>

        <div class="card-body">
          <div class="branch-card-metrics" data-branch-metrics="${branch.id}">
            <div class="branch-mini-metric"><span>Today</span><strong>…</strong></div>
            <div class="branch-mini-metric"><span>This Month</span><strong>…</strong></div>
            <div class="branch-mini-metric"><span>Staff</span><strong>…</strong></div>
            <div class="branch-mini-metric"><span>Low Stock</span><strong>…</strong></div>
          </div>

          <details class="branch-feature-disclosure">
            <summary>Module access</summary>
            <div class="branch-feature-list">
              ${['inventory', 'sales', 'customers', 'reports'].map(feat => `
                <div class="feature-row">
                  <div class="feature-label">${feat.charAt(0).toUpperCase() + feat.slice(1)}</div>
                  <span class="badge ${features[feat] ? 'badge-success' : 'badge-gray'}">${features[feat] ? 'Enabled' : 'Disabled'}</span>
                </div>
              `).join('')}
            </div>
          </details>

          <div class="branch-card-actions">
            <button class="btn btn-primary btn-sm view-branch-btn" data-id="${branch.id}">View Details</button>
            <button class="btn btn-ghost btn-sm edit-branch-btn" data-id="${branch.id}">Edit</button>
            <button class="btn btn-ghost btn-sm toggle-branch-btn" data-id="${branch.id}" data-active="${branch.is_active}">
              ${branch.is_active ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function hydrateBranchMetrics(container, branches, pharmacyId) {
  await Promise.allSettled(branches.map(async (branch) => {
    const target = container.querySelector(`[data-branch-metrics="${branch.id}"]`);
    if (!target) return;
    try {
      const summary = await getBranchDashboard(branch.id, pharmacyId);
      if (!target.isConnected) return;
      target.innerHTML = `
        <div class="branch-mini-metric"><span>Today</span><strong>${formatCurrency(summary.dailySales)}</strong></div>
        <div class="branch-mini-metric"><span>This Month</span><strong>${formatCurrency(summary.monthlyRevenue)}</strong></div>
        <div class="branch-mini-metric"><span>Staff</span><strong>${summary.staffCount}</strong></div>
        <div class="branch-mini-metric ${summary.lowStockCount > 0 ? 'needs-attention' : ''}"><span>Low Stock</span><strong>${summary.lowStockCount}</strong></div>
      `;
    } catch (error) {
      console.warn(`Failed to load branch summary for ${branch.name}:`, error);
      if (target.isConnected) {
        target.innerHTML = `<div class="branch-metric-error">Performance summary unavailable</div>`;
      }
    }
  }));
}

function bindBranchFilters(container) {
  const search = container.querySelector('#branch-search');
  const status = container.querySelector('#branch-status-filter');
  const statusCards = [...container.querySelectorAll('[data-branch-status]')];

  const apply = () => {
    const term = String(search?.value || '').trim().toLowerCase();
    const statusValue = status?.value || 'all';
    let visible = 0;

    container.querySelectorAll('[data-branch-card]').forEach(card => {
      const matchesTerm = !term || card.dataset.name.includes(term) || card.dataset.address.includes(term);
      const matchesStatus = statusValue === 'all' || card.dataset.status === statusValue;
      const show = matchesTerm && matchesStatus;
      card.classList.toggle('hidden', !show);
      if (show) visible += 1;
    });

    container.querySelector('#branch-filter-empty')?.classList.toggle('hidden', visible !== 0 || !container.querySelector('[data-branch-card]'));
    statusCards.forEach(card => card.classList.toggle('is-selected', card.dataset.branchStatus === statusValue));
  };

  search?.addEventListener('input', apply);
  status?.addEventListener('change', apply);
  statusCards.forEach(card => card.addEventListener('click', () => {
    if (status) status.value = card.dataset.branchStatus;
    apply();
  }));
}

function bindActions(branches, user, reload) {
  const branchMap = Object.fromEntries(branches.map(branch => [branch.id, branch]));

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
          <input type="text" class="form-input" id="branch-name" value="${escapeHtml(branch?.name || '')}" placeholder="Main Branch" required />
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" class="form-input" id="branch-addr" value="${escapeHtml(branch?.address || '')}" placeholder="123 Health St" />
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
    if (!name) {
      errEl.textContent = 'Branch name is required.';
      errEl.classList.remove('hidden');
      return;
    }

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
