// Admin Sales Reports - period analytics, product reporting and salesman comparison
import {
  getBranches,
  getPharmacySettings,
  getPharmacySalesmen,
  getSalesForReport,
  enrichSalesWithItems,
  getSalesReportTransactionsPage
} from '../../database.js';
import { formatCurrency, showToast } from '../../utils.js';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseDateInput(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getPresetRange(preset, customStart, customEnd) {
  const today = todayUtc();
  const tomorrow = addUtcDays(today, 1);

  if (preset === 'today') return { start: today, end: tomorrow, label: 'Today' };
  if (preset === 'yesterday') {
    const start = addUtcDays(today, -1);
    return { start, end: today, label: 'Yesterday' };
  }
  if (preset === 'last7') {
    return { start: addUtcDays(today, -6), end: tomorrow, label: 'Last 7 Days' };
  }
  if (preset === 'last30') {
    return { start: addUtcDays(today, -29), end: tomorrow, label: 'Last 30 Days' };
  }
  if (preset === 'this_month') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { start, end: tomorrow, label: 'This Month' };
  }
  if (preset === 'this_year') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    return { start, end: tomorrow, label: 'This Year' };
  }

  const start = parseDateInput(customStart);
  const parsedEnd = parseDateInput(customEnd || customStart);
  const end = addUtcDays(parsedEnd < start ? start : parsedEnd, 1);
  return { start, end, label: 'Custom Range' };
}

function formatRange(start, end) {
  const options = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' };
  const inclusiveEnd = addUtcDays(end, -1);
  if (formatIsoDate(start) === formatIsoDate(inclusiveEnd)) {
    return start.toLocaleDateString('en-US', options);
  }
  return `${start.toLocaleDateString('en-US', options)} – ${inclusiveEnd.toLocaleDateString('en-US', options)}`;
}

function dateKeyUtc(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatDayKey(key) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC'
  });
}

function sumItemQuantity(sales) {
  return sales.reduce((total, sale) => total + (sale.sale_items || [])
    .reduce((itemTotal, item) => itemTotal + Number(item.quantity || 0), 0), 0);
}

