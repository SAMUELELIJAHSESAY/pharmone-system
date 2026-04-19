// Daily Sales Reports - Records of all sales aggregated by day
import { getDailyReports, getDailyReportsByDateRange, generateDailySalesReport, getBranches } from '../../database.js';
import { formatCurrency, formatDateTime, showToast } from '../../utils.js';
import { createModal } from '../../components/modal.js';

export async function renderDailyReports(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;
  const userRole = user?.profile?.role;
  const userBranchId = user?.profile?.branch_id;

  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked to your account.</div>`;
    return;
  }

  try {
    // Get branches for filter
    const branches = await getBranches(pharmacyId);
    
    // Get all daily reports
    let reports = await getDailyReports(pharmacyId, null, 100);
    
    // Filter for salesman - only their branch
    if (userRole === 'salesman' && userBranchId) {
      reports = reports.filter(r => r.branch_id === userBranchId);
    }

    const totalReports = reports.length;
    const totalRevenue = reports.reduce((sum, r) => sum + (parseFloat(r.total_sales) || 0), 0);
    const totalItems = reports.reduce((sum, r) => sum + (r.total_items_sold || 0), 0);

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">📊 Daily Sales Reports</div>
            <div class="page-subtitle">View and manage daily sales records by branch</div>
          </div>
          ${userRole === 'admin' ? `<button class="btn btn-primary" id="generate-report-btn">+ Generate Today's Report</button>` : ''}
        </div>

        <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Reports</span>
              <div class="stat-card-icon blue">📋</div>
            </div>
            <div class="stat-card-value">${totalReports}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Revenue</span>
              <div class="stat-card-icon teal">💰</div>
            </div>
            <div class="stat-card-value">${formatCurrency(totalRevenue)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Items</span>
              <div class="stat-card-icon green">📦</div>
            </div>
            <div class="stat-card-value">${totalItems}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Sales Reports</span>
            <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
              ${userRole === 'admin' ? `
              <select class="form-select" id="branch-filter-reports" style="width:auto">
                <option value="">All Branches</option>
                ${branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
              </select>
              ` : ''}
              <input type="date" id="date-filter-from-reports" class="form-input" style="width:140px" />
              <input type="date" id="date-filter-to-reports" class="form-input" style="width:140px" />
            </div>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Report Date</th>
                  <th>Branch</th>
                  <th>Total Sales</th>
                  <th>Items Sold</th>
                  <th>Payment Method</th>
                  <th>Generated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="reports-tbody">
                ${renderReportsTable(reports, branches)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    if (userRole === 'admin') {
      const generateBtn = document.getElementById('generate-report-btn');
      if (generateBtn) {
        generateBtn.addEventListener('click', () => showGenerateReportModal(pharmacyId, branches));
      }
    }

    // Filter handlers
    const applyFilters = () => {
      const branchFilter = document.getElementById('branch-filter-reports')?.value || '';
      const dateFrom = document.getElementById('date-filter-from-reports')?.value ? new Date(document.getElementById('date-filter-from-reports').value) : null;
      const dateTo = document.getElementById('date-filter-to-reports')?.value ? new Date(document.getElementById('date-filter-to-reports').value) : null;

      const filtered = reports.filter(r => {
        const matchesBranch = !branchFilter || r.branch_id === branchFilter;
        const reportDate = new Date(r.report_date);
        const matchesDate = (!dateFrom || reportDate >= dateFrom) && (!dateTo || reportDate <= dateTo);
        return matchesBranch && matchesDate;
      });

      document.getElementById('reports-tbody').innerHTML = renderReportsTable(filtered, branches);
      bindReportActions(filtered, branches);
    };

    if (document.getElementById('branch-filter-reports')) {
      document.getElementById('branch-filter-reports').addEventListener('change', applyFilters);
    }
    if (document.getElementById('date-filter-from-reports')) {
      document.getElementById('date-filter-from-reports').addEventListener('change', applyFilters);
    }
    if (document.getElementById('date-filter-to-reports')) {
      document.getElementById('date-filter-to-reports').addEventListener('change', applyFilters);
    }

    bindReportActions(reports, branches);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load reports: ${err.message}</div>`;
  }
}

function renderReportsTable(reports, branches) {
  if (!reports.length) {
    return `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">No reports yet</div></div></td></tr>`;
  }

  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));

  return reports.map(r => {
    const payments = r.payment_breakdown || {};
    const paymentMethods = Object.entries(payments)
      .filter(([_, amount]) => amount > 0)
      .map(([method, amount]) => `${method.replace('_', ' ')}: ${formatCurrency(amount)}`)
      .join(', ');

    return `
      <tr>
        <td class="font-semibold">${new Date(r.report_date).toLocaleDateString()}</td>
        <td>${branchMap[r.branch_id] || 'Unknown'}</td>
        <td class="font-semibold" style="color:var(--success)">${formatCurrency(r.total_sales)}</td>
        <td class="text-center">${r.total_items_sold}</td>
        <td class="text-xs" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${paymentMethods || '—'}</td>
        <td class="text-xs text-muted">${formatDateTime(r.created_at)}</td>
        <td>
          <button class="btn btn-ghost btn-sm view-report-btn" data-id="${r.id}">View Details</button>
        </td>
      </tr>
    `;
  }).join('');
}

