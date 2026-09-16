import {
  getBranches,
  getStaffPage,
  getStaffSummary,
  getStaffSalesAnalytics,
  updateProfile
} from '../../database.js';
import { signUp } from '../../auth.js';
import { debounce, formatCurrency, formatDate, showToast, showConfirm } from '../../utils.js';
import { createModal } from '../../components/modal.js';
import { supabase } from '../../config.js';

const staffState = {
  page: 1,
  pageSize: 30,
  total: 0,
  totalPages: 1,
  search: '',
  role: '',
  status: 'all',
  branchId: '',
  branches: [],
  summary: null,
  rows: []
};

let activeContainer = null;
let activeStaffUser = null;
let profileReportState = null;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function roleLabel(role = '') {
  const labels = {
    admin: 'Admin',
    salesman: 'Salesman',
    inventory_manager: 'Inventory Manager'
  };
  return labels[role] || String(role || 'Staff').replaceAll('_', ' ');
}

function roleBadgeClass(role = '') {
  return {
    admin: 'badge-primary',
    salesman: 'badge-gray',
    inventory_manager: 'badge-info'
  }[role] || 'badge-gray';
}

function formatFriendlyDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

function renderPagination(totalPages) {
  if (totalPages <= 1) {
    return `
      <div class="staff-pagination">
        <button class="btn btn-ghost btn-sm" disabled>Previous</button>
        <div class="staff-page-numbers"><button class="btn btn-sm staff-page-btn active" disabled>1</button></div>
        <button class="btn btn-ghost btn-sm" disabled>Next</button>
      </div>
    `;
  }

  const current = staffState.page;
  const pages = new Set([1, totalPages, current, current - 1, current + 1]);
  const visible = [...pages].filter(page => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  let previous = null;
  const buttons = [];
  visible.forEach(page => {
    if (previous !== null && page - previous > 1) buttons.push('<span class="staff-page-ellipsis">…</span>');
    buttons.push(`<button class="btn btn-sm staff-page-btn ${page === current ? 'active' : 'btn-ghost'}" data-page="${page}">${page}</button>`);
    previous = page;
  });

  return `
    <div class="staff-pagination">
      <button class="btn btn-ghost btn-sm staff-page-nav" data-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>Previous</button>
      <div class="staff-page-numbers">${buttons.join('')}</div>
      <button class="btn btn-ghost btn-sm staff-page-nav" data-page="${current + 1}" ${current >= totalPages ? 'disabled' : ''}>Next</button>
    </div>
  `;
}

function branchBadges(assignments = []) {
  if (!assignments.length) return '<span class="text-xs text-muted">Not assigned</span>';
  return `
    <div class="staff-branch-badges">
      ${assignments.slice(0, 2).map(assignment => `
        <span class="staff-branch-chip" title="${escapeHtml(assignment.role_in_branch || '')}">
          ${escapeHtml(assignment.branch_name || 'Branch')}
        </span>
      `).join('')}
      ${assignments.length > 2 ? `<span class="staff-branch-more">+${assignments.length - 2}</span>` : ''}
    </div>
  `;
}

function renderRows(profiles, currentUser) {
  if (!profiles.length) {
    return `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <div class="empty-state-icon">👥</div>
            <div class="empty-state-title">No staff found</div>
            <div class="empty-state-desc">Try changing the search or filters.</div>
          </div>
        </td>
      </tr>
    `;
  }

  return profiles.map(profile => `
    <tr>
      <td>
        <div class="staff-name-cell">
          <div class="user-avatar staff-avatar">${escapeHtml((profile.full_name || profile.email || '?')[0].toUpperCase())}</div>
          <div>
            <div class="font-semibold staff-name-text">${escapeHtml(profile.full_name || '—')}</div>
            ${profile.id === currentUser.id ? '<div class="text-xs text-muted">Current account</div>' : ''}
          </div>
        </div>
      </td>
      <td class="text-sm text-muted staff-email-cell">${escapeHtml(profile.email || '—')}</td>
      <td><span class="badge ${roleBadgeClass(profile.role)}">${escapeHtml(roleLabel(profile.role))}</span></td>
      <td>${branchBadges(profile.branch_assignments)}</td>
      <td><span class="badge ${profile.is_active ? 'badge-success' : 'badge-danger'}">${profile.is_active ? 'Active' : 'Inactive'}</span></td>
      <td class="text-sm text-muted">${escapeHtml(formatDate(profile.created_at))}</td>
      <td>
        <div class="staff-row-actions">
          <button class="btn btn-ghost btn-sm view-staff-btn" data-id="${profile.id}">View Profile</button>
          ${profile.id !== currentUser.id ? `
            <button class="btn btn-ghost btn-sm edit-staff-btn" data-id="${profile.id}">Edit</button>
            <button class="btn btn-ghost btn-sm toggle-staff-btn" data-id="${profile.id}" data-active="${profile.is_active}">
              ${profile.is_active ? 'Disable' : 'Enable'}
            </button>
          ` : '<span class="text-xs text-muted">You</span>'}
        </div>
      </td>
    </tr>
  `).join('');
}

function renderView(container, user) {
  const summary = staffState.summary || { total: 0, active: 0, salesmen: 0, inventoryManagers: 0 };
  const totalPages = Math.max(1, staffState.totalPages || 1);
  const fromItem = staffState.total ? ((staffState.page - 1) * staffState.pageSize) + 1 : 0;
  const toItem = staffState.total ? Math.min(staffState.page * staffState.pageSize, staffState.total) : 0;

  container.innerHTML = `
    <div class="animate-in admin-staff-page">
      <div class="page-header">
        <div>
          <div class="page-title">Staff Management</div>
          <div class="page-subtitle">Manage team accounts, branch assignments and employee sales performance</div>
        </div>
        <button class="btn btn-primary" id="add-staff-btn">+ Add Staff</button>
      </div>

      <div class="staff-summary-grid">
        <button type="button" class="staff-summary-card" data-summary-filter="all">
          <span>Total Staff</span><strong>${summary.total.toLocaleString()}</strong><small>All non-platform accounts</small>
        </button>
        <button type="button" class="staff-summary-card" data-summary-filter="active">
          <span>Active Staff</span><strong>${summary.active.toLocaleString()}</strong><small>Currently enabled</small>
        </button>
        <button type="button" class="staff-summary-card" data-summary-filter="salesman">
          <span>Salesmen</span><strong>${summary.salesmen.toLocaleString()}</strong><small>Sales team members</small>
        </button>
        <button type="button" class="staff-summary-card" data-summary-filter="inventory_manager">
          <span>Inventory Managers</span><strong>${summary.inventoryManagers.toLocaleString()}</strong><small>Inventory team members</small>
        </button>
      </div>

      <div class="card staff-directory-card">
        <div class="card-header staff-directory-header">
          <div>
            <span class="card-title">Team Members</span>
            <div class="text-xs text-muted">Showing ${fromItem}-${toItem} of ${staffState.total.toLocaleString()} matching staff member${staffState.total === 1 ? '' : 's'}</div>
          </div>
        </div>

        <div class="staff-filter-panel">
          <div class="search-box staff-search-box">
            <span style="color:var(--gray-400)">🔎</span>
            <input id="staff-search" type="text" value="${escapeHtml(staffState.search)}" placeholder="Search name or email..." />
          </div>
          <select class="form-select" id="staff-role-filter">
            <option value="" ${!staffState.role ? 'selected' : ''}>All Roles</option>
            <option value="salesman" ${staffState.role === 'salesman' ? 'selected' : ''}>Salesman</option>
            <option value="inventory_manager" ${staffState.role === 'inventory_manager' ? 'selected' : ''}>Inventory Manager</option>
            <option value="admin" ${staffState.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
          <select class="form-select" id="staff-status-filter">
            <option value="all" ${staffState.status === 'all' ? 'selected' : ''}>All Statuses</option>
            <option value="active" ${staffState.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="inactive" ${staffState.status === 'inactive' ? 'selected' : ''}>Inactive</option>
          </select>
          <select class="form-select" id="staff-branch-filter">
            <option value="" ${!staffState.branchId ? 'selected' : ''}>All Branches</option>
            ${staffState.branches.map(branch => `<option value="${branch.id}" ${staffState.branchId === branch.id ? 'selected' : ''}>${escapeHtml(branch.name)}</option>`).join('')}
          </select>
          <select class="form-select staff-page-size" id="staff-page-size" title="Staff per page">
            ${[25, 30, 50].map(size => `<option value="${size}" ${staffState.pageSize === size ? 'selected' : ''}>${size} / page</option>`).join('')}
          </select>
          <button class="btn btn-ghost" id="clear-staff-filters">Clear</button>
        </div>

        <div class="table-container staff-table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Assigned Branch</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${renderRows(staffState.rows, user)}</tbody>
          </table>
        </div>

        <div class="staff-pagination-wrap">
          <div class="staff-pagination-info">Page ${staffState.page} of ${totalPages} · ${staffState.pageSize} staff per page</div>
          ${renderPagination(totalPages)}
        </div>
      </div>
    </div>
  `;

  bindDirectoryActions(container, user);
}

async function loadStaffDirectory({ refreshMeta = false } = {}) {
  if (!activeContainer || !activeStaffUser) return;
  const pharmacyId = activeStaffUser.profile?.pharmacy_id;
  if (!pharmacyId) return;

  try {
    activeContainer.setAttribute('aria-busy', 'true');
    let pageResult;
    if (refreshMeta || !staffState.summary || !staffState.branches.length) {
      const [branches, summary, page] = await Promise.all([
        getBranches(pharmacyId),
        getStaffSummary(pharmacyId),
        getStaffPage(pharmacyId, staffState)
      ]);
      staffState.branches = (branches || []).filter(branch => branch.is_active !== false);
      staffState.summary = summary;
      pageResult = page;
    } else {
      pageResult = await getStaffPage(pharmacyId, staffState);
    }

    staffState.rows = pageResult.data || [];
    staffState.total = pageResult.total || 0;
    staffState.totalPages = pageResult.totalPages || 1;
    if (staffState.page > staffState.totalPages) staffState.page = staffState.totalPages;
    renderView(activeContainer, activeStaffUser);
  } catch (err) {
    console.error('Failed to load staff directory:', err);
    activeContainer.innerHTML = `<div class="alert alert-danger">Failed to load staff: ${escapeHtml(err.message)}</div>`;
  } finally {
    activeContainer?.removeAttribute('aria-busy');
  }
}

export async function renderStaff(container, user, initialSearch = '') {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = '<div class="alert alert-warning">No pharmacy linked.</div>';
    return;
  }

  activeContainer = container;
  activeStaffUser = user;
  staffState.page = 1;
  staffState.pageSize = 30;
  staffState.total = 0;
  staffState.totalPages = 1;
  staffState.search = String(initialSearch || '').trim();
  staffState.role = '';
  staffState.status = 'all';
  staffState.branchId = '';
  staffState.summary = null;
  staffState.rows = [];
  staffState.branches = [];

  await loadStaffDirectory({ refreshMeta: true });
}

