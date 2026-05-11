// Advanced Admin Sales Reports - Daily, Weekly, Monthly with Branch Filtering
import { getSales, getBranches, getPharmacySettings, enrichSalesWithItems } from '../../database.js';
import { formatCurrency, formatDate, showToast } from '../../utils.js';

export async function renderAdminSalesReports(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;

  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked to your account.</div>`;
    return;
  }

  try {
    // Load settings and branches
    if (!window.pharmacySettings?.currency_symbol) {
      const settings = await getPharmacySettings(pharmacyId);
      window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    }

    const [allSales, branches] = await Promise.all([
      getSales(pharmacyId, 1000).then(sales => enrichSalesWithItems(sales)),
      getBranches(pharmacyId)
    ]);

    renderReportsView(container, allSales, branches, user, pharmacyId);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load reports: ${err.message}</div>`;
  }
}

function renderReportsView(container, allSales, branches, user, pharmacyId) {
  let selectedBranch = 'all';
  let reportType = 'daily'; // daily, weekly, monthly
  let selectedDate = new Date().toISOString().split('T')[0];

  const currencySymbol = window.pharmacySettings?.currency_symbol || 'Le';

  function generateReport() {
    let filteredSales = [...allSales];

    // Filter by branch
    if (selectedBranch !== 'all') {
      filteredSales = filteredSales.filter(s => s.branch_id === selectedBranch);
    }

    // Filter by completed status
    filteredSales = filteredSales.filter(s => s.status === 'completed');

    let reportData = {};
    let reportTitle = '';

    if (reportType === 'daily') {
      const targetDate = new Date(selectedDate);
      reportTitle = `Daily Sales Report - ${targetDate.toLocaleDateString()}`;
      
      const daySales = filteredSales.filter(s => {
        const saleDate = new Date(s.created_at);
        return saleDate.toDateString() === targetDate.toDateString();
      });

      reportData = {
        title: reportTitle,
        type: 'daily',
        date: targetDate,
        sales: daySales,
        totalRevenue: daySales.reduce((sum, s) => sum + parseFloat(s.total_amount), 0),
        itemsSold: daySales.flatMap(s => s.sale_items || []).length,
        transactionCount: daySales.length
      };
    } else if (reportType === 'weekly') {
      const targetDate = new Date(selectedDate);
      // Calculate Monday of the current week
      const dayOfWeek = targetDate.getDay();
      const weekStart = new Date(targetDate);
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 0=Sunday, so go back 6 days; 1=Monday, so go back 0 days
      weekStart.setDate(weekStart.getDate() - daysToMonday);
      weekStart.setHours(0, 0, 0, 0); // Start of Monday
      
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6); // Sunday is 6 days after Monday
      weekEnd.setHours(23, 59, 59, 999); // End of Sunday
      
      reportTitle = `Weekly Sales Report - Week of ${weekStart.toLocaleDateString()} to ${weekEnd.toLocaleDateString()}`;

      const weekSales = filteredSales.filter(s => {
        const saleDate = new Date(s.created_at);
        return saleDate >= weekStart && saleDate <= weekEnd;
      });

      // Group by day
      const byDay = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        byDay[d.toDateString()] = [];
      }

      weekSales.forEach(s => {
        const key = new Date(s.created_at).toDateString();
        if (key in byDay) byDay[key].push(s);
      });

      reportData = {
        title: reportTitle,
        type: 'weekly',
        weekStart,
        weekEnd,
        sales: weekSales,
        byDay,
        totalRevenue: weekSales.reduce((sum, s) => sum + parseFloat(s.total_amount), 0),
        itemsSold: weekSales.flatMap(s => s.sale_items || []).length,
        transactionCount: weekSales.length,
        avgDaily: weekSales.length > 0 ? (weekSales.reduce((sum, s) => sum + parseFloat(s.total_amount), 0) / 7).toFixed(2) : 0
      };
    } else if (reportType === 'monthly') {
      const targetDate = new Date(selectedDate);
      const monthStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
      monthStart.setHours(0, 0, 0, 0); // Start of 1st
      
      const monthEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
      monthEnd.setHours(23, 59, 59, 999); // End of last day

      reportTitle = `Monthly Sales Report - ${monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;

      const monthSales = filteredSales.filter(s => {
        const saleDate = new Date(s.created_at);
        return saleDate >= monthStart && saleDate <= monthEnd;
      });

      // Group by day
      const byDay = {};
      for (let i = 1; i <= monthEnd.getDate(); i++) {
        const d = new Date(monthStart.getFullYear(), monthStart.getMonth(), i);
        byDay[d.toDateString()] = [];
      }

      monthSales.forEach(s => {
        const key = new Date(s.created_at).toDateString();
        if (key in byDay) byDay[key].push(s);
      });

      reportData = {
        title: reportTitle,
        type: 'monthly',
        monthStart,
        monthEnd,
        sales: monthSales,
        byDay,
        totalRevenue: monthSales.reduce((sum, s) => sum + parseFloat(s.total_amount), 0),
        itemsSold: monthSales.flatMap(s => s.sale_items || []).length,
        transactionCount: monthSales.length,
        avgDaily: monthSales.length > 0 ? (monthSales.reduce((sum, s) => sum + parseFloat(s.total_amount), 0) / monthEnd.getDate()).toFixed(2) : 0
      };
    }

    displayReport(reportData);
  }

  function displayReport(reportData) {
    const reportContainer = document.getElementById('report-display');
    
    let dayBreakdownHTML = '';
    if (reportData.byDay) {
      dayBreakdownHTML = `
        <div style="margin-top:1.5rem;border-top:1px solid var(--gray-200);padding-top:1.5rem">
          <h3 style="margin:0 0 1rem 0">Daily Breakdown</h3>
          <div class="table-responsive">
            <table class="table" style="font-size:0.9rem">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Transactions</th>
                  <th>Items</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(reportData.byDay).map(([date, sales]) => {
                  const dayTotal = sales.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
                  const itemCount = sales.flatMap(s => s.sale_items || []).length;
                  return sales.length > 0 ? `
                    <tr>
                      <td>${new Date(date).toLocaleDateString()}</td>
                      <td>${sales.length}</td>
                      <td>${itemCount}</td>
                      <td><strong>${currencySymbol}${dayTotal.toFixed(2)}</strong></td>
                    </tr>
                  ` : '';
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    const paymentBreakdown = {};
    reportData.sales.forEach(s => {
      const method = s.payment_method || 'Other';
      paymentBreakdown[method] = (paymentBreakdown[method] || 0) + parseFloat(s.total_amount);
    });

    reportContainer.innerHTML = `
      <div style="background:white;border-radius:var(--radius);padding:1.5rem;margin-bottom:1.5rem">
        <h2 style="margin:0 0 1rem 0;text-align:center">${reportData.title}</h2>
        
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:1.5rem">
          <div style="padding:1rem;background:var(--blue-50);border-radius:var(--radius-sm);text-align:center">
            <div style="font-size:0.9rem;color:var(--gray-600)">Total Revenue</div>
            <div style="font-size:1.5rem;font-weight:bold;color:var(--blue-700)">${currencySymbol}${reportData.totalRevenue.toFixed(2)}</div>
          </div>
          <div style="padding:1rem;background:var(--emerald-50);border-radius:var(--radius-sm);text-align:center">
            <div style="font-size:0.9rem;color:var(--gray-600)">Transactions</div>
            <div style="font-size:1.5rem;font-weight:bold;color:var(--emerald-700)">${reportData.transactionCount}</div>
          </div>
          <div style="padding:1rem;background:var(--purple-50);border-radius:var(--radius-sm);text-align:center">
            <div style="font-size:0.9rem;color:var(--gray-600)">Items Sold</div>
            <div style="font-size:1.5rem;font-weight:bold;color:var(--purple-700)">${reportData.itemsSold}</div>
          </div>
          ${reportData.avgDaily ? `
            <div style="padding:1rem;background:var(--amber-50);border-radius:var(--radius-sm);text-align:center">
              <div style="font-size:0.9rem;color:var(--gray-600)">Avg Daily</div>
              <div style="font-size:1.5rem;font-weight:bold;color:var(--amber-700)">${currencySymbol}${reportData.avgDaily}</div>
            </div>
          ` : ''}
        </div>

        <div style="border-top:1px solid var(--gray-200);padding-top:1.5rem">
          <h3 style="margin:0 0 1rem 0">Payment Method Breakdown</h3>
          ${Object.entries(paymentBreakdown).length === 0 ? `
            <div style="padding:1rem;text-align:center;color:var(--gray-500)">No sales data</div>
          ` : `
            <div style="display:grid;gap:0.75rem">
              ${Object.entries(paymentBreakdown).map(([method, amount]) => {
                const pct = reportData.totalRevenue > 0 ? Math.round((amount / reportData.totalRevenue) * 100) : 0;
                return `
                  <div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:0.25rem">
                      <span style="font-weight:500">${method.replace(/_/g, ' ')}</span>
                      <span>${currencySymbol}${amount.toFixed(2)} (${pct}%)</span>
                    </div>
                    <div style="height:8px;background:var(--gray-200);border-radius:4px">
                      <div style="height:8px;background:var(--primary);border-radius:4px;width:${pct}%"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <div style="border-top:1px solid var(--gray-200);padding-top:1.5rem;margin-top:1.5rem">
          <h3 style="margin:0 0 1rem 0">Top Products</h3>
          ${(() => {
            const productSales = {};
            reportData.sales.forEach(s => {
              (s.sale_items || []).forEach(i => {
                if (!productSales[i.product_name]) productSales[i.product_name] = { qty: 0, revenue: 0 };
                productSales[i.product_name].qty += i.quantity;
                productSales[i.product_name].revenue += parseFloat(i.total_price);
              });
            });

            const topProducts = Object.entries(productSales)
              .sort(([,a], [,b]) => b.revenue - a.revenue)
              .slice(0, 10);

            return topProducts.length === 0 ? `
              <div style="padding:1rem;text-align:center;color:var(--gray-500)">No product sales</div>
            ` : `
              <div class="table-responsive">
                <table class="table" style="font-size:0.9rem">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Qty Sold</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${topProducts.map(([name, data]) => `
                      <tr>
                        <td>${name}</td>
                        <td>${data.qty}</td>
                        <td><strong>${currencySymbol}${data.revenue.toFixed(2)}</strong></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `;
          })()}
        </div>

        ${dayBreakdownHTML}

        <div style="margin-top:1.5rem;display:flex;gap:0.5rem;justify-content:flex-end">
          <button class="btn btn-secondary" onclick="window.printReport()">🖨️ Print</button>
          <button class="btn btn-primary" onclick="window.exportReportAsExcel()">📊 Export Excel</button>
        </div>
      </div>
    `;

    // Store report data for export
    window.currentReportData = reportData;
  }

  const mainContent = container;
  mainContent.innerHTML = `
    <div class="animate-in">
      <div class="page-header">
        <div>
          <div class="page-title">📊 Sales Reports</div>
          <div class="page-subtitle">Generate daily, weekly, or monthly sales reports by branch</div>
        </div>
      </div>

      <!-- Report Configuration -->
      <div class="card" style="margin-bottom:1.5rem">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem">
          <div class="form-group" style="margin:0">
            <label class="form-label">Report Type</label>
            <select class="form-control" id="report-type" onchange="window.updateReportType()">
              <option value="daily">Daily Report</option>
              <option value="weekly">Weekly Report</option>
              <option value="monthly">Monthly Report</option>
            </select>
          </div>

          <div class="form-group" style="margin:0">
            <label class="form-label" id="date-label">Select Date</label>
            <input type="date" class="form-control" id="report-date" value="${selectedDate}" onchange="window.updateReportDate()">
          </div>

          <div class="form-group" style="margin:0">
            <label class="form-label">Branch</label>
            <select class="form-control" id="branch-filter" onchange="window.updateBranchFilter()">
              <option value="all">All Branches</option>
              ${branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
            </select>
          </div>

          <div class="form-group" style="margin:0;display:flex;align-items:flex-end">
            <button class="btn btn-primary" style="width:100%" onclick="window.generateSalesReport()">Generate Report</button>
          </div>
        </div>
      </div>

      <!-- Report Display -->
      <div id="report-display">
        <div style="padding:2rem;text-align:center;color:var(--gray-500)">
          <div>Select report parameters above and click "Generate Report" to view sales data</div>
        </div>
      </div>
    </div>
  `;

  // Make functions global
  window.updateReportType = () => {
    reportType = document.getElementById('report-type').value;
    const dateLabel = document.getElementById('date-label');
    if (reportType === 'daily') {
      dateLabel.textContent = 'Select Date';
      document.getElementById('report-date').type = 'date';
    } else if (reportType === 'weekly') {
      dateLabel.textContent = 'Select Week (any day in week)';
      document.getElementById('report-date').type = 'date';
    } else if (reportType === 'monthly') {
      dateLabel.textContent = 'Select Month';
      document.getElementById('report-date').type = 'month';
      document.getElementById('report-date').value = selectedDate.substring(0, 7);
    }
  };

  window.updateReportDate = () => {
    selectedDate = document.getElementById('report-date').value;
    if (reportType === 'monthly' && selectedDate.length === 7) {
      selectedDate = selectedDate + '-01';
    }
  };

  window.updateBranchFilter = () => {
    selectedBranch = document.getElementById('branch-filter').value;
  };

  window.generateSalesReport = () => {
    generateReport();
  };

  window.printReport = () => {
    if (!window.currentReportData) return;
    const reportContent = document.getElementById('report-display').innerHTML;
    const printWindow = window.open('', '', 'height=800,width=1000');
    printWindow.document.write(`
      <html><head><title>${window.currentReportData.title}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        h2, h3 { color: #333; }
        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 20px 0; }
      </style>
      </head><body>${reportContent}</body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 100);
  };

  window.exportReportAsExcel = () => {
    if (!window.currentReportData) return;

    const reportData = window.currentReportData;
    let excelContent = [];

    // Title
    excelContent.push([reportData.title]);
    excelContent.push(['']);

    // Summary
    excelContent.push(['Total Revenue', reportData.totalRevenue]);
    excelContent.push(['Transactions', reportData.transactionCount]);
    excelContent.push(['Items Sold', reportData.itemsSold]);
    if (reportData.avgDaily) excelContent.push(['Average Daily Revenue', reportData.avgDaily]);
    excelContent.push(['']);

    // Payment Methods
    excelContent.push(['Payment Method', 'Amount']);
    const paymentBreakdown = {};
    reportData.sales.forEach(s => {
      const method = s.payment_method || 'Other';
      paymentBreakdown[method] = (paymentBreakdown[method] || 0) + parseFloat(s.total_amount);
    });
    Object.entries(paymentBreakdown).forEach(([method, amount]) => {
      excelContent.push([method, amount]);
    });
    excelContent.push(['']);

    // Sales Transactions
    excelContent.push(['Invoice #', 'Date', 'Time', 'Customer', 'Items', 'Total', 'Payment Method']);
    reportData.sales.forEach(s => {
      const itemCount = (s.sale_items || []).length;
      excelContent.push([
        s.invoice_number,
        new Date(s.created_at).toLocaleDateString(),
        new Date(s.created_at).toLocaleTimeString(),
        s.customers?.name || 'Walk-in',
        itemCount,
        s.total_amount,
        s.payment_method || '-'
      ]);
    });

    // Convert to CSV and download
    const csv = excelContent.map(row => row.map(cell => {
      const val = cell?.toString() || '';
      return val.includes(',') ? `"${val}"` : val;
    }).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `${reportData.title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
    link.click();
  };
}
