import { supabase } from '../config.js';
import { updateProfile } from '../database.js';
import { showToast } from '../utils.js';
import { createModal } from './modal.js';


// Expose close function globally
window.closeProfileModal = function() {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  }
};

// Main export function
export async function showProfileModal(user) {
  if (!user || !user.id) {
    showToast('User information not available', 'error');
    return;
  }

  const { full_name, email, role } = user.profile || {};
  const pharmacyName = user.profile?.pharmacies?.name || 'PharmaCare';
  const userId = user.id;
  
  const roleLabel = {
    super_admin: 'Super Admin',
    admin: 'Administrator',
    salesman: 'Salesman'
  }[role] || role;

  const { overlay } = createModal({
    id: 'user-profile-modal',
    title: '👤 My Account',
    size: 'modal-lg',
    body: `
      <div class="profile-container">
        <div class="profile-header" style="text-align:center;padding:2rem;background:linear-gradient(135deg,var(--primary),var(--primary-dark));border-radius:var(--radius);color:white;margin-bottom:2rem">
          <div class="profile-avatar" style="width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;font-size:2.5rem;font-weight:bold">
            ${full_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U'}
          </div>
          <h3 style="margin:0 0 0.5rem;font-size:1.5rem">${full_name || 'User'}</h3>
          <div style="opacity:0.9;font-size:0.9rem">${roleLabel}</div>
        </div>

        <div class="profile-info" style="display:grid;grid-template-columns:2fr 3fr;gap:2rem;margin-bottom:2rem">
          <div>
            <div style="margin-bottom:1.5rem">
              <label class="text-sm font-semibold text-muted" style="display:block;margin-bottom:0.5rem">Email Address</label>
              <div style="padding:0.75rem;background:var(--gray-50);border-radius:var(--radius);font-size:0.9rem;color:var(--text-primary)">${email}</div>
            </div>
            <div>
              <label class="text-sm font-semibold text-muted" style="display:block;margin-bottom:0.5rem">Pharmacy</label>
              <div style="padding:0.75rem;background:var(--gray-50);border-radius:var(--radius);font-size:0.9rem;color:var(--text-primary)">${pharmacyName}</div>
            </div>
          </div>
          <div>
            <div style="margin-bottom:1.5rem">
              <label for="edit-name" class="text-sm font-semibold text-muted" style="display:block;margin-bottom:0.5rem">Full Name</label>
              <input type="text" id="edit-name" class="form-control" value="${full_name || ''}" placeholder="Your full name">
            </div>
            <button class="btn btn-primary btn-sm" id="save-name-btn">Update Name</button>
          </div>
        </div>

        <div class="divider" style="margin:2rem 0;border-top:1px solid var(--gray-200)"></div>

        <div class="password-section">
          <h4 style="margin-bottom:1.5rem;font-size:1rem">Change Password</h4>
          
          <div style="display:grid;gap:1rem;max-width:400px">
            <div>
              <label for="current-password" class="text-sm font-semibold text-muted" style="display:block;margin-bottom:0.5rem">Current Password</label>
              <input type="password" id="current-password" class="form-control" placeholder="Enter current password">
            </div>
            
            <div>
              <label for="new-password" class="text-sm font-semibold text-muted" style="display:block;margin-bottom:0.5rem">New Password</label>
              <input type="password" id="new-password" class="form-control" placeholder="Enter new password (min 8 characters)">
              <div class="text-xs text-muted" style="margin-top:0.5rem">Must be at least 8 characters long</div>
            </div>
            
            <div>
              <label for="confirm-password" class="text-sm font-semibold text-muted" style="display:block;margin-bottom:0.5rem">Confirm New Password</label>
              <input type="password" id="confirm-password" class="form-control" placeholder="Confirm new password">
            </div>

            <div id="password-error" class="alert alert-danger" style="display:none;margin-top:1rem"></div>
            
            <button class="btn btn-warning" id="change-password-btn">Change Password</button>
          </div>
        </div>
      </div>
    `
  });

  // Set up event handlers with proper scope
  const saveNameBtn = document.getElementById('save-name-btn');
  const changePasswordBtn = document.getElementById('change-password-btn');

  if (saveNameBtn) {
    saveNameBtn.addEventListener('click', async () => {
      const newName = document.getElementById('edit-name')?.value?.trim();
      if (!newName) {
        showToast('Please enter your full name', 'warning');
        return;
      }
      
      try {
        await updateProfile(userId, { full_name: newName });
        showToast('Name updated successfully!', 'success');
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        showToast('Error updating name: ' + err.message, 'error');
      }
    });
  }

  if (changePasswordBtn) {
    changePasswordBtn.addEventListener('click', async () => {
      const currentPassword = document.getElementById('current-password')?.value;
      const newPassword = document.getElementById('new-password')?.value;
      const confirmPassword = document.getElementById('confirm-password')?.value;
      const errorEl = document.getElementById('password-error');

      // Validation
      if (!currentPassword) {
        errorEl.textContent = 'Please enter your current password for verification';
        errorEl.style.display = 'block';
        return;
      }

      if (!newPassword || newPassword.length < 8) {
        errorEl.textContent = 'New password must be at least 8 characters';
        errorEl.style.display = 'block';
        return;
      }

      if (newPassword !== confirmPassword) {
        errorEl.textContent = 'Passwords do not match';
        errorEl.style.display = 'block';
        return;
      }

      if (currentPassword === newPassword) {
        errorEl.textContent = 'New password must be different from current password';
        errorEl.style.display = 'block';
        return;
      }

      try {
        // Get current user session
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        
        if (!currentUser) {
          throw new Error('No active session found. Please log in again.');
        }

        // Update password directly for authenticated user
        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword
        });

        if (updateError) {
          throw updateError;
        }

        errorEl.style.display = 'none';
        showToast('✓ Password changed successfully! Redirecting to login...', 'success');
        
        // Sign out after password change and redirect to login
        setTimeout(async () => {
          await supabase.auth.signOut();
          window.location.href = '/login.html';
        }, 1500);
      } catch (err) {
        errorEl.textContent = err.message || 'Error changing password. Please try again.';
        errorEl.style.display = 'block';
      }
    });
  }
}
