import { getDashboardStats, getSales, getPharmacySettings } from '../../database.js';
import { formatCurrency, formatDate, formatDateTime } from '../../utils.js';

export async function renderAdminDashboard(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">&#9888; Your account is not linked to a pharmacy. Please contact your Super Admin.</div>`;
    return;
  }

  try {
    // Ensure pharmacy settings are loaded globally
    if (!window.pharmacySettings?.currency_symbol) {
      const settings = await getPharmacySettings(pharmacyId);
      window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    }
    
    // Force fresh data fetch by adding cache buster
    const [stats, recentSales] = await Promise.all([
      getDashboardStats(pharmacyId),
      getSales(pharmacyId, 10)
    ]);

    // Validate data freshness - if data seems stale, refetch
    const statsTimestamp = new Date(stats.lastUpdated || new Date());
    const now = new Date();
    if (now - statsTimestamp > 60000) { // Older than 1 minute, refetch
      const freshStats = await getDashboardStats(pharmacyId);
      Object.assign(stats, freshStats);
    }

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">Good ${getGreeting()}, ${(user.profile?.full_name || 'Admin').split(' ')[0]}!</div>
            <div class="page-subtitle">Here's what's happening at your pharmacy today (Last updated: ${new Date().toLocaleTimeString()})</div>
          </div>
          <button class="btn btn-primary" onclick="import('./src/views/app.js').then(m=>m.navigate('pos'))">
            + New Sale
          </button>
        </div>

        ${stats.lowStockCount > 0 ? `
          <div class="alert alert-warning">
            &#9888;&nbsp; <strong>${stats.lowStockCount} product(s)</strong> are low on stock and need restocking.
            <a href="#" onclick="event.preventDefault();import('/src/views/app.js').then(m=>m.navigate('inventory'))" style="color:inherit;font-weight:600;margin-left:0.5rem;text-decoration:underline">View inventory</a>
          </div>
        ` : ''}

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Today's Revenue</span>
              <div class="stat-card-icon teal">&#128176;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(stats.todayRevenue)}</div>
            <div class="stat-card-change">${stats.todaySalesCount} sale(s) today</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Weekly Revenue</span>
              <div class="stat-card-icon blue">&#128200;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(stats.weekRevenue)}</div>
            <div class="stat-card-change">Last 7 days</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Products</span>
              <div class="stat-card-icon green">&#128230;</div>
            </div>
            <div class="stat-card-value">${stats.totalProducts}</div>
            <div class="stat-card-change">Active products</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Low Stock</span>
              <div class="stat-card-icon ${stats.lowStockCount > 0 ? 'red' : 'green'}">&#128683;</div>
            </div>
            <div class="stat-card-value">${stats.lowStockCount}</div>
            <div class="stat-card-change">${stats.lowStockCount > 0 ? 'Needs attention' : 'All good!'}</div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <span class="card-title">Recent Transactions</span>
              <button class="btn btn-ghost btn-sm" data-view-link="sales">View all</button>
            </div>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  ${recentSales.length === 0 ? `
                    <tr><td colspan="4"><div class="empty-state" style="padding:1.5rem"><div class="empty-state-icon" style="font-size:2rem">&#128176;</div><div class="empty-state-title">No sales yet</div></div></td></tr>
                  ` : recentSales.slice(0, 8).map(s => `
                    <tr>
                      <td class="text-sm font-semibold">${s.invoice_number}</td>
                      <td class="font-semibold" style="color:var(--success)">${formatCurrency(s.total_amount)}</td>
                      <td><span class="badge badge-gray">${s.payment_method?.replace('_', ' ')}</span></td>
                      <td class="text-xs text-muted">${formatDateTime(s.created_at)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Low Stock Alert</span>
              <button class="btn btn-ghost btn-sm" data-view-link="inventory">Manage</button>
            </div>
            <div class="card-body" style="padding:0">
              ${stats.lowStockProducts.length === 0 ? `
                <div class="empty-state" style="padding:1.5rem">
                  <div class="empty-state-icon" style="font-size:2rem">&#9989;</div>
                  <div class="empty-state-title">All stocked up!</div>
                  <div class="empty-state-desc">No low stock alerts</div>
                </div>
              ` : `
                <div style="padding:0.75rem">
                  ${stats.lowStockProducts.slice(0, 8).map(p => `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.625rem;border-radius:var(--radius-sm);margin-bottom:0.375rem;background:var(--gray-50)">
                      <div>
                        <div class="text-sm font-semibold">${p.name}</div>
                        <div class="text-xs text-muted">${p.category}</div>
                      </div>
                      <span class="badge badge-warning">${p.stock_boxes} boxes</span>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 2rem">
          <button class="btn btn-secondary" onclick="location.reload()">Refresh Dashboard</button>
        </div>
      </div>
    `;

    document.querySelectorAll('[data-view-link]').forEach(btn => {
      btn.addEventListener('click', () => {
        import('../app.js').then(m => m.navigate(btn.dataset.viewLink));
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load dashboard: ${err.message}</div>`;
  }
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
