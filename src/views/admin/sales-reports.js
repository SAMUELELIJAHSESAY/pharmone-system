// Admin Sales Reports - Daily, Weekly and Monthly with Branch + Employee filtering
import {
  getBranches,
  getPharmacySettings,
  getPharmacySalesmen,
  getSalesForReport,
  enrichSalesWithItems
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
  if (!year || !month) return new Date();
  return new Date(Date.UTC(year, month - 1, day || 1, 0, 0, 0, 0));
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getReportRange(reportType, selectedDate) {
  const target = parseDateInput(selectedDate);

  if (reportType === 'daily') {
    const start = new Date(target);
    const end = addUtcDays(start, 1);
    return { start, end };
  }

  if (reportType === 'weekly') {
    const day = target.getUTCDay();
    const daysToMonday = day === 0 ? 6 : day - 1;
    const start = addUtcDays(target, -daysToMonday);
    const end = addUtcDays(start, 7);
    return { start, end };
  }

  const start = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1));
  const end = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 1));
  return { start, end };
}

function formatRangeTitle(reportType, start, end) {
  const dateOptions = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (reportType === 'daily') {
    return `Daily Sales Report - ${start.toLocaleDateString('en-US', dateOptions)}`;
  }
  if (reportType === 'weekly') {
    const inclusiveEnd = addUtcDays(end, -1);
    return `Weekly Sales Report - ${start.toLocaleDateString('en-US', dateOptions)} to ${inclusiveEnd.toLocaleDateString('en-US', dateOptions)}`;
  }
  return `Monthly Sales Report - ${start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
}

function dateKeyUtc(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatDayKey(key) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC'
  });
}

function sumItemQuantity(sales) {
  return sales.reduce((total, sale) => {
    return total + (sale.sale_items || []).reduce((itemTotal, item) => itemTotal + Number(item.quantity || 0), 0);
  }, 0);
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
    const key = day.toISOString().slice(0, 10);
    const record = grouped.get(key);
    if (record) rows.push(record);
  }
  return rows;
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

    const [branches, staff] = await Promise.all([
      getBranches(pharmacyId),
      getPharmacySalesmen(pharmacyId)
    ]);

    renderReportsView(container, branches || [], staff || [], pharmacyId);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load reports: ${escapeHtml(err.message)}</div>`;
  }
}

