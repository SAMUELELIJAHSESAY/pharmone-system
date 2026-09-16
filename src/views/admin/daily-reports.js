// Admin Daily Records - paginated daily operations, staff breakdown and cash closing
import {
  generateDailySalesReport,
  getBranches,
  getDailyReportDetail,
  getDailyReportsPage,
  getDailyReportsSummary,
  getStaffBranch,
  saveDailyCashClosing
} from '../../database.js';
import { formatCurrency, formatDateTime, showToast, formatUTCDate } from '../../utils.js';
import { createModal } from '../../components/modal.js';

const PAGE_SIZES = [25, 30, 50];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMethod(value) {
  return String(value || 'other')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function yesterdayIso() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return isoDate(date);
}

function getFilterDateRange(state) {
  if (state.customFrom || state.customTo) {
    return { startDate: state.customFrom || null, endDate: state.customTo || null };
  }
  if (!state.year) return { startDate: null, endDate: null };

  const year = Number(state.year);
  if (state.month !== '') {
    const monthIndex = Number(state.month);
    const start = new Date(Date.UTC(year, monthIndex, 1));
    const end = new Date(Date.UTC(year, monthIndex + 1, 0));
    return { startDate: isoDate(start), endDate: isoDate(end) };
  }

  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

function renderPageButtons(page, totalPages) {
  if (totalPages <= 1) return '';
  const pages = new Set([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...pages].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);
  let previous = 0;
  return sorted.map((value) => {
    const gap = previous && value - previous > 1 ? '<span class="daily-page-gap">…</span>' : '';
    previous = value;
    return `${gap}<button class="btn btn-sm ${value === page ? 'btn-primary' : 'btn-ghost'} daily-page-number" data-page="${value}">${value}</button>`;
  }).join('');
}

function paymentText(payments = {}) {
  const values = Object.entries(payments || {})
    .filter(([, amount]) => Number(amount || 0) > 0)
    .map(([method, amount]) => `${formatMethod(method)}: ${formatCurrency(Number(amount || 0))}`);
  return values.join(' · ') || '—';
}

function buildStaffBreakdown(report) {
  if (Array.isArray(report.staff_breakdown) && report.staff_breakdown.length) {
    return report.staff_breakdown.map((row) => ({
      staffId: row.staff_id || null,
      staffName: row.staff_name || 'Unknown',
      transactions: Number(row.transactions || 0),
      total: Number(row.total || 0)
    })).sort((a, b) => b.total - a.total);
  }

  const byStaff = new Map();
  for (const sale of report.sales_data || []) {
    const key = sale.staff_name || 'Unknown';
    const row = byStaff.get(key) || { staffId: null, staffName: key, transactions: 0, total: 0 };
    row.transactions += 1;
    row.total += Number(sale.amount || 0);
    byStaff.set(key, row);
  }
  return [...byStaff.values()].sort((a, b) => b.total - a.total);
}

function buildTopProducts(report) {
  const products = new Map();
  for (const sale of report.sales_data || []) {
    for (const item of sale.items || []) {
      const key = item.product_name || 'Unknown product';
      const row = products.get(key) || { name: key, quantity: 0, revenue: 0 };
      row.quantity += Number(item.quantity || 0);
      row.revenue += Number(item.total_price || 0);
      products.set(key, row);
    }
  }
  return [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
}

export async function renderDailyReports(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;
  const userRole = user?.profile?.role;

  if (!pharmacyId) {
    container.innerHTML = '<div class="alert alert-warning">No pharmacy linked to your account.</div>';
    return;
  }

  let assignedBranchId = user?.profile?.branch_id || null;
  if (userRole === 'salesman' && !assignedBranchId) {
    try {
      assignedBranchId = await getStaffBranch(user?.id || user?.profile?.id);
    } catch (error) {
      console.warn('Could not resolve salesman branch assignment:', error);
    }
  }

  const currentYear = new Date().getFullYear();
  const state = {
    page: 1,
    pageSize: 30,
    branchId: userRole === 'salesman' ? assignedBranchId : '',
    year: String(currentYear),
    month: '',
    customFrom: '',
    customTo: '',
    closingReady: true,
    loading: false,
    reports: [],
    total: 0,
    totalPages: 1
  };

  let branches = [];
  try {
    branches = await getBranches(pharmacyId);
  } catch (error) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load branches: ${escapeHtml(error.message)}</div>`;
    return;
  }

  const visibleBranches = userRole === 'salesman'
    ? branches.filter((branch) => branch.id === assignedBranchId)
    : branches;
  const branchMap = Object.fromEntries(branches.map((branch) => [branch.id, branch.name]));

  const yearOptions = Array.from({ length: 8 }, (_, index) => currentYear - index)
    .map((year) => `<option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>`)
    .join('');

  container.innerHTML = `
    <div class="animate-in daily-records-workspace">
      <div class="page-header daily-records-header">
        <div>
          <div class="page-title">📊 Daily Records</div>
          <div class="page-subtitle">Daily branch sales, staff performance, expenses and cash closing</div>
        </div>
        ${userRole === 'admin' ? '<button class="btn btn-primary" id="generate-report-btn">+ Generate Daily Report</button>' : ''}
      </div>

      <div id="daily-closing-notice"></div>

      <div class="stats-grid daily-records-stats">
        <div class="stat-card">
          <div class="stat-card-header"><span class="stat-card-label">Reports in Range</span><div class="stat-card-icon blue">📋</div></div>
          <div class="stat-card-value" id="daily-stat-count">—</div>
          <div class="stat-card-sub">Filtered daily records</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header"><span class="stat-card-label">Revenue</span><div class="stat-card-icon teal">💰</div></div>
          <div class="stat-card-value" id="daily-stat-revenue">—</div>
          <div class="stat-card-sub">Completed sales in range</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header"><span class="stat-card-label">Items Sold</span><div class="stat-card-icon green">📦</div></div>
          <div class="stat-card-value" id="daily-stat-items">—</div>
          <div class="stat-card-sub">Across generated reports</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header"><span class="stat-card-label">Closed Days</span><div class="stat-card-icon blue">🔒</div></div>
          <div class="stat-card-value" id="daily-stat-closed">—</div>
          <div class="stat-card-sub" id="daily-stat-open">Cash closing status</div>
        </div>
      </div>

      <div class="card daily-records-card" id="daily-records-card">
        <div class="card-header daily-records-card-header">
          <div>
            <span class="card-title">Daily Branch Records</span>
            <div class="text-xs text-muted" id="daily-filter-caption">Loading records…</div>
          </div>
        </div>

        <div class="daily-records-filters">
          ${userRole === 'admin' ? `
            <label><span>Branch</span><select class="form-select" id="daily-branch-filter"><option value="">All Branches</option>${visibleBranches.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join('')}</select></label>
          ` : ''}
          <label><span>Year</span><select class="form-select" id="daily-year-filter"><option value="">All Years</option>${yearOptions}</select></label>
          <label><span>Month</span><select class="form-select" id="daily-month-filter"><option value="">All Months</option>${MONTHS.map((name, index) => `<option value="${index}">${name}</option>`).join('')}</select></label>
          <label><span>From</span><input class="form-input" type="date" id="daily-from-filter" /></label>
          <label><span>To</span><input class="form-input" type="date" id="daily-to-filter" /></label>
          <label><span>Per page</span><select class="form-select" id="daily-page-size">${PAGE_SIZES.map((size) => `<option value="${size}" ${size === 30 ? 'selected' : ''}>${size}</option>`).join('')}</select></label>
          <button class="btn btn-ghost" id="daily-clear-custom" type="button">Clear custom dates</button>
        </div>
        <div class="daily-custom-range-note">Custom From/To dates override the Year and Month filters.</div>

        <div class="table-container daily-records-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Report Date</th>
                <th>Branch</th>
                <th>Sales</th>
                <th>Transactions</th>
                <th>Items</th>
                <th>Payments</th>
                <th>Closing</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="daily-reports-tbody"><tr><td colspan="8" class="text-center text-muted">Loading daily records…</td></tr></tbody>
          </table>
        </div>

        <div class="daily-pagination-wrap">
          <div class="daily-pagination-info" id="daily-pagination-info">—</div>
          <div class="daily-pagination" id="daily-pagination"></div>
        </div>
      </div>
    </div>
  `;

  const els = {
    card: container.querySelector('#daily-records-card'),
    tbody: container.querySelector('#daily-reports-tbody'),
    count: container.querySelector('#daily-stat-count'),
    revenue: container.querySelector('#daily-stat-revenue'),
    items: container.querySelector('#daily-stat-items'),
    closed: container.querySelector('#daily-stat-closed'),
    open: container.querySelector('#daily-stat-open'),
    caption: container.querySelector('#daily-filter-caption'),
    paginationInfo: container.querySelector('#daily-pagination-info'),
    pagination: container.querySelector('#daily-pagination'),
    notice: container.querySelector('#daily-closing-notice'),
    branch: container.querySelector('#daily-branch-filter'),
    year: container.querySelector('#daily-year-filter'),
    month: container.querySelector('#daily-month-filter'),
    from: container.querySelector('#daily-from-filter'),
    to: container.querySelector('#daily-to-filter'),
    pageSize: container.querySelector('#daily-page-size'),
    clearCustom: container.querySelector('#daily-clear-custom')
  };

  const renderRows = () => {
    if (!state.reports.length) {
      els.tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">No daily records found</div><div class="empty-state-text">Adjust the filters or generate a daily report.</div></div></td></tr>';
      return;
    }

    els.tbody.innerHTML = state.reports.map((report) => {
      const closing = state.closingReady
        ? `<span class="badge ${report.closing_status === 'closed' ? 'badge-success' : 'badge-warning'}">${report.closing_status === 'closed' ? 'Closed' : 'Open'}</span>`
        : '<span class="badge">Not enabled</span>';
      const transactions = Number(report.total_transactions || 0) || '—';
      return `
        <tr>
          <td data-label="Report Date" class="font-semibold">${formatUTCDate(report.report_date)}</td>
          <td data-label="Branch">${escapeHtml(branchMap[report.branch_id] || 'Unknown branch')}</td>
          <td data-label="Sales" class="font-semibold text-success">${formatCurrency(Number(report.total_sales || 0))}</td>
          <td data-label="Transactions">${transactions}</td>
          <td data-label="Items">${Number(report.total_items_sold || 0)}</td>
          <td data-label="Payments"><span class="daily-payment-summary">${escapeHtml(paymentText(report.payment_breakdown || {}))}</span></td>
          <td data-label="Closing">${closing}</td>
          <td data-label="Actions"><button class="btn btn-ghost btn-sm daily-view-report" data-id="${report.id}">View Details</button></td>
        </tr>
      `;
    }).join('');
  };

  const renderPagination = () => {
    const start = state.total ? ((state.page - 1) * state.pageSize) + 1 : 0;
    const end = Math.min(state.page * state.pageSize, state.total);
    els.paginationInfo.textContent = `Showing ${start}–${end} of ${state.total} daily records · Page ${state.page} of ${state.totalPages}`;
    els.pagination.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="daily-prev-page" ${state.page <= 1 ? 'disabled' : ''}>← Previous</button>
      ${renderPageButtons(state.page, state.totalPages)}
      <button class="btn btn-ghost btn-sm" id="daily-next-page" ${state.page >= state.totalPages ? 'disabled' : ''}>Next →</button>
    `;
  };

  const showClosingNotice = () => {
    els.notice.innerHTML = state.closingReady ? '' : `
      <div class="alert alert-info daily-closing-upgrade-notice">
        <strong>Daily closing upgrade available.</strong> Apply <code>20260916080000_upgrade_daily_records_closing.sql</code> in Supabase to enable cash reconciliation, expenses/returns snapshots, staff summaries and closed-day status.
      </div>
    `;
  };

  const loadData = async () => {
    if (state.loading) return;
    state.loading = true;
    els.card?.setAttribute('aria-busy', 'true');
    els.tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Loading daily records…</td></tr>';

    try {
      const { startDate, endDate } = getFilterDateRange(state);
      const [pageResult, summary] = await Promise.all([
        getDailyReportsPage(pharmacyId, {
          branchId: state.branchId || null,
          page: state.page,
          pageSize: state.pageSize,
          startDate,
          endDate
        }),
        getDailyReportsSummary(pharmacyId, {
          branchId: state.branchId || null,
          startDate,
          endDate
        })
      ]);

      state.closingReady = Boolean(pageResult.closingReady && summary.closingReady);
      state.total = pageResult.total;
      state.totalPages = pageResult.totalPages;
      if (state.page > state.totalPages) {
        state.page = state.totalPages;
        state.loading = false;
        els.card?.removeAttribute('aria-busy');
        return loadData();
      }
      state.reports = pageResult.data;

      els.count.textContent = summary.totalReports.toLocaleString();
      els.revenue.textContent = formatCurrency(summary.totalRevenue);
      els.items.textContent = summary.totalItems.toLocaleString();
      els.closed.textContent = state.closingReady ? summary.closedDays.toLocaleString() : '—';
      els.open.textContent = state.closingReady ? `${summary.openDays.toLocaleString()} day(s) still open` : 'Apply daily closing migration';

      const branchName = state.branchId ? branchMap[state.branchId] || 'Selected branch' : 'All branches';
      const rangeLabel = startDate || endDate ? `${startDate || 'Beginning'} → ${endDate || 'Today'}` : 'All dates';
      els.caption.textContent = `${branchName} · ${rangeLabel}`;

      showClosingNotice();
      renderRows();
      renderPagination();
      bindRowActions();
      bindPagination();
    } catch (error) {
      console.error('Failed to load daily records:', error);
      els.tbody.innerHTML = `<tr><td colspan="8"><div class="alert alert-danger">Failed to load daily records: ${escapeHtml(error.message)}</div></td></tr>`;
    } finally {
      state.loading = false;
      els.card?.removeAttribute('aria-busy');
    }
  };

  const bindPagination = () => {
    container.querySelector('#daily-prev-page')?.addEventListener('click', () => {
      if (state.page > 1) { state.page -= 1; loadData(); }
    });
    container.querySelector('#daily-next-page')?.addEventListener('click', () => {
      if (state.page < state.totalPages) { state.page += 1; loadData(); }
    });
    container.querySelectorAll('.daily-page-number').forEach((button) => {
      button.addEventListener('click', () => {
        state.page = Number(button.dataset.page || 1);
        loadData();
      });
    });
  };

  const bindRowActions = () => {
    container.querySelectorAll('.daily-view-report').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        const original = button.textContent;
        button.textContent = 'Loading…';
        try {
          const report = await getDailyReportDetail(button.dataset.id);
          await showReportDetail({
            report,
            branchName: branchMap[report.branch_id] || 'Unknown branch',
            userRole,
            closingReady: state.closingReady,
            onChanged: loadData
          });
        } catch (error) {
          showToast(`Could not load daily record: ${error.message}`, 'error');
        } finally {
          button.disabled = false;
          button.textContent = original;
        }
      });
    });
  };

  const clearCustomDates = () => {
    state.customFrom = '';
    state.customTo = '';
    if (els.from) els.from.value = '';
    if (els.to) els.to.value = '';
    state.page = 1;
    loadData();
  };

  els.branch?.addEventListener('change', () => { state.branchId = els.branch.value; state.page = 1; loadData(); });
  els.year?.addEventListener('change', () => { state.year = els.year.value; clearCustomDates(); });
  els.month?.addEventListener('change', () => { state.month = els.month.value; clearCustomDates(); });
  els.from?.addEventListener('change', () => { state.customFrom = els.from.value; state.page = 1; loadData(); });
  els.to?.addEventListener('change', () => { state.customTo = els.to.value; state.page = 1; loadData(); });
  els.pageSize?.addEventListener('change', () => { state.pageSize = Number(els.pageSize.value || 30); state.page = 1; loadData(); });
  els.clearCustom?.addEventListener('click', clearCustomDates);

  if (userRole === 'admin') {
    container.querySelector('#generate-report-btn')?.addEventListener('click', () => showGenerateReportModal({
      pharmacyId,
      branches: visibleBranches,
      onGenerated: loadData
    }));
  }

  await loadData();

  // Idempotently backfill yesterday for active branches when an Admin opens
  // Daily Records. This provides automatic maintenance without requiring pg_cron.
  if (userRole === 'admin') {
    const date = yesterdayIso();
    const sessionKey = `sammia-daily-auto-${pharmacyId}-${date}`;
    if (!sessionStorage.getItem(sessionKey)) {
      sessionStorage.setItem(sessionKey, 'running');
      Promise.allSettled(
        visibleBranches.filter((branch) => branch.is_active !== false).map((branch) => generateDailySalesReport(pharmacyId, branch.id, date))
      ).then((results) => {
        sessionStorage.setItem(sessionKey, 'done');
        if (results.some((result) => result.status === 'fulfilled') && document.body.contains(container)) loadData();
      });
    }
  }
}