function bindReportActions(reports, branches) {
  const reportMap = Object.fromEntries(reports.map(r => [r.id, r]));
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b]));

  document.querySelectorAll('.view-report-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const report = reportMap[btn.dataset.id];
      if (report) showReportDetail(report, branchMap[report.branch_id]);
    });
  });
}

function showGenerateReportModal(pharmacyId, branches) {
  createModal({
    id: 'generate-report',
    title: 'Generate Daily Report',
    body: `
      <div style="display:grid;gap:1rem">
        <div>
          <label class="form-label">Select Branch</label>
          <select id="gen-branch-select" class="form-select">
            <option value="">-- Select a branch --</option>
            ${branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">Report Date</label>
          <input type="date" id="gen-report-date" class="form-input" value="${new Date().toISOString().split('T')[0]}" />
        </div>
      </div>
    `,
    confirmBtn: 'Generate Report',
    onConfirm: async () => {
      const branchId = document.getElementById('gen-branch-select')?.value;
      const reportDate = document.getElementById('gen-report-date')?.value;

      if (!branchId) {
        showToast('Please select a branch', 'error');
        return false;
      }

      try {
        await generateDailySalesReport(pharmacyId, branchId, reportDate);
        showToast('Report generated successfully', 'success');
        
        // Close modal and reload
        document.getElementById('generate-report')?.remove();
        
        // Reload the reports
        import('../app.js').then(m => m.navigate('daily-reports'));
        return true;
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
        return false;
      }
    }
  });
}

function showReportDetail(report, branchName) {
  const salesData = report.sales_data || [];
  const payments = report.payment_breakdown || {};

  const paymentSummary = Object.entries(payments)
    .filter(([_, amount]) => amount > 0)
    .map(([method, amount]) => `<div style="display:flex;justify-content:space-between"><span>${method.replace('_', ' ')}:</span><span class="font-semibold">${formatCurrency(amount)}</span></div>`)
    .join('');

  const itemsHtml = salesData.map((sale, idx) => `
    <div style="border-bottom:1px solid var(--gray-200);padding:1rem;${idx === salesData.length - 1 ? 'border-bottom:none' : ''}">
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem;margin-bottom:0.75rem">
        <div>
          <div class="text-xs text-muted">Invoice</div>
          <div class="font-semibold text-sm">${sale.invoice_number}</div>
        </div>
        <div>
          <div class="text-xs text-muted">Customer</div>
          <div class="font-semibold text-sm">${sale.customer_name}</div>
        </div>
        <div>
          <div class="text-xs text-muted">Amount</div>
          <div class="font-semibold text-sm" style="color:var(--success)">${formatCurrency(sale.amount)}</div>
        </div>
        <div>
          <div class="text-xs text-muted">Payment</div>
          <div class="font-semibold text-sm">${sale.payment_method?.replace('_', ' ')}</div>
        </div>
        <div style="grid-column:1/-1">
          <div class="text-xs text-muted">Staff</div>
          <div class="text-sm">${sale.staff_name}</div>
        </div>
      </div>
      ${sale.items && sale.items.length > 0 ? `
        <div style="background:var(--gray-50);border-radius:var(--radius-md);padding:0.75rem;margin-top:0.75rem">
          <div class="text-xs font-semibold text-muted" style="margin-bottom:0.5rem">Items:</div>
          ${sale.items.map(item => `
            <div style="display:flex;justify-content:space-between;font-size:0.875rem;margin-bottom:0.25rem">
              <span>${item.product_name} (x${item.quantity})</span>
              <span>${formatCurrency(item.total_price)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');

  createModal({
    id: 'report-detail',
    title: `Daily Report - ${new Date(report.report_date).toLocaleDateString()}`,
    size: 'lg',
    body: `
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid var(--gray-200)">
        <div>
          <div class="text-xs text-muted">Branch</div>
          <div class="font-semibold">${branchName}</div>
        </div>
        <div>
          <div class="text-xs text-muted">Report Date</div>
          <div class="font-semibold">${new Date(report.report_date).toLocaleDateString()}</div>
        </div>
        <div>
          <div class="text-xs text-muted">Total Sales</div>
          <div class="font-semibold" style="font-size:1.25rem;color:var(--success)">${formatCurrency(report.total_sales)}</div>
        </div>
        <div>
          <div class="text-xs text-muted">Items Sold</div>
          <div class="font-semibold" style="font-size:1.25rem">${report.total_items_sold}</div>
        </div>
      </div>

      <div style="margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid var(--gray-200)">
        <div class="text-sm font-semibold" style="margin-bottom:0.75rem">Payment Breakdown</div>
        <div style="background:var(--gray-50);padding:1rem;border-radius:var(--radius-md)">
          ${paymentSummary || '<div class="text-muted">No payment data</div>'}
        </div>
      </div>

      <div>
        <div class="text-sm font-semibold" style="margin-bottom:0.75rem">Sales Details (${salesData.length} transactions)</div>
        <div style="max-height:400px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius-md)">
          ${itemsHtml || '<div style="padding:1rem;text-align:center;color:var(--gray-400)">No sales data</div>'}
        </div>
      </div>
    `,
    confirmBtn: 'Close',
    onConfirm: () => true
  });
}
