import { getProfiles, updateProfile } from '../../database.js';
import { signUp } from '../../auth.js';
import { formatDate, showToast, showConfirm } from '../../utils.js';
import { createModal } from '../../components/modal.js';
import { supabase } from '../../config.js';

export async function renderStaff(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) { container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`; return; }

  try {
    const profiles = await getProfiles(pharmacyId);
    renderView(container, profiles, user);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load staff: ${err.message}</div>`;
  }
}

function renderView(container, profiles, user) {
  container.innerHTML = `
    <div class="animate-in">
      <div class="page-header">
        <div>
          <div class="page-title">Staff Management</div>
          <div class="page-subtitle">Manage your pharmacy team members</div>
        </div>
        <button class="btn btn-primary" id="add-staff-btn">+ Add Staff</button>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Team Members (${profiles.length})</span>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="staff-tbody">
              ${renderRows(profiles, user)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const reload = () => renderStaff(container, user);
  document.getElementById('add-staff-btn').addEventListener('click', () => showAddStaffModal(user, reload));
  bindActions(profiles, user, reload);
}

function renderRows(profiles, currentUser) {
  if (!profiles.length) return `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">&#128101;</div><div class="empty-state-title">No staff yet</div><div class="empty-state-desc">Add your first team member</div></div></td></tr>`;

  const roleColors = { admin: 'badge-primary', salesman: 'badge-gray' };

  return profiles.map(p => `
    <tr>
      <td>
        <div class="flex items-center gap-2">
          <div class="user-avatar" style="width:30px;height:30px;font-size:0.75rem">${(p.full_name || p.email)[0].toUpperCase()}</div>
          <span class="font-semibold">${p.full_name || '—'}</span>
        </div>
      </td>
      <td class="text-sm text-muted">${p.email}</td>
      <td><span class="badge ${roleColors[p.role] || 'badge-gray'}">${p.role?.replace('_', ' ')}</span></td>
      <td><span class="badge ${p.is_active ? 'badge-success' : 'badge-danger'}">${p.is_active ? 'Active' : 'Inactive'}</span></td>
      <td class="text-sm text-muted">${formatDate(p.created_at)}</td>
      <td>
        ${p.id !== currentUser.id ? `
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm edit-staff-btn" data-id="${p.id}" data-staff='${JSON.stringify(p)}'>
              Edit
            </button>
            <button class="btn btn-ghost btn-sm toggle-staff-btn" data-id="${p.id}" data-active="${p.is_active}">
              ${p.is_active ? 'Disable' : 'Enable'}
            </button>
          </div>
        ` : '<span class="text-xs text-muted">You</span>'}
      </td>
    </tr>
  `).join('');
}

function bindActions(profiles, user, reload) {
  // Edit button handlers
  document.querySelectorAll('.edit-staff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const staff = JSON.parse(btn.dataset.staff);
      showEditStaffModal(staff, reload);
    });
  });

  // Toggle button handlers
  document.querySelectorAll('.toggle-staff-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const isActive = btn.dataset.active === 'true';
      const confirmed = await showConfirm(`${isActive ? 'Disable' : 'Enable'} this staff member?`);
      if (!confirmed) return;
      try {
        await updateProfile(btn.dataset.id, { is_active: !isActive });
        showToast('Staff member updated');
        reload();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function showAddStaffModal(user, reload) {
  const { overlay, closeModal } = createModal({
    id: 'add-staff',
    title: 'Add Staff Member',
    body: `
      <form id="staff-form">
        <div class="form-group">
          <label class="form-label">Full Name *</label>
          <input type="text" class="form-input" id="staff-name" placeholder="Jane Doe" required />
        </div>
        <div class="form-group">
          <label class="form-label">Email *</label>
          <input type="email" class="form-input" id="staff-email" placeholder="staff@pharmacy.com" required />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Password *</label>
            <input type="password" class="form-input" id="staff-pass" placeholder="Min 8 chars" minlength="8" required />
          </div>
          <div class="form-group">
            <label class="form-label">Role *</label>
            <select class="form-select" id="staff-role">
              <option value="salesman">Salesman</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div id="staff-err" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-staff">Cancel</button>
      <button class="btn btn-primary" id="save-staff">Add Staff</button>
    `
  });

  overlay.querySelector('#cancel-staff').addEventListener('click', closeModal);
  overlay.querySelector('#save-staff').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-staff');
    const errEl = overlay.querySelector('#staff-err');
    errEl.classList.add('hidden');

    const name = overlay.querySelector('#staff-name').value.trim();
    const email = overlay.querySelector('#staff-email').value.trim();
    const pass = overlay.querySelector('#staff-pass').value;
    const role = overlay.querySelector('#staff-role').value;

    if (!name || !email || !pass) {
      errEl.textContent = 'All fields are required.';
      errEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Adding...';

    try {
      await signUp(email, pass, name, role, user.profile.pharmacy_id);
      showToast('Staff member added successfully');
      closeModal();
      reload();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Add Staff';
    }
  });
}

function showEditStaffModal(staff, reload) {
  const { overlay, closeModal } = createModal({
    id: 'edit-staff',
    title: 'Edit Staff Member',
    body: `
      <form id="edit-staff-form">
        <div class="form-group">
          <label class="form-label">Full Name *</label>
          <input type="text" class="form-input" id="es-name" value="${staff.full_name || ''}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Email *</label>
          <input type="email" class="form-input" id="es-email" value="${staff.email}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select class="form-select" id="es-role">
            <option value="salesman" ${staff.role === 'salesman' ? 'selected' : ''}>Salesman</option>
            <option value="admin" ${staff.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </div>
        <hr class="divider" />
        <p class="text-sm font-semibold" style="margin-bottom:0.75rem;color:var(--gray-700)">Change Password (Optional)</p>
        <div class="form-group">
          <label class="form-label">New Password</label>
          <input type="password" class="form-input" id="es-password" placeholder="Leave empty to keep current password" minlength="8" />
        </div>
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <input type="password" class="form-input" id="es-password-confirm" placeholder="Confirm new password" minlength="8" />
        </div>
        <div id="edit-staff-error" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-edit-staff">Cancel</button>
      <button class="btn btn-primary" id="save-edit-staff">Save Changes</button>
    `
  });

  overlay.querySelector('#cancel-edit-staff').addEventListener('click', closeModal);

  overlay.querySelector('#save-edit-staff').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-edit-staff');
    const errEl = overlay.querySelector('#edit-staff-error');
    errEl.classList.add('hidden');

    const name = overlay.querySelector('#es-name').value.trim();
    const email = overlay.querySelector('#es-email').value.trim();
    const role = overlay.querySelector('#es-role').value;
    const newPassword = overlay.querySelector('#es-password').value;
    const confirmPassword = overlay.querySelector('#es-password-confirm').value;

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
      await updateProfile(staff.id, { 
        full_name: name,
        email: email,
        role: role
      });

      // Update password if provided
      if (newPassword) {
        const { error: pwdError } = await supabase.auth.admin.updateUserById(staff.id, {
          password: newPassword
        });
        if (pwdError) throw pwdError;
      }

      showToast('Staff member updated successfully!');
      closeModal();
      reload();
    } catch (err) {
      errEl.textContent = err.message || 'Failed to update staff member';
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });
}