function showGenerateReportModal({ pharmacyId, branches, onGenerated }) {
  const { overlay, closeModal } = createModal({
    id: 'generate-report',
    title: 'Generate Daily Report',
    body: `
      <div class="daily-generate-form">
        <label><span>Branch</span><select id="gen-branch-select" class="form-select"><option value="">Select a branch</option>${branches.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join('')}</select></label>
        <label><span>Report Date</span><input type="date" id="gen-report-date" class="form-input" value="${isoDate(new Date())}" /></label>
        <div id="gen-report-error" class="alert alert-danger hidden"></div>
      </div>
    `,
    footer: '<button class="btn btn-ghost" id="gen-report-cancel">Cancel</button><button class="btn btn-primary" id="gen-report-confirm">Generate / Refresh</button>'
  });

  overlay.querySelector('#gen-report-cancel')?.addEventListener('click', closeModal);
  overlay.querySelector('#gen-report-confirm')?.addEventListener('click', async () => {
    const branchId = overlay.querySelector('#gen-branch-select')?.value;
    const reportDate = overlay.querySelector('#gen-report-date')?.value;
    const errorEl = overlay.querySelector('#gen-report-error');
    const button = overlay.querySelector('#gen-report-confirm');
    errorEl?.classList.add('hidden');
    if (!branchId || !reportDate) {
      if (errorEl) { errorEl.textContent = 'Select a branch and report date.'; errorEl.classList.remove('hidden'); }
      return;
    }

    button.disabled = true;
    button.textContent = 'Generating…';
    try {
      await generateDailySalesReport(pharmacyId, branchId, reportDate);
      showToast('Daily report generated successfully', 'success');
      closeModal();
      await onGenerated?.();
    } catch (error) {
      if (errorEl) { errorEl.textContent = `Error: ${error.message}`; errorEl.classList.remove('hidden'); }
      button.disabled = false;
      button.textContent = 'Generate / Refresh';
    }
  });
}

