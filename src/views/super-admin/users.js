import {
  getSuperAdminUsersPage,
  getSuperAdminUserSummary,
  getSuperAdminUserFilterOptions,
  getSuperAdminUserDetail,
  setSuperAdminUserAccountState,
  changeSuperAdminUserRole,
  revokeSuperAdminUserSessions,
  updateProfile
} from '../../database.js';
import { debounce, formatCurrency, formatDate, showToast, showConfirm } from '../../utils.js';
import { createModal } from '../../components/modal.js';
import { supabase } from '../../config.js';

const state = {
  page: 1,
  pageSize: 30,
  search: '',
  role: '',
  status: 'all',
  pharmacyId: '',
  branchId: '',
  count: 0,
  pageCount: 1,
  rows: [],
  pharmacies: [],
  branches: [],
  summary: { total: 0, active: 0, disabled: 0, superAdmins: 0 },
  usingFallback: false
};

let activeContainer = null;
let activeUser = null;

function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function roleLabel(role = '') {
  return {
    super_admin: 'Super Admin',
    admin: 'Admin',
    inventory_manager: 'Inventory Manager',
    salesman: 'Salesman'
  }[role] || String(role || 'User').replaceAll('_', ' ');
}

function roleBadge(role = '') {
  return {
    super_admin: 'badge-danger',
    admin: 'badge-primary',
    inventory_manager: 'badge-info',
    salesman: 'badge-gray'
  }[role] || 'badge-gray';
}

function accountStatus(row = {}) {
  if (row.account_status === 'locked') return 'locked';
  if (row.account_status === 'disabled' || row.is_active === false) return 'disabled';
  return 'active';
}

function statusBadge(row = {}) {
  const status = accountStatus(row);
  if (status === 'locked') return '<span class="badge badge-warning">Locked</span>';
  if (status === 'disabled') return '<span class="badge badge-danger">Disabled</span>';
  return '<span class="badge badge-success">Active</span>';
}

function friendlyDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function relativeActivity(value) {
  if (!value) return 'No activity recorded';
  const when = new Date(value).getTime();
  if (!Number.isFinite(when)) return '—';
  const diff = Date.now() - when;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return friendlyDateTime(value);
}

function branchText(assignments = []) {
  if (!assignments?.length) return '<span class="text-muted text-sm">—</span>';
  const shown = assignments.slice(0, 2).map(a => `<span class="super-user-branch-chip">${esc(a.branch_name || 'Branch')}</span>`).join('');
  const more = assignments.length > 2 ? `<span class="super-user-branch-more">+${assignments.length - 2}</span>` : '';
  return `<div class="super-user-branches">${shown}${more}</div>`;
}

function paginationMarkup() {
  const totalPages = Math.max(1, state.pageCount || 1);
  const current = Math.min(state.page, totalPages);
  const pages = new Set([1, totalPages, current, current - 1, current + 1]);
  const visible = [...pages].filter(p => p > 0 && p <= totalPages).sort((a, b) => a - b);
  let last = null;
  const pageButtons = visible.map(page => {
    const gap = last !== null && page - last > 1 ? '<span class="pagination-ellipsis">…</span>' : '';
    last = page;
    return `${gap}<button class="btn btn-sm ${page === current ? 'btn-primary' : 'btn-ghost'}" data-user-page="${page}">${page}</button>`;
  }).join('');
  return `
    <div class="pagination-controls">
      <button class="btn btn-ghost btn-sm" data-user-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>Previous</button>
      ${pageButtons}
      <button class="btn btn-ghost btn-sm" data-user-page="${current + 1}" ${current >= totalPages ? 'disabled' : ''}>Next</button>
    </div>`;
}

