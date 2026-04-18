import { getProfiles, updateProfile } from '../../database.js';
import { formatDate, showToast, showConfirm } from '../../utils.js';

export async function renderAllUsers(container, user) {
  try {
    const profiles = await getProfiles();

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">All Users</div>
            <div class="page-subtitle">View and manage all users across the platform</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Users (${profiles.length})</span>
            <div class="topbar-search">
              <span style="color:var(--gray-400)">&#128269;</span>
              <input type="text" id="user-search" placeholder="Search users..." />
            </div>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Pharmacy</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="users-tbody">
                ${renderRows(profiles)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('user-search').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = profiles.filter(p =>
        (p.full_name || '').toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q)
      );
      document.getElementById('users-tbody').innerHTML = renderRows(filtered);
      bindActions(filtered);
    });

    bindActions(profiles);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load users: ${err.message}</div>`;
  }
}

function renderRows(profiles) {
  if (!profiles.length) return `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">&#128101;</div><div class="empty-state-title">No users found</div></div></td></tr>`;
  const roleColors = { super_admin: 'badge-danger', admin: 'badge-primary', salesman: 'badge-gray' };
  return profiles.map(p => `
    <tr>
      <td class="font-semibold">${p.full_name || '—'}</td>
      <td class="text-sm text-muted">${p.email}</td>
      <td><span class="badge ${roleColors[p.role] || 'badge-gray'}">${p.role?.replace('_', ' ')}</span></td>
      <td class="text-sm text-muted">${p.pharmacies?.name || '—'}</td>
      <td><span class="badge ${p.is_active ? 'badge-success' : 'badge-danger'}">${p.is_active ? 'Active' : 'Inactive'}</span></td>
      <td class="text-sm text-muted">${formatDate(p.created_at)}</td>
      <td>
        <button class="btn btn-ghost btn-sm toggle-user-btn" data-id="${p.id}" data-active="${p.is_active}">
          ${p.is_active ? 'Disable' : 'Enable'}
        </button>
      </td>
    </tr>
  `).join('');
}

function bindActions(profiles) {
  document.querySelectorAll('.toggle-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm(`Are you sure you want to ${btn.dataset.active === 'true' ? 'disable' : 'enable'} this user?`);
      if (!confirmed) return;
      try {
        await updateProfile(btn.dataset.id, { is_active: btn.dataset.active !== 'true' });
        showToast('User updated successfully');
        import('../app.js').then(m => m.navigate('all-users'));
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}
