import {
  getDashboardStats,
  getDashboardInsights,
  getPharmacySettings,
  getSales
} from '../../database.js';
import { formatCurrency, formatDateTime, formatDate } from '../../utils.js';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getPeriodLabel(period) {
  if (period === 'today') return 'Today';
  if (period === 'month') return 'This Month';
  return 'This Week';
}

function renderInsightPanels(insights) {
  const periodLabel = getPeriodLabel(insights.period);
  const topProducts = insights.topProducts || [];
  const staff = insights.staffPerformance || [];

  return `
    <div class="dashboard-period-summary">
      <div class="dashboard-mini-stat">
        <span>${periodLabel} Sales</span>
        <strong>${formatCurrency(insights.totalRevenue)}</strong>
      </div>
      <div class="dashboard-mini-stat">
        <span>Transactions</span>
        <strong>${insights.transactionCount}</strong>
      </div>
      <div class="dashboard-mini-stat">
        <span>Average Sale</span>
        <strong>${formatCurrency(insights.averageSale)}</strong>
      </div>
    </div>

    <div class="dashboard-insight-grid">
      <section class="card dashboard-insight-card">
        <div class="card-header">
          <div>
            <div class="card-title">Top Selling Products</div>
            <div class="dashboard-card-subtitle">Ranked by quantity sold · ${periodLabel}</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-dashboard-nav="sales">View sales</button>
        </div>
        <div class="dashboard-ranked-list">
          ${topProducts.length ? topProducts.map((product, index) => `
            <div class="dashboard-ranked-row">
              <span class="dashboard-rank">${index + 1}</span>
              <div class="dashboard-ranked-main">
                <strong title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</strong>
                <span>${Number(product.quantity || 0).toLocaleString()} item(s) sold</span>
              </div>
              <div class="dashboard-ranked-value">${formatCurrency(product.revenue)}</div>
            </div>
          `).join('') : `
            <div class="dashboard-panel-empty">No product sales recorded for ${periodLabel.toLowerCase()}.</div>
          `}
        </div>
      </section>

      <section class="card dashboard-insight-card">
        <div class="card-header">
          <div>
            <div class="card-title">Salesmen Performance</div>
            <div class="dashboard-card-subtitle">Top salesmen · ${periodLabel}</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-dashboard-nav="sales-reports">Reports</button>
        </div>
        <div class="dashboard-ranked-list">
          ${staff.length ? staff.map((person, index) => `
            <div class="dashboard-ranked-row">
              <span class="dashboard-avatar">${escapeHtml((person.name || 'S').trim().charAt(0).toUpperCase())}</span>
              <div class="dashboard-ranked-main">
                <strong title="${escapeHtml(person.name)}">${escapeHtml(person.name)}</strong>
                <span>${person.transactions} transaction(s)</span>
              </div>
              <div class="dashboard-ranked-value">${formatCurrency(person.revenue)}</div>
            </div>
          `).join('') : `
            <div class="dashboard-panel-empty">No salesman transactions recorded for ${periodLabel.toLowerCase()}.</div>
          `}
        </div>
      </section>
    </div>
  `;
}

