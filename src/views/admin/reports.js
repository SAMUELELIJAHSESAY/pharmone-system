import { getSales, getProducts, getPharmacySettings } from '../../database.js';
import { formatCurrency, formatDate } from '../../utils.js';

export async function renderReports(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) { container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`; return; }

  try {
    // Ensure pharmacy settings are loaded globally
    if (!window.pharmacySettings?.currency_symbol) {
      const settings = await getPharmacySettings(pharmacyId);
      window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    }
    
    const [sales, products] = await Promise.all([
      getSales(pharmacyId, 500),
      getProducts(pharmacyId)
    ]);

    const completedSales = sales.filter(s => s.status === 'completed');

    const totalRevenue = completedSales.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);

    const productCost = products.reduce((sum, p) => {
      const sold = completedSales.flatMap(s => s.sale_items || [])
        .filter(i => i.product_id === p.id)
        .reduce((a, i) => a + i.quantity, 0);
      return sum + (sold * (p.cost_price || 0));
    }, 0);

    const grossProfit = totalRevenue - productCost;

    const today = new Date();
    const todayRevenue = completedSales
      .filter(s => new Date(s.created_at).toDateString() === today.toDateString())
      .reduce((sum, s) => sum + parseFloat(s.total_amount), 0);

    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekRevenue = completedSales
      .filter(s => new Date(s.created_at) >= weekAgo)
      .reduce((sum, s) => sum + parseFloat(s.total_amount), 0);

    const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
    const monthRevenue = completedSales
      .filter(s => new Date(s.created_at) >= monthAgo)
      .reduce((sum, s) => sum + parseFloat(s.total_amount), 0);

    const paymentBreakdown = {};
    completedSales.forEach(s => {
      paymentBreakdown[s.payment_method] = (paymentBreakdown[s.payment_method] || 0) + parseFloat(s.total_amount);
    });

    const productSales = {};
    completedSales.forEach(s => {
      (s.sale_items || []).forEach(i => {
        if (!productSales[i.product_name]) productSales[i.product_name] = { qty: 0, revenue: 0 };
        productSales[i.product_name].qty += i.quantity;
        productSales[i.product_name].revenue += parseFloat(i.total_price);
      });
    });

    const topProducts = Object.entries(productSales)
      .sort(([,a], [,b]) => b.revenue - a.revenue)
      .slice(0, 10);

    const last30Days = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      last30Days[d.toDateString()] = 0;
    }
    completedSales.forEach(s => {
      const key = new Date(s.created_at).toDateString();
      if (key in last30Days) last30Days[key] += parseFloat(s.total_amount);
    });

    // Attach handlers globally
    window.exportReportAsCSV = (reportType) => exportReportAsCSV(reportType, { sales: completedSales, products, topProducts, paymentBreakdown });
    window.generateSalesReport = () => generateSalesReport(completedSales);
    window.generateInventoryReport = () => generateInventoryReport(products);
    window.generatePaymentReport = () => generatePaymentReport(paymentBreakdown);

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">Reports & Analytics</div>
            <div class="page-subtitle">Insights into your pharmacy's performance</div>
          </div>
          <div class="flex gap-2" style="display:flex;gap:0.5rem">
            <button class="btn btn-ghost btn-sm" onclick="window.generateSalesReport()">📊 Sales Report</button>
            <button class="btn btn-ghost btn-sm" onclick="window.generateInventoryReport()">📦 Inventory Report</button>
            <button class="btn btn-ghost btn-sm" onclick="window.generatePaymentReport()">💰 Payment Report</button>
            <button class="btn btn-primary btn-sm" onclick="window.exportReportAsCSV('all')">⬇️ Export CSV</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Today's Revenue</span>
              <div class="stat-card-icon teal">&#128200;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(todayRevenue)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">This Week</span>
              <div class="stat-card-icon blue">&#128200;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(weekRevenue)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">This Month</span>
              <div class="stat-card-icon green">&#128200;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(monthRevenue)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Gross Profit</span>
              <div class="stat-card-icon ${grossProfit >= 0 ? 'green' : 'red'}">&#128181;</div>
            </div>
            <div class="stat-card-value" style="color:${grossProfit >= 0 ? 'var(--success)' : 'var(--danger)'}">${formatCurrency(grossProfit)}</div>
            <div class="stat-card-change">Revenue minus cost</div>
          </div>
        </div>

        <div class="grid-2" style="margin-bottom:1.25rem">
          <div class="card">
            <div class="card-header"><span class="card-title">Revenue by Payment Method</span></div>
            <div class="card-body">
              ${Object.entries(paymentBreakdown).length === 0 ? `<div class="empty-state" style="padding:1.5rem"><div class="empty-state-title">No data</div></div>` :
                Object.entries(paymentBreakdown).map(([method, amount]) => {
                  const pct = totalRevenue > 0 ? Math.round((amount / totalRevenue) * 100) : 0;
                  return `
                    <div style="margin-bottom:1rem">
                      <div style="display:flex;justify-content:space-between;margin-bottom:0.375rem">
                        <span class="text-sm font-semibold">${method.replace('_', ' ')}</span>
                        <span class="text-sm font-semibold">${formatCurrency(amount)} (${pct}%)</span>
                      </div>
                      <div style="height:8px;background:var(--gray-200);border-radius:4px">
                        <div style="height:8px;background:var(--primary);border-radius:4px;width:${pct}%;transition:width 0.5s ease"></div>
                      </div>
                    </div>
                  `;
                }).join('')}
            </div>
          </div>

          <div class="card">
            <div class="card-header"><span class="card-title">Summary</span></div>
            <div class="card-body">
              <div style="display:grid;gap:0.75rem">
                ${[
                  ['Total Sales Count', completedSales.length],
                  ['Total Revenue', formatCurrency(totalRevenue)],
                  ['Estimated Cost', formatCurrency(productCost)],
                  ['Gross Profit', formatCurrency(grossProfit)],
                  ['Profit Margin', totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) + '%' : '0%']
                ].map(([label, value]) => `
                  <div style="display:flex;justify-content:space-between;padding:0.625rem;background:var(--gray-50);border-radius:var(--radius-sm)">
                    <span class="text-sm text-muted">${label}</span>
                    <span class="font-semibold text-sm">${value}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Top Selling Products</span></div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Product</th><th>Units Sold</th><th>Revenue</th></tr>
              </thead>
              <tbody>
                ${topProducts.length === 0 ? `<tr><td colspan="3"><div class="empty-state"><div class="empty-state-title">No sales data yet</div></div></td></tr>` :
                  topProducts.map(([name, data], i) => `
                    <tr>
                      <td><span style="color:var(--gray-400);margin-right:0.5rem">${i+1}.</span><span class="font-semibold">${name}</span></td>
                      <td>${data.qty} units</td>
                      <td class="font-semibold" style="color:var(--success)">${formatCurrency(data.revenue)}</td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">Inventory Value</span></div>
            <div class="card-body">
              ${products.length === 0 ? '<div class="text-muted">No products in inventory</div>' : `
                <div style="display:grid;gap:0.75rem">
                  ${(() => {
                    let totalValue = 0;
                    let lowStockValue = 0;
                    let expiredCount = 0;
                    
                    products.forEach(p => {
                      const totalUnits = (p.stock_boxes * (p.units_per_box || 1)) + p.stock_units;
                      totalValue += totalUnits * (p.cost_price || 0);
                      
                      if (p.stock_boxes <= p.low_stock_threshold) {
                        lowStockValue += totalUnits * (p.cost_price || 0);
                      }
                      
                      if (p.expiry_date && new Date(p.expiry_date) < new Date()) {
                        expiredCount++;
                      }
                    });

                    return `
                      <div style="display:flex;justify-content:space-between;padding:0.625rem;background:var(--gray-50);border-radius:var(--radius-sm)">
                        <span class="text-sm text-muted">Total Inventory Value</span>
                        <span class="font-semibold text-sm">${formatCurrency(totalValue)}</span>
                      </div>
                      <div style="display:flex;justify-content:space-between;padding:0.625rem;background:var(--gray-50);border-radius:var(--radius-sm)">
                        <span class="text-sm text-muted">Low Stock Value</span>
                        <span class="font-semibold text-sm" style="color:var(--warning)">${formatCurrency(lowStockValue)}</span>
                      </div>
                      <div style="display:flex;justify-content:space-between;padding:0.625rem;background:var(--gray-50);border-radius:var(--radius-sm)">
                        <span class="text-sm text-muted">Expired Products</span>
                        <span class="font-semibold text-sm" style="color:var(--danger)">${expiredCount} item${expiredCount !== 1 ? 's' : ''}</span>
                      </div>
                      <div style="display:flex;justify-content:space-between;padding:0.625rem;background:var(--gray-50);border-radius:var(--radius-sm)">
                        <span class="text-sm text-muted">Total Products</span>
                        <span class="font-semibold text-sm">${products.length}</span>
                      </div>
                    `;
                  })()}
                </div>
              `}
            </div>
          </div>

          <div class="card">
            <div class="card-header"><span class="card-title">Expiry Report</span></div>
            <div class="card-body">
              ${(() => {
                const today = new Date();
                let expired = 0;
                let expiring30 = 0;
                let expiring90 = 0;
                let noExpiry = 0;

                products.forEach(p => {
                  if (!p.expiry_date) {
                    noExpiry++;
                  } else {
                    const expiryDate = new Date(p.expiry_date);
                    const daysToExpiry = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));
                    if (daysToExpiry < 0) expired++;
                    else if (daysToExpiry <= 30) expiring30++;
                    else if (daysToExpiry <= 90) expiring90++;
                  }
                });

                return `
                  <div style="display:grid;gap:0.75rem">
                    <div style="display:flex;justify-content:space-between;padding:0.625rem;background:var(--gray-50);border-radius:var(--radius-sm)">
                      <span class="text-sm text-muted">Already Expired</span>
                      <span class="font-semibold text-sm" style="color:var(--danger)">${expired}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:0.625rem;background:var(--gray-50);border-radius:var(--radius-sm)">
                      <span class="text-sm text-muted">Expiring in 30 Days</span>
                      <span class="font-semibold text-sm" style="color:var(--warning)">${expiring30}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:0.625rem;background:var(--gray-50);border-radius:var(--radius-sm)">
                      <span class="text-sm text-muted">Expiring in 90 Days</span>
                      <span class="font-semibold text-sm">${expiring90}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:0.625rem;background:var(--gray-50);border-radius:var(--radius-sm)">
                      <span class="text-sm text-muted">No Expiry Date</span>
                      <span class="font-semibold text-sm">${noExpiry}</span>
                    </div>
                  </div>
                `;
              })()}
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load reports: ${err.message}</div>`;
  }
}

// CSV Export Functions
function exportReportAsCSV(reportType, data) {
  let csvContent = '';
  let filename = '';
  
  if (reportType === 'all' || reportType === 'sales') {
    filename = 'sales_report_' + new Date().toISOString().split('T')[0] + '.csv';
    csvContent = 'Sales Report\n';
    csvContent += 'Date,Product Name,Quantity,Unit Price,Total Price,Payment Method\n';
    
    data.sales.forEach(sale => {
      (sale.sale_items || []).forEach(item => {
        csvContent += `"${new Date(sale.created_at).toLocaleDateString()}","${item.product_name}",${item.quantity},${item.unit_price},${item.total_price},"${sale.payment_method}"\n`;
      });
    });
  }
  
  if (reportType === 'all' || reportType === 'inventory') {
    filename = 'inventory_report_' + new Date().toISOString().split('T')[0] + '.csv';
    csvContent += '\n\nInventory Report\n';
    csvContent += 'Product Name,Category,Stock (Units),Reorder Level,Expiry Date,Status\n';
    
    data.products.forEach(p => {
      const status = p.stock_boxes <= p.low_stock_threshold ? 'LOW_STOCK' : 'OK';
      csvContent += `"${p.name}","${p.category}",${p.stock_boxes},${p.low_stock_threshold},"${p.expiry_date || 'N/A'}","${status}"\n`;
    });
  }
  
  if (reportType === 'all' || reportType === 'payment') {
    filename = 'payment_report_' + new Date().toISOString().split('T')[0] + '.csv';
    csvContent += '\n\nPayment Breakdown\n';
    csvContent += 'Payment Method,Total Amount\n';
    
    Object.entries(data.paymentBreakdown || {}).forEach(([method, amount]) => {
      csvContent += `"${method}",${amount}\n`;
    });
  }
  
  // Download CSV
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.setAttribute('href', URL.createObjectURL(blob));
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function generateSalesReport(sales) {
  const completed = sales.filter(s => s.status === 'completed');
  const totalRevenue = completed.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
  alert(`Sales Report\n\nTotal Transactions: ${completed.length}\nTotal Revenue: Le ${totalRevenue.toFixed(2)}`);
}

function generateInventoryReport(products) {
  const lowStock = products.filter(p => p.stock_boxes <= p.low_stock_threshold).length;
  alert(`Inventory Report\n\nTotal Products: ${products.length}\nLow Stock Items: ${lowStock}\n\nClick "Export CSV" for detailed report.`);
}

function generatePaymentReport(breakdown) {
  let reportText = 'Payment Methods\n\n';
  Object.entries(breakdown).forEach(([method, amount]) => {
    reportText += `${method}: Le ${amount.toFixed(2)}\n`;
  });
  alert(reportText);
}