function renderReportsView(container, branches, staff, pharmacyId) {
  let selectedBranch = 'all';
  let selectedEmployee = 'all';
  let reportType = 'daily';
  let selectedDate = new Date().toISOString().split('T')[0];

  const currencySymbol = window.pharmacySettings?.currency_symbol || 'Le';

  const branchName = (id) => id === 'all'
    ? 'All Branches'
    : (branches.find(branch => branch.id === id)?.name || 'Selected Branch');

  const employeeName = (id) => id === 'all'
    ? 'All Salesmen'
    : (staff.find(person => person.id === id)?.full_name || 'Selected Employee');

  async function generateReport() {
    const generateBtn = document.getElementById('generate-sales-report-btn');
    const reportContainer = document.getElementById('report-display');
    if (!reportContainer) return;

    generateBtn?.setAttribute('disabled', 'disabled');
    if (generateBtn) generateBtn.textContent = 'Generating...';
    reportContainer.innerHTML = '<div class="card"><div class="card-body" style="text-align:center">Loading report data...</div></div>';

    try {
      const { start, end } = getReportRange(reportType, selectedDate);
      const rawSales = await getSalesForReport(pharmacyId, {
        branchId: selectedBranch === 'all' ? null : selectedBranch,
        staffId: selectedEmployee === 'all' ? null : selectedEmployee,
        start: start.toISOString(),
        end: end.toISOString()
      });
      const sales = await enrichSalesWithItems(rawSales);

      const totalRevenue = sales.reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0);
      const transactionCount = sales.length;
      const itemsSold = sumItemQuantity(sales);
      const dailyBreakdown = buildDailyBreakdown(sales, start, end);
      const periodDays = Math.max(1, Math.round((end - start) / 86400000));

      const reportData = {
        title: formatRangeTitle(reportType, start, end),
        type: reportType,
        start,
        end,
        sales,
        dailyBreakdown,
        totalRevenue,
        itemsSold,
        transactionCount,
        avgDaily: totalRevenue / periodDays,
        branchLabel: branchName(selectedBranch),
        employeeLabel: employeeName(selectedEmployee)
      };

      displayReport(reportData);
    } catch (err) {
      console.error('Failed to generate sales report:', err);
      reportContainer.innerHTML = `<div class="alert alert-danger">Failed to generate report: ${escapeHtml(err.message)}</div>`;
      showToast('Failed to generate employee sales report', 'error');
    } finally {
      generateBtn?.removeAttribute('disabled');
      if (generateBtn) generateBtn.textContent = 'Generate Report';
    }
  }

  function displayReport(reportData) {
    const reportContainer = document.getElementById('report-display');
    if (!reportContainer) return;

    const paymentBreakdown = {};
    reportData.sales.forEach(sale => {
      const method = sale.payment_method || 'Other';
      paymentBreakdown[method] = (paymentBreakdown[method] || 0) + Number(sale.total_amount || 0);
    });

    const productSales = {};
    reportData.sales.forEach(sale => {
      (sale.sale_items || []).forEach(item => {
        const name = item.product_name || 'Unknown product';
        if (!productSales[name]) productSales[name] = { qty: 0, revenue: 0 };
        productSales[name].qty += Number(item.quantity || 0);
        productSales[name].revenue += Number(item.total_price || 0);
      });
    });
    const topProducts = Object.entries(productSales)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .slice(0, 10);

    const dailyRows = reportData.dailyBreakdown.length
      ? reportData.dailyBreakdown.map(row => `
          <tr>
            <td>${escapeHtml(formatDayKey(row.date))}</td>
            <td>${row.transactions}</td>
            <td>${row.items}</td>
            <td><strong>${formatCurrency(row.total)}</strong></td>
          </tr>
        `).join('')
      : '<tr><td colspan="4" style="text-align:center;color:var(--gray-500)">No sales in this period</td></tr>';

    reportContainer.innerHTML = `
      <div class="card employee-report-card">
        <div class="card-body">
          <div class="employee-report-heading">
            <div>
              <h2 style="margin:0">${escapeHtml(reportData.title)}</h2>
              <div class="employee-report-scope">
                <span>Branch: <strong>${escapeHtml(reportData.branchLabel)}</strong></span>
                <span>Employee: <strong>${escapeHtml(reportData.employeeLabel)}</strong></span>
              </div>
            </div>
          </div>

          <div class="staff-report-summary-grid">
            <div class="staff-report-summary-card">
              <span>Total Sales</span>
              <strong>${formatCurrency(reportData.totalRevenue)}</strong>
            </div>
            <div class="staff-report-summary-card">
              <span>Transactions</span>
              <strong>${reportData.transactionCount}</strong>
            </div>
            <div class="staff-report-summary-card">
              <span>Items Sold</span>
              <strong>${reportData.itemsSold}</strong>
            </div>
            <div class="staff-report-summary-card">
              <span>Average / Day</span>
              <strong>${formatCurrency(reportData.avgDaily)}</strong>
            </div>
          </div>

          <div class="employee-report-section">
            <h3>Daily Sales Breakdown</h3>
            <div class="table-responsive">
              <table class="table responsive-data-table">
                <thead>
                  <tr><th>Date</th><th>Transactions</th><th>Items Sold</th><th>Total Sales</th></tr>
                </thead>
                <tbody>${dailyRows}</tbody>
              </table>
            </div>
          </div>

          <div class="employee-report-section">
            <h3>Payment Method Breakdown</h3>
            ${Object.entries(paymentBreakdown).length === 0 ? `
              <div class="empty-state-desc">No payment data for this period.</div>
            ` : `
              <div class="payment-report-list">
                ${Object.entries(paymentBreakdown).map(([method, amount]) => {
                  const pct = reportData.totalRevenue > 0 ? Math.round((amount / reportData.totalRevenue) * 100) : 0;
                  return `
                    <div class="payment-report-row">
                      <span>${escapeHtml(String(method).replaceAll('_', ' '))}</span>
                      <strong>${formatCurrency(amount)} (${pct}%)</strong>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <div class="employee-report-section">
            <h3>Top Products</h3>
            ${topProducts.length === 0 ? `
              <div class="empty-state-desc">No product sales for this period.</div>
            ` : `
              <div class="table-responsive">
                <table class="table responsive-data-table">
                  <thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th></tr></thead>
                  <tbody>
                    ${topProducts.map(([name, data]) => `
                      <tr><td>${escapeHtml(name)}</td><td>${data.qty}</td><td><strong>${formatCurrency(data.revenue)}</strong></td></tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>

          <div class="employee-report-actions">
            <button class="btn btn-secondary" id="print-employee-sales-report">🖨️ Print</button>
            <button class="btn btn-primary" id="export-employee-sales-report">📊 Export CSV</button>
          </div>
        </div>
      </div>
    `;

    window.currentReportData = reportData;
    document.getElementById('print-employee-sales-report')?.addEventListener('click', printCurrentReport);
    document.getElementById('export-employee-sales-report')?.addEventListener('click', exportCurrentReport);
  }

  function printCurrentReport() {
    const reportData = window.currentReportData;
    if (!reportData) return;
    const content = document.getElementById('report-display')?.innerHTML || '';
    const printWindow = window.open('', '', 'height=800,width=1000');
    if (!printWindow) {
      showToast('Please allow pop-ups to print this report', 'warning');
      return;
    }
    printWindow.document.write(`
      <html><head><title>${escapeHtml(reportData.title)}</title>
      <style>
        body{font-family:Inter,Arial,sans-serif;margin:24px;color:#0f172a}
        table{width:100%;border-collapse:collapse;margin:16px 0}
        th,td{border:1px solid #e5e7eb;padding:8px;text-align:left}
        th{background:#f8fafc}
        button{display:none!important}
        .staff-report-summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}
        .staff-report-summary-card{border:1px solid #e5e7eb;padding:12px;border-radius:10px}
        .staff-report-summary-card span{display:block;color:#64748b;font-size:12px}
        .staff-report-summary-card strong{font-size:18px}
        .employee-report-scope{display:flex;gap:18px;margin-top:6px;color:#64748b}
      </style></head><body>${content}</body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 100);
  }

  function exportCurrentReport() {
    const reportData = window.currentReportData;
    if (!reportData) return;

    const rows = [
      [reportData.title],
      ['Branch', reportData.branchLabel],
      ['Employee', reportData.employeeLabel],
      ['Total Sales', reportData.totalRevenue],
      ['Transactions', reportData.transactionCount],
      ['Items Sold', reportData.itemsSold],
      ['Average Per Day', reportData.avgDaily.toFixed(2)],
      [],
      ['Daily Breakdown'],
      ['Date', 'Transactions', 'Items Sold', 'Total Sales'],
      ...reportData.dailyBreakdown.map(row => [row.date, row.transactions, row.items, row.total]),
      [],
      ['Transactions'],
      ['Invoice #', 'Date', 'Time', 'Customer', 'Total', 'Payment Method']
    ];

    reportData.sales.forEach(sale => {
      const created = new Date(sale.created_at);
      rows.push([
        sale.invoice_number || '',
        created.toISOString().slice(0, 10),
        created.toISOString().slice(11, 19),
        sale.customers?.name || 'Walk-in',
        Number(sale.total_amount || 0).toFixed(2),
        sale.payment_method || '-'
      ]);
    });

    const csv = rows.map(row => row.map(cell => {
      const value = String(cell ?? '').replaceAll('"', '""');
      return /[",\n]/.test(value) ? `"${value}"` : value;
    }).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportData.employeeLabel.replace(/[^a-z0-9]+/gi, '_')}_${reportData.type}_sales_${reportData.start.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  container.innerHTML = `
    <div class="animate-in">
      <div class="page-header">
        <div>
          <div class="page-title">📊 Sales Reports</div>
          <div class="page-subtitle">Generate daily, weekly or monthly reports by branch and employee</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-body">
          <div class="employee-report-filter-grid">
            <div class="form-group" style="margin:0">
              <label class="form-label">Report Type</label>
              <select class="form-control" id="report-type">
                <option value="daily">Daily Report</option>
                <option value="weekly">Weekly Report</option>
                <option value="monthly">Monthly Report</option>
              </select>
            </div>

            <div class="form-group" style="margin:0">
              <label class="form-label" id="date-label">Select Date</label>
              <input type="date" class="form-control" id="report-date" value="${selectedDate}">
            </div>

            <div class="form-group" style="margin:0">
              <label class="form-label">Branch</label>
              <select class="form-control" id="branch-filter">
                <option value="all">All Branches</option>
                ${branches.map(branch => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join('')}
              </select>
            </div>

            <div class="form-group" style="margin:0">
              <label class="form-label">Employee (Salesman)</label>
              <select class="form-control" id="employee-filter">
                <option value="all">All Salesmen</option>
                ${staff
                  .slice()
                  .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
                  .map(person => `<option value="${person.id}">${escapeHtml(person.full_name || person.email || 'Unnamed employee')} · ${escapeHtml(String(person.role || '').replaceAll('_', ' '))}</option>`)
                  .join('')}
              </select>
            </div>

            <div class="form-group employee-report-generate" style="margin:0">
              <button class="btn btn-primary" id="generate-sales-report-btn">Generate Report</button>
            </div>
          </div>
        </div>
      </div>

      <div id="report-display">
        <div class="card"><div class="card-body" style="text-align:center;color:var(--gray-500)">
          Choose a report type, branch and employee, then generate the report.
        </div></div>
      </div>
    </div>
  `;

  const reportTypeEl = document.getElementById('report-type');
  const reportDateEl = document.getElementById('report-date');
  const dateLabelEl = document.getElementById('date-label');
  const branchFilterEl = document.getElementById('branch-filter');
  const employeeFilterEl = document.getElementById('employee-filter');

  reportTypeEl?.addEventListener('change', () => {
    reportType = reportTypeEl.value;
    if (reportType === 'monthly') {
      dateLabelEl.textContent = 'Select Month';
      reportDateEl.type = 'month';
      reportDateEl.value = selectedDate.slice(0, 7);
    } else {
      dateLabelEl.textContent = reportType === 'weekly' ? 'Select Week (any day)' : 'Select Date';
      reportDateEl.type = 'date';
      reportDateEl.value = selectedDate;
    }
  });

  reportDateEl?.addEventListener('change', () => {
    const value = reportDateEl.value;
    selectedDate = reportType === 'monthly' && value.length === 7 ? `${value}-01` : value;
  });
  branchFilterEl?.addEventListener('change', () => { selectedBranch = branchFilterEl.value; });
  employeeFilterEl?.addEventListener('change', () => { selectedEmployee = employeeFilterEl.value; });
  document.getElementById('generate-sales-report-btn')?.addEventListener('click', generateReport);
}