function bindDirectoryActions(container, user) {
  const delayedSearch = debounce(async (value) => {
    staffState.search = value.trim();
    staffState.page = 1;
    await loadStaffDirectory();
  }, 350);

  document.getElementById('staff-search')?.addEventListener('input', event => delayedSearch(event.target.value));
  document.getElementById('staff-role-filter')?.addEventListener('change', async event => {
    staffState.role = event.target.value;
    staffState.page = 1;
    await loadStaffDirectory();
  });
  document.getElementById('staff-status-filter')?.addEventListener('change', async event => {
    staffState.status = event.target.value;
    staffState.page = 1;
    await loadStaffDirectory();
  });
  document.getElementById('staff-branch-filter')?.addEventListener('change', async event => {
    staffState.branchId = event.target.value;
    staffState.page = 1;
    await loadStaffDirectory();
  });
  document.getElementById('staff-page-size')?.addEventListener('change', async event => {
    staffState.pageSize = Number(event.target.value) || 30;
    staffState.page = 1;
    await loadStaffDirectory();
  });
  document.getElementById('clear-staff-filters')?.addEventListener('click', async () => {
    staffState.search = '';
    staffState.role = '';
    staffState.status = 'all';
    staffState.branchId = '';
    staffState.page = 1;
    await loadStaffDirectory();
  });

  document.querySelectorAll('.staff-page-btn, .staff-page-nav').forEach(button => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const nextPage = Number(button.dataset.page || 1);
      if (!nextPage || nextPage === staffState.page) return;
      staffState.page = nextPage;
      await loadStaffDirectory();
    });
  });

  document.querySelectorAll('[data-summary-filter]').forEach(card => {
    card.addEventListener('click', async () => {
      const filter = card.dataset.summaryFilter;
      staffState.page = 1;
      staffState.search = '';
      staffState.branchId = '';
      if (filter === 'active') {
        staffState.status = 'active';
        staffState.role = '';
      } else if (filter === 'salesman' || filter === 'inventory_manager') {
        staffState.role = filter;
        staffState.status = 'all';
      } else {
        staffState.role = '';
        staffState.status = 'all';
      }
      await loadStaffDirectory();
    });
  });

  document.getElementById('add-staff-btn')?.addEventListener('click', () => {
    showAddStaffModal(user, () => loadStaffDirectory({ refreshMeta: true }));
  });

  document.querySelectorAll('.view-staff-btn').forEach(button => {
    button.addEventListener('click', () => {
      const staff = staffState.rows.find(row => row.id === button.dataset.id);
      if (staff) showStaffProfileModal(staff, user);
    });
  });

  document.querySelectorAll('.edit-staff-btn').forEach(button => {
    button.addEventListener('click', () => {
      const staff = staffState.rows.find(row => row.id === button.dataset.id);
      if (staff) showEditStaffModal(staff, () => loadStaffDirectory({ refreshMeta: true }));
    });
  });

  document.querySelectorAll('.toggle-staff-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const isActive = button.dataset.active === 'true';
      const confirmed = await showConfirm(`${isActive ? 'Disable' : 'Enable'} this staff member?`);
      if (!confirmed) return;
      try {
        await updateProfile(button.dataset.id, { is_active: !isActive });
        showToast(`Staff member ${isActive ? 'disabled' : 'enabled'}`);
        await loadStaffDirectory({ refreshMeta: true });
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function utcDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function staffReportRange(period, customStart = '', customEnd = '') {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endTomorrow = addUtcDays(today, 1);

  if (period === 'last7') return { start: addUtcDays(today, -6), end: endTomorrow, label: 'Last 7 Days' };
  if (period === 'last30') return { start: addUtcDays(today, -29), end: endTomorrow, label: 'Last 30 Days' };
  if (period === 'year') return { start: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)), end: endTomorrow, label: 'This Year' };
  if (period === 'custom') {
    const start = customStart ? new Date(`${customStart}T00:00:00Z`) : today;
    const endBase = customEnd ? new Date(`${customEnd}T00:00:00Z`) : today;
    return { start, end: addUtcDays(endBase, 1), label: `${formatFriendlyDate(start)} – ${formatFriendlyDate(endBase)}` };
  }
  return {
    start: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    end: endTomorrow,
    label: 'This Month'
  };
}