function buildDailyBreakdown(sales, start, end) {
  const grouped = new Map();
  for (const sale of sales) {
    const key = dateKeyUtc(sale.created_at);
    const current = grouped.get(key) || { date: key, transactions: 0, total: 0, items: 0 };
    current.transactions += 1;
    current.total += Number(sale.total_amount || 0);
    current.items += (sale.sale_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    grouped.set(key, current);
  }

  const rows = [];
  for (let day = new Date(start); day < end; day = addUtcDays(day, 1)) {
    const key = formatIsoDate(day);
    const record = grouped.get(key) || { date: key, transactions: 0, total: 0, items: 0 };
    rows.push(record);
  }
  return rows;
}

function buildProductReport(sales) {
  const products = new Map();
  for (const sale of sales) {
    for (const item of sale.sale_items || []) {
      const key = item.product_id || item.product_name || 'unknown';
      const row = products.get(key) || {
        name: item.product_name || 'Unknown product', quantity: 0, revenue: 0, invoices: new Set()
      };
      row.quantity += Number(item.quantity || 0);
      row.revenue += Number(item.total_price || 0);
      if (sale.id) row.invoices.add(sale.id);
      products.set(key, row);
    }
  }
  return [...products.values()]
    .map(row => ({ ...row, transactions: row.invoices.size, invoices: undefined }))
    .sort((a, b) => b.revenue - a.revenue);
}

function buildStaffComparison(sales, staff) {
  const staffById = new Map((staff || []).map(person => [person.id, person]));
  const rows = new Map();

  for (const sale of sales) {
    const id = sale.created_by || 'unassigned';
    const person = staffById.get(id);
    const row = rows.get(id) || {
      id,
      name: person?.full_name || person?.email || (id === 'unassigned' ? 'Unassigned Sales' : 'Unknown Staff'),
      revenue: 0,
      transactions: 0,
      items: 0,
      activeDays: new Set(),
      dayTotals: new Map()
    };
    const amount = Number(sale.total_amount || 0);
    const day = dateKeyUtc(sale.created_at);
    row.revenue += amount;
    row.transactions += 1;
    row.items += (sale.sale_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    row.activeDays.add(day);
    row.dayTotals.set(day, (row.dayTotals.get(day) || 0) + amount);
    rows.set(id, row);
  }

  return [...rows.values()].map(row => {
    let bestDay = null;
    let bestDayRevenue = 0;
    for (const [day, amount] of row.dayTotals.entries()) {
      if (amount > bestDayRevenue) {
        bestDay = day;
        bestDayRevenue = amount;
      }
    }
    return {
      id: row.id,
      name: row.name,
      revenue: row.revenue,
      transactions: row.transactions,
      items: row.items,
      activeDays: row.activeDays.size,
      averageSale: row.transactions ? row.revenue / row.transactions : 0,
      bestDay,
      bestDayRevenue
    };
  }).sort((a, b) => b.revenue - a.revenue);
}

function buildTimePerformance(sales) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0, transactions: 0 }));
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekdays = weekdayNames.map((name, day) => ({ name, day, revenue: 0, transactions: 0 }));

  for (const sale of sales) {
    const created = new Date(sale.created_at);
    const amount = Number(sale.total_amount || 0);
    const hour = created.getUTCHours();
    const weekday = created.getUTCDay();
    hours[hour].revenue += amount;
    hours[hour].transactions += 1;
    weekdays[weekday].revenue += amount;
    weekdays[weekday].transactions += 1;
  }

  const bestHour = [...hours].sort((a, b) => b.revenue - a.revenue)[0] || null;
  const bestWeekday = [...weekdays].sort((a, b) => b.revenue - a.revenue)[0] || null;
  return { hours, weekdays, bestHour, bestWeekday };
}