export async function renderAdminDashboard(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">&#9888; Your account is not linked to a pharmacy. Please contact your Super Admin.</div>`;
    return;
  }

  try {
    if (!window.pharmacySettings?.currency_symbol) {
      const settings = await getPharmacySettings(pharmacyId);
      window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    }

    const [stats, recentSales] = await Promise.all([
      getDashboardStats(pharmacyId),
      getSales(pharmacyId, 10)
    ]);

    container.innerHTML = `
      <div class="animate-in admin-dashboard-view">
        <div class="page-header">
          <div>
            <div class="page-title">Good ${getGreeting()}, ${escapeHtml((user.profile?.full_name || 'Admin').split(' ')[0])}!</div>
            <div class="page-subtitle">Here's what's happening at your pharmacy today (Last updated: ${new Date().toLocaleTimeString()})</div>
          </div>
          <button type="button" class="btn btn-primary" data-dashboard-nav="pos">+ New Sale</button>
        </div>

        ${stats.lowStockCount > 0 ? `
          <div class="alert alert-warning dashboard-alert-row">
            <span>&#9888;&nbsp; <strong>${stats.lowStockCount} product(s)</strong> are low on stock and need restocking.</span>
            <button type="button" class="alert-inline-link" data-dashboard-nav="inventory" data-filter-type="low-stock">View inventory</button>
          </div>
        ` : ''}

        ${(stats.expiredCount > 0 || stats.expiringSoonCount > 0) ? `
          <div class="alert ${stats.expiredCount > 0 ? 'alert-danger' : 'alert-warning'} dashboard-alert-row">
            <span>🧪 <strong>${stats.expiredCount || 0} expired</strong> and <strong>${stats.expiringSoonCount || 0} expiring within 30 days</strong>.</span>
            <div class="dashboard-alert-actions">
              ${stats.expiredCount > 0 ? `<button type="button" class="alert-inline-link" data-dashboard-nav="inventory" data-filter-type="expired">Expired</button>` : ''}
              ${stats.expiringSoonCount > 0 ? `<button type="button" class="alert-inline-link" data-dashboard-nav="inventory" data-filter-type="expiring">Expiring soon</button>` : ''}
            </div>
          </div>
        ` : ''}

        <div class="stats-grid dashboard-stats-grid">
          <div class="stat-card stat-card-clickable" role="button" tabindex="0" data-dashboard-nav="sales">
            <div class="stat-card-header">
              <span class="stat-card-label">Today's Revenue</span>
              <div class="stat-card-icon teal">&#128176;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(stats.todayRevenue)}</div>
            <div class="stat-card-change">${stats.todaySalesCount} sale(s) today</div>
          </div>
          <div class="stat-card stat-card-clickable" role="button" tabindex="0" data-dashboard-nav="sales">
            <div class="stat-card-header">
              <span class="stat-card-label">Weekly Revenue</span>
              <div class="stat-card-icon blue">&#128200;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(stats.weekRevenue)}</div>
            <div class="stat-card-change">This week (Mon-Sun)</div>
          </div>
          <div class="stat-card stat-card-clickable" role="button" tabindex="0" data-dashboard-nav="inventory">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Products</span>
              <div class="stat-card-icon green">&#128230;</div>
            </div>
            <div class="stat-card-value">${Number(stats.totalProducts || 0).toLocaleString()}</div>
            <div class="stat-card-change">Active products</div>
          </div>
          <div class="stat-card stat-card-clickable" role="button" tabindex="0" data-dashboard-nav="inventory" data-filter-type="low-stock">
            <div class="stat-card-header">
              <span class="stat-card-label">Low Stock</span>
              <div class="stat-card-icon ${stats.lowStockCount > 0 ? 'red' : 'green'}">&#128683;</div>
            </div>
            <div class="stat-card-value">${Number(stats.lowStockCount || 0).toLocaleString()}</div>
            <div class="stat-card-change">${stats.lowStockCount > 0 ? 'Needs attention' : 'All good!'}</div>
          </div>
          <div class="stat-card stat-card-clickable" role="button" tabindex="0" data-dashboard-nav="inventory">
            <div class="stat-card-header">
              <span class="stat-card-label">Inventory Worth</span>
              <div class="stat-card-icon purple">💎</div>
            </div>
            <div class="stat-card-value">${formatCurrency(stats.inventoryWorth)}</div>
            <div class="stat-card-change">Total selling value</div>
          </div>
        </div>

        <section class="dashboard-performance-section">
          <div class="dashboard-section-heading">
            <div>
              <h2>Sales Performance</h2>
              <p>Review revenue, products and salesman activity for the selected period.</p>
            </div>
            <div class="dashboard-period-switch" role="group" aria-label="Dashboard sales period">
              <button type="button" class="dashboard-period-btn" data-period="today">Today</button>
              <button type="button" class="dashboard-period-btn active" data-period="week">This Week</button>
              <button type="button" class="dashboard-period-btn" data-period="month">This Month</button>
            </div>
          </div>
          <div id="dashboard-insights" class="dashboard-insights-shell">
            <div class="dashboard-insights-loading">Loading sales performance…</div>
          </div>
        </section>

        <div class="grid-2 dashboard-lower-grid">
          <div class="card">
            <div class="card-header">
              <span class="card-title">Recent Transactions</span>
              <button class="btn btn-ghost btn-sm" data-dashboard-nav="sales">View all</button>
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
                  ` : recentSales.slice(0, 8).map(sale => `
                    <tr>
                      <td class="text-sm font-semibold">${escapeHtml(sale.invoice_number || '-')}</td>
                      <td class="font-semibold" style="color:var(--success)">${formatCurrency(sale.total_amount)}</td>
                      <td><span class="badge badge-gray">${escapeHtml((sale.payment_method || 'other').replaceAll('_', ' '))}</span></td>
                      <td class="text-xs text-muted">${formatDateTime(sale.created_at)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Inventory Attention</span>
              <button class="btn btn-ghost btn-sm" data-dashboard-nav="inventory" data-filter-type="low-stock">Manage</button>
            </div>
            <div class="card-body dashboard-attention-body">
              <div class="dashboard-attention-block">
                <div class="dashboard-attention-title">Low stock</div>
                ${stats.lowStockProducts.length === 0 ? `<div class="dashboard-panel-empty compact">No low-stock products.</div>` : stats.lowStockProducts.slice(0, 5).map(product => `
                  <button type="button" class="dashboard-attention-row" data-dashboard-nav="inventory" data-filter-type="low-stock">
                    <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category || 'Uncategorized')}</small></span>
                    <span class="badge badge-warning">${Number(product.stock_boxes || 0).toLocaleString()} boxes</span>
                  </button>
                `).join('')}
              </div>

              <div class="dashboard-attention-block">
                <div class="dashboard-attention-title">Expiring soon</div>
                ${stats.expiringSoonProducts.length === 0 ? `<div class="dashboard-panel-empty compact">Nothing expiring in the next 30 days.</div>` : stats.expiringSoonProducts.slice(0, 5).map(product => `
                  <button type="button" class="dashboard-attention-row" data-dashboard-nav="inventory" data-filter-type="expiring">
                    <span><strong>${escapeHtml(product.name)}</strong><small>Expires ${formatDate(product.expiry_date)}</small></span>
                    <span class="badge badge-warning">Soon</span>
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="dashboard-refresh-row">
          <button class="btn btn-secondary" id="refresh-dashboard-btn">Refresh Dashboard</button>
        </div>
      </div>
    `;

    const navigateFromElement = element => {
      const view = element?.dataset?.dashboardNav;
      if (!view) return;
      const filterType = element.dataset.filterType || null;
      window.navigate(view, filterType ? { filterType } : {});
    };

    container.querySelectorAll('[data-dashboard-nav]').forEach(element => {
      element.addEventListener('click', () => navigateFromElement(element));
      if (element.getAttribute('role') === 'button') {
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            navigateFromElement(element);
          }
        });
      }
    });

    const insightsContainer = container.querySelector('#dashboard-insights');
    const periodButtons = [...container.querySelectorAll('.dashboard-period-btn')];
    let insightRequest = 0;

    async function loadInsights(period) {
      const requestId = ++insightRequest;
      periodButtons.forEach(button => button.classList.toggle('active', button.dataset.period === period));
      if (insightsContainer) insightsContainer.innerHTML = '<div class="dashboard-insights-loading">Loading sales performance…</div>';

      try {
        const insights = await getDashboardInsights(pharmacyId, period);
        if (requestId !== insightRequest || !insightsContainer) return;
        insightsContainer.innerHTML = renderInsightPanels(insights);
        insightsContainer.querySelectorAll('[data-dashboard-nav]').forEach(element => {
          element.addEventListener('click', () => navigateFromElement(element));
        });
      } catch (error) {
        console.error('Failed to load dashboard insights:', error);
        if (requestId === insightRequest && insightsContainer) {
          insightsContainer.innerHTML = '<div class="alert alert-danger">Sales performance could not be loaded. Please try again.</div>';
        }
      }
    }

    periodButtons.forEach(button => button.addEventListener('click', () => loadInsights(button.dataset.period || 'week')));
    container.querySelector('#refresh-dashboard-btn')?.addEventListener('click', () => renderAdminDashboard(container, user));

    loadInsights('week');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load dashboard: ${escapeHtml(err.message)}</div>`;
  }
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
