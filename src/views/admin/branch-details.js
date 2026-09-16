// Branch Details Dashboard
import { supabase } from '../../config.js';
import {
  getBranchDetails,
  getBranchDashboard,
  getBranchAssignments,
  getBranchStaffSalesStats,
  getSalesForReport,
  updateBranchDetails,
  getPharmacyStaff,
  assignStaffToBranch,
  getProductsPage,
  getSalesPage,
  getSalesFilteredSummary,
  getExpensesPage,
  getExpenseReport,
  getInventorySummary
} from '../../database.js';
import { createModal } from '../../components/modal.js';
import { showToast, formatCurrency, formatUTCDate, formatUTCDateTime } from '../../utils.js';
import { isViewLifecycleActive } from '../../view-lifecycle.js';

const branchState = {
  inventory: { page: 1, pageSize: 30, search: '', filter: '' },
  sales: { page: 1, pageSize: 30, search: '', preset: 'month', paymentMethod: '' },
  expenses: { page: 1, pageSize: 30, preset: 'month' }
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function getUtcRange(preset) {
  if (preset === 'all') return { start: null, end: null, startDate: null, endDate: null };
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let start = new Date(today);
  let end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 1);

  if (preset === 'week') {
    const mondayOffset = (today.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - mondayOffset);
  } else if (preset === 'month') {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  } else if (preset === 'year') {
    start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    end = new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1));
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: start.toISOString().slice(0, 10),
    endDate: new Date(end.getTime() - 1).toISOString().slice(0, 10)
  };
}

function pagerMarkup(prefix, result) {
  const totalPages = Math.max(1, Number(result.totalPages || Math.ceil((result.total || 0) / result.pageSize) || 1));
  const page = Math.max(1, Number(result.page || 1));
  const total = Number(result.total || 0);
  const start = total ? ((page - 1) * result.pageSize) + 1 : 0;
  const end = Math.min(total, page * result.pageSize);
  return `
    <div class="branch-pager" data-pager="${prefix}">
      <span>Showing ${start}–${end} of ${total}</span>
      <div class="branch-pager-actions">
        <button class="btn btn-ghost btn-sm" data-page-action="prev" ${page <= 1 ? 'disabled' : ''}>Previous</button>
        <strong>Page ${page} of ${totalPages}</strong>
        <button class="btn btn-ghost btn-sm" data-page-action="next" ${page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    </div>`;
}