function normalizePaymentLabel(method) {
  return String(method || 'Other').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function pagerPages(page, totalPages) {
  const pages = new Set([1, totalPages, page, page - 1, page + 1]);
  return [...pages].filter(value => value >= 1 && value <= totalPages).sort((a, b) => a - b);
}

function pagerMarkup(page, totalPages) {
  if (totalPages <= 1) return '';
  const pages = pagerPages(page, totalPages);
  let previous = 0;
  const buttons = [];
  for (const value of pages) {
    if (previous && value - previous > 1) buttons.push('<span class="sales-page-ellipsis">…</span>');
    buttons.push(`<button class="btn btn-sm ${value === page ? 'btn-primary sales-report-page-btn active' : 'btn-secondary sales-report-page-btn'}" data-report-page="${value}">${value}</button>`);
    previous = value;
  }
  return `
    <div class="sales-pagination">
      <button class="btn btn-sm btn-secondary" data-report-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Previous</button>
      <div class="sales-page-numbers">${buttons.join('')}</div>
      <button class="btn btn-sm btn-secondary" data-report-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next →</button>
    </div>
  `;
}

export async function renderAdminSalesReports(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = '<div class="alert alert-warning">No pharmacy linked to your account.</div>';
    return;
  }

  try {
    if (!window.pharmacySettings?.currency_symbol) {
      const settings = await getPharmacySettings(pharmacyId);
      window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    }
    const [branches, staff] = await Promise.all([getBranches(pharmacyId), getPharmacySalesmen(pharmacyId)]);
    renderReportsView(container, branches || [], staff || [], pharmacyId);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load reports: ${escapeHtml(err.message)}</div>`;
  }
}

function renderReportsView(container, branches, staff, pharmacyId) {
  const today = formatIsoDate(todayUtc());
  const state = {
    preset: 'today',
    customStart: today,
    customEnd: today,
    branchId: 'all',
    employeeId: 'all',
    detailPage: 1,
    detailPageSize: 30,
    currentReport: null
  };

  const branchName = id => id === 'all' ? 'All Branches' : (branches.find(branch => branch.id === id)?.name || 'Selected Branch');
  const employeeName = id => id === 'all' ? 'All Salesmen' : (staff.find(person => person.id === id)?.full_name || 'Selected Salesman');

  container.innerHTML = `
    <div class="animate-in admin-sales-reports-upgrade">
      <div class="page-header">
        <div>
          <div class="page-title">📊 Sales Reports</div>
          <div class="page-subtitle">Salesman performance, product sales and time-of-day analytics</div>
        </div>
      </div>

      <div class="card sales-report-controls-card">
        <div class="card-body">
          <div class="sales-report-preset-row" role="group" aria-label="Report period">
            <button class="btn btn-primary" data-report-preset="today">Today</button>
            <button class="btn btn-secondary" data-report-preset="yesterday">Yesterday</button>
            <button class="btn btn-secondary" data-report-preset="last7">Last 7 Days</button>
            <button class="btn btn-secondary" data-report-preset="last30">Last 30 Days</button>
            <button class="btn btn-secondary" data-report-preset="this_month">This Month</button>
            <button class="btn btn-secondary" data-report-preset="this_year">This Year</button>
            <button class="btn btn-secondary" data-report-preset="custom">Custom</button>
          </div>

          <div class="sales-report-filter-grid">
            <div class="form-group" style="margin:0">
              <label class="form-label">Branch</label>
              <select class="form-control" id="sales-report-branch">
                <option value="all">All Branches</option>
                ${branches.filter(branch => branch.is_active !== false).map(branch => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Employee (Salesman)</label>
              <select class="form-control" id="sales-report-employee">
                <option value="all">All Salesmen</option>
                ${staff.map(person => `<option value="${person.id}">${escapeHtml(person.full_name || person.email || 'Unnamed salesman')}</option>`).join('')}
              </select>
            </div>
            <div class="form-group sales-report-custom-date" style="margin:0;display:none">
              <label class="form-label">From</label>
              <input class="form-control" type="date" id="sales-report-start" value="${today}">
            </div>
            <div class="form-group sales-report-custom-date" style="margin:0;display:none">
              <label class="form-label">To</label>
              <input class="form-control" type="date" id="sales-report-end" value="${today}">
            </div>
            <div class="form-group sales-report-generate" style="margin:0">
              <button class="btn btn-primary" id="generate-sales-report-btn">Generate Report</button>
            </div>
          </div>
        </div>
      </div>

      <div id="report-display">
        <div class="card"><div class="card-body" style="text-align:center;color:var(--gray-500)">Generate a report to view sales analytics.</div></div>
      </div>
    </div>
  `;

  const reportDisplay = container.querySelector('#report-display');
  const generateBtn = container.querySelector('#generate-sales-report-btn');
  const branchEl = container.querySelector('#sales-report-branch');
  const employeeEl = container.querySelector('#sales-report-employee');
  const startEl = container.querySelector('#sales-report-start');
  const endEl = container.querySelector('#sales-report-end');
  const customDateEls = [...container.querySelectorAll('.sales-report-custom-date')];

  function syncPresetButtons() {
    container.querySelectorAll('[data-report-preset]').forEach(button => {
      const active = button.dataset.reportPreset === state.preset;
      button.classList.toggle('btn-primary', active);
      button.classList.toggle('btn-secondary', !active);
    });
    customDateEls.forEach(el => { el.style.display = state.preset === 'custom' ? '' : 'none'; });
  }

  async function generateReport() {
    const range = getPresetRange(state.preset, state.customStart, state.customEnd);
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
    reportDisplay.innerHTML = '<div class="card"><div class="card-body" style="text-align:center">Loading report analytics...</div></div>';

    try {
      const rawSales = await getSalesForReport(pharmacyId, {
        branchId: state.branchId === 'all' ? null : state.branchId,
        staffId: state.employeeId === 'all' ? null : state.employeeId,
        start: range.start.toISOString(),
        end: range.end.toISOString()
      });
      const sales = await enrichSalesWithItems(rawSales || []);
      const totalRevenue = sales.reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0);
      const transactionCount = sales.length;
      const itemsSold = sumItemQuantity(sales);
      const dailyBreakdown = buildDailyBreakdown(sales, range.start, range.end);
      const productReport = buildProductReport(sales);
      const staffComparison = buildStaffComparison(sales, staff);
      const timePerformance = buildTimePerformance(sales);
      const activeSalesDays = dailyBreakdown.filter(day => day.transactions > 0).length;
      const paymentBreakdown = {};
      for (const sale of sales) {
        const method = sale.payment_method || 'other';
        paymentBreakdown[method] = (paymentBreakdown[method] || 0) + Number(sale.total_amount || 0);
      }

      state.detailPage = 1;
      state.currentReport = {
        title: `${range.label} Sales Report`,
        rangeLabel: formatRange(range.start, range.end),
        start: range.start,
        end: range.end,
        sales,
        totalRevenue,
        transactionCount,
        itemsSold,
        averageSale: transactionCount ? totalRevenue / transactionCount : 0,
        averageActiveDay: activeSalesDays ? totalRevenue / activeSalesDays : 0,
        activeSalesDays,
        paymentBreakdown,
        dailyBreakdown,
        productReport,
        staffComparison,
        timePerformance,
        branchLabel: branchName(state.branchId),
        employeeLabel: employeeName(state.employeeId)
      };
      renderCurrentReport();
      await loadTransactionPage();
    } catch (err) {
      console.error('Failed to generate sales report:', err);
      reportDisplay.innerHTML = `<div class="alert alert-danger">Failed to generate report: ${escapeHtml(err.message)}</div>`;
      showToast('Failed to generate sales report', 'error');
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate Report';
    }
  }

  function renderCurrentReport() {
    const report = state.currentReport;
    if (!report) return;
    const topProducts = report.productReport.slice(0, 15);
    const maxHourlyRevenue = Math.max(1, ...report.timePerformance.hours.map(row => row.revenue));
    const maxWeekdayRevenue = Math.max(1, ...report.timePerformance.weekdays.map(row => row.revenue));
    const bestHour = report.timePerformance.bestHour?.revenue > 0 ? report.timePerformance.bestHour : null;
    const bestWeekday = report.timePerformance.bestWeekday?.revenue > 0 ? report.timePerformance.bestWeekday : null;

    reportDisplay.innerHTML = `
      <div class="card employee-report-card">
        <div class="card-body">
          <div class="employee-report-heading">
            <div>
              <h2 style="margin:0">${escapeHtml(report.title)}</h2>
              <div class="employee-report-scope">
                <span>${escapeHtml(report.rangeLabel)}</span>
                <span>Branch: <strong>${escapeHtml(report.branchLabel)}</strong></span>
                <span>Salesman: <strong>${escapeHtml(report.employeeLabel)}</strong></span>
              </div>
            </div>
            <div class="employee-report-actions sales-report-top-actions">
              <button class="btn btn-secondary" id="print-sales-report">🖨️ Print</button>
              <button class="btn btn-primary" id="export-sales-report">📊 Export CSV</button>
            </div>
          </div>

          <div class="staff-report-summary-grid sales-report-summary-grid">
            <div class="staff-report-summary-card"><span>Total Sales</span><strong>${formatCurrency(report.totalRevenue)}</strong></div>
            <div class="staff-report-summary-card"><span>Transactions</span><strong>${report.transactionCount.toLocaleString()}</strong></div>
            <div class="staff-report-summary-card"><span>Items Sold</span><strong>${report.itemsSold.toLocaleString()}</strong></div>
            <div class="staff-report-summary-card"><span>Average Sale</span><strong>${formatCurrency(report.averageSale)}</strong></div>
            <div class="staff-report-summary-card"><span>Active Sales Days</span><strong>${report.activeSalesDays.toLocaleString()}</strong></div>
            <div class="staff-report-summary-card"><span>Average / Active Day</span><strong>${formatCurrency(report.averageActiveDay)}</strong></div>
            <div class="staff-report-summary-card"><span>Best Sales Hour</span><strong>${bestHour ? `${String(bestHour.hour).padStart(2, '0')}:00` : '—'}</strong></div>
            <div class="staff-report-summary-card"><span>Best Sales Day</span><strong>${bestWeekday ? escapeHtml(bestWeekday.name) : '—'}</strong></div>
          </div>

          <div class="sales-report-two-column">
            <section class="employee-report-section sales-report-panel">
              <h3>Payment Breakdown</h3>
              ${Object.keys(report.paymentBreakdown).length ? `
                <div class="payment-report-list">
                  ${Object.entries(report.paymentBreakdown).sort((a, b) => b[1] - a[1]).map(([method, amount]) => `
                    <div class="payment-report-row">
                      <span>${escapeHtml(normalizePaymentLabel(method))}</span>
                      <strong>${formatCurrency(amount)} · ${report.totalRevenue ? Math.round((amount / report.totalRevenue) * 100) : 0}%</strong>
                    </div>
                  `).join('')}
                </div>` : '<div class="empty-state-desc">No payment data for this period.</div>'}
            </section>

            <section class="employee-report-section sales-report-panel">
              <h3>Period Highlights</h3>
              <div class="payment-report-list">
                <div class="payment-report-row"><span>Best hour</span><strong>${bestHour ? `${String(bestHour.hour).padStart(2, '0')}:00 · ${formatCurrency(bestHour.revenue)}` : '—'}</strong></div>
                <div class="payment-report-row"><span>Best weekday</span><strong>${bestWeekday ? `${escapeHtml(bestWeekday.name)} · ${formatCurrency(bestWeekday.revenue)}` : '—'}</strong></div>
                <div class="payment-report-row"><span>Products sold</span><strong>${report.productReport.length.toLocaleString()} distinct</strong></div>
                <div class="payment-report-row"><span>Salesmen with sales</span><strong>${report.staffComparison.length.toLocaleString()}</strong></div>
              </div>
            </section>
          </div>

          <section class="employee-report-section">
            <div class="sales-report-section-heading"><div><h3>Salesman Comparison</h3><p>Completed sales attributed to each salesman in this period.</p></div></div>
            ${report.staffComparison.length ? `
              <div class="table-responsive">
                <table class="table responsive-data-table">
                  <thead><tr><th>Salesman</th><th>Sales</th><th>Transactions</th><th>Items</th><th>Avg Sale</th><th>Active Days</th><th>Best Day</th></tr></thead>
                  <tbody>${report.staffComparison.map(row => `
                    <tr>
                      <td><strong>${escapeHtml(row.name)}</strong></td>
                      <td><strong>${formatCurrency(row.revenue)}</strong></td>
                      <td>${row.transactions.toLocaleString()}</td>
                      <td>${row.items.toLocaleString()}</td>
                      <td>${formatCurrency(row.averageSale)}</td>
                      <td>${row.activeDays}</td>
                      <td>${row.bestDay ? `${escapeHtml(formatDayKey(row.bestDay))}<br><small>${formatCurrency(row.bestDayRevenue)}</small>` : '—'}</td>
                    </tr>`).join('')}</tbody>
                </table>
              </div>` : '<div class="empty-state-desc">No salesman-attributed sales in this period.</div>'}
          </section>

          <section class="employee-report-section">
            <div class="sales-report-section-heading"><div><h3>Product Sales Report</h3><p>Top products by recorded sales revenue.</p></div></div>
            ${topProducts.length ? `
              <div class="table-responsive">
                <table class="table responsive-data-table">
                  <thead><tr><th>Product</th><th>Quantity</th><th>Transactions</th><th>Revenue</th><th>Avg Revenue / Unit</th></tr></thead>
                  <tbody>${topProducts.map(row => `
                    <tr>
                      <td><strong>${escapeHtml(row.name)}</strong></td>
                      <td>${row.quantity.toLocaleString()}</td>
                      <td>${row.transactions.toLocaleString()}</td>
                      <td><strong>${formatCurrency(row.revenue)}</strong></td>
                      <td>${formatCurrency(row.quantity ? row.revenue / row.quantity : 0)}</td>
                    </tr>`).join('')}</tbody>
                </table>
              </div>` : '<div class="empty-state-desc">No product sales for this period.</div>'}
          </section>

          <section class="employee-report-section">
            <div class="sales-report-section-heading"><div><h3>Hourly Performance</h3><p>Revenue and transactions by hour of day (UTC / Sierra Leone time).</p></div></div>
            <div class="sales-report-time-grid">
              ${report.timePerformance.hours.map(row => `
                <div class="sales-report-time-card ${bestHour?.hour === row.hour && row.revenue > 0 ? 'is-best' : ''}">
                  <div class="sales-report-time-label">${String(row.hour).padStart(2, '0')}:00</div>
                  <div class="sales-report-time-bar"><span style="width:${Math.max(row.revenue ? 4 : 0, Math.round((row.revenue / maxHourlyRevenue) * 100))}%"></span></div>
                  <strong>${formatCurrency(row.revenue)}</strong>
                  <small>${row.transactions} txn</small>
                </div>`).join('')}
            </div>
          </section>

          <section class="employee-report-section">
            <div class="sales-report-section-heading"><div><h3>Day-of-Week Performance</h3><p>Sales pattern across the week.</p></div></div>
            <div class="sales-report-weekday-grid">
              ${report.timePerformance.weekdays.map(row => `
                <div class="sales-report-weekday-card ${bestWeekday?.day === row.day && row.revenue > 0 ? 'is-best' : ''}">
                  <span>${escapeHtml(row.name)}</span>
                  <div class="sales-report-time-bar"><span style="width:${Math.max(row.revenue ? 4 : 0, Math.round((row.revenue / maxWeekdayRevenue) * 100))}%"></span></div>
                  <strong>${formatCurrency(row.revenue)}</strong>
                  <small>${row.transactions} transactions</small>
                </div>`).join('')}
            </div>
          </section>

          <section class="employee-report-section">
            <div class="sales-report-section-heading"><div><h3>Daily Breakdown</h3><p>Every calendar day in the selected period.</p></div></div>
            <div class="table-responsive sales-report-daily-table">
              <table class="table responsive-data-table">
                <thead><tr><th>Date</th><th>Transactions</th><th>Items Sold</th><th>Total Sales</th></tr></thead>
                <tbody>${report.dailyBreakdown.map(row => `
                  <tr><td>${escapeHtml(formatDayKey(row.date))}</td><td>${row.transactions}</td><td>${row.items}</td><td><strong>${formatCurrency(row.total)}</strong></td></tr>
                `).join('')}</tbody>
              </table>
            </div>
          </section>

          <section class="employee-report-section sales-report-transactions-section">
            <div class="sales-report-section-heading">
              <div><h3>Detailed Transactions</h3><p>Loaded in database pages so long report periods remain manageable.</p></div>
              <div class="form-group sales-report-page-size" style="margin:0">
                <label class="form-label">Per page</label>
                <select class="form-control" id="sales-report-page-size">
                  <option value="25">25</option><option value="30" selected>30</option><option value="50">50</option>
                </select>
              </div>
            </div>
            <div id="sales-report-transactions"><div class="empty-state-desc">Loading transaction details...</div></div>
          </section>
        </div>
      </div>
    `;

    reportDisplay.querySelector('#print-sales-report')?.addEventListener('click', printCurrentReport);
    reportDisplay.querySelector('#export-sales-report')?.addEventListener('click', exportCurrentReport);
    reportDisplay.querySelector('#sales-report-page-size')?.addEventListener('change', async event => {
      state.detailPageSize = Number(event.target.value || 30);
      state.detailPage = 1;
      await loadTransactionPage();
    });
  }

  async function loadTransactionPage() {
    const report = state.currentReport;
    const wrap = reportDisplay.querySelector('#sales-report-transactions');
    if (!report || !wrap) return;
    wrap.setAttribute('aria-busy', 'true');
    wrap.innerHTML = '<div class="empty-state-desc" style="padding:1rem">Loading transactions...</div>';

    try {
      const result = await getSalesReportTransactionsPage(pharmacyId, {
        branchId: state.branchId === 'all' ? null : state.branchId,
        staffId: state.employeeId === 'all' ? null : state.employeeId,
        start: report.start.toISOString(),
        end: report.end.toISOString(),
        page: state.detailPage,
        pageSize: state.detailPageSize
      });
      state.detailPage = result.page;
      const staffMap = new Map(staff.map(person => [person.id, person]));
      const branchMap = new Map(branches.map(branch => [branch.id, branch]));

      wrap.innerHTML = `
        <div class="table-responsive">
          <table class="table responsive-data-table">
            <thead><tr><th>Invoice</th><th>Date / Time</th><th>Customer</th><th>Salesman</th><th>Branch</th><th>Payment</th><th>Total</th></tr></thead>
            <tbody>${result.rows.length ? result.rows.map(sale => {
              const created = new Date(sale.created_at);
              const staffMember = staffMap.get(sale.created_by);
              const branch = branchMap.get(sale.branch_id);
              return `<tr>
                <td><strong>${escapeHtml(sale.invoice_number || '—')}</strong></td>
                <td>${escapeHtml(created.toLocaleDateString('en-US'))}<br><small>${escapeHtml(created.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))}</small></td>
                <td>${escapeHtml(sale.customers?.name || 'Walk-in')}</td>
                <td>${escapeHtml(staffMember?.full_name || staffMember?.email || 'Unassigned')}</td>
                <td>${escapeHtml(branch?.name || '—')}</td>
                <td>${escapeHtml(normalizePaymentLabel(sale.payment_method))}</td>
                <td><strong>${formatCurrency(Number(sale.total_amount || 0))}</strong></td>
              </tr>`;
            }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--gray-500)">No transactions found.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="sales-pagination-wrap sales-report-detail-pagination">
          <div class="sales-pagination-info">Showing ${result.total ? ((result.page - 1) * result.pageSize) + 1 : 0}–${Math.min(result.page * result.pageSize, result.total)} of ${result.total.toLocaleString()} transactions · Page ${result.page} of ${result.totalPages}</div>
          ${pagerMarkup(result.page, result.totalPages)}
        </div>
      `;
      wrap.querySelectorAll('[data-report-page]').forEach(button => button.addEventListener('click', async () => {
        const nextPage = Number(button.dataset.reportPage);
        if (!Number.isFinite(nextPage) || nextPage < 1 || nextPage > result.totalPages || nextPage === state.detailPage) return;
        state.detailPage = nextPage;
        await loadTransactionPage();
      }));
    } catch (err) {
      console.error('Failed to load sales report transactions:', err);
      wrap.innerHTML = `<div class="alert alert-danger">Failed to load transactions: ${escapeHtml(err.message)}</div>`;
    } finally {
      wrap.removeAttribute('aria-busy');
    }
  }

  function printCurrentReport() {
    const report = state.currentReport;
    if (!report) return;
    const card = reportDisplay.querySelector('.employee-report-card');
    const content = card?.innerHTML || '';
    const printWindow = window.open('', '', 'height=900,width=1100');
    if (!printWindow) {
      showToast('Please allow pop-ups to print this report', 'warning');
      return;
    }
    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(report.title)}</title><style>
      body{font-family:Inter,Arial,sans-serif;margin:24px;color:#0f172a}table{width:100%;border-collapse:collapse;margin:12px 0 24px}th,td{border:1px solid #e5e7eb;padding:7px;text-align:left;vertical-align:top}th{background:#f8fafc}button,select,.sales-pagination-wrap,.sales-report-page-size{display:none!important}.staff-report-summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.staff-report-summary-card,.sales-report-time-card,.sales-report-weekday-card{border:1px solid #e5e7eb;padding:10px;border-radius:8px}.sales-report-time-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}.sales-report-weekday-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.sales-report-time-bar{height:5px;background:#e5e7eb;margin:6px 0}.sales-report-time-bar span{display:block;height:100%;background:#2563eb}.employee-report-section{margin-top:20px;padding-top:14px;border-top:1px solid #e5e7eb}.employee-report-actions{display:none!important}</style></head><body>${content}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 120);
  }

  function exportCurrentReport() {
    const report = state.currentReport;
    if (!report) return;
    const rows = [
      [report.title], ['Period', report.rangeLabel], ['Branch', report.branchLabel], ['Salesman', report.employeeLabel],
      ['Total Sales', report.totalRevenue], ['Transactions', report.transactionCount], ['Items Sold', report.itemsSold], ['Average Sale', report.averageSale],
      [], ['Salesman Comparison'], ['Salesman', 'Revenue', 'Transactions', 'Items', 'Average Sale', 'Active Days', 'Best Day', 'Best Day Revenue'],
      ...report.staffComparison.map(row => [row.name, row.revenue, row.transactions, row.items, row.averageSale, row.activeDays, row.bestDay || '', row.bestDayRevenue]),
      [], ['Product Sales'], ['Product', 'Quantity', 'Transactions', 'Revenue', 'Average Revenue Per Unit'],
      ...report.productReport.map(row => [row.name, row.quantity, row.transactions, row.revenue, row.quantity ? row.revenue / row.quantity : 0]),
      [], ['Payment Breakdown'], ['Payment Method', 'Revenue'],
      ...Object.entries(report.paymentBreakdown).map(([method, amount]) => [normalizePaymentLabel(method), amount]),
      [], ['Hourly Performance'], ['Hour', 'Transactions', 'Revenue'],
      ...report.timePerformance.hours.map(row => [`${String(row.hour).padStart(2, '0')}:00`, row.transactions, row.revenue]),
      [], ['Day-of-Week Performance'], ['Day', 'Transactions', 'Revenue'],
      ...report.timePerformance.weekdays.map(row => [row.name, row.transactions, row.revenue]),
      [], ['Daily Breakdown'], ['Date', 'Transactions', 'Items Sold', 'Revenue'],
      ...report.dailyBreakdown.map(row => [row.date, row.transactions, row.items, row.total]),
      [], ['Transactions'], ['Invoice', 'Date', 'Time', 'Customer', 'Salesman ID', 'Total', 'Payment Method'],
      ...report.sales.map(sale => {
        const created = new Date(sale.created_at);
        return [sale.invoice_number || '', created.toISOString().slice(0, 10), created.toISOString().slice(11, 19), sale.customers?.name || 'Walk-in', sale.created_by || '', Number(sale.total_amount || 0), normalizePaymentLabel(sale.payment_method)];
      })
    ];
    const csv = rows.map(row => row.map(cell => {
      const value = String(cell ?? '').replaceAll('"', '""');
      return /[",\n]/.test(value) ? `"${value}"` : value;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sales_report_${formatIsoDate(report.start)}_${formatIsoDate(addUtcDays(report.end, -1))}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  container.querySelectorAll('[data-report-preset]').forEach(button => button.addEventListener('click', () => {
    state.preset = button.dataset.reportPreset;
    syncPresetButtons();
  }));
  branchEl.addEventListener('change', () => { state.branchId = branchEl.value; });
  employeeEl.addEventListener('change', () => { state.employeeId = employeeEl.value; });
  startEl.addEventListener('change', () => { state.customStart = startEl.value; });
  endEl.addEventListener('change', () => { state.customEnd = endEl.value; });
  generateBtn.addEventListener('click', generateReport);

  syncPresetButtons();
}
