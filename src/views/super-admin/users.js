import { getProfiles, updateProfile } from '../../database.js';
import { formatDate, showToast, showConfirm } from '../../utils.js';
import { createModal } from '../../components/modal.js';
import { supabase } from '../../config.js';

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
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm edit-user-btn" data-id="${p.id}" data-user='${JSON.stringify(p)}'>
            Edit
          </button>
          <button class="btn btn-ghost btn-sm toggle-user-btn" data-id="${p.id}" data-active="${p.is_active}">
            ${p.is_active ? 'Disable' : 'Enable'}
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function bindActions(profiles) {
  // Edit button handlers
  document.querySelectorAll('.edit-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const profile = JSON.parse(btn.dataset.user);
      showEditUserModal(profile, () => {
        import('../app.js').then(m => m.navigate('all-users'));
      });
    });
  });

  // Toggle button handlers
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

function showEditUserModal(profile, onSave) {
  const { overlay, closeModal } = createModal({
    id: 'edit-user',
    title: 'Edit User Information',
    body: `
      <form id="edit-user-form">
        <div class="form-group">
          <label class="form-label">Full Name *</label>
          <input type="text" class="form-input" id="eu-name" value="${profile.full_name || ''}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Email *</label>
          <input type="email" class="form-input" id="eu-email" value="${profile.email}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select class="form-select" id="eu-role" disabled>
            <option value="super_admin" ${profile.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
            <option value="admin" ${profile.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="salesman" ${profile.role === 'salesman' ? 'selected' : ''}>Salesman</option>
          </select>
          <small class="text-muted" style="display:block;margin-top:0.25rem">Role cannot be changed here</small>
        </div>
        <hr class="divider" />
        <p class="text-sm font-semibold" style="margin-bottom:0.75rem;color:var(--gray-700)">Change Password (Optional)</p>
        <div class="form-group">
          <label class="form-label">New Password</label>
          <input type="password" class="form-input" id="eu-password" placeholder="Leave empty to keep current password" minlength="8" />
        </div>
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <input type="password" class="form-input" id="eu-password-confirm" placeholder="Confirm new password" minlength="8" />
        </div>
        <div id="edit-user-error" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-edit-user">Cancel</button>
      <button class="btn btn-primary" id="save-edit-user">Save Changes</button>
    `
  });

  overlay.querySelector('#cancel-edit-user').addEventListener('click', closeModal);

  overlay.querySelector('#save-edit-user').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-edit-user');
    const errEl = overlay.querySelector('#edit-user-error');
    errEl.classList.add('hidden');

    const name = overlay.querySelector('#eu-name').value.trim();
    const email = overlay.querySelector('#eu-email').value.trim();
    const newPassword = overlay.querySelector('#eu-password').value;
    const confirmPassword = overlay.querySelector('#eu-password-confirm').value;

    if (!name || !email) {
      errEl.textContent = 'Name and email are required.';
      errEl.classList.remove('hidden');
      return;
    }

    if ((newPassword || confirmPassword) && newPassword !== confirmPassword) {
      errEl.textContent = 'Passwords do not match.';
      errEl.classList.remove('hidden');
      return;
    }

    if (newPassword && newPassword.length < 8) {
      errEl.textContent = 'Password must be at least 8 characters.';
      errEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      // Update profile information
      await updateProfile(profile.id, { 
        full_name: name,
        email: email
      });

      // Update password if provided
      if (newPassword) {
        const { error: pwdError } = await supabase.auth.admin.updateUserById(profile.id, {
          password: newPassword
        });
        if (pwdError) throw pwdError;
      }

      showToast('User updated successfully!');
      closeModal();
      onSave();
    } catch (err) {
      errEl.textContent = err.message || 'Failed to update user';
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });
}