export function renderBranchDetailsView(branchId, pharmacyId, lifecycleToken) {
  const mainContent = document.getElementById('page-content');
  window.currentPharmacyId = pharmacyId;
  window.currentBranchId = branchId;
  branchState.inventory = { page: 1, pageSize: 30, search: '', filter: '' };
  branchState.sales = { page: 1, pageSize: 30, search: '', preset: 'month', paymentMethod: '' };
  branchState.expenses = { page: 1, pageSize: 30, preset: 'month' };

  mainContent.innerHTML = `
    <div class="branch-details-container animate-in">
      <div class="branch-workspace-header">
        <div>
          <button id="back-to-branches-btn" class="btn btn-ghost btn-sm">← Branches</button>
          <h1 id="branch-name">Loading...</h1>
          <p id="branch-subtitle" class="text-muted">Branch operations workspace</p>
        </div>
        <span id="branch-status-badge" class="badge badge-gray">Loading</span>
      </div>

      <div class="tabs branch-workspace-tabs">
        <button class="tab-btn active" data-tab="overview">📊 Overview</button>
        <button class="tab-btn" data-tab="staff">👥 Staff</button>
        <button class="tab-btn" data-tab="sales">💰 Sales</button>
        <button class="tab-btn" data-tab="inventory">📦 Inventory</button>
        <button class="tab-btn" data-tab="expenses">💵 Expenses</button>
        <button class="tab-btn" data-tab="reports">📈 Reports</button>
        <button class="tab-btn" data-tab="details">ℹ️ Details</button>
      </div>

      <div id="overview-tab" class="tab-content">
        <div class="branch-overview-grid">
          ${[
            ['Today Sales', 'daily-sales'], ['This Week', 'weekly-revenue'], ['This Month', 'monthly-revenue'],
            ['Transactions Today', 'today-transactions'], ['Staff', 'staff-count'], ['Products', 'product-count'],
            ['Low Stock', 'low-stock-count'], ['Expired', 'expired-count'], ['Expiring 30 Days', 'expiring-count'],
            ['Month Expenses', 'month-expenses'], ['Revenue − Expenses', 'operating-balance'], ['Unread Alerts', 'alert-count']
          ].map(([label,id]) => `<div class="metric-card branch-overview-card"><div class="metric-label">${label}</div><div class="metric-value" id="${id}">—</div></div>`).join('')}
        </div>
        <div class="section branch-recent-section">
          <div class="section-heading-row"><h3>Recent Sales Activity</h3><button class="btn btn-ghost btn-sm" data-jump-tab="sales">View Sales</button></div>
          <div id="recent-activity" class="activity-list"><p>Loading...</p></div>
        </div>
      </div>

      <div id="staff-tab" class="tab-content" style="display:none">
        <div class="section">
          <div class="section-heading-row"><div><h3>Branch Staff</h3><p class="text-muted text-sm">Assignments and sales performance for this branch.</p></div><button class="btn btn-primary" id="assign-staff-btn">+ Assign Staff</button></div>
          <div class="table-responsive"><table class="data-table responsive-data-table">
            <thead><tr><th>Name</th><th>Role</th><th>Daily Sales</th><th>Total Sales</th><th>Transactions</th><th>Actions</th></tr></thead>
            <tbody id="staff-table"><tr><td colspan="6">Loading...</td></tr></tbody>
          </table></div>
        </div>
      </div>

      <div id="sales-tab" class="tab-content" style="display:none">
        <div class="section">
          <div class="section-heading-row"><div><h3>Branch Sales</h3><p class="text-muted text-sm">Only the visible page of transactions is loaded.</p></div></div>
          <div class="branch-filter-grid">
            <input type="search" id="branch-sales-search" class="form-input" placeholder="Invoice or customer..." />
            <select id="branch-sales-period" class="form-select"><option value="today">Today</option><option value="week">This Week</option><option value="month" selected>This Month</option><option value="year">This Year</option><option value="all">All Time</option></select>
            <select id="branch-sales-payment" class="form-select"><option value="">All payments</option><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option></select>
            <select id="branch-sales-page-size" class="form-select"><option value="25">25 / page</option><option value="30" selected>30 / page</option><option value="50">50 / page</option></select>
          </div>
          <div class="branch-inline-summary" id="branch-sales-summary"><div><span>Revenue</span><strong>—</strong></div><div><span>Transactions</span><strong>—</strong></div><div><span>Average Sale</span><strong>—</strong></div></div>
          <div class="table-responsive"><table class="data-table responsive-data-table">
            <thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Payment</th><th>Staff</th><th>Status</th><th>Date</th></tr></thead>
            <tbody id="sales-table"><tr><td colspan="7">Loading...</td></tr></tbody>
          </table></div>
          <div id="branch-sales-pager"></div>
        </div>
      </div>

      <div id="inventory-tab" class="tab-content" style="display:none">
        <div class="section">
          <div class="section-heading-row"><div><h3>Branch Inventory</h3><p class="text-muted text-sm">Server-side product paging keeps large branch inventories responsive.</p></div></div>
          <div class="branch-filter-grid branch-inventory-filters">
            <input type="search" id="inventory-search" class="form-input" placeholder="Search products..." />
            <select id="stock-filter" class="form-select"><option value="">All stock</option><option value="low-stock">Low stock</option><option value="expired">Expired</option><option value="expiring-30">Expiring in 30 days</option><option value="no-expiry">No expiry date</option></select>
            <select id="branch-inventory-page-size" class="form-select"><option value="25">25 / page</option><option value="30" selected>30 / page</option><option value="50">50 / page</option></select>
          </div>
          <div class="table-responsive"><table class="data-table responsive-data-table">
            <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Status</th><th>Expiry</th></tr></thead>
            <tbody id="inventory-table"><tr><td colspan="5">Loading...</td></tr></tbody>
          </table></div>
          <div id="branch-inventory-pager"></div>
        </div>
      </div>

      <div id="expenses-tab" class="tab-content" style="display:none">
        <div class="section">
          <div class="section-heading-row"><div><h3>Branch Expenses</h3><p class="text-muted text-sm">Expense ledger scoped to this location.</p></div></div>
          <div class="branch-filter-grid compact">
            <select id="branch-expense-period" class="form-select"><option value="today">Today</option><option value="week">This Week</option><option value="month" selected>This Month</option><option value="year">This Year</option><option value="all">All Time</option></select>
            <select id="branch-expense-page-size" class="form-select"><option value="25">25 / page</option><option value="30" selected>30 / page</option><option value="50">50 / page</option></select>
          </div>
          <div class="branch-inline-summary" id="branch-expense-summary"><div><span>Total Expenses</span><strong>—</strong></div><div><span>Entries</span><strong>—</strong></div></div>
          <div class="table-responsive"><table class="data-table responsive-data-table">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Payment</th><th>Status</th></tr></thead>
            <tbody id="branch-expenses-table"><tr><td colspan="6">Loading...</td></tr></tbody>
          </table></div>
          <div id="branch-expenses-pager"></div>
        </div>
      </div>

      <div id="reports-tab" class="tab-content" style="display:none">
        <div class="section">
          <div class="section-heading-row"><div><h3>Branch Report Snapshot</h3><p class="text-muted text-sm">Revenue, expenses and inventory health for a selected period.</p></div></div>
          <div class="branch-report-controls"><select id="branch-report-period" class="form-select"><option value="today">Today</option><option value="week">This Week</option><option value="month" selected>This Month</option><option value="year">This Year</option></select><button id="load-branch-report" class="btn btn-primary">Generate Snapshot</button></div>
          <div id="branch-report-content" class="branch-report-content"><div class="empty-state"><div class="empty-state-title">Generate a branch snapshot</div><div class="empty-state-desc">Choose a period to review revenue, expenses and inventory health.</div></div></div>
        </div>
      </div>

      <div id="details-tab" class="tab-content" style="display:none">
        <div class="section branch-details-form-section">
          <h3>Branch Information</h3>
          <form id="branch-details-form">
            <div class="form-row"><div class="form-group"><label>Branch Name</label><input type="text" id="branch-name-input" class="form-control" required></div><div class="form-group"><label>Location</label><input type="text" id="branch-location" class="form-control"></div></div>
            <div class="form-row"><div class="form-group"><label>Contact Person</label><input type="text" id="branch-contact-person" class="form-control"></div><div class="form-group"><label>Phone</label><input type="tel" id="branch-phone" class="form-control"></div></div>
            <div class="form-row"><div class="form-group"><label>Email</label><input type="email" id="branch-email" class="form-control"></div></div>
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </form>
        </div>
      </div>
    </div>`;

  document.getElementById('back-to-branches-btn')?.addEventListener('click', () => window.navigate('branches'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchBranchTab(btn.dataset.tab)));
  document.querySelectorAll('[data-jump-tab]').forEach(btn => btn.addEventListener('click', () => switchBranchTab(btn.dataset.jumpTab)));
  document.getElementById('assign-staff-btn')?.addEventListener('click', openAssignStaffModal);
  document.getElementById('branch-details-form')?.addEventListener('submit', event => saveBranchDetails(event, branchId));

  let inventoryTimer;
  document.getElementById('inventory-search')?.addEventListener('input', event => {
    clearTimeout(inventoryTimer);
    inventoryTimer = setTimeout(() => { branchState.inventory.search = event.target.value; branchState.inventory.page = 1; loadBranchInventory(branchId, pharmacyId); }, 300);
  });
  document.getElementById('stock-filter')?.addEventListener('change', event => { branchState.inventory.filter = event.target.value; branchState.inventory.page = 1; loadBranchInventory(branchId, pharmacyId); });
  document.getElementById('branch-inventory-page-size')?.addEventListener('change', event => { branchState.inventory.pageSize = Number(event.target.value); branchState.inventory.page = 1; loadBranchInventory(branchId, pharmacyId); });

  let salesTimer;
  document.getElementById('branch-sales-search')?.addEventListener('input', event => {
    clearTimeout(salesTimer);
    salesTimer = setTimeout(() => { branchState.sales.search = event.target.value; branchState.sales.page = 1; loadBranchSales(branchId, pharmacyId); }, 300);
  });
  document.getElementById('branch-sales-period')?.addEventListener('change', event => { branchState.sales.preset = event.target.value; branchState.sales.page = 1; loadBranchSales(branchId, pharmacyId); });
  document.getElementById('branch-sales-payment')?.addEventListener('change', event => { branchState.sales.paymentMethod = event.target.value; branchState.sales.page = 1; loadBranchSales(branchId, pharmacyId); });
  document.getElementById('branch-sales-page-size')?.addEventListener('change', event => { branchState.sales.pageSize = Number(event.target.value); branchState.sales.page = 1; loadBranchSales(branchId, pharmacyId); });

  document.getElementById('branch-expense-period')?.addEventListener('change', event => { branchState.expenses.preset = event.target.value; branchState.expenses.page = 1; loadBranchExpenses(branchId, pharmacyId); });
  document.getElementById('branch-expense-page-size')?.addEventListener('change', event => { branchState.expenses.pageSize = Number(event.target.value); branchState.expenses.page = 1; loadBranchExpenses(branchId, pharmacyId); });
  document.getElementById('load-branch-report')?.addEventListener('click', () => loadBranchReport(branchId, pharmacyId));

  loadBranchData(branchId, pharmacyId, lifecycleToken);
}

