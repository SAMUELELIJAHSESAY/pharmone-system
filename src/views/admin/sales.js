import { getSales, getBranches } from '../../database.js';
import { formatCurrency, formatDateTime, showToast } from '../../utils.js';
import { createModal } from '../../components/modal.js';

export async function renderSales(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) { container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`; return; }

  try {
    const [sales, branches] = await Promise.all([
      getSales(pharmacyId, 200),
      getBranches(pharmacyId)
    ]);

    const totalRevenue = sales.filter(s => s.status === 'completed').reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
    
    // Calculate today's revenue with proper timezone-aware handling
    const now = new Date();
    const todayDateStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().split('T')[0];
    
    const todayRevenue = sales.filter(s => {
      const saleDate = s.created_at.split('T')[0];
      return saleDate === todayDateStr && s.status === 'completed';
    }).reduce((sum, s) => sum + parseFloat(s.total_amount), 0);

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
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Transactions</span>
              <div class="stat-card-icon blue">&#128179;</div>
            </div>
            <div class="stat-card-value">${sales.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Revenue</span>
              <div class="stat-card-icon green">&#128200;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(totalRevenue)}</div>
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
      <td class="text-sm text-muted">${s.profiles?.full_name || '—'}</td>
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
          <div class="font-semibold">${sale.profiles?.full_name || '—'}</div>
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
