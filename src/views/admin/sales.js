import { getSales, getBranches, getSalesStats } from '../../database.js';
import { formatCurrency, formatDateTime, showToast } from '../../utils.js';
import { createModal } from '../../components/modal.js';

// Helper function to get the next period reset time
function getNextPeriodResets() {
  const now = new Date();
  
  // Next daily reset: tomorrow at 00:00
  const nextDaily = new Date(now);
  nextDaily.setDate(nextDaily.getDate() + 1);
  nextDaily.setHours(0, 0, 0, 0);
  
  // Next weekly reset: next Monday at 00:00
  const nextWeekly = new Date(now);
  const day = nextWeekly.getDay();
  const daysUntilMonday = day === 0 ? 1 : (8 - day);
  nextWeekly.setDate(nextWeekly.getDate() + daysUntilMonday);
  nextWeekly.setHours(0, 0, 0, 0);
  
  // Next monthly reset: 1st of next month at 00:00
  const nextMonthly = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  
  // Next yearly reset: January 1st of next year at 00:00
  const nextYearly = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
  
  return { nextDaily, nextWeekly, nextMonthly, nextYearly };
}

// Helper function to format time remaining until reset
function getTimeUntilReset(resetDate) {
  const now = new Date();
  const diff = resetDate - now;
  
  if (diff <= 0) return 'Resetting now...';
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `Resets in ${days}d`;
  } else if (hours > 0) {
    return `Resets in ${hours}h ${minutes}m`;
  } else {
    return `Resets in ${minutes}m`;
  }
}

// Helper function to get current period info
function getPeriodInfo() {
  const now = new Date();
  const day = now.getDay();
  
  // Weekly info (Monday to Sunday, 7 days total)
  const weekStart = new Date(now);
  const daysToMonday = day === 0 ? 6 : (day - 1);
  weekStart.setDate(weekStart.getDate() - daysToMonday);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6); // 6 days after Monday = Sunday
  
  // Monthly info
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  
  // Yearly info
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear(), 11, 31);
  
  return {
    weekStart: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    weekEnd: weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    monthStart: monthStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    monthEnd: monthEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    yearStart: yearStart.toLocaleDateString('en-US', { year: 'numeric' }),
    yearEnd: yearEnd.toLocaleDateString('en-US', { year: 'numeric' })
  };
}