async function loadBranchData(branchId, pharmacyId, lifecycleToken) {
  try {
    const [branch, dashboard] = await Promise.all([getBranchDetails(branchId), getBranchDashboard(branchId, pharmacyId)]);
    if (!isViewLifecycleActive(lifecycleToken)) return;

    document.getElementById('branch-name').textContent = branch.name;
    document.getElementById('branch-subtitle').textContent = branch.address || 'No address recorded';
    const statusBadge = document.getElementById('branch-status-badge');
    statusBadge.textContent = branch.is_active ? 'Active' : 'Inactive';
    statusBadge.className = `badge ${branch.is_active ? 'badge-success' : 'badge-danger'}`;
    document.title = `${branch.name} | Branch Details | SamMia Pharm`;
    document.getElementById('branch-name-input').value = branch.name || '';
    document.getElementById('branch-location').value = branch.address || '';
    document.getElementById('branch-contact-person').value = branch.contact_person || '';
    document.getElementById('branch-phone').value = branch.phone || '';
    document.getElementById('branch-email').value = branch.email || '';

    const values = {
      'daily-sales': formatCurrency(dashboard.dailySales), 'weekly-revenue': formatCurrency(dashboard.weeklyRevenue),
      'monthly-revenue': formatCurrency(dashboard.monthlyRevenue), 'today-transactions': dashboard.todayTransactions,
      'staff-count': dashboard.staffCount, 'product-count': dashboard.totalProducts, 'low-stock-count': dashboard.lowStockCount,
      'expired-count': dashboard.expiredCount, 'expiring-count': dashboard.expiringSoonCount,
      'month-expenses': formatCurrency(dashboard.monthlyExpenses), 'operating-balance': formatCurrency(dashboard.operatingBalance),
      'alert-count': dashboard.alertCount
    };
    Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.textContent = value; });

    await Promise.all([
      loadBranchInventory(branchId, pharmacyId), loadBranchSales(branchId, pharmacyId),
      loadBranchStaff(branchId, pharmacyId), loadBranchExpenses(branchId, pharmacyId), loadRecentActivity(branchId, pharmacyId)
    ]);
  } catch (error) {
    if (!isViewLifecycleActive(lifecycleToken)) return;
    console.error('Error loading branch data:', error);
    showToast(`Error loading branch details: ${error.message}`, 'error');
  }
}