async function showReportDetail({ report, branchName, userRole, closingReady, onChanged }) {
  const salesData = Array.isArray(report.sales_data) ? report.sales_data : [];
  const payments = report.payment_breakdown || {};
  const staff = buildStaffBreakdown(report);
  const topProducts = buildTopProducts(report);
  const transactions = Number(report.total_transactions || 0) || salesData.length;
  const approvedExpenses = Number(report.approved_expenses || 0);
  const recordedReturns = Number(report.recorded_returns || 0);
  const operatingResult = Number(report.total_sales || 0) - approvedExpenses;

  const paymentCards = Object.entries(payments)
    .filter(([, amount]) => Number(amount || 0) > 0)
    .map(([method, amount]) => `<div class="daily-breakdown-row"><span>${formatMethod(method)}</span><strong>${formatCurrency(Number(amount || 0))}</strong></div>`)
    .join('') || '<div class="text-muted">No payment data</div>';

  const staffRows = staff.length
    ? staff.map((row) => `<tr><td>${escapeHtml(row.staffName)}</td><td>${row.transactions}</td><td class="text-success font-semibold">${formatCurrency(row.total)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="text-center text-muted">No staff sales recorded</td></tr>';

  const productRows = topProducts.length
    ? topProducts.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.quantity}</td><td class="text-success font-semibold">${formatCurrency(row.revenue)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="text-center text-muted">No product data recorded</td></tr>';

  const saleRows = salesData.slice(0, 30).map((sale) => `
    <tr>
      <td>${escapeHtml(sale.invoice_number || '—')}</td>
      <td>${escapeHtml(sale.customer_name || 'Walk-in')}</td>
      <td>${escapeHtml(sale.staff_name || 'Unknown')}</td>
      <td>${formatMethod(sale.payment_method)}</td>
      <td class="text-success font-semibold">${formatCurrency(Number(sale.amount || 0))}</td>
      <td>${sale.created_at ? formatDateTime(sale.created_at) : '—'}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-center text-muted">No transaction detail stored</td></tr>';

  const closingStatus = report.closing_status || 'open';
  const variance = Number(report.cash_variance || 0);
  const varianceClass = variance === 0 ? '' : variance > 0 ? 'text-success' : 'text-danger';
  const closingBody = closingReady ? `
    <div class="daily-closing-grid">
      <div><span>Status</span><strong><span class="badge ${closingStatus === 'closed' ? 'badge-success' : 'badge-warning'}">${closingStatus === 'closed' ? 'Closed' : 'Open'}</span></strong></div>
      <div><span>Opening Cash</span><strong>${formatCurrency(Number(report.opening_cash || 0))}</strong></div>
      <div><span>Cash Sales</span><strong>${formatCurrency(Number(payments.cash || 0))}</strong></div>
      <div><span>Cash Expenses</span><strong>${formatCurrency(Number(report.cash_expenses || 0))}</strong></div>
      <div><span>Expected Cash</span><strong>${formatCurrency(Number(report.expected_cash || 0))}</strong></div>
      <div><span>Actual Cash</span><strong>${report.actual_cash == null ? '—' : formatCurrency(Number(report.actual_cash || 0))}</strong></div>
      <div><span>Variance</span><strong class="${varianceClass}">${report.actual_cash == null ? '—' : formatCurrency(variance)}</strong></div>
      <div><span>Closed At</span><strong>${report.closed_at ? formatDateTime(report.closed_at) : '—'}</strong></div>
    </div>
    ${report.closing_notes ? `<div class="daily-closing-notes"><strong>Closing Notes</strong><p>${escapeHtml(report.closing_notes)}</p></div>` : ''}
  ` : `
    <div class="alert alert-info">Apply the latest daily-records Supabase migration to enable cash reconciliation and closed-day tracking.</div>
  `;

  const footer = `
    <button class="btn btn-ghost" id="daily-detail-export">Export CSV</button>
    <button class="btn btn-ghost" id="daily-detail-print">Print</button>
    ${userRole === 'admin' && closingReady ? `<button class="btn btn-primary" id="daily-detail-close-day">${closingStatus === 'closed' ? 'Update Closing' : 'Close Day'}</button>` : ''}
    <button class="btn btn-ghost" id="daily-detail-dismiss">Close</button>
  `;

  const { overlay, closeModal } = createModal({
    id: 'daily-report-detail',
    title: `${formatUTCDate(report.report_date)} · ${escapeHtml(branchName)}`,
    size: 'modal-xl',
    body: `
      <div class="daily-detail-summary-grid">
        <div class="daily-detail-metric"><span>Total Sales</span><strong>${formatCurrency(Number(report.total_sales || 0))}</strong></div>
        <div class="daily-detail-metric"><span>Transactions</span><strong>${transactions.toLocaleString()}</strong></div>
        <div class="daily-detail-metric"><span>Items Sold</span><strong>${Number(report.total_items_sold || 0).toLocaleString()}</strong></div>
        <div class="daily-detail-metric"><span>Approved Expenses</span><strong>${formatCurrency(approvedExpenses)}</strong></div>
        <div class="daily-detail-metric"><span>Recorded Returns</span><strong>${formatCurrency(recordedReturns)}</strong></div>
        <div class="daily-detail-metric"><span>Revenue − Expenses</span><strong>${formatCurrency(operatingResult)}</strong></div>
      </div>

      <div class="daily-detail-note">Recorded returns are shown separately. They are not deducted again from the operating result because return accounting is being normalized separately.</div>

      <div class="daily-detail-two-col">
        <section class="daily-detail-section"><h4>Payment Breakdown</h4><div class="daily-breakdown-box">${paymentCards}</div></section>
        <section class="daily-detail-section"><h4>Cash Reconciliation</h4>${closingBody}</section>
      </div>

      <section class="daily-detail-section"><h4>Staff Performance</h4><div class="table-container"><table><thead><tr><th>Staff</th><th>Transactions</th><th>Sales</th></tr></thead><tbody>${staffRows}</tbody></table></div></section>
      <section class="daily-detail-section"><h4>Top Products</h4><div class="table-container"><table><thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead><tbody>${productRows}</tbody></table></div></section>
      <section class="daily-detail-section"><h4>Transactions <span class="text-xs text-muted">${salesData.length > 30 ? `(showing first 30 of ${salesData.length})` : `(${salesData.length})`}</span></h4><div class="table-container daily-detail-sales-table"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Staff</th><th>Payment</th><th>Amount</th><th>Time</th></tr></thead><tbody>${saleRows}</tbody></table></div></section>
    `,
    footer
  });

  overlay.querySelector('#daily-detail-dismiss')?.addEventListener('click', closeModal);
  overlay.querySelector('#daily-detail-export')?.addEventListener('click', () => exportDailyReportCsv(report, branchName, staff, topProducts));
  overlay.querySelector('#daily-detail-print')?.addEventListener('click', () => printDailyReport(report, branchName, staff, topProducts));
  overlay.querySelector('#daily-detail-close-day')?.addEventListener('click', () => {
    showCashClosingModal({
      report,
      branchName,
      onSaved: async () => {
        closeModal();
        await onChanged?.();
      }
    });
  });
}

function showCashClosingModal({ report, branchName, onSaved }) {
  const cashSales = Number(report.payment_breakdown?.cash || 0);
  const cashExpenses = Number(report.cash_expenses || 0);
  const existingOpening = Number(report.opening_cash || 0);
  const existingActual = report.actual_cash == null ? '' : Number(report.actual_cash || 0);

  const { overlay, closeModal } = createModal({
    id: 'daily-cash-closing',
    title: `${report.closing_status === 'closed' ? 'Update' : 'Close'} Day · ${escapeHtml(branchName)}`,
    body: `
      <div class="daily-cash-form">
        <div class="daily-cash-context"><div><span>Report Date</span><strong>${formatUTCDate(report.report_date)}</strong></div><div><span>Cash Sales</span><strong>${formatCurrency(cashSales)}</strong></div><div><span>Approved Cash Expenses</span><strong>${formatCurrency(cashExpenses)}</strong></div></div>
        <label><span>Opening Cash</span><input class="form-input" type="number" min="0" step="0.01" id="daily-opening-cash" value="${existingOpening}" /></label>
        <label><span>Expected Cash</span><input class="form-input" id="daily-expected-cash" readonly /></label>
        <label><span>Actual Cash Counted</span><input class="form-input" type="number" min="0" step="0.01" id="daily-actual-cash" value="${existingActual}" placeholder="Counted cash" /></label>
        <div class="daily-cash-variance"><span>Variance</span><strong id="daily-cash-variance-value">—</strong></div>
        <label class="daily-cash-notes"><span>Closing Notes</span><textarea class="form-input" id="daily-closing-notes" rows="3" placeholder="Optional explanation for shortages/overages">${escapeHtml(report.closing_notes || '')}</textarea></label>
        <div id="daily-closing-error" class="alert alert-danger hidden"></div>
      </div>
    `,
    footer: '<button class="btn btn-ghost" id="daily-closing-cancel">Cancel</button><button class="btn btn-primary" id="daily-closing-save">Save Closing</button>'
  });

  const openingInput = overlay.querySelector('#daily-opening-cash');
  const actualInput = overlay.querySelector('#daily-actual-cash');
  const expectedInput = overlay.querySelector('#daily-expected-cash');
  const varianceEl = overlay.querySelector('#daily-cash-variance-value');

  const recalc = () => {
    const opening = Number(openingInput?.value || 0);
    const actual = actualInput?.value === '' ? null : Number(actualInput?.value || 0);
    const expected = opening + cashSales - cashExpenses;
    if (expectedInput) expectedInput.value = formatCurrency(expected);
    if (varianceEl) {
      if (actual == null) {
        varianceEl.textContent = '—';
        varianceEl.className = '';
      } else {
        const variance = actual - expected;
        varianceEl.textContent = formatCurrency(variance);
        varianceEl.className = variance === 0 ? '' : variance > 0 ? 'text-success' : 'text-danger';
      }
    }
  };
  openingInput?.addEventListener('input', recalc);
  actualInput?.addEventListener('input', recalc);
  recalc();

  overlay.querySelector('#daily-closing-cancel')?.addEventListener('click', closeModal);
  overlay.querySelector('#daily-closing-save')?.addEventListener('click', async () => {
    const actualValue = actualInput?.value;
    const errorEl = overlay.querySelector('#daily-closing-error');
    const saveButton = overlay.querySelector('#daily-closing-save');
    errorEl?.classList.add('hidden');
    if (actualValue === '' || Number(actualValue) < 0) {
      if (errorEl) { errorEl.textContent = 'Enter the actual cash counted before closing the day.'; errorEl.classList.remove('hidden'); }
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
      await saveDailyCashClosing(report.id, {
        openingCash: Number(openingInput?.value || 0),
        actualCash: Number(actualValue),
        notes: overlay.querySelector('#daily-closing-notes')?.value || ''
      });
      showToast('Daily cash closing saved', 'success');
      closeModal();
      await onSaved?.();
    } catch (error) {
      if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); }
      saveButton.disabled = false;
      saveButton.textContent = 'Save Closing';
    }
  });
}

