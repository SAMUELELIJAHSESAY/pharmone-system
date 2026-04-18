import { getSuperAdminStats } from '../../database.js';
import { formatCurrency, formatDate } from '../../utils.js';

export async function renderSuperAdminDashboard(container, user) {
  try {
    const stats = await getSuperAdminStats();

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">Platform Overview</div>
            <div class="page-subtitle">Monitor all pharmacies and platform activity</div>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Pharmacies</span>
              <div class="stat-card-icon teal">&#127978;</div>
            </div>
            <div class="stat-card-value">${stats.totalPharmacies}</div>
            <div class="stat-card-change">${stats.activePharmacies} active</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Users</span>
              <div class="stat-card-icon blue">&#128101;</div>
            </div>
            <div class="stat-card-value">${stats.totalUsers}</div>
            <div class="stat-card-change">Across all pharmacies</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Platform Revenue</span>
              <div class="stat-card-icon green">&#128176;</div>
            </div>
            <div class="stat-card-value">${formatCurrency(stats.totalRevenue)}</div>
            <div class="stat-card-change">All-time total</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Active Rate</span>
              <div class="stat-card-icon amber">&#128200;</div>
            </div>
            <div class="stat-card-value">${stats.totalPharmacies ? Math.round((stats.activePharmacies / stats.totalPharmacies) * 100) : 0}%</div>
            <div class="stat-card-change">Pharmacy activity</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Registered Pharmacies</span>
            <button class="btn btn-primary btn-sm" id="add-pharmacy-btn">+ Add Pharmacy</button>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Pharmacy Name</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                ${stats.pharmacies.length === 0 ? `
                  <tr><td colspan="3">
                    <div class="empty-state">
                      <div class="empty-state-icon">&#127978;</div>
                      <div class="empty-state-title">No pharmacies yet</div>
                      <div class="empty-state-desc">Add your first pharmacy to get started</div>
                    </div>
                  </td></tr>
                ` : stats.pharmacies.map(p => `
                  <tr>
                    <td><span class="font-semibold">${p.name}</span></td>
                    <td>
                      <span class="badge ${p.is_active ? 'badge-success' : 'badge-danger'}">
                        ${p.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td class="text-muted text-sm">${formatDate(p.created_at)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('add-pharmacy-btn')?.addEventListener('click', () => {
      import('./pharmacies.js').then(m => m.showAddPharmacyModal());
    });
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load dashboard: ${err.message}</div>`;
  }
}