export async function renderSales(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) { container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`; return; }

  try {
    const [sales, branches, stats] = await Promise.all([
      getSales(pharmacyId, 200),
      getBranches(pharmacyId),
      getSalesStats(pharmacyId)
    ]);

    // Extract calculated values from server-side stats
    const todayRevenue = stats.todayRevenue;
    const weekRevenue = stats.weekRevenue;
    const monthRevenue = stats.monthRevenue;
    const yearRevenue = stats.yearRevenue;
    const totalRevenue = stats.totalRevenue;
    
    // Get period information
    const resets = getNextPeriodResets();
    const periods = getPeriodInfo();
    const todayReset = getTimeUntilReset(resets.nextDaily);
    const weekReset = getTimeUntilReset(resets.nextWeekly);
    const monthReset = getTimeUntilReset(resets.nextMonthly);
    const yearReset = getTimeUntilReset(resets.nextYearly);

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">Sales</div>
            <div class="page-subtitle">View and manage all sales transactions</div>
          </div>
          <button class="btn btn-primary" id="new-sale-btn">+ New Sale</button>
        </div>

        <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Today's Revenue</span>
              <div class="stat-card-icon teal">&#128176;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(todayRevenue)}</div>
            <div class="stat-card-change" title="Resets daily at midnight">${todayReset}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Weekly Revenue</span>
              <div class="stat-card-icon blue">&#128200;</div>
            </div>
            <div class="stat-card-value" data-stat="week-revenue">${formatCurrency(weekRevenue)}</div>
            <div class="stat-card-change" title="${periods.weekStart} - ${periods.weekEnd} | Resets every Monday">${periods.weekStart} - ${periods.weekEnd} | ${weekReset}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Monthly Revenue</span>
              <div class="stat-card-icon purple">&#128181;</div>
            </div>
            <div class="stat-card-value" data-stat="month-revenue">${formatCurrency(monthRevenue)}</div>
            <div class="stat-card-change" title="${periods.monthStart} - ${periods.monthEnd} | Resets on the 1st">${periods.monthStart} - ${periods.monthEnd} | ${monthReset}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Yearly Revenue</span>
              <div class="stat-card-icon green">&#128202;</div>
            </div>
            <div class="stat-card-value" data-stat="year-revenue">${formatCurrency(yearRevenue)}</div>
            <div class="stat-card-change" title="${periods.yearStart} - ${periods.yearEnd} | Resets on Jan 1st">${periods.yearStart} - ${periods.yearEnd} | ${yearReset}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Transactions</span>
              <div class="stat-card-icon orange">&#128179;</div>
            </div>
            <div class="stat-card-value">${sales.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Revenue</span>
              <div class="stat-card-icon darkgreen">&#128200;</div>
            </div>
            <div class="stat-card-value" data-stat="total-revenue">${formatCurrency(totalRevenue)}</div>
            <div class="stat-card-change">All time</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">All Sales</span>
            <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
              <select class="form-select" id="branch-filter" style="width:auto">
                <option value="">All Branches</option>
                ${branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
              </select>
              <div class="search-box" style="min-width:220px">
                <span style="color:var(--gray-400)">&#128269;</span>
                <input type="text" id="sales-search" placeholder="Search invoice..." />
              </div>
              <select class="form-select" id="payment-filter" style="width:auto">
                <option value="">All Payments</option>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="card">Card</option>
              </select>
              <input type="date" id="date-filter-from" class="form-input" style="width:140px" />
              <input type="date" id="date-filter-to" class="form-input" style="width:140px" />
            </div>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Staff</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="sales-tbody">
                ${renderRows(sales)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('new-sale-btn').addEventListener('click', () => {
      import('../app.js').then(m => m.navigate('pos'));
    });

    const applyFilters = () => {
      const searchQuery = document.getElementById('sales-search')?.value.toLowerCase() || '';
      const paymentFilter = document.getElementById('payment-filter')?.value || '';
      const branchFilter = document.getElementById('branch-filter')?.value || '';
      const dateFrom = document.getElementById('date-filter-from')?.value ? new Date(document.getElementById('date-filter-from').value) : null;
      const dateTo = document.getElementById('date-filter-to')?.value ? new Date(document.getElementById('date-filter-to').value) : null;
      
      const filtered = sales.filter(s => {
        // Search filter
        const matchesSearch = !searchQuery || 
          s.invoice_number.toLowerCase().includes(searchQuery) ||
          (s.customers?.name || '').toLowerCase().includes(searchQuery);
        
        // Branch filter
        const matchesBranch = !branchFilter || s.branch_id === branchFilter;
        
        // Payment method filter
        const matchesPayment = !paymentFilter || s.payment_method === paymentFilter;
        
        // Date range filter
        const saleDate = new Date(s.created_at);
        const matchesDate = (!dateFrom || saleDate >= dateFrom) && (!dateTo || saleDate <= dateTo);
        
        return matchesSearch && matchesBranch && matchesPayment && matchesDate;
      });
      
      // Recalculate displayed totals based on filtered sales
      const filteredCompletedSales = filtered.filter(s => s.status === 'completed');
      const filteredRevenue = filteredCompletedSales.reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
      
      // Helper to properly compare dates with timestamps
      const isBetweenDates = (dateStr, startDate, endDate) => {
        const saleDate = new Date(dateStr);
        return saleDate >= startDate && saleDate <= endDate;
      };
      
      // Calculate week range for current week (Monday to Sunday)
      const now = new Date();
      const currentDay = now.getDay();
      const daysToMondayOffset = currentDay === 0 ? 6 : (currentDay - 1);
      const currentWeekStart = new Date(now);
      currentWeekStart.setDate(currentWeekStart.getDate() - daysToMondayOffset);
      currentWeekStart.setHours(0, 0, 0, 0);
      const currentWeekEnd = new Date(currentWeekStart);
      currentWeekEnd.setDate(currentWeekStart.getDate() + 6);
      currentWeekEnd.setHours(23, 59, 59, 999);
      
      // Calculate month range
      const monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      monthStartDate.setHours(0, 0, 0, 0);
      const monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      monthEndDate.setHours(23, 59, 59, 999);
      
      // Calculate year range
      const yearStartDate = new Date(now.getFullYear(), 0, 1);
      yearStartDate.setHours(0, 0, 0, 0);
      const yearEndDate = new Date(now.getFullYear(), 11, 31);
      yearEndDate.setHours(23, 59, 59, 999);
      
      // Recalculate period-based revenues using corrected date ranges
      const filteredWeekRevenue = filteredCompletedSales.filter(s => isBetweenDates(s.created_at, currentWeekStart, currentWeekEnd))
        .reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
      const filteredMonthRevenue = filteredCompletedSales.filter(s => isBetweenDates(s.created_at, monthStartDate, monthEndDate))
        .reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
      const filteredYearRevenue = filteredCompletedSales.filter(s => isBetweenDates(s.created_at, yearStartDate, yearEndDate))
        .reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
      
      // Update the revenue displays
      const weekCard = document.querySelector('[data-stat="week-revenue"]');
      if (weekCard) {
        weekCard.textContent = formatCurrency(filteredWeekRevenue);
      }
      const monthCard = document.querySelector('[data-stat="month-revenue"]');
      if (monthCard) {
        monthCard.textContent = formatCurrency(filteredMonthRevenue);
      }
      const yearCard = document.querySelector('[data-stat="year-revenue"]');
      if (yearCard) {
        yearCard.textContent = formatCurrency(filteredYearRevenue);
      }
      const revenueCard = document.querySelector('[data-stat="total-revenue"]');
      if (revenueCard) {
        revenueCard.textContent = formatCurrency(filteredRevenue);
      }
      
      document.getElementById('sales-tbody').innerHTML = renderRows(filtered);
      bindViewActions(filtered);
    };

    document.getElementById('sales-search').addEventListener('input', applyFilters);
    if (document.getElementById('branch-filter')) {
      document.getElementById('branch-filter').addEventListener('change', applyFilters);
    }
    if (document.getElementById('payment-filter')) {
      document.getElementById('payment-filter').addEventListener('change', applyFilters);
    }
    if (document.getElementById('date-filter-from')) {
      document.getElementById('date-filter-from').addEventListener('change', applyFilters);
    }
    if (document.getElementById('date-filter-to')) {
      document.getElementById('date-filter-to').addEventListener('change', applyFilters);
    }

    bindViewActions(sales);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load sales: ${err.message}</div>`;
  }
}