function exportDailyReportCsv(report, branchName, staff, topProducts) {
  const rows = [
    ['Daily Record', report.report_date],
    ['Branch', branchName],
    ['Total Sales', Number(report.total_sales || 0).toFixed(2)],
    ['Transactions', Number(report.total_transactions || 0) || (report.sales_data || []).length],
    ['Items Sold', Number(report.total_items_sold || 0)],
    ['Approved Expenses', Number(report.approved_expenses || 0).toFixed(2)],
    ['Recorded Returns', Number(report.recorded_returns || 0).toFixed(2)],
    ['Opening Cash', Number(report.opening_cash || 0).toFixed(2)],
    ['Expected Cash', Number(report.expected_cash || 0).toFixed(2)],
    ['Actual Cash', report.actual_cash == null ? '' : Number(report.actual_cash || 0).toFixed(2)],
    ['Cash Variance', report.actual_cash == null ? '' : Number(report.cash_variance || 0).toFixed(2)],
    [],
    ['Staff Performance'],
    ['Staff', 'Transactions', 'Sales'],
    ...staff.map((row) => [row.staffName, row.transactions, row.total.toFixed(2)]),
    [],
    ['Top Products'],
    ['Product', 'Quantity', 'Revenue'],
    ...topProducts.map((row) => [row.name, row.quantity, row.revenue.toFixed(2)])
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `daily_record_${report.report_date}_${branchName.replace(/[^a-z0-9]+/gi, '_')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function printDailyReport(report, branchName, staff, topProducts) {
  const win = window.open('', '_blank', 'width=980,height=760');
  if (!win) {
    showToast('Allow pop-ups to print the daily record.', 'warning');
    return;
  }
  const payments = Object.entries(report.payment_breakdown || {}).filter(([, amount]) => Number(amount || 0) > 0);
  win.document.write(`<!doctype html><html><head><title>Daily Record ${escapeHtml(report.report_date)}</title><style>body{font-family:Inter,Arial,sans-serif;color:#0f172a;padding:32px}h1{margin:0 0 4px}.muted{color:#64748b}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.card{border:1px solid #e5e7eb;border-radius:10px;padding:14px}table{border-collapse:collapse;width:100%;margin:12px 0 26px}th,td{border-bottom:1px solid #e5e7eb;padding:9px;text-align:left}th{background:#f8fafc}.money{font-weight:700}</style></head><body>
    <h1>SamMia Pharm · Daily Record</h1><div class="muted">${escapeHtml(branchName)} · ${escapeHtml(formatUTCDate(report.report_date))}</div>
    <div class="grid"><div class="card">Sales<br><span class="money">${formatCurrency(Number(report.total_sales || 0))}</span></div><div class="card">Transactions<br><strong>${Number(report.total_transactions || 0) || (report.sales_data || []).length}</strong></div><div class="card">Items Sold<br><strong>${Number(report.total_items_sold || 0)}</strong></div><div class="card">Approved Expenses<br><span class="money">${formatCurrency(Number(report.approved_expenses || 0))}</span></div><div class="card">Recorded Returns<br><span class="money">${formatCurrency(Number(report.recorded_returns || 0))}</span></div><div class="card">Cash Variance<br><span class="money">${report.actual_cash == null ? '—' : formatCurrency(Number(report.cash_variance || 0))}</span></div></div>
    <h2>Payment Breakdown</h2><table><tbody>${payments.map(([method, amount]) => `<tr><td>${escapeHtml(formatMethod(method))}</td><td>${formatCurrency(Number(amount || 0))}</td></tr>`).join('') || '<tr><td>No payment data</td><td></td></tr>'}</tbody></table>
    <h2>Staff Performance</h2><table><thead><tr><th>Staff</th><th>Transactions</th><th>Sales</th></tr></thead><tbody>${staff.map((row) => `<tr><td>${escapeHtml(row.staffName)}</td><td>${row.transactions}</td><td>${formatCurrency(row.total)}</td></tr>`).join('') || '<tr><td colspan="3">No staff data</td></tr>'}</tbody></table>
    <h2>Top Products</h2><table><thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead><tbody>${topProducts.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.quantity}</td><td>${formatCurrency(row.revenue)}</td></tr>`).join('') || '<tr><td colspan="3">No product data</td></tr>'}</tbody></table>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}
