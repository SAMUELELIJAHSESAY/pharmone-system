import { getSalesToday, getDashboardStats, getStaffBranch, getPharmacySettings } from '../../database.js';
import { formatCurrency, formatDateTime } from '../../utils.js';

export async function renderSalesmanDashboard(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) { container.innerHTML = `<div class="alert alert-warning">No pharmacy linked to your account.</div>`; return; }

  try {
    // Ensure pharmacy settings are loaded globally
    if (!window.pharmacySettings?.currency_symbol) {
      const settings = await getPharmacySettings(pharmacyId);
      window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    }
    
    // Get salesman's assigned branch
    const branchId = await getStaffBranch(user.id);
    if (!branchId) {
      container.innerHTML = `<div class="alert alert-warning">You are not assigned to any branch. Contact your administrator.</div>`;
      return;
    }

    const [salesToday, stats] = await Promise.all([
      getSalesToday(pharmacyId, branchId),
      getDashboardStats(pharmacyId, branchId)
    ]);

    const myToday = salesToday.filter(s => s.created_by === user.id);
    const myRevenue = myToday.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
    const totalTodayRevenue = salesToday.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">Hi, ${(user.profile?.full_name || 'there').split(' ')[0]}!</div>
            <div class="page-subtitle">Your sales summary for today</div>
          </div>
          <button class="btn btn-primary btn-lg" id="go-pos-btn">
            &#128179; Start Selling
          </button>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">My Sales Today</span>
              <div class="stat-card-icon teal">&#128176;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(myRevenue)}</div>
            <div class="stat-card-change">${myToday.length} transaction(s)</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Pharmacy Today</span>
              <div class="stat-card-icon blue">&#128200;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(totalTodayRevenue)}</div>
            <div class="stat-card-change">${salesToday.length} total sales</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Products Available</span>
              <div class="stat-card-icon green">&#128230;</div>
            </div>
            <div class="stat-card-value">${stats.totalProducts}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Low Stock</span>
              <div class="stat-card-icon ${stats.lowStockCount > 0 ? 'amber' : 'green'}">&#9888;</div>
            </div>
            <div class="stat-card-value">${stats.lowStockCount}</div>
            <div class="stat-card-change">${stats.lowStockCount > 0 ? 'Alert!' : 'All good'}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">My Transactions Today</span>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                ${myToday.length === 0 ? `
                  <tr><td colspan="4">
                    <div class="empty-state">
                      <div class="empty-state-icon">&#128176;</div>
                      <div class="empty-state-title">No sales yet today</div>
                      <div class="empty-state-desc">Click "Start Selling" to make your first sale</div>
                    </div>
                  </td></tr>
                ` : myToday.map(s => `
                  <tr>
                    <td class="font-semibold text-sm">${s.invoice_number}</td>
                    <td class="font-semibold" style="color:var(--success)">${formatCurrency(s.total_amount)}</td>
                    <td><span class="badge badge-gray">${s.payment_method?.replace('_', ' ')}</span></td>
                    <td class="text-xs text-muted">${formatDateTime(s.created_at)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('go-pos-btn').addEventListener('click', () => {
      import('../app.js').then(m => m.navigate('pos'));
    });
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load dashboard: ${err.message}</div>`;
  }
}