function renderRows() {
  if (!state.rows.length) {
    return `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-title">No users found</div><div class="empty-state-desc">Try changing your search or filters.</div></div></td></tr>`;
  }

  return state.rows.map(row => {
    const self = row.id === activeUser?.id;
    return `
      <tr>
        <td>
          <div class="super-user-name-cell">
            <div class="user-avatar">${esc((row.full_name || row.email || '?').slice(0, 1).toUpperCase())}</div>
            <div>
              <div class="font-semibold">${esc(row.full_name || 'Unnamed User')}</div>
              ${self ? '<div class="text-xs text-muted">Current account</div>' : ''}
            </div>
          </div>
        </td>
        <td class="text-sm super-user-email">${esc(row.email || '—')}</td>
        <td><span class="badge ${roleBadge(row.role)}">${esc(roleLabel(row.role))}</span></td>
        <td>
          <div class="font-medium">${esc(row.pharmacy_name || 'Platform')}</div>
          ${branchText(row.branch_assignments)}
        </td>
        <td>${statusBadge(row)}</td>
        <td class="text-sm">
          <div>${esc(relativeActivity(row.last_sign_in_at || row.last_activity_at))}</div>
          <div class="text-xs text-muted">${esc(friendlyDateTime(row.last_sign_in_at || row.last_activity_at))}</div>
        </td>
        <td class="text-sm text-muted">${esc(formatDate(row.created_at))}</td>
        <td>
          <div class="super-user-row-actions">
            <button class="btn btn-ghost btn-sm" data-user-action="view" data-id="${row.id}">View Profile</button>
            ${row.pharmacy_id ? `<button class="btn btn-ghost btn-sm" data-user-action="access" data-id="${row.id}">Access Pharmacy</button>` : ''}
            ${self ? '<span class="text-xs text-muted">Protected</span>' : `
              <button class="btn btn-ghost btn-sm" data-user-action="edit" data-id="${row.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-user-action="manage" data-id="${row.id}">Manage</button>
            `}
          </div>
        </td>
      </tr>`;
  }).join('');
}

function filteredBranches() {
  if (!state.pharmacyId) return state.branches;
  return state.branches.filter(branch => branch.pharmacy_id === state.pharmacyId);
}

