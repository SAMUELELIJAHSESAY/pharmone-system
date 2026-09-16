import {
  getBranches,
  getManagementReportAnalytics,
  getInventoryReportAnalytics,
  getBranchComparisonReport,
  getPharmacySettings
} from '../../database.js';
import { formatCurrency } from '../../utils.js';

const reportState = {
  pharmacyId: null,
  user: null,
  branches: [],
  period: 'month',
  branchId: '',
  customStart: '',
  customEnd: '',
  analytics: null,
  inventory: null,
  branchComparison: [],
  loading: false
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfDay(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function getPeriodRange() {
  const today = startOfDay(new Date());
  let start = today;
  let endExclusive = addDays(today, 1);
  let label = 'Today';

  if (reportState.period === 'yesterday') {
    start = addDays(today, -1);
    endExclusive = today;
    label = 'Yesterday';
  } else if (reportState.period === '7days') {
    start = addDays(today, -6);
    label = 'Last 7 Days';
  } else if (reportState.period === '30days') {
    start = addDays(today, -29);
    label = 'Last 30 Days';
  } else if (reportState.period === 'month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    label = today.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  } else if (reportState.period === 'quarter') {
    const quarterStart = Math.floor(today.getMonth() / 3) * 3;
    start = new Date(today.getFullYear(), quarterStart, 1);
    label = `Q${Math.floor(today.getMonth() / 3) + 1} ${today.getFullYear()}`;
  } else if (reportState.period === 'year') {
    start = new Date(today.getFullYear(), 0, 1);
    label = String(today.getFullYear());
  } else if (reportState.period === 'custom') {
    const startValue = reportState.customStart ? new Date(`${reportState.customStart}T00:00:00`) : today;
    const endValue = reportState.customEnd ? new Date(`${reportState.customEnd}T00:00:00`) : startValue;
    start = startValue;
    endExclusive = addDays(endValue, 1);
    label = `${toDateKey(startValue)} to ${toDateKey(endValue)}`;
  }

  const expenseEnd = addDays(endExclusive, -1);
  return {
    salesStart: start.toISOString(),
    salesEnd: endExclusive.toISOString(),
    expenseStart: toDateKey(start),
    expenseEnd: toDateKey(expenseEnd),
    label
  };
}

function money(value) {
  return formatCurrency(Number(value || 0));
}

function percent(value) {
  const n = Number(value || 0);
  return `${Number.isFinite(n) ? n.toFixed(1) : '0.0'}%`;
}

function paymentLabel(method) {
  return ({ cash: 'Cash', mobile_money: 'Mobile Money', card: 'Card' })[method] || String(method || 'Other').replace(/_/g, ' ');
}

function renderLoading() {
  const body = document.getElementById('management-report-body');
  if (body) body.innerHTML = '<div class="report-loading"><div class="loading-spinner"></div><div>Building management report…</div></div>';
}

function renderStatCard({ label, value, helper = '', tone = '', action = '' }) {
  const clickable = action ? ' report-stat-clickable' : '';
  const actionAttr = action ? ` data-report-action="${action}" tabindex="0" role="button"` : '';
  return `
    <div class="stat-card report-stat-card${clickable}"${actionAttr}>
      <div class="stat-card-label">${escapeHtml(label)}</div>
      <div class="stat-card-value report-stat-value ${tone}">${escapeHtml(value)}</div>
      ${helper ? `<div class="stat-card-change">${escapeHtml(helper)}</div>` : ''}
    </div>
  `;
}

function renderRevenueBars(dailyRevenue = {}) {
  const rows = Object.entries(dailyRevenue)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14);
  if (!rows.length) return '<div class="empty-state compact-empty"><div class="empty-state-title">No sales in this period</div></div>';
  const max = Math.max(...rows.map(([, value]) => Number(value || 0)), 1);
  return `
    <div class="report-bar-chart" aria-label="Daily revenue chart">
      ${rows.map(([date, value]) => {
        const amount = Number(value || 0);
        const height = Math.max(4, Math.round((amount / max) * 100));
        const label = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `
          <div class="report-bar-item" title="${escapeHtml(label)} · ${escapeHtml(money(amount))}">
            <div class="report-bar-value">${escapeHtml(money(amount))}</div>
            <div class="report-bar-track"><div class="report-bar-fill" style="height:${height}%;--mobile-bar-width:${height}%"></div></div>
            <div class="report-bar-label">${escapeHtml(label)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderPaymentBreakdown(analytics) {
  const entries = Object.entries(analytics.paymentBreakdown || {}).sort(([, a], [, b]) => b - a);
  if (!entries.length) return '<div class="empty-state compact-empty"><div class="empty-state-title">No payment data</div></div>';
  return entries.map(([method, amount]) => {
    const pct = analytics.revenue > 0 ? (Number(amount || 0) / analytics.revenue) * 100 : 0;
    return `
      <div class="report-progress-row">
        <div class="report-progress-heading"><span>${escapeHtml(paymentLabel(method))}</span><strong>${escapeHtml(money(amount))} · ${pct.toFixed(1)}%</strong></div>
        <div class="report-progress-track"><div class="report-progress-fill" style="width:${Math.min(100, pct)}%"></div></div>
      </div>
    `;
  }).join('');
}

function renderTopProducts(products = []) {
  return `
    <div class="table-container">
      <table>
        <thead><tr><th>#</th><th>Product</th><th>Units Sold</th><th>Revenue</th><th></th></tr></thead>
        <tbody>
          ${products.length ? products.map((product, index) => `
            <tr>
              <td>${index + 1}</td>
              <td class="font-semibold">${escapeHtml(product.name)}</td>
              <td>${Number(product.quantity || 0).toLocaleString()}</td>
              <td class="font-semibold">${escapeHtml(money(product.revenue))}</td>
              <td><button class="btn btn-ghost btn-sm" data-product-drill="${escapeHtml(product.name)}">Inventory</button></td>
            </tr>
          `).join('') : '<tr><td colspan="5"><div class="empty-state compact-empty"><div class="empty-state-title">No product sales in this period</div></div></td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderBranchComparison(rows = []) {
  return `
    <div class="table-container">
      <table>
        <thead><tr><th>Branch</th><th>Revenue</th><th>Transactions</th><th>Avg. Sale</th><th>Approved Expenses</th><th>Revenue − Expenses</th><th>Inventory</th><th>Low Stock</th><th></th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((row) => `
            <tr>
              <td class="font-semibold">${escapeHtml(row.name)}</td>
              <td>${escapeHtml(money(row.revenue))}</td>
              <td>${Number(row.transactions || 0).toLocaleString()}</td>
              <td>${escapeHtml(money(row.averageSale))}</td>
              <td>${escapeHtml(money(row.approvedExpenses))}</td>
              <td class="font-semibold ${row.operatingBalance >= 0 ? 'text-success' : 'text-danger'}">${escapeHtml(money(row.operatingBalance))}</td>
              <td>${Number(row.products || 0).toLocaleString()}</td>
              <td>${Number(row.lowStock || 0).toLocaleString()}</td>
              <td><button class="btn btn-ghost btn-sm" data-branch-drill="${row.id}">View Details</button></td>
            </tr>
          `).join('') : '<tr><td colspan="9"><div class="empty-state compact-empty"><div class="empty-state-title">No active branches found</div></div></td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderCategoryValues(categories = []) {
  if (!categories.length) return '<div class="empty-state compact-empty"><div class="empty-state-title">No category data</div></div>';
  const max = Math.max(...categories.map((item) => Number(item.value || 0)), 1);
  return categories.map((item) => `
    <div class="report-progress-row">
      <div class="report-progress-heading"><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(money(item.value))}</strong></div>
      <div class="report-progress-track"><div class="report-progress-fill" style="width:${Math.min(100, (Number(item.value || 0) / max) * 100)}%"></div></div>
    </div>
  `).join('');
}

function renderReportBody() {
  const body = document.getElementById('management-report-body');
  if (!body || !reportState.analytics || !reportState.inventory) return;
  const analytics = reportState.analytics;
  const inventory = reportState.inventory;
  const range = getPeriodRange();
  const branch = reportState.branches.find((item) => item.id === reportState.branchId);
  const scopeName = branch?.name || 'All branches';

  body.innerHTML = `
    <div class="report-scope-line">
      <div><strong>${escapeHtml(range.label)}</strong><span> · ${escapeHtml(scopeName)}</span></div>
      <div class="report-data-note">Completed sales + approved expenses only</div>
    </div>

    <div class="stats-grid reports-stats-grid">
      ${renderStatCard({ label: 'Revenue', value: money(analytics.revenue), helper: `${analytics.transactions.toLocaleString()} completed transactions`, action: 'sales' })}
      ${renderStatCard({ label: 'Approved Expenses', value: money(analytics.approvedExpenses), helper: 'Approved expenses in selected period', action: 'expenses' })}
      ${renderStatCard({ label: 'Estimated COGS', value: money(analytics.estimatedCogs), helper: 'Uses current product cost', tone: 'report-estimated' })}
      ${renderStatCard({ label: 'Estimated Gross Profit', value: money(analytics.estimatedGrossProfit), helper: `${percent(analytics.estimatedGrossMargin)} estimated gross margin`, tone: analytics.estimatedGrossProfit >= 0 ? 'text-success' : 'text-danger' })}
      ${renderStatCard({ label: 'Estimated Net Result', value: money(analytics.estimatedNetResult), helper: 'Revenue − estimated COGS − approved expenses', tone: analytics.estimatedNetResult >= 0 ? 'text-success' : 'text-danger' })}
    </div>

    <div class="report-warning">
      <strong>Cost accuracy note:</strong> COGS and profit are estimates because historical sale lines do not yet store cost-at-sale. They use each product's current cost price. Revenue and approved-expense totals are read from recorded transactions for the selected period.
    </div>

    <div class="grid-2 reports-grid">
      <section class="card">
        <div class="card-header"><div><div class="card-title">Revenue Trend</div><div class="card-subtitle">Last 14 days inside the selected period</div></div></div>
        <div class="card-body">${renderRevenueBars(analytics.dailyRevenue)}</div>
      </section>
      <section class="card">
        <div class="card-header"><div><div class="card-title">Payment Mix</div><div class="card-subtitle">How completed sales were paid</div></div></div>
        <div class="card-body">${renderPaymentBreakdown(analytics)}</div>
      </section>
    </div>

    <section class="card report-section-card">
      <div class="card-header report-card-header">
        <div><div class="card-title">Profit & Loss Snapshot</div><div class="card-subtitle">Management view for ${escapeHtml(range.label)}</div></div>
        <button class="btn btn-ghost btn-sm" data-report-action="expenses">Open Expenses</button>
      </div>
      <div class="card-body">
        <div class="report-pl-grid">
          <div><span>Revenue</span><strong>${escapeHtml(money(analytics.revenue))}</strong></div>
          <div><span>Estimated COGS</span><strong class="report-estimated">− ${escapeHtml(money(analytics.estimatedCogs))}</strong></div>
          <div class="report-pl-total"><span>Estimated Gross Profit</span><strong>${escapeHtml(money(analytics.estimatedGrossProfit))}</strong></div>
          <div><span>Approved Operating Expenses</span><strong>− ${escapeHtml(money(analytics.approvedExpenses))}</strong></div>
          <div class="report-pl-total report-pl-net"><span>Estimated Net Result</span><strong class="${analytics.estimatedNetResult >= 0 ? 'text-success' : 'text-danger'}">${escapeHtml(money(analytics.estimatedNetResult))}</strong></div>
          <div><span>Average Sale</span><strong>${escapeHtml(money(analytics.averageSale))}</strong></div>
          <div><span>Items Sold</span><strong>${Number(analytics.itemUnits || 0).toLocaleString()}</strong></div>
          <div><span>Recorded Discounts</span><strong>${escapeHtml(money(analytics.totalDiscount))}</strong></div>
          <div><span>Estimated Net Margin</span><strong>${percent(analytics.estimatedNetMargin)}</strong></div>
        </div>
      </div>
    </section>

    <section class="card report-section-card">
      <div class="card-header"><div><div class="card-title">Top Selling Products</div><div class="card-subtitle">Highest revenue products in the selected period</div></div></div>
      ${renderTopProducts(analytics.topProducts)}
    </section>

    <section class="card report-section-card">
      <div class="card-header report-card-header">
        <div><div class="card-title">Branch Comparison</div><div class="card-subtitle">All active branches · selected period</div></div>
        <button class="btn btn-ghost btn-sm" data-report-action="branches">Open Branches</button>
      </div>
      ${renderBranchComparison(reportState.branchComparison)}
      <div class="report-table-note">Revenue − Expenses is an operating comparison only; it does not subtract COGS.</div>
    </section>

    <div class="stats-grid reports-stats-grid inventory-report-stats">
      ${renderStatCard({ label: 'Active Products', value: Number(inventory.totalProducts || 0).toLocaleString(), helper: 'Current inventory catalogue', action: 'inventory' })}
      ${renderStatCard({ label: 'Estimated Stock Cost', value: money(inventory.estimatedCostValue), helper: 'Current recorded inventory at current cost' })}
      ${renderStatCard({ label: 'Low Stock', value: Number(inventory.lowStockCount || 0).toLocaleString(), helper: money(inventory.lowStockCostValue) + ' estimated cost value', action: 'inventory-low' })}
      ${renderStatCard({ label: 'Expired', value: Number(inventory.expiredCount || 0).toLocaleString(), helper: money(inventory.expiredCostExposure) + ' estimated cost exposure', tone: inventory.expiredCount ? 'text-danger' : '', action: 'inventory-expired' })}
      ${renderStatCard({ label: 'Expiring ≤30 Days', value: Number(inventory.expiring30Count || 0).toLocaleString(), helper: `${inventory.expiring90Count.toLocaleString()} more expiring in 31–90 days`, action: 'inventory-expiring' })}
    </div>

    <div class="grid-2 reports-grid">
      <section class="card">
        <div class="card-header"><div><div class="card-title">Inventory Value Analytics</div><div class="card-subtitle">Current inventory estimates for ${escapeHtml(scopeName)}</div></div></div>
        <div class="card-body">
          <div class="report-kv-list">
            <div><span>Estimated Cost Value</span><strong>${escapeHtml(money(inventory.estimatedCostValue))}</strong></div>
            <div><span>Estimated Retail Value</span><strong>${escapeHtml(money(inventory.estimatedRetailValue))}</strong></div>
            <div><span>Estimated Potential Margin</span><strong>${escapeHtml(money(inventory.estimatedPotentialMargin))}</strong></div>
            <div><span>No Expiry Date</span><strong>${Number(inventory.noExpiryCount || 0).toLocaleString()}</strong></div>
            <div><span>Expired Cost Exposure</span><strong class="text-danger">${escapeHtml(money(inventory.expiredCostExposure))}</strong></div>
          </div>
          <div class="report-table-note">Inventory values assume cost/selling price applies to a full container and prorate loose units using units-per-box.</div>
        </div>
      </section>
      <section class="card">
        <div class="card-header"><div><div class="card-title">Stock Cost by Category</div><div class="card-subtitle">Largest categories by estimated current cost value</div></div></div>
        <div class="card-body">${renderCategoryValues(inventory.topCategories)}</div>
      </section>
    </div>
  `;

  bindReportBodyActions();
}

function bindReportBodyActions() {
  document.querySelectorAll('[data-report-action]').forEach((button) => {
    const activate = () => {
      const action = button.dataset.reportAction;
      if (action === 'sales') window.navigate?.('sales');
      if (action === 'expenses') window.navigate?.('expenses');
      if (action === 'branches') window.navigate?.('branches');
      if (action === 'inventory') window.navigate?.('inventory');
      if (action === 'inventory-low') window.navigate?.('inventory', { filterType: 'low' });
      if (action === 'inventory-expired') window.navigate?.('inventory', { filterType: 'expired' });
      if (action === 'inventory-expiring') window.navigate?.('inventory', { filterType: 'expiring-30' });
    };
    button.addEventListener('click', activate);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
  });

  document.querySelectorAll('[data-product-drill]').forEach((button) => {
    button.addEventListener('click', () => window.navigate?.('inventory', { search: button.dataset.productDrill || '' }));
  });

  document.querySelectorAll('[data-branch-drill]').forEach((button) => {
    button.addEventListener('click', () => window.navigate?.('branch-details', {
      branchId: button.dataset.branchDrill,
      pharmacyId: reportState.pharmacyId
    }));
  });
}

async function loadReport() {
  if (reportState.loading) return;
  reportState.loading = true;
  renderLoading();
  const range = getPeriodRange();

  try {
    const [analytics, inventory, branchComparison] = await Promise.all([
      getManagementReportAnalytics(reportState.pharmacyId, {
        branchId: reportState.branchId || null,
        salesStart: range.salesStart,
        salesEnd: range.salesEnd,
        expenseStart: range.expenseStart,
        expenseEnd: range.expenseEnd
      }),
      getInventoryReportAnalytics(reportState.pharmacyId, reportState.branchId || null),
      getBranchComparisonReport(reportState.pharmacyId, {
        salesStart: range.salesStart,
        salesEnd: range.salesEnd,
        expenseStart: range.expenseStart,
        expenseEnd: range.expenseEnd
      })
    ]);
    reportState.analytics = analytics;
    reportState.inventory = inventory;
    reportState.branchComparison = branchComparison;
    renderReportBody();
  } catch (error) {
    console.error('Failed to build management report:', error);
    const body = document.getElementById('management-report-body');
    if (body) body.innerHTML = `<div class="alert alert-danger">Failed to load Reports & Analytics: ${escapeHtml(error.message || error)}</div>`;
  } finally {
    reportState.loading = false;
  }
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function exportManagementReport() {
  if (!reportState.analytics || !reportState.inventory) return;
  const a = reportState.analytics;
  const i = reportState.inventory;
  const range = getPeriodRange();
  const branch = reportState.branches.find((row) => row.id === reportState.branchId);
  const lines = [];
  lines.push('SamMia Pharm Management Report');
  lines.push(`Period,${csvCell(range.label)}`);
  lines.push(`Scope,${csvCell(branch?.name || 'All branches')}`);
  lines.push('');
  lines.push('Financial Summary');
  lines.push('Metric,Value');
  lines.push(`Revenue,${a.revenue}`);
  lines.push(`Transactions,${a.transactions}`);
  lines.push(`Average Sale,${a.averageSale}`);
  lines.push(`Estimated COGS,${a.estimatedCogs}`);
  lines.push(`Estimated Gross Profit,${a.estimatedGrossProfit}`);
  lines.push(`Approved Expenses,${a.approvedExpenses}`);
  lines.push(`Estimated Net Result,${a.estimatedNetResult}`);
  lines.push(`Recorded Discounts,${a.totalDiscount}`);
  lines.push('');
  lines.push('Payment Breakdown');
  lines.push('Payment Method,Amount');
  Object.entries(a.paymentBreakdown || {}).forEach(([method, amount]) => lines.push(`${csvCell(paymentLabel(method))},${amount}`));
  lines.push('');
  lines.push('Top Products');
  lines.push('Product,Units Sold,Revenue');
  (a.topProducts || []).forEach((product) => lines.push(`${csvCell(product.name)},${product.quantity},${product.revenue}`));
  lines.push('');
  lines.push('Inventory Analytics');
  lines.push('Metric,Value');
  lines.push(`Active Products,${i.totalProducts}`);
  lines.push(`Low Stock,${i.lowStockCount}`);
  lines.push(`Expired,${i.expiredCount}`);
  lines.push(`Expiring 30 Days,${i.expiring30Count}`);
  lines.push(`Estimated Stock Cost,${i.estimatedCostValue}`);
  lines.push(`Estimated Retail Value,${i.estimatedRetailValue}`);
  lines.push(`Expired Cost Exposure,${i.expiredCostExposure}`);
  lines.push('');
  lines.push('Branch Comparison');
  lines.push('Branch,Revenue,Transactions,Average Sale,Approved Expenses,Revenue Minus Expenses,Products,Low Stock');
  (reportState.branchComparison || []).forEach((row) => lines.push([
    csvCell(row.name), row.revenue, row.transactions, row.averageSale, row.approvedExpenses,
    row.operatingBalance, row.products, row.lowStock
  ].join(',')));

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sammia-management-report-${range.expenseStart}-${range.expenseEnd}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printManagementReport() {
  if (!reportState.analytics || !reportState.inventory) return;
  const range = getPeriodRange();
  const branch = reportState.branches.find((row) => row.id === reportState.branchId);
  const body = document.getElementById('management-report-body');
  if (!body) return;
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>Management Report | SamMia Pharm</title><style>
    body{font-family:Inter,Arial,sans-serif;color:#0f172a;padding:28px}h1{margin:0 0 4px}.meta{color:#64748b;margin-bottom:24px}
    .report-warning{border:1px solid #fbbf24;background:#fffbeb;padding:12px;border-radius:8px;margin:16px 0}
    .stats-grid,.grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.stat-card,.card{border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:14px}
    .stat-card-value{font-size:22px;font-weight:700}.stat-card-label,.stat-card-change,.card-subtitle{color:#64748b;font-size:12px}.card-title{font-weight:700;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #e5e7eb;padding:8px;text-align:left}.btn{display:none!important}.report-bar-chart{display:none}.report-progress-track{height:6px;background:#e5e7eb}.report-progress-fill{height:6px;background:#2563eb}
    .report-progress-heading,.report-kv-list>div,.report-pl-grid>div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e5e7eb}.report-table-note,.report-data-note{font-size:11px;color:#64748b;margin:8px 0}
    @media print{body{padding:0}.card{break-inside:avoid}}
  </style></head><body><h1>SamMia Pharm — Reports & Analytics</h1><div class="meta">${escapeHtml(range.label)} · ${escapeHtml(branch?.name || 'All branches')}</div>${body.innerHTML}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

export async function renderReports(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = '<div class="alert alert-warning">No pharmacy linked.</div>';
    return;
  }

  reportState.pharmacyId = pharmacyId;
  reportState.user = user;
  reportState.period = 'month';
  reportState.branchId = '';
  reportState.customStart = '';
  reportState.customEnd = '';
  reportState.analytics = null;
  reportState.inventory = null;
  reportState.branchComparison = [];

  try {
    const [branches, settings] = await Promise.all([
      getBranches(pharmacyId),
      getPharmacySettings(pharmacyId)
    ]);
    reportState.branches = branches || [];
    if (!window.pharmacySettings?.currency_symbol) {
      window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    }
  } catch (error) {
    container.innerHTML = `<div class="alert alert-danger">Failed to initialise reports: ${escapeHtml(error.message || error)}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="animate-in reports-page">
      <div class="page-header reports-page-header">
        <div>
          <div class="page-title">Reports & Analytics</div>
          <div class="page-subtitle">Financial, branch, sales and inventory insights from your pharmacy data</div>
        </div>
        <div class="reports-header-actions">
          <button id="reports-print-btn" class="btn btn-ghost btn-sm">🖨️ Print</button>
          <button id="reports-export-btn" class="btn btn-primary btn-sm">⬇️ Export CSV</button>
        </div>
      </div>

      <div class="card reports-filter-card">
        <div class="card-body reports-filter-grid">
          <label class="form-group"><span class="form-label">Period</span>
            <select id="reports-period" class="form-control">
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
              <option value="month" selected>This Month</option>
              <option value="quarter">This Quarter</option>
              <option value="year">This Year</option>
              <option value="custom">Custom Range</option>
            </select>
          </label>
          <label class="form-group"><span class="form-label">Branch</span>
            <select id="reports-branch" class="form-control">
              <option value="">All Branches</option>
              ${reportState.branches.filter((branch) => branch.is_active !== false).map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join('')}
            </select>
          </label>
          <label class="form-group reports-custom-date" hidden><span class="form-label">From</span><input id="reports-start" class="form-control" type="date"></label>
          <label class="form-group reports-custom-date" hidden><span class="form-label">To</span><input id="reports-end" class="form-control" type="date"></label>
          <div class="form-group reports-refresh-group"><span class="form-label">&nbsp;</span><button id="reports-refresh-btn" class="btn btn-ghost">↻ Refresh</button></div>
        </div>
      </div>

      <div id="management-report-body"></div>
    </div>
  `;

  const periodEl = document.getElementById('reports-period');
  const branchEl = document.getElementById('reports-branch');
  const startEl = document.getElementById('reports-start');
  const endEl = document.getElementById('reports-end');
  const customEls = [...document.querySelectorAll('.reports-custom-date')];

  const setCustomVisibility = () => {
    const visible = periodEl.value === 'custom';
    customEls.forEach((el) => { el.hidden = !visible; });
    if (visible && !startEl.value) {
      const today = new Date();
      startEl.value = toDateKey(new Date(today.getFullYear(), today.getMonth(), 1));
      endEl.value = toDateKey(today);
    }
  };

  periodEl.addEventListener('change', async () => {
    reportState.period = periodEl.value;
    setCustomVisibility();
    if (reportState.period === 'custom') {
      reportState.customStart = startEl.value;
      reportState.customEnd = endEl.value || startEl.value;
    }
    await loadReport();
  });
  branchEl.addEventListener('change', async () => {
    reportState.branchId = branchEl.value;
    await loadReport();
  });
  const applyCustom = async () => {
    reportState.customStart = startEl.value;
    reportState.customEnd = endEl.value || startEl.value;
    if (reportState.period === 'custom' && reportState.customStart) await loadReport();
  };
  startEl.addEventListener('change', applyCustom);
  endEl.addEventListener('change', applyCustom);
  document.getElementById('reports-refresh-btn')?.addEventListener('click', loadReport);
  document.getElementById('reports-export-btn')?.addEventListener('click', exportManagementReport);
  document.getElementById('reports-print-btn')?.addEventListener('click', printManagementReport);

  setCustomVisibility();
  await loadReport();
}
