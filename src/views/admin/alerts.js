import { getAlerts, markAlertAsRead, markAllAlertsAsRead, generateAlerts } from '../../database.js';
import { showToast } from '../../utils.js';

export async function renderAlerts(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`;
    return;
  }

  try {
    // Generate fresh alerts
    await generateAlerts(pharmacyId);
    
    const alertsData = await getAlerts(pharmacyId);
    const unreadAlerts = alertsData.filter(a => !a.is_read);
    const readAlerts = alertsData.filter(a => a.is_read);

    const alertIcon = (type) => {
      switch(type) {
        case 'low_stock': return '📦';
        case 'out_of_stock': return '⚠️';
        case 'expiry': return '⛔';
        case 'expiry_30_days': return '🕐';
        default: return '🔔';
      }
    };

    const alertColor = (type) => {
      switch(type) {
        case 'low_stock': return 'warning';
        case 'out_of_stock': return 'danger';
        case 'expiry': return 'danger';
        case 'expiry_30_days': return 'warning';
        default: return 'info';
      }
    };

    const alertTitle = (type) => {
      switch(type) {
        case 'low_stock': return 'Low Stock Alert';
        case 'out_of_stock': return 'Out of Stock';
        case 'expiry': return 'Product Expired';
        case 'expiry_30_days': return 'Expiring Soon';
        default: return 'Alert';
      }
    };

    const alertDescription = (alert) => {
      switch(alert.alert_type) {
        case 'low_stock': return `Currently: ${alert.current_stock} boxes (Threshold: ${alert.threshold_value})`;
        case 'out_of_stock': return `Stock is empty - no units available`;
        case 'expiry': return `This product has expired`;
        case 'expiry_30_days': return `Expires in ${alert.days_to_expiry} days`;
        default: return '';
      }
    };

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">Alerts & Notifications</div>
            <div class="page-subtitle">Monitor inventory status and expirations</div>
          </div>
          ${unreadAlerts.length > 0 ? `
            <button class="btn btn-secondary" onclick="window.markAllReadHandler()">
              Mark All as Read
            </button>
          ` : ''}
        </div>

        <div class="grid-2">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Unread Alerts</span>
              <div class="stat-card-icon red">${unreadAlerts.length}</div>
            </div>
            <div class="stat-card-value">${unreadAlerts.length}</div>
            <div class="stat-card-change">Active notifications</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Alerts</span>
              <div class="stat-card-icon gray">${alertsData.length}</div>
            </div>
            <div class="stat-card-value">${alertsData.length}</div>
            <div class="stat-card-change">All time record</div>
          </div>
        </div>

        ${unreadAlerts.length > 0 ? `
          <div style="margin-bottom:2rem">
            <div class="page-subtitle" style="margin-bottom:1rem">Active Alerts</div>
            ${unreadAlerts.map(alert => `
              <div class="alert alert-${alertColor(alert.alert_type)}" style="margin-bottom:0.75rem;display:flex;align-items:center;justify-content:space-between">
                <div style="display:flex;align-items:center;gap:1rem;flex:1">
                  <div style="font-size:1.5rem">${alertIcon(alert.alert_type)}</div>
                  <div style="flex:1">
                    <div class="font-semibold">${alert.product_name}</div>
                    <div class="text-sm" style="opacity:0.9">${alertTitle(alert.alert_type)}</div>
                    <div class="text-sm" style="opacity:0.8">${alertDescription(alert)}</div>
                  </div>
                </div>
                <button class="btn btn-sm btn-ghost" onclick="window.markAlertReadHandler('${alert.id}')">
                  ✓ Mark as Read
                </button>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <div class="empty-state-icon">✓</div>
            <div class="empty-state-title">All Clear!</div>
            <div class="empty-state-text">No active alerts. Your inventory is healthy.</div>
          </div>
        `}

        ${readAlerts.length > 0 ? `
          <div>
            <div class="page-subtitle" style="margin-bottom:1rem">Read Alerts (Last 30 days)</div>
            <div class="card">
              <div class="table-responsive" style="font-size:0.9rem">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Type</th>
                      <th>Details</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${readAlerts.slice(0, 20).map(alert => `
                      <tr style="opacity:0.7">
                        <td>${alert.product_name}</td>
                        <td>
                          <span class="badge">${alertTitle(alert.alert_type)}</span>
                        </td>
                        <td class="text-sm">${alertDescription(alert)}</td>
                        <td>${new Date(alert.created_at).toLocaleDateString()}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    window.markAlertReadHandler = async (alertId) => {
      try {
        await markAlertAsRead(alertId);
        showToast('Alert marked as read', 'success');
        renderAlerts(container, user);
      } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
      }
    };

    window.markAllReadHandler = async () => {
      try {
        await markAllAlertsAsRead(pharmacyId);
        showToast('All alerts marked as read', 'success');
        renderAlerts(container, user);
      } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
      }
    };

  } catch (error) {
    showToast(`Error loading alerts: ${error.message}`, 'error');
    container.innerHTML = `<div class="alert alert-danger">Error loading alerts: ${error.message}</div>`;
  }
}
