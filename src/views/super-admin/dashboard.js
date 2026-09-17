import { getSuperAdminOverview } from '../../database.js';
import { formatCurrency, formatDate } from '../../utils.js';

const PERIOD_LABELS = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 Days',
  this_month: 'This Month',
  this_year: 'This Year',
  all_time: 'All Time'
};

export async function renderSuperAdminDashboard(container, user, initialPeriod = 'this_month') {
  const period = PERIOD_LABELS[initialPeriod] ? initialPeriod : 'this_month';

  try {
    const data = await getSuperAdminOverview(period);
    const summary = data.summary || {};
    const pharmacies = data.pharmacies || [];
    const health = buildHealthSummary(pharmacies);
    const revenueChange = percentChange(summary.period_revenue, summary.previous_revenue);
    const transactionChange = percentChange(summary.period_transactions, summary.previous_transactions);
    const activeRate = Number(summary.total_pharmacies || 0)
      ? Math.round((Number(summary.active_pharmacies || 0) / Number(summary.total_pharmacies || 1)) * 100)
      : 0;

    container.innerHTML = `
      <div class="animate-in super-admin-overview">
        <div class="page-header super-overview-header">
          <div>
            <div class="page-title">Platform Overview</div>
            <div class="page-subtitle">Monitor pharmacy activity, platform usage and operational health</div>
          </div>
          <div class="super-overview-actions">
            <label class="sr-only" for="platform-period">Overview period</label>
            <select class="form-select" id="platform-period" aria-label="Overview period">
              ${Object.entries(PERIOD_LABELS).map(([value, label]) => `<option value="${value}" ${period === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
            <button class="btn btn-primary" id="add-pharmacy-btn">+ Add Pharmacy</button>
          </div>
        </div>

        ${data.usingFallback ? `
          <div class="alert alert-warning super-overview-migration-note">
            Platform analytics are running in compatibility mode. Apply the latest Supabase migration for faster server-side aggregation as the platform grows.
          </div>
        ` : ''}

        <div class="super-overview-stats">
          ${statCard({
            label: 'Total Pharmacies',
            value: number(summary.total_pharmacies),
            sub: `${number(summary.active_pharmacies)} active`,
            icon: '🏥',
            tone: 'teal',
            nav: 'pharmacies'
          })}
          ${statCard({
            label: 'Total Users',
            value: number(summary.total_users),
            sub: `${number(summary.active_users)} active accounts`,
            icon: '👥',
            tone: 'blue',
            nav: 'all-users'
          })}
          ${statCard({
            label: `${PERIOD_LABELS[period]} Revenue`,
            value: formatCurrency(Number(summary.period_revenue || 0)),
            sub: comparisonText(revenueChange, 'previous period', period),
            icon: '💰',
            tone: 'green',
            nav: 'pharmacies'
          })}
          ${statCard({
            label: `${PERIOD_LABELS[period]} Transactions`,
            value: number(summary.period_transactions),
            sub: comparisonText(transactionChange, 'previous period', period),
            icon: '🧾',
            tone: 'amber',
            nav: 'pharmacies'
          })}
          ${statCard({
            label: 'Active Pharmacy Rate',
            value: `${activeRate}%`,
            sub: `${number(summary.active_pharmacies)} of ${number(summary.total_pharmacies)} enabled`,
            icon: '📈',
            tone: activeRate >= 80 ? 'green' : 'amber',
            nav: 'pharmacies'
          })}
        </div>

        <div class="super-overview-grid">
          <section class="card super-overview-panel">
            <div class="card-header">
              <div>
                <span class="card-title">7-Day Revenue Trend</span>
                <div class="super-card-subtitle">Completed sales across all pharmacies</div>
              </div>
            </div>
            ${renderRevenueTrend(data.revenue_trend || [])}
          </section>

          <section class="card super-overview-panel">
            <div class="card-header">
              <div>
                <span class="card-title">Pharmacy Health</span>
                <div class="super-card-subtitle">Based on account status and recent completed-sale activity</div>
              </div>
            </div>
            <div class="super-health-grid">
              ${healthCard('Healthy', health.healthy, 'Sale recorded within 7 days', 'success')}
              ${healthCard('Low Activity', health.lowActivity, 'Last sale 8–30 days ago', 'warning')}
              ${healthCard('No Recent Sales', health.noRecentSales, 'No completed sale in 30 days', 'neutral')}
              ${healthCard('Disabled', health.disabled, 'Pharmacy account disabled', 'danger')}
            </div>
            <div class="super-health-footer">
              <button type="button" class="btn btn-ghost btn-sm" data-nav="pharmacies">Manage pharmacies →</button>
            </div>
          </section>
        </div>

        <div class="super-overview-grid super-overview-grid-secondary">
          <section class="card super-overview-panel">
            <div class="card-header">
              <div>
                <span class="card-title">Recent Platform Activity</span>
                <div class="super-card-subtitle">Recent registrations, users and completed sales</div>
              </div>
            </div>
            ${renderActivity(data.activity || [])}
          </section>

          <section class="card super-overview-panel super-attention-panel">
            <div class="card-header">
              <div>
                <span class="card-title">Needs Attention</span>
                <div class="super-card-subtitle">Pharmacies that may need a quick review</div>
              </div>
            </div>
            ${renderAttentionList(pharmacies)}
          </section>
        </div>

        <section class="card super-pharmacy-summary-card">
          <div class="card-header super-pharmacy-summary-header">
            <div>
              <span class="card-title">Registered Pharmacies</span>
              <div class="super-card-subtitle">${pharmacies.length} pharmacy${pharmacies.length === 1 ? '' : 'ies'} · ${PERIOD_LABELS[period]} performance</div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-nav="pharmacies">View all pharmacies</button>
          </div>
          <div class="table-container">
            <table class="super-pharmacy-summary-table">
              <thead>
                <tr>
                  <th>Pharmacy</th>
                  <th>Health</th>
                  <th>Users</th>
                  <th>Branches</th>
                  <th>${PERIOD_LABELS[period]} Revenue</th>
                  <th>Transactions</th>
                  <th>Last Sale</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${pharmacies.length ? pharmacies.map(p => pharmacyRow(p)).join('') : `
                  <tr><td colspan="10">
                    <div class="empty-state">
                      <div class="empty-state-icon">🏥</div>
                      <div class="empty-state-title">No pharmacies yet</div>
                      <div class="empty-state-desc">Add your first pharmacy to begin monitoring platform activity.</div>
                    </div>
                  </td></tr>
                `}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    container.querySelector('#platform-period')?.addEventListener('change', event => {
      renderSuperAdminDashboard(container, user, event.target.value);
    });

    container.querySelector('#add-pharmacy-btn')?.addEventListener('click', () => {
      import('./pharmacies.js').then(module => module.showAddPharmacyModal());
    });

    container.querySelectorAll('[data-nav]').forEach(element => {
      element.addEventListener('click', () => window.navigate?.(element.dataset.nav));
    });
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load dashboard: ${escapeHtml(err.message)}</div>`;
  }
}

function statCard({ label, value, sub, icon, tone, nav }) {
  return `
    <button type="button" class="stat-card stat-card-clickable super-stat-card" data-nav="${nav}">
      <div class="stat-card-header">
        <span class="stat-card-label">${escapeHtml(label)}</span>
        <div class="stat-card-icon ${tone}">${icon}</div>
      </div>
      <div class="stat-card-value">${escapeHtml(String(value))}</div>
      <div class="stat-card-change">${sub}</div>
    </button>
  `;
}

function renderRevenueTrend(rows) {
  if (!rows.length) return `<div class="empty-state compact"><div class="empty-state-desc">No recent revenue data.</div></div>`;
  const max = Math.max(...rows.map(row => Number(row.revenue || 0)), 1);
  return `
    <div class="super-trend-chart" role="img" aria-label="Revenue trend for the last seven days">
      ${rows.map(row => {
        const revenue = Number(row.revenue || 0);
        const height = revenue > 0 ? Math.max(10, Math.round((revenue / max) * 100)) : 4;
        return `
          <div class="super-trend-column" title="${escapeHtml(formatDate(row.date))}: ${escapeHtml(formatCurrency(revenue))}">
            <div class="super-trend-value">${compactCurrency(revenue)}</div>
            <div class="super-trend-bar-wrap"><div class="super-trend-bar" style="height:${height}%"></div></div>
            <div class="super-trend-label">${shortDay(row.date)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderActivity(rows) {
  if (!rows.length) return `<div class="empty-state compact"><div class="empty-state-desc">No recent platform activity.</div></div>`;
  return `
    <div class="super-activity-list">
      ${rows.slice(0, 10).map(item => `
        <div class="super-activity-item">
          <div class="super-activity-icon">${activityIcon(item.type)}</div>
          <div class="super-activity-content">
            <div class="super-activity-title">${escapeHtml(item.title || 'Activity')}</div>
            <div class="super-activity-detail">${escapeHtml(activityDetail(item))}</div>
          </div>
          <time class="super-activity-time">${relativeTime(item.time)}</time>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAttentionList(pharmacies) {
  const rows = pharmacies
    .map(p => ({ ...p, health: healthStatus(p) }))
    .filter(p => p.health.key !== 'healthy')
    .sort((a, b) => healthPriority(a.health.key) - healthPriority(b.health.key))
    .slice(0, 7);

  if (!rows.length) {
    return `<div class="super-all-good"><span>✓</span><div><strong>All pharmacies look healthy</strong><div>No disabled or low-activity pharmacy is currently flagged.</div></div></div>`;
  }

  return `
    <div class="super-attention-list">
      ${rows.map(p => `
        <div class="super-attention-item">
          <div class="super-attention-main">
            <div class="font-semibold">${escapeHtml(p.name)}</div>
            <div class="text-sm text-muted">${p.last_sale_at ? `Last sale ${relativeTime(p.last_sale_at)}` : 'No recent completed sale found'}</div>
          </div>
          <span class="badge ${p.health.badge}">${p.health.label}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function pharmacyRow(pharmacy) {
  const health = healthStatus(pharmacy);
  return `
    <tr>
      <td>
        <div class="font-semibold">${escapeHtml(pharmacy.name)}</div>
        <div class="text-xs text-muted">${escapeHtml(pharmacy.email || 'No email')}</div>
      </td>
      <td><span class="badge ${health.badge}">${health.label}</span></td>
      <td>${number(pharmacy.user_count)}<div class="text-xs text-muted">${number(pharmacy.active_user_count)} active</div></td>
      <td>${number(pharmacy.branch_count)}</td>
      <td class="font-semibold super-money-cell">${formatCurrency(Number(pharmacy.period_revenue || 0))}</td>
      <td>${number(pharmacy.period_transactions)}</td>
      <td>${pharmacy.last_sale_at ? relativeTime(pharmacy.last_sale_at) : '<span class="text-muted">No recent sale</span>'}</td>
      <td><span class="badge ${pharmacy.is_active ? 'badge-success' : 'badge-danger'}">${pharmacy.is_active ? 'Active' : 'Disabled'}</span></td>
      <td class="text-muted text-sm">${formatDate(pharmacy.created_at)}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-nav="pharmacies">Manage</button></td>
    </tr>
  `;
}

function buildHealthSummary(pharmacies) {
  return pharmacies.reduce((acc, pharmacy) => {
    const status = healthStatus(pharmacy).key;
    if (status === 'healthy') acc.healthy += 1;
    if (status === 'low_activity') acc.lowActivity += 1;
    if (status === 'no_recent_sales') acc.noRecentSales += 1;
    if (status === 'disabled') acc.disabled += 1;
    return acc;
  }, { healthy: 0, lowActivity: 0, noRecentSales: 0, disabled: 0 });
}

function healthStatus(pharmacy) {
  if (!pharmacy.is_active) return { key: 'disabled', label: 'Disabled', badge: 'badge-danger' };
  if (!pharmacy.last_sale_at) return { key: 'no_recent_sales', label: 'No Recent Sales', badge: 'badge-neutral' };
  const days = Math.floor((Date.now() - new Date(pharmacy.last_sale_at).getTime()) / 86400000);
  if (days <= 7) return { key: 'healthy', label: 'Healthy', badge: 'badge-success' };
  if (days <= 30) return { key: 'low_activity', label: 'Low Activity', badge: 'badge-warning' };
  return { key: 'no_recent_sales', label: 'No Recent Sales', badge: 'badge-neutral' };
}

function healthCard(label, value, detail, tone) {
  return `
    <div class="super-health-card ${tone}">
      <div class="super-health-number">${number(value)}</div>
      <div class="super-health-label">${label}</div>
      <div class="super-health-detail">${detail}</div>
    </div>
  `;
}

function percentChange(current, previous) {
  if (previous === null || previous === undefined) return null;
  const prev = Number(previous || 0);
  const curr = Number(current || 0);
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function comparisonText(change, fallback, period) {
  if (period === 'all_time') return 'All completed sales';
  if (change === null) return 'No comparable previous-period baseline';
  const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
  const cls = change > 0 ? 'positive' : change < 0 ? 'negative' : '';
  return `<span class="super-comparison ${cls}">${arrow} ${Math.abs(change).toFixed(1)}%</span> vs ${fallback}`;
}

function activityDetail(item) {
  if (item.type === 'sale_completed' && item.amount !== undefined && item.amount !== null) {
    return `${item.detail || ''}${item.detail ? ' · ' : ''}${formatCurrency(Number(item.amount || 0))}`;
  }
  return item.detail || '';
}

function activityIcon(type) {
  if (type === 'pharmacy_created') return '🏥';
  if (type === 'user_created') return '👤';
  if (type === 'sale_completed') return '🧾';
  return '•';
}

function relativeTime(value) {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return formatDate(value);
  const diff = Date.now() - time;
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return formatDate(value);
}

function shortDay(value) {
  const d = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(d);
}

function compactCurrency(value) {
  const amount = Number(value || 0);
  if (amount >= 1000000) return `Le${(amount / 1000000).toFixed(1)}m`;
  if (amount >= 1000) return `Le${(amount / 1000).toFixed(1)}k`;
  return `Le${amount.toFixed(0)}`;
}

function number(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function healthPriority(key) {
  return ({ disabled: 0, no_recent_sales: 1, low_activity: 2, healthy: 3 })[key] ?? 4;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