function renderAssignments(assignments = []) {
  if (!assignments.length) {
    return '<div class="empty-state-desc">No active branch assignment.</div>';
  }
  return assignments.map(assignment => `
    <div class="staff-profile-assignment">
      <div>
        <strong>${escapeHtml(assignment.branch_name || 'Branch')}</strong>
        <small>${escapeHtml(assignment.role_in_branch ? roleLabel(assignment.role_in_branch) : 'Assigned staff')}</small>
      </div>
      <span>${formatFriendlyDate(assignment.assigned_date)}</span>
    </div>
  `).join('');
}

async function showStaffProfileModal(staff, user) {
  const today = new Date();
  const todayInput = utcDateInput(today);
  const monthStart = utcDateInput(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const branchOptions = staffState.branches.map(branch => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join('');

  const { overlay } = createModal({
    id: 'staff-profile',
    title: `${staff.full_name || 'Staff Member'} · Profile`,
    size: 'modal-xl',
    body: `
      <div class="staff-profile-shell">
        <div class="staff-profile-top">
          <div class="staff-profile-avatar">${escapeHtml((staff.full_name || staff.email || '?')[0].toUpperCase())}</div>
          <div class="staff-profile-identity">
            <h3>${escapeHtml(staff.full_name || 'Unnamed staff member')}</h3>
            <div>${escapeHtml(staff.email || '—')}</div>
            <div class="staff-profile-meta">
              <span class="badge ${roleBadgeClass(staff.role)}">${escapeHtml(roleLabel(staff.role))}</span>
              <span class="badge ${staff.is_active ? 'badge-success' : 'badge-danger'}">${staff.is_active ? 'Active' : 'Inactive'}</span>
              <span>Joined ${formatFriendlyDate(staff.created_at)}</span>
            </div>
          </div>
        </div>

        <div class="staff-profile-section">
          <h4>Branch Assignments</h4>
          <div class="staff-profile-assignments">${renderAssignments(staff.branch_assignments)}</div>
        </div>

        <div class="staff-profile-section">
          <div class="staff-profile-section-heading">
            <div>
              <h4>Sales Performance & Activity</h4>
              <p>Sales are attributed from completed transactions created by this employee.</p>
            </div>
          </div>
          <div class="staff-profile-report-controls">
            <select class="form-select" id="staff-profile-period">
              <option value="month">This Month</option>
              <option value="last7">Last 7 Days</option>
              <option value="last30">Last 30 Days</option>
              <option value="year">This Year</option>
              <option value="custom">Custom Range</option>
            </select>
            <select class="form-select" id="staff-profile-branch">
              <option value="">All Branches</option>
              ${branchOptions}
            </select>
            <input type="date" class="form-input staff-profile-custom-date" id="staff-profile-start" value="${monthStart}" style="display:none" />
            <input type="date" class="form-input staff-profile-custom-date" id="staff-profile-end" value="${todayInput}" style="display:none" />
            <button class="btn btn-primary" id="load-staff-profile-report">Load</button>
          </div>
          <div id="staff-profile-report" class="staff-profile-report">
            <div class="staff-profile-loading">Loading performance...</div>
          </div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" id="print-staff-profile-report">🖨️ Print</button>
      <button class="btn btn-primary" id="export-staff-profile-report">📊 Export CSV</button>
    `
  });

  const periodSelect = overlay.querySelector('#staff-profile-period');
  const customDateFields = overlay.querySelectorAll('.staff-profile-custom-date');
  const reportEl = overlay.querySelector('#staff-profile-report');

  periodSelect.addEventListener('change', () => {
    const showCustom = periodSelect.value === 'custom';
    customDateFields.forEach(field => { field.style.display = showCustom ? '' : 'none'; });
  });

  const loadReport = async () => {
    reportEl.innerHTML = '<div class="staff-profile-loading">Loading performance...</div>';
    try {
      const range = staffReportRange(
        periodSelect.value,
        overlay.querySelector('#staff-profile-start')?.value,
        overlay.querySelector('#staff-profile-end')?.value
      );
      const branchId = overlay.querySelector('#staff-profile-branch')?.value || null;
      const analytics = await getStaffSalesAnalytics(user.profile.pharmacy_id, staff.id, {
        branchId,
        start: range.start.toISOString(),
        end: range.end.toISOString()
      });
      profileReportState = { staff, analytics, range, branchId };
      renderStaffProfileReport(reportEl, analytics, range);
    } catch (err) {
      console.error('Failed to load staff performance:', err);
      reportEl.innerHTML = `<div class="alert alert-danger">Failed to load employee performance: ${escapeHtml(err.message)}</div>`;
    }
  };

  overlay.querySelector('#load-staff-profile-report')?.addEventListener('click', loadReport);
  overlay.querySelector('#export-staff-profile-report')?.addEventListener('click', exportStaffProfileCsv);
  overlay.querySelector('#print-staff-profile-report')?.addEventListener('click', printStaffProfileReport);
  await loadReport();
}

function renderStaffProfileReport(container, analytics, range) {
  const bestDayLabel = analytics.bestDay ? `${formatFriendlyDate(analytics.bestDay.date)} · ${formatCurrency(analytics.bestDay.total)}` : 'No sales';
  const lastSaleLabel = analytics.lastSale ? formatFriendlyDate(analytics.lastSale) : 'No recorded sale';
  const dailyRows = analytics.daily.length
    ? analytics.daily.map(row => `
        <tr>
          <td>${formatFriendlyDate(row.date)}</td>
          <td>${row.transactions}</td>
          <td><strong>${formatCurrency(row.total)}</strong></td>
        </tr>
      `).join('')
    : '<tr><td colspan="3" class="text-muted" style="text-align:center">No completed sales in this period.</td></tr>';

  const paymentRows = Object.entries(analytics.paymentBreakdown || {}).length
    ? Object.entries(analytics.paymentBreakdown).map(([method, amount]) => `
        <div class="staff-payment-row"><span>${escapeHtml(method.replaceAll('_', ' '))}</span><strong>${formatCurrency(amount)}</strong></div>
      `).join('')
    : '<div class="empty-state-desc">No payment activity in this period.</div>';

  container.innerHTML = `
    <div class="staff-profile-period-label">${escapeHtml(range.label)}</div>
    <div class="staff-performance-grid">
      <div class="staff-performance-card"><span>Total Sales</span><strong>${formatCurrency(analytics.totalRevenue)}</strong></div>
      <div class="staff-performance-card"><span>Transactions</span><strong>${analytics.transactions.toLocaleString()}</strong></div>
      <div class="staff-performance-card"><span>Average Sale</span><strong>${formatCurrency(analytics.averageSale)}</strong></div>
      <div class="staff-performance-card"><span>Sales Days</span><strong>${analytics.activeDays.toLocaleString()}</strong></div>
      <div class="staff-performance-card staff-performance-card-wide"><span>Best Sales Day</span><strong>${escapeHtml(bestDayLabel)}</strong></div>
      <div class="staff-performance-card staff-performance-card-wide"><span>Last Sale</span><strong>${escapeHtml(lastSaleLabel)}</strong></div>
    </div>

    <div class="staff-profile-report-grid">
      <div class="staff-profile-report-panel">
        <h5>Daily Sales History</h5>
        <div class="table-container staff-profile-daily-table">
          <table>
            <thead><tr><th>Date</th><th>Transactions</th><th>Total Sales</th></tr></thead>
            <tbody>${dailyRows}</tbody>
          </table>
        </div>
      </div>
      <div class="staff-profile-report-panel">
        <h5>Payment Breakdown</h5>
        <div class="staff-payment-list">${paymentRows}</div>
      </div>
    </div>
  `;
}

function exportStaffProfileCsv() {
  if (!profileReportState) {
    showToast('Load a staff report first', 'warning');
    return;
  }
  const { staff, analytics, range } = profileReportState;
  const rows = [
    ['Employee', staff.full_name || staff.email],
    ['Role', roleLabel(staff.role)],
    ['Period', range.label],
    ['Total Sales', analytics.totalRevenue.toFixed(2)],
    ['Transactions', analytics.transactions],
    ['Average Sale', analytics.averageSale.toFixed(2)],
    ['Sales Days', analytics.activeDays],
    [],
    ['Date', 'Transactions', 'Total Sales'],
    ...analytics.daily.map(row => [row.date, row.transactions, row.total.toFixed(2)])
  ];
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${String(staff.full_name || 'staff').replace(/[^a-z0-9]+/gi, '_')}_${range.label.replace(/[^a-z0-9]+/gi, '_')}_sales.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function printStaffProfileReport() {
  if (!profileReportState) {
    showToast('Load a staff report first', 'warning');
    return;
  }
  const { staff, analytics, range } = profileReportState;
  const printWindow = window.open('', '', 'width=1000,height=800');
  if (!printWindow) {
    showToast('Please allow pop-ups to print this report', 'warning');
    return;
  }
  printWindow.document.write(`
    <html><head><title>${escapeHtml(staff.full_name || 'Staff')} Sales Report</title>
      <style>body{font-family:Inter,Arial,sans-serif;color:#0f172a;padding:28px}h1{margin-bottom:4px}.muted{color:#64748b}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card{border:1px solid #e2e8f0;border-radius:10px;padding:12px}.card strong{display:block;font-size:18px;margin-top:6px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:9px;border:1px solid #e2e8f0;text-align:left}</style>
    </head><body>
      <h1>${escapeHtml(staff.full_name || 'Staff Member')}</h1>
      <div class="muted">${escapeHtml(roleLabel(staff.role))} · ${escapeHtml(range.label)}</div>
      <div class="cards">
        <div class="card">Total Sales<strong>${formatCurrency(analytics.totalRevenue)}</strong></div>
        <div class="card">Transactions<strong>${analytics.transactions}</strong></div>
        <div class="card">Average Sale<strong>${formatCurrency(analytics.averageSale)}</strong></div>
        <div class="card">Sales Days<strong>${analytics.activeDays}</strong></div>
      </div>
      <table><thead><tr><th>Date</th><th>Transactions</th><th>Total Sales</th></tr></thead><tbody>
        ${analytics.daily.map(row => `<tr><td>${formatFriendlyDate(row.date)}</td><td>${row.transactions}</td><td>${formatCurrency(row.total)}</td></tr>`).join('') || '<tr><td colspan="3">No sales</td></tr>'}
      </tbody></table>
    </body></html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function showAddStaffModal(user, reload) {
  const { overlay, closeModal } = createModal({
    id: 'add-staff',
    title: 'Add Staff Member',
    body: `
      <form id="staff-form">
        <div class="form-group">
          <label class="form-label">Full Name *</label>
          <input type="text" class="form-input" id="staff-name" placeholder="Jane Doe" required />
        </div>
        <div class="form-group">
          <label class="form-label">Email *</label>
          <input type="email" class="form-input" id="staff-email" placeholder="staff@pharmacy.com" required />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Password *</label>
            <input type="password" class="form-input" id="staff-pass" placeholder="Min 8 chars" minlength="8" required />
          </div>
          <div class="form-group">
            <label class="form-label">Role *</label>
            <select class="form-select" id="staff-role">
              <option value="salesman">Salesman</option>
              <option value="inventory_manager">Inventory Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div id="staff-err" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-staff">Cancel</button>
      <button class="btn btn-primary" id="save-staff">Add Staff</button>
    `
  });

  overlay.querySelector('#cancel-staff').addEventListener('click', closeModal);
  overlay.querySelector('#save-staff').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-staff');
    const errEl = overlay.querySelector('#staff-err');
    errEl.classList.add('hidden');

    const name = overlay.querySelector('#staff-name').value.trim();
    const email = overlay.querySelector('#staff-email').value.trim();
    const pass = overlay.querySelector('#staff-pass').value;
    const role = overlay.querySelector('#staff-role').value;

    if (!name || !email || !pass) {
      errEl.textContent = 'All fields are required.';
      errEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Adding...';
    try {
      await signUp(email, pass, name, role, user.profile.pharmacy_id);
      showToast('Staff member added successfully');
      closeModal();
      await reload();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Add Staff';
    }
  });
}

function showEditStaffModal(staff, reload) {
  const { overlay, closeModal } = createModal({
    id: 'edit-staff',
    title: 'Edit Staff Member',
    body: `
      <form id="edit-staff-form">
        <div class="form-group">
          <label class="form-label">Full Name *</label>
          <input type="text" class="form-input" id="es-name" value="${escapeHtml(staff.full_name || '')}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Email *</label>
          <input type="email" class="form-input" id="es-email" value="${escapeHtml(staff.email || '')}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select class="form-select" id="es-role">
            <option value="salesman" ${staff.role === 'salesman' ? 'selected' : ''}>Salesman</option>
            <option value="inventory_manager" ${staff.role === 'inventory_manager' ? 'selected' : ''}>Inventory Manager</option>
            <option value="admin" ${staff.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </div>
        <hr class="divider" />
        <p class="text-sm font-semibold" style="margin-bottom:.75rem;color:var(--gray-700)">Change Password (Optional)</p>
        <div class="form-group">
          <label class="form-label">New Password</label>
          <input type="password" class="form-input" id="es-password" placeholder="Leave empty to keep current password" minlength="8" />
        </div>
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <input type="password" class="form-input" id="es-password-confirm" placeholder="Confirm new password" minlength="8" />
        </div>
        <div id="edit-staff-error" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-edit-staff">Cancel</button>
      <button class="btn btn-primary" id="save-edit-staff">Save Changes</button>
    `
  });

  overlay.querySelector('#cancel-edit-staff').addEventListener('click', closeModal);
  overlay.querySelector('#save-edit-staff').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-edit-staff');
    const errEl = overlay.querySelector('#edit-staff-error');
    errEl.classList.add('hidden');

    const name = overlay.querySelector('#es-name').value.trim();
    const email = overlay.querySelector('#es-email').value.trim();
    const role = overlay.querySelector('#es-role').value;
    const newPassword = overlay.querySelector('#es-password').value;
    const confirmPassword = overlay.querySelector('#es-password-confirm').value;

    if (!name || !email) {
      errEl.textContent = 'Name and email are required.';
      errEl.classList.remove('hidden');
      return;
    }
    if ((newPassword || confirmPassword) && newPassword !== confirmPassword) {
      errEl.textContent = 'Passwords do not match.';
      errEl.classList.remove('hidden');
      return;
    }
    if (newPassword && newPassword.length < 8) {
      errEl.textContent = 'Password must be at least 8 characters.';
      errEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      await updateProfile(staff.id, { full_name: name, email, role });
      if (newPassword) {
        const { error: passwordError } = await supabase.auth.admin.updateUserById(staff.id, { password: newPassword });
        if (passwordError) throw passwordError;
      }
      showToast('Staff member updated successfully!');
      closeModal();
      await reload();
    } catch (err) {
      errEl.textContent = err.message || 'Failed to update staff member';
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });
}