function renderRows(sales) {
  if (!sales.length) return `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">&#128176;</div><div class="empty-state-title">No sales yet</div></div></td></tr>`;

  const paymentColors = { cash: 'badge-success', mobile_money: 'badge-info', card: 'badge-primary' };

  return sales.map(s => `
    <tr>
      <td class="font-semibold text-sm">${s.invoice_number}</td>
      <td class="text-sm">${s.customers?.name || 'Walk-in'}</td>
      <td class="text-sm text-muted">${(s.sale_items || []).length} item(s)</td>
      <td class="font-semibold" style="color:var(--success)">${formatCurrency(s.total_amount)}</td>
      <td><span class="badge ${paymentColors[s.payment_method] || 'badge-gray'}">${s.payment_method?.replace('_', ' ')}</span></td>
      <td class="text-sm text-muted">—</td>
      <td class="text-xs text-muted">${formatDateTime(s.created_at)}</td>
      <td>
        <button class="btn btn-ghost btn-sm view-sale-btn" data-id="${s.id}">View</button>
      </td>
    </tr>
  `).join('');
}

function bindViewActions(sales) {
  const saleMap = Object.fromEntries(sales.map(s => [s.id, s]));
  document.querySelectorAll('.view-sale-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sale = saleMap[btn.dataset.id];
      if (sale) showSaleDetail(sale);
    });
  });
}

function showSaleDetail(sale) {
  const itemsHtml = (sale.sale_items || []).map(item => `
    <tr>
      <td>${item.product_name}</td>
      <td class="text-center">${item.quantity}</td>
      <td>${formatCurrency(item.unit_price)}</td>
      <td class="font-semibold">${formatCurrency(item.total_price)}</td>
    </tr>
  `).join('');

  createModal({
    id: 'sale-detail',
    title: `Invoice ${sale.invoice_number}`,
    body: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1.25rem">
        <div>
          <div class="text-xs text-muted">Customer</div>
          <div class="font-semibold">${sale.customers?.name || 'Walk-in Customer'}</div>
        </div>
        <div>
          <div class="text-xs text-muted">Payment Method</div>
          <div class="font-semibold">${sale.payment_method?.replace('_', ' ')}</div>
        </div>
        <div>
          <div class="text-xs text-muted">Date</div>
          <div class="font-semibold">${formatDateTime(sale.created_at)}</div>
        </div>
        <div>
          <div class="text-xs text-muted">Staff</div>
          <div class="font-semibold">—</div>
        </div>
      </div>
      <div class="table-container">
        <table>
          <thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
          <tbody>${itemsHtml || '<tr><td colspan="4" class="text-center text-muted">No items</td></tr>'}</tbody>
        </table>
      </div>
      <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--gray-200)">
        <div class="cart-summary-total">
          <span>Total</span>
          <span style="color:var(--success)">${formatCurrency(sale.total_amount)}</span>
        </div>
      </div>
    `
  });
}