async function loadBranchInventory(branchId, pharmacyId) {
  const tbody = document.getElementById('inventory-table');
  const pager = document.getElementById('branch-inventory-pager');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5">Loading inventory...</td></tr>';
  try {
    const result = await getProductsPage(pharmacyId, {
      branchId, page: branchState.inventory.page, pageSize: branchState.inventory.pageSize,
      search: branchState.inventory.search, filterType: branchState.inventory.filter, sortType: 'name'
    });
    const today = new Date().toISOString().slice(0, 10);
    tbody.innerHTML = result.products.length ? result.products.map(product => {
      const boxes = Number(product.stock_boxes || 0); const loose = Number(product.stock_units || 0); const threshold = Number(product.low_stock_threshold || 0);
      const out = boxes <= 0 && loose <= 0; const low = !out && boxes <= threshold;
      const expired = product.expiry_date && product.expiry_date < today;
      const status = out ? '<span class="badge badge-danger">Out of stock</span>' : low ? '<span class="badge badge-warning">Low stock</span>' : '<span class="badge badge-success">Healthy</span>';
      return `<tr><td><strong>${escapeHtml(product.name)}</strong></td><td>${escapeHtml(product.category || '—')}</td><td>${boxes} boxes${loose ? ` + ${loose} loose` : ''}<div class="text-xs text-muted">${Number(product.units_per_box || 1)} per box</div></td><td>${status}${expired ? '<div class="text-xs text-danger">Expired</div>' : ''}</td><td>${product.expiry_date ? formatUTCDate(product.expiry_date) : 'No expiry'}</td></tr>`;
    }).join('') : '<tr><td colspan="5">No products match these filters.</td></tr>';
    if (pager) {
      const normalized = { ...result, total: result.count, totalPages: Math.max(1, Math.ceil(result.count / result.pageSize)) };
      pager.innerHTML = pagerMarkup('inventory', normalized);
      bindPager(pager, normalized, (page) => { branchState.inventory.page = page; loadBranchInventory(branchId, pharmacyId); });
    }
  } catch (error) {
    console.error('Error loading branch inventory:', error);
    tbody.innerHTML = `<tr><td colspan="5">Unable to load branch inventory: ${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadBranchSales(branchId, pharmacyId) {
  const tbody = document.getElementById('sales-table'); const pager = document.getElementById('branch-sales-pager');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7">Loading sales...</td></tr>';
  try {
    const range = getUtcRange(branchState.sales.preset);
    const filters = { branchId, page: branchState.sales.page, pageSize: branchState.sales.pageSize, search: branchState.sales.search, paymentMethod: branchState.sales.paymentMethod || null, start: range.start, end: range.end };
    const [result, summary] = await Promise.all([getSalesPage(pharmacyId, filters), getSalesFilteredSummary(pharmacyId, filters)]);
    tbody.innerHTML = result.data.length ? result.data.map(sale => `<tr><td><strong>${escapeHtml(sale.invoice_number || '—')}</strong></td><td>${escapeHtml(sale.customers?.name || 'Walk-in')}</td><td><strong>${formatCurrency(sale.total_amount)}</strong></td><td>${escapeHtml(String(sale.payment_method || '—').replaceAll('_',' '))}</td><td>${escapeHtml(sale.staff_name || 'Unknown')}</td><td><span class="badge ${sale.status === 'completed' ? 'badge-success' : 'badge-gray'}">${escapeHtml(sale.status || 'unknown')}</span></td><td>${formatUTCDateTime(sale.created_at)}</td></tr>`).join('') : '<tr><td colspan="7">No sales match these filters.</td></tr>';
    const summaryEl = document.getElementById('branch-sales-summary');
    if (summaryEl) summaryEl.innerHTML = `<div><span>Revenue</span><strong>${formatCurrency(summary.totalRevenue)}</strong></div><div><span>Transactions</span><strong>${summary.totalTransactions}</strong></div><div><span>Average Sale</span><strong>${formatCurrency(summary.averageSale)}</strong></div>`;
    if (pager) { pager.innerHTML = pagerMarkup('sales', result); bindPager(pager, result, page => { branchState.sales.page = page; loadBranchSales(branchId, pharmacyId); }); }
  } catch (error) {
    console.error('Error loading branch sales:', error);
    tbody.innerHTML = `<tr><td colspan="7">Unable to load branch sales: ${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadBranchExpenses(branchId, pharmacyId) {
  const tbody = document.getElementById('branch-expenses-table'); const pager = document.getElementById('branch-expenses-pager');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6">Loading expenses...</td></tr>';
  try {
    const range = getUtcRange(branchState.expenses.preset);
    const [result, report] = await Promise.all([
      getExpensesPage(pharmacyId, { branchId, page: branchState.expenses.page, pageSize: branchState.expenses.pageSize, startDate: range.startDate, endDate: range.endDate }),
      getExpenseReport(pharmacyId, branchId, range.startDate, range.endDate)
    ]);
    tbody.innerHTML = result.data.length ? result.data.map(expense => `<tr><td>${formatUTCDate(expense.expense_date)}</td><td>${escapeHtml(expense.expense_categories?.category_name || 'Uncategorized')}</td><td>${escapeHtml(expense.description || '—')}</td><td><strong>${formatCurrency(expense.amount)}</strong></td><td>${escapeHtml(String(expense.payment_method || '—').replaceAll('_',' '))}</td><td><span class="badge ${expense.is_approved ? 'badge-success' : 'badge-warning'}">${expense.is_approved ? 'Approved' : 'Pending'}</span></td></tr>`).join('') : '<tr><td colspan="6">No expenses found for this period.</td></tr>';
    const summaryEl = document.getElementById('branch-expense-summary');
    if (summaryEl) summaryEl.innerHTML = `<div><span>Total Expenses</span><strong>${formatCurrency(report.totalExpenses)}</strong></div><div><span>Entries</span><strong>${report.count}</strong></div>`;
    if (pager) { pager.innerHTML = pagerMarkup('expenses', result); bindPager(pager, result, page => { branchState.expenses.page = page; loadBranchExpenses(branchId, pharmacyId); }); }
  } catch (error) {
    console.error('Error loading branch expenses:', error);
    tbody.innerHTML = `<tr><td colspan="6">Unable to load branch expenses: ${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadBranchReport(branchId, pharmacyId) {
  const content = document.getElementById('branch-report-content'); const button = document.getElementById('load-branch-report');
  if (!content || !button) return;
  button.disabled = true; button.textContent = 'Generating...';
  content.innerHTML = '<div class="empty-state"><div class="empty-state-title">Loading branch snapshot...</div></div>';
  try {
    const preset = document.getElementById('branch-report-period')?.value || 'month'; const range = getUtcRange(preset);
    const [sales, expenses, inventory] = await Promise.all([
      getSalesFilteredSummary(pharmacyId, { branchId, start: range.start, end: range.end }),
      getExpenseReport(pharmacyId, branchId, range.startDate, range.endDate), getInventorySummary(pharmacyId, branchId)
    ]);
    const operatingBalance = Number(sales.totalRevenue || 0) - Number(expenses.totalExpenses || 0);
    content.innerHTML = `
      <div class="branch-report-summary-grid">
        <div class="metric-card"><div class="metric-label">Revenue</div><div class="metric-value">${formatCurrency(sales.totalRevenue)}</div></div>
        <div class="metric-card"><div class="metric-label">Transactions</div><div class="metric-value">${sales.totalTransactions}</div></div>
        <div class="metric-card"><div class="metric-label">Average Sale</div><div class="metric-value">${formatCurrency(sales.averageSale)}</div></div>
        <div class="metric-card"><div class="metric-label">Expenses</div><div class="metric-value">${formatCurrency(expenses.totalExpenses)}</div></div>
        <div class="metric-card"><div class="metric-label">Revenue − Expenses</div><div class="metric-value">${formatCurrency(operatingBalance)}</div></div>
        <div class="metric-card"><div class="metric-label">Products</div><div class="metric-value">${inventory.totalProducts}</div></div>
        <div class="metric-card"><div class="metric-label">Low Stock</div><div class="metric-value">${inventory.lowStockCount}</div></div>
        <div class="metric-card"><div class="metric-label">Expiring 30 Days</div><div class="metric-value">${inventory.expiringSoonCount}</div></div>
      </div>
      <div class="branch-report-note">Revenue − Expenses is an operating snapshot, not accounting net profit. Cost-of-goods corrections identified in the system audit are still pending.</div>`;
  } catch (error) {
    content.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
  } finally { button.disabled = false; button.textContent = 'Generate Snapshot'; }
}

function bindPager(container, result, onPage) {
  const page = Number(result.page || 1); const totalPages = Math.max(1, Number(result.totalPages || 1));
  container.querySelector('[data-page-action="prev"]')?.addEventListener('click', () => { if (page > 1) onPage(page - 1); });
  container.querySelector('[data-page-action="next"]')?.addEventListener('click', () => { if (page < totalPages) onPage(page + 1); });
}

async function loadBranchStaff(branchId, pharmacyId = window.currentPharmacyId) {
  try {
    const [assignments, staffStats] = await Promise.all([
      getBranchAssignments(branchId),
      getBranchStaffSalesStats(pharmacyId, branchId)
    ]);

    const tbody = document.getElementById('staff-table');
    if (!tbody) return;

    if (assignments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No staff assigned to this branch</td></tr>';
      return;
    }

    const staffSalesMap = new Map(staffStats.map(stat => [stat.staffId, stat]));
    const currencySymbol = window.pharmacySettings?.currency_symbol || 'Le';

    tbody.innerHTML = assignments.map(a => {
      const salesData = staffSalesMap.get(a.staff_id) || {
        dailyTotal: 0,
        dailyCount: 0,
        total: 0,
        count: 0
      };

      return `
      <tr>
        <td>${a.profiles.full_name}</td>
        <td>${a.role_in_branch}</td>
        <td>${currencySymbol}${salesData.dailyTotal.toFixed(2)}</td>
        <td>${currencySymbol}${salesData.total.toFixed(2)}</td>
        <td>${salesData.count}</td>
        <td>
          <div class="branch-staff-actions">
            <button
              type="button"
              class="btn btn-small btn-secondary staff-sales-history-btn"
              data-staff-id="${a.staff_id}"
              data-staff-name="${encodeURIComponent(a.profiles.full_name || 'Staff')}"
            >Sales History</button>
            <button class="btn btn-small btn-danger" onclick="removeStaffFromBranch('${a.id}')">Remove</button>
          </div>
        </td>
      </tr>
    `;
    }).join('');

    tbody.querySelectorAll('.staff-sales-history-btn').forEach(button => {
      button.addEventListener('click', () => {
        const staffId = button.dataset.staffId;
        const staffName = decodeURIComponent(button.dataset.staffName || 'Staff');
        showStaffSalesHistoryModal(staffId, staffName, branchId, pharmacyId);
      });
    });
  } catch (error) {
    console.error('Error loading staff:', error);
  }
}

function getStaffHistoryRange(period, customStart = '', customEnd = '') {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (period === 'last-7') {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 6);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  if (period === 'last-30') {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 29);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  if (period === 'this-year') {
    return {
      start: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)),
      end: new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1))
    };
  }

  if (period === 'custom') {
    const [sy, sm, sd] = String(customStart || '').split('-').map(Number);
    const [ey, em, ed] = String(customEnd || '').split('-').map(Number);
    if (!sy || !sm || !sd || !ey || !em || !ed) throw new Error('Choose both custom dates.');
    const start = new Date(Date.UTC(sy, sm - 1, sd));
    const end = new Date(Date.UTC(ey, em - 1, ed + 1));
    if (end <= start) throw new Error('End date must be on or after the start date.');
    return { start, end };
  }

  return {
    start: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    end: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))
  };
}

function groupStaffSalesByDay(sales) {
  const byDay = new Map();
  for (const sale of sales || []) {
    const key = new Date(sale.created_at).toISOString().slice(0, 10);
    const current = byDay.get(key) || { date: key, transactions: 0, total: 0 };
    current.transactions += 1;
    current.total += Number(sale.total_amount || 0);
    byDay.set(key, current);
  }
  return [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function formatStaffSalesDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

async function showStaffSalesHistoryModal(staffId, staffName, branchId, pharmacyId) {
  const today = new Date().toISOString().slice(0, 10);
  const { overlay } = createModal({
    id: 'staff-sales-history',
    title: `${staffName} · Daily Sales`,
    size: 'modal-xl',
    body: `
      <div class="staff-sales-history-controls">
        <div class="form-group" style="margin:0">
          <label class="form-label">Period</label>
          <select id="staff-sales-period" class="form-control">
            <option value="this-month">This Month</option>
            <option value="last-7">Last 7 Days</option>
            <option value="last-30">Last 30 Days</option>
            <option value="this-year">This Year</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>
        <div class="form-group staff-sales-custom-date" style="margin:0;display:none">
          <label class="form-label">Start Date</label>
          <input type="date" id="staff-sales-start" class="form-control" value="${today}">
        </div>
        <div class="form-group staff-sales-custom-date" style="margin:0;display:none">
          <label class="form-label">End Date</label>
          <input type="date" id="staff-sales-end" class="form-control" value="${today}">
        </div>
        <div class="form-group" style="margin:0;display:flex;align-items:flex-end">
          <button type="button" class="btn btn-primary" id="load-staff-sales-history">Load</button>
        </div>
      </div>

      <div id="staff-sales-history-content" class="staff-sales-history-content">
        <div style="padding:2rem;text-align:center;color:var(--gray-500)">Loading sales history...</div>
      </div>
    `,
    footer: `
      <button type="button" class="btn btn-secondary" id="export-staff-sales-history">Export CSV</button>
    `
  });

  const periodSelect = overlay.querySelector('#staff-sales-period');
  const customFields = overlay.querySelectorAll('.staff-sales-custom-date');
  const loadButton = overlay.querySelector('#load-staff-sales-history');
  const exportButton = overlay.querySelector('#export-staff-sales-history');
  let currentRows = [];

  const toggleCustomFields = () => {
    const isCustom = periodSelect.value === 'custom';
    customFields.forEach(field => { field.style.display = isCustom ? '' : 'none'; });
  };

  const loadHistory = async () => {
    const content = overlay.querySelector('#staff-sales-history-content');
    loadButton.disabled = true;
    loadButton.textContent = 'Loading...';
    content.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--gray-500)">Loading sales history...</div>';

    try {
      const { start, end } = getStaffHistoryRange(
        periodSelect.value,
        overlay.querySelector('#staff-sales-start')?.value,
        overlay.querySelector('#staff-sales-end')?.value
      );
      const sales = await getSalesForReport(pharmacyId, {
        branchId,
        staffId,
        start: start.toISOString(),
        end: end.toISOString()
      });
      currentRows = groupStaffSalesByDay(sales);
      const totalSales = currentRows.reduce((sum, row) => sum + row.total, 0);
      const totalTransactions = currentRows.reduce((sum, row) => sum + row.transactions, 0);
      const averagePerSalesDay = currentRows.length ? totalSales / currentRows.length : 0;

      content.innerHTML = `
        <div class="staff-report-summary-grid staff-history-summary">
          <div class="staff-report-summary-card">
            <span>Total Sales</span>
            <strong>${formatCurrency(totalSales)}</strong>
          </div>
          <div class="staff-report-summary-card">
            <span>Transactions</span>
            <strong>${totalTransactions}</strong>
          </div>
          <div class="staff-report-summary-card">
            <span>Sales Days</span>
            <strong>${currentRows.length}</strong>
          </div>
          <div class="staff-report-summary-card">
            <span>Average / Sales Day</span>
            <strong>${formatCurrency(averagePerSalesDay)}</strong>
          </div>
        </div>

        <div class="table-responsive staff-sales-daily-table">
          <table class="data-table responsive-data-table">
            <thead>
              <tr><th>Date</th><th>Transactions</th><th>Total Sales</th></tr>
            </thead>
            <tbody>
              ${currentRows.length ? currentRows.map(row => `
                <tr>
                  <td>${formatStaffSalesDate(row.date)}</td>
                  <td>${row.transactions}</td>
                  <td><strong>${formatCurrency(row.total)}</strong></td>
                </tr>
              `).join('') : '<tr><td colspan="3" style="text-align:center">No sales found for this period.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    } catch (error) {
      console.error('Failed to load staff sales history:', error);
      content.innerHTML = `<div class="alert alert-danger">${error.message || 'Failed to load employee sales history.'}</div>`;
    } finally {
      loadButton.disabled = false;
      loadButton.textContent = 'Load';
    }
  };

  periodSelect.addEventListener('change', toggleCustomFields);
  loadButton.addEventListener('click', loadHistory);
  exportButton.addEventListener('click', () => {
    if (!currentRows.length) {
      showToast('No employee sales data to export', 'warning');
      return;
    }
    const rows = [
      [`Employee Sales History - ${staffName}`],
      ['Date', 'Transactions', 'Total Sales'],
      ...currentRows.map(row => [row.date, row.transactions, row.total.toFixed(2)])
    ];
    const csv = rows.map(row => row.map(cell => {
      const value = String(cell ?? '').replaceAll('"', '""');
      return /[",\n]/.test(value) ? `"${value}"` : value;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${staffName.replace(/[^a-z0-9]+/gi, '_')}_daily_sales.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });

  toggleCustomFields();
  loadHistory();
}

async function loadRecentActivity(branchId) {
  try {
    const { data, error } = await supabase
      .from('sales')
      .select('id, total_amount, created_at')
      .eq('branch_id', branchId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) throw error;
    
    const div = document.getElementById('recent-activity');
    if (data.length === 0) {
      div.innerHTML = '<p>No recent activity</p>';
      return;
    }
    
    div.innerHTML = data.map(s => `
      <div class="activity-item">
        <div class="activity-icon">💳</div>
        <div class="activity-details">
          <div class="activity-title">Sale completed</div>
          <div class="activity-amount">Le${s.total_amount.toFixed(2)}</div>
          <div class="activity-time">${formatUTCDateTime(s.created_at)}</div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading activity:', error);
  }
}

function switchBranchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  
  // Show selected tab
  const selectedTab = document.getElementById(tabName + '-tab');
  if (selectedTab) selectedTab.style.display = 'block';
  
  // Mark button as active
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    }
  });
}

// Make switchBranchTab globally accessible
window.switchBranchTab = switchBranchTab;

async function saveBranchDetails(event, branchId) {
  event.preventDefault();
  
  try {
    const updates = {
      name: document.getElementById('branch-name-input').value,
      address: document.getElementById('branch-location').value,
      contact_person: document.getElementById('branch-contact-person').value,
      phone: document.getElementById('branch-phone').value,
      email: document.getElementById('branch-email').value
    };
    
    const { updateBranchDetails } = await import('../../database.js');
    await updateBranchDetails(branchId, updates);
    
    alert('Branch details updated successfully!');
  } catch (error) {
    console.error('Error saving branch details:', error);
    alert('Error saving details: ' + error.message);
  }
}

async function openAssignStaffModal() {
  const branchId = window.currentBranchId;
  const pharmacyId = window.currentPharmacyId;
  
  try {
    // Get all pharmacy staff
    const allStaff = await getPharmacyStaff(pharmacyId);
    
    // Get already assigned staff to this branch
    const assignedStaff = await getBranchAssignments(branchId);
    const assignedIds = new Set(assignedStaff.map(a => a.staff_id));
    
    // Filter out already assigned staff
    const availableStaff = allStaff.filter(s => !assignedIds.has(s.id));
    
    if (availableStaff.length === 0) {
      showToast('No available staff to assign to this branch', 'warning');
      return;
    }
    
    const { overlay, closeModal } = createModal({
      id: 'assign-staff-modal',
      title: 'Assign Staff to Branch',
      size: 'modal-md',
      body: `
        <form id="assign-staff-form">
          <div class="form-group">
            <label class="form-label">Select Staff Member *</label>
            <select class="form-select" id="staff-select" required>
              <option value="">-- Choose a staff member --</option>
              ${availableStaff.map(s => `
                <option value="${s.id}">
                  ${s.full_name} (${s.role})
                </option>
              `).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">Role in Branch *</label>
            <select class="form-select" id="role-select" required>
              <option value="">-- Select role --</option>
              <option value="manager">Manager</option>
              <option value="pharmacist">Pharmacist</option>
              <option value="salesman">Salesman</option>
              <option value="cashier">Cashier</option>
            </select>
          </div>
          
          <div id="assign-error" class="alert alert-danger hidden"></div>
        </form>
      `,
      footer: `
        <button class="btn btn-ghost" id="cancel-assign">Cancel</button>
        <button class="btn btn-primary" id="save-assign">Assign Staff</button>
      `
    });
    
    overlay.querySelector('#cancel-assign').addEventListener('click', closeModal);
    overlay.querySelector('#save-assign').addEventListener('click', async () => {
      const staffSelect = overlay.querySelector('#staff-select');
      const roleSelect = overlay.querySelector('#role-select');
      const errorEl = overlay.querySelector('#assign-error');
      const saveBtn = overlay.querySelector('#save-assign');
      
      errorEl.classList.add('hidden');
      
      if (!staffSelect.value || !roleSelect.value) {
        errorEl.textContent = 'Please select both staff and role';
        errorEl.classList.remove('hidden');
        return;
      }
      
      try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Assigning...';
        
        await assignStaffToBranch(
          staffSelect.value,
          branchId,
          pharmacyId,
          roleSelect.value
        );
        
        showToast('Staff assigned successfully!');
        closeModal();
        
        // Reload the staff table
        loadBranchStaff(branchId, pharmacyId);
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Assign Staff';
      }
    });
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
}

// Make inline form/action handlers globally accessible
window.saveBranchDetails = saveBranchDetails;
window.openAssignStaffModal = openAssignStaffModal;

async function removeStaffFromBranch(assignmentId) {
  if (!confirm('Remove this staff member from the branch?')) return;
  
  try {
    const { removeStaffFromBranch: removeFn } = await import('../../database.js');
    await removeFn(assignmentId);
    showToast('Staff member removed');
    loadBranchStaff(window.currentBranchId, window.currentPharmacyId);
  } catch (error) {
    console.error('Error removing staff:', error);
    showToast('Error: ' + error.message, 'error');
  }
}

// Make functions globally accessible
window.removeStaffFromBranch = removeStaffFromBranch;
window.switchBranchTab = switchBranchTab;
window.openAssignStaffModal = openAssignStaffModal;