function renderPage() {
  const start = state.count ? ((state.page - 1) * state.pageSize) + 1 : 0;
  const end = state.count ? Math.min(state.page * state.pageSize, state.count) : 0;
  activeContainer.innerHTML = `
    <div class="animate-in super-admin-users-page">
      <div class="page-header">
        <div>
          <div class="page-title">All Users</div>
          <div class="page-subtitle">Manage platform accounts, pharmacy access, security status and user activity</div>
        </div>
      </div>

      <div class="super-user-summary-grid">
        <button class="super-user-summary-card" data-summary="all"><span>Total Users</span><strong>${state.summary.total.toLocaleString()}</strong><small>Across the platform</small></button>
        <button class="super-user-summary-card" data-summary="active"><span>Active Users</span><strong>${state.summary.active.toLocaleString()}</strong><small>Enabled accounts</small></button>
        <button class="super-user-summary-card" data-summary="disabled"><span>Disabled</span><strong>${state.summary.disabled.toLocaleString()}</strong><small>Access currently blocked</small></button>
        <button class="super-user-summary-card" data-summary="super_admin"><span>Super Admins</span><strong>${state.summary.superAdmins.toLocaleString()}</strong><small>Platform administrators</small></button>
      </div>

      ${state.usingFallback ? '<div class="alert alert-warning">Apply the latest Super Admin user-management migration to enable Auth last-sign-in data, account locking, role audit history and session revocation.</div>' : ''}

      <div class="card super-user-directory" aria-busy="false">
        <div class="super-user-filters">
          <div class="form-group super-filter-search">
            <label class="form-label">Search</label>
            <input class="form-input" id="super-user-search" value="${esc(state.search)}" placeholder="Name, email or pharmacy..." />
          </div>
          <div class="form-group"><label class="form-label">Role</label><select class="form-select" id="super-user-role">
            <option value="">All Roles</option>
            <option value="super_admin" ${state.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
            <option value="admin" ${state.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="inventory_manager" ${state.role === 'inventory_manager' ? 'selected' : ''}>Inventory Manager</option>
            <option value="salesman" ${state.role === 'salesman' ? 'selected' : ''}>Salesman</option>
          </select></div>
          <div class="form-group"><label class="form-label">Status</label><select class="form-select" id="super-user-status">
            <option value="all" ${state.status === 'all' ? 'selected' : ''}>All Statuses</option>
            <option value="active" ${state.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="disabled" ${state.status === 'disabled' ? 'selected' : ''}>Disabled</option>
            <option value="locked" ${state.status === 'locked' ? 'selected' : ''}>Locked</option>
          </select></div>
          <div class="form-group"><label class="form-label">Pharmacy</label><select class="form-select" id="super-user-pharmacy"><option value="">All Pharmacies</option>${state.pharmacies.map(p => `<option value="${p.id}" ${state.pharmacyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Branch</label><select class="form-select" id="super-user-branch"><option value="">All Branches</option>${filteredBranches().map(b => `<option value="${b.id}" ${state.branchId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
          <div class="form-group super-user-page-size"><label class="form-label">Per Page</label><select class="form-select" id="super-user-page-size">${[25,30,50].map(size => `<option value="${size}" ${state.pageSize === size ? 'selected' : ''}>${size}</option>`).join('')}</select></div>
          <button class="btn btn-ghost" id="super-user-clear">Clear</button>
        </div>

        <div class="card-header"><span class="card-title">Users (${state.count.toLocaleString()})</span><span class="text-sm text-muted">Showing ${start.toLocaleString()}–${end.toLocaleString()}</span></div>
        <div class="table-container">
          <table class="super-user-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Pharmacy / Branch</th><th>Status</th><th>Last Sign-in</th><th>Joined</th><th>Actions</th></tr></thead>
            <tbody>${renderRows()}</tbody>
          </table>
        </div>
        <div class="pagination-bar">
          <div class="text-sm text-muted">Page ${state.page.toLocaleString()} of ${state.pageCount.toLocaleString()} · ${state.pageSize} users per page</div>
          ${paginationMarkup()}
        </div>
      </div>
    </div>`;
  bindPageActions();
}

async function loadPage() {
  const card = activeContainer?.querySelector('.super-user-directory');
  if (card) card.setAttribute('aria-busy', 'true');
  try {
    const result = await getSuperAdminUsersPage({
      page: state.page,
      pageSize: state.pageSize,
      search: state.search,
      role: state.role,
      status: state.status,
      pharmacyId: state.pharmacyId || null,
      branchId: state.branchId || null
    });
    state.rows = result.rows;
    state.count = result.count;
    state.pageCount = result.pageCount;
    state.usingFallback = result.usingFallback;
    if (state.page > state.pageCount) state.page = state.pageCount;
    renderPage();
  } catch (err) {
    activeContainer.innerHTML = `<div class="alert alert-danger">Failed to load platform users: ${esc(err.message)}</div>`;
  }
}

function bindPageActions() {
  const search = activeContainer.querySelector('#super-user-search');
  const debouncedSearch = debounce(() => { state.search = search.value.trim(); state.page = 1; loadPage(); }, 350);
  search?.addEventListener('input', debouncedSearch);

  activeContainer.querySelector('#super-user-role')?.addEventListener('change', e => { state.role = e.target.value; state.page = 1; loadPage(); });
  activeContainer.querySelector('#super-user-status')?.addEventListener('change', e => { state.status = e.target.value; state.page = 1; loadPage(); });
  activeContainer.querySelector('#super-user-pharmacy')?.addEventListener('change', e => {
    state.pharmacyId = e.target.value;
    if (state.branchId && !filteredBranches().some(b => b.id === state.branchId)) state.branchId = '';
    state.page = 1;
    loadPage();
  });
  activeContainer.querySelector('#super-user-branch')?.addEventListener('change', e => { state.branchId = e.target.value; state.page = 1; loadPage(); });
  activeContainer.querySelector('#super-user-page-size')?.addEventListener('change', e => { state.pageSize = Number(e.target.value) || 30; state.page = 1; loadPage(); });
  activeContainer.querySelector('#super-user-clear')?.addEventListener('click', () => {
    Object.assign(state, { page: 1, search: '', role: '', status: 'all', pharmacyId: '', branchId: '' });
    loadPage();
  });

  activeContainer.querySelectorAll('[data-user-page]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.disabled) return;
    state.page = Math.max(1, Math.min(state.pageCount, Number(btn.dataset.userPage) || 1));
    loadPage();
  }));
  activeContainer.querySelectorAll('[data-summary]').forEach(btn => btn.addEventListener('click', () => {
    const filter = btn.dataset.summary;
    state.page = 1;
    state.role = filter === 'super_admin' ? 'super_admin' : '';
    state.status = filter === 'active' ? 'active' : filter === 'disabled' ? 'disabled' : 'all';
    loadPage();
  }));

  activeContainer.querySelectorAll('[data-user-action]').forEach(btn => btn.addEventListener('click', async () => {
    const row = state.rows.find(item => item.id === btn.dataset.id);
    if (!row) return;
    if (btn.dataset.userAction === 'view') return showUserProfile(row.id);
    if (btn.dataset.userAction === 'access') {
      if (!row.pharmacy_id) return;
      const { impersonatePharmacy } = await import('../app.js');
      impersonatePharmacy({ id: row.pharmacy_id, name: row.pharmacy_name || 'Selected Pharmacy' });
      return;
    }
    if (btn.dataset.userAction === 'edit') return showEditUserModal(row);
    if (btn.dataset.userAction === 'manage') return showManageAccountModal(row);
  }));
}

function auditActionLabel(action = '') {
  return {
    account_status_changed: 'Account status changed',
    role_changed: 'Role changed',
    sessions_revoked: 'Sessions revoked'
  }[action] || String(action || 'Account event').replaceAll('_', ' ');
}

async function showUserProfile(userId) {
  const { overlay, closeModal } = createModal({
    id: 'super-user-profile', title: 'User Profile', size: 'modal-xl',
    body: '<div class="super-user-profile-loading">Loading user profile…</div>',
    footer: '<button class="btn btn-ghost" id="sup-close-profile">Close</button>'
  });
  overlay.querySelector('#sup-close-profile').onclick = closeModal;
  try {
    const data = await getSuperAdminUserDetail(userId);
    const p = data.profile || {};
    const security = data.security || {};
    const branches = data.branches || [];
    const sales = data.sales || {};
    const audit = data.audit || [];
    overlay.querySelector('.modal-body').innerHTML = `
      ${data.usingFallback ? '<div class="alert alert-warning">Apply the latest user-management migration to show Auth sign-in and security audit history.</div>' : ''}
      <div class="super-user-profile-head">
        <div class="user-avatar super-user-profile-avatar">${esc((p.full_name || p.email || '?')[0].toUpperCase())}</div>
        <div><h3>${esc(p.full_name || 'Unnamed User')}</h3><div>${esc(p.email || '—')}</div><div class="super-user-profile-badges"><span class="badge ${roleBadge(p.role)}">${esc(roleLabel(p.role))}</span>${statusBadge(p)}</div></div>
      </div>
      <div class="super-user-profile-grid">
        <div class="super-user-profile-stat"><span>Pharmacy</span><strong>${esc(p.pharmacy_name || 'Platform')}</strong></div>
        <div class="super-user-profile-stat"><span>Last Sign-in</span><strong>${esc(friendlyDateTime(security.last_sign_in_at))}</strong></div>
        <div class="super-user-profile-stat"><span>Last App Activity</span><strong>${esc(friendlyDateTime(p.last_activity_at))}</strong></div>
        <div class="super-user-profile-stat"><span>Joined</span><strong>${esc(formatDate(p.created_at))}</strong></div>
        <div class="super-user-profile-stat"><span>Sales Recorded</span><strong>${Number(sales.transactions || 0).toLocaleString()}</strong></div>
        <div class="super-user-profile-stat"><span>Sales Value</span><strong>${esc(formatCurrency(Number(sales.total_sales || 0)))}</strong></div>
      </div>
      <div class="super-user-profile-sections">
        <section class="card"><div class="card-header"><span class="card-title">Branch Assignments</span></div><div class="super-user-profile-list">${branches.length ? branches.map(b => `<div><strong>${esc(b.branch_name || 'Branch')}</strong><span>${esc((b.role_in_branch || 'Staff').replaceAll('_', ' '))}${b.assigned_date ? ` · since ${esc(formatDate(b.assigned_date))}` : ''}</span></div>`).join('') : '<div class="empty-mini">No active branch assignments.</div>'}</div></section>
        <section class="card"><div class="card-header"><span class="card-title">Security</span></div><div class="settings-detail-grid"><div><span>Email confirmed</span><strong>${security.email_confirmed_at ? esc(formatDate(security.email_confirmed_at)) : 'Not available'}</strong></div><div><span>Auth created</span><strong>${esc(formatDate(security.auth_created_at || p.created_at))}</strong></div><div><span>Last sign-in</span><strong>${esc(friendlyDateTime(security.last_sign_in_at))}</strong></div><div><span>Account status</span><strong>${esc(accountStatus(p))}</strong></div></div>${p.status_reason ? `<div class="super-user-status-note"><strong>Status note:</strong> ${esc(p.status_reason)}</div>` : ''}</section>
      </div>
      <section class="card super-user-audit-card"><div class="card-header"><span class="card-title">Account & Security History</span></div><div class="super-user-audit-list">${audit.length ? audit.map(item => `<div class="super-user-audit-item"><div><strong>${esc(auditActionLabel(item.action))}</strong><span>${esc(item.note || 'No note')}</span></div><div class="text-sm text-muted">${esc(item.actor_name || 'Super Admin')} · ${esc(friendlyDateTime(item.created_at))}</div></div>`).join('') : '<div class="empty-mini">No account-management events recorded yet.</div>'}</div></section>
    `;
  } catch (err) {
    overlay.querySelector('.modal-body').innerHTML = `<div class="alert alert-danger">${esc(err.message)}</div>`;
  }
}

function showEditUserModal(row) {
  const self = row.id === activeUser?.id;
  const platformRoleProtected = row.role === 'super_admin';
  const { overlay, closeModal } = createModal({
    id: 'super-edit-user', title: 'Edit User',
    body: `
      <div class="form-group"><label class="form-label">Full Name</label><input class="form-input" id="seu-name" value="${esc(row.full_name || '')}" /></div>
      <div class="form-group"><label class="form-label">Email</label><input class="form-input" value="${esc(row.email || '')}" disabled /><small class="text-muted">Authentication email changes should be handled through the user's verified email flow.</small></div>
      <div class="form-group"><label class="form-label">Role</label><select class="form-select" id="seu-role" ${(self || platformRoleProtected) ? 'disabled' : ''}>
        ${platformRoleProtected ? '<option value="super_admin" selected>Super Admin</option>' : ''}
        <option value="admin" ${row.role === 'admin' ? 'selected' : ''}>Admin</option>
        <option value="inventory_manager" ${row.role === 'inventory_manager' ? 'selected' : ''}>Inventory Manager</option>
        <option value="salesman" ${row.role === 'salesman' ? 'selected' : ''}>Salesman</option>
      </select>${(self || platformRoleProtected) ? '<small class="text-muted">Platform Super Admin roles are bootstrap-protected.</small>' : ''}</div>
      <div class="form-group"><label class="form-label">Reason for role change</label><input class="form-input" id="seu-reason" placeholder="Optional internal audit note" /></div>
      <div id="seu-error" class="alert alert-danger hidden"></div>`,
    footer: '<button class="btn btn-ghost" id="seu-cancel">Cancel</button><button class="btn btn-primary" id="seu-save">Save Changes</button>'
  });
  overlay.querySelector('#seu-cancel').onclick = closeModal;
  overlay.querySelector('#seu-save').onclick = async () => {
    const button = overlay.querySelector('#seu-save');
    const err = overlay.querySelector('#seu-error');
    const name = overlay.querySelector('#seu-name').value.trim();
    const role = overlay.querySelector('#seu-role').value;
    const reason = overlay.querySelector('#seu-reason').value.trim();
    if (!name) { err.textContent = 'Full name is required.'; err.classList.remove('hidden'); return; }
    button.disabled = true;
    try {
      await updateProfile(row.id, { full_name: name });
      if (!self && !platformRoleProtected && role !== row.role) await changeSuperAdminUserRole(row.id, role, reason);
      showToast('User updated successfully');
      closeModal();
      state.summary = await getSuperAdminUserSummary();
      loadPage();
    } catch (e) {
      err.textContent = e.message || 'Unable to update user.';
      err.classList.remove('hidden');
      button.disabled = false;
    }
  };
}

function showManageAccountModal(row) {
  const current = accountStatus(row);
  const { overlay, closeModal } = createModal({
    id: 'super-manage-user', title: 'Manage User Account', size: 'modal-lg',
    body: `
      <div class="super-account-summary"><strong>${esc(row.full_name || row.email)}</strong><span>${esc(row.email || '')} · ${esc(roleLabel(row.role))}</span></div>
      <div class="form-group"><label class="form-label">Account Status</label><select class="form-select" id="smu-status"><option value="active" ${current === 'active' ? 'selected' : ''}>Active</option><option value="disabled" ${current === 'disabled' ? 'selected' : ''}>Disabled</option><option value="locked" ${current === 'locked' ? 'selected' : ''}>Locked</option></select></div>
      <div class="form-group"><label class="form-label">Reason / internal note</label><textarea class="form-input" id="smu-reason" rows="3" placeholder="Why is this account being changed?">${esc(row.status_reason || '')}</textarea></div>
      <div class="super-account-actions">
        <button class="btn btn-ghost" id="smu-reset">Send Password Reset</button>
        <button class="btn btn-ghost" id="smu-revoke">Revoke Sessions</button>
      </div>
      <div class="alert alert-info">Disabled and locked accounts are blocked by SamMia Pharm. Revoking sessions removes refreshable Auth sessions; a short-lived access token can remain valid until it expires.</div>
      <div id="smu-error" class="alert alert-danger hidden"></div>`,
    footer: '<button class="btn btn-ghost" id="smu-cancel">Cancel</button><button class="btn btn-primary" id="smu-save">Save Status</button>'
  });
  const errorBox = overlay.querySelector('#smu-error');
  const showError = message => { errorBox.textContent = message; errorBox.classList.remove('hidden'); };
  overlay.querySelector('#smu-cancel').onclick = closeModal;
  overlay.querySelector('#smu-reset').onclick = async () => {
    const confirmed = await showConfirm(`Send a password reset email to ${row.email}?`);
    if (!confirmed) return;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(row.email, { redirectTo: `${window.location.origin}/` });
      if (error) throw error;
      showToast('Password reset email requested');
    } catch (e) { showError(e.message); }
  };
  overlay.querySelector('#smu-revoke').onclick = async () => {
    const confirmed = await showConfirm('Revoke this user’s refreshable sessions? They will need to sign in again after their current access token expires.');
    if (!confirmed) return;
    try {
      const count = await revokeSuperAdminUserSessions(row.id, overlay.querySelector('#smu-reason').value.trim());
      showToast(`${count} session${count === 1 ? '' : 's'} revoked`);
    } catch (e) { showError(e.message); }
  };
  overlay.querySelector('#smu-save').onclick = async () => {
    const button = overlay.querySelector('#smu-save');
    button.disabled = true;
    try {
      await setSuperAdminUserAccountState(row.id, overlay.querySelector('#smu-status').value, overlay.querySelector('#smu-reason').value.trim());
      showToast('Account status updated');
      closeModal();
      state.summary = await getSuperAdminUserSummary();
      loadPage();
    } catch (e) { showError(e.message); button.disabled = false; }
  };
}

export async function renderAllUsers(container, user, initialSearch = '') {
  activeContainer = container;
  activeUser = user;
  state.page = 1;
  state.search = initialSearch || '';
  state.role = '';
  state.status = 'all';
  state.pharmacyId = '';
  state.branchId = '';
  container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-title">Loading platform users…</div></div>';
  try {
    const [summary, options] = await Promise.all([getSuperAdminUserSummary(), getSuperAdminUserFilterOptions()]);
    state.summary = summary;
    state.pharmacies = options.pharmacies;
    state.branches = options.branches;
    await loadPage();
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to initialize All Users: ${esc(err.message)}</div>`;
  }
}
