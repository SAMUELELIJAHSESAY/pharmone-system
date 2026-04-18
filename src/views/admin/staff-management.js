// Staff Management View
import { assignStaffToBranch, getBranches, getProfiles, getBranchAssignments, updateStaffAssignment, removeStaffFromBranch } from '../../database.js';
import { supabase } from '../../config.js';

export function renderStaffManagementView(pharmacyId) {
  const mainContent = document.getElementById('main-content');
  
  mainContent.innerHTML = `
    <div class="staff-management-container">
      <div class="page-header">
        <h1>👥 Staff Management</h1>
        <button class="btn btn-primary" onclick="openAddStaffModal()">+ Add Staff</button>
      </div>
      
      <!-- Staff List -->
      <div class="section">
        <h3>Branch Assignments</h3>
        <div class="filter-bar">
          <select id="branch-filter" class="filter-select" onchange="filterStaffByBranch()">
            <option value="">All Branches</option>
          </select>
          <input type="text" id="staff-search" placeholder="Search staff..." class="search-input" onkeyup="filterStaff()">
        </div>
        
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Assigned Branch</th>
              <th>Role in Branch</th>
              <th>Assigned Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="staff-table">
            <tr><td colspan="7">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      
      <!-- Staff Performance -->
      <div class="section">
        <h3>Today's Performance</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Staff Name</th>
              <th>Branch</th>
              <th>Total Sales</th>
              <th>Transactions</th>
              <th>Avg Transaction</th>
            </tr>
          </thead>
          <tbody id="performance-table">
            <tr><td colspan="5">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    
    <!-- Add Staff Modal -->
    <div id="add-staff-modal" class="modal" style="display: none;">
      <div class="modal-content">
        <div class="modal-close" onclick="closeModal('add-staff-modal')">×</div>
        <h2>Assign Staff to Branch</h2>
        
        <form onsubmit="saveStaffAssignment(event)">
          <div class="form-group">
            <label>Select Staff</label>
            <select id="staff-select" class="form-control" required onchange="loadStaffDetails()">
              <option value="">-- Choose Staff --</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Select Branch</label>
            <select id="assign-branch-select" class="form-control" required>
              <option value="">-- Choose Branch --</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Role in Branch</label>
            <select id="staff-role" class="form-control" required>
              <option value="">-- Select Role --</option>
              <option value="manager">Manager</option>
              <option value="pharmacist">Pharmacist</option>
              <option value="salesman">Salesman</option>
              <option value="cashier">Cashier</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Notes</label>
            <textarea id="assignment-notes" class="form-control" rows="3"></textarea>
          </div>
          
          <button type="submit" class="btn btn-primary">Assign Staff</button>
        </form>
      </div>
    </div>
    
    <!-- Edit Assignment Modal -->
    <div id="edit-assignment-modal" class="modal" style="display: none;">
      <div class="modal-content">
        <div class="modal-close" onclick="closeModal('edit-assignment-modal')">×</div>
        <h2>Edit Staff Assignment</h2>
        
        <form onsubmit="updateAssignment(event)">
          <input type="hidden" id="assignment-id">
          
          <div class="form-group">
            <label>Role in Branch</label>
            <select id="edit-staff-role" class="form-control" required>
              <option value="manager">Manager</option>
              <option value="pharmacist">Pharmacist</option>
              <option value="salesman">Salesman</option>
              <option value="cashier">Cashier</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Status</label>
            <select id="assignment-status" class="form-control">
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
          
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </form>
      </div>
    </div>
  `;
  
  loadStaffManagementData(pharmacyId);
}

async function loadStaffManagementData(pharmacyId) {
  try {
    // Load branches
    const branches = await getBranches(pharmacyId);
    const branchSelect = document.getElementById('assign-branch-select');
    branchSelect.innerHTML = '<option value="">-- Choose Branch --</option>' + 
      branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    
    // Load staff
    const profiles = await getProfiles(pharmacyId);
    const staffSelect = document.getElementById('staff-select');
    staffSelect.innerHTML = '<option value="">-- Choose Staff --</option>' + 
      profiles
        .filter(p => p.role !== 'super_admin')
        .map(p => `<option value="${p.id}">${p.full_name}</option>`)
        .join('');
    
    // Load all assignments
    loadAllAssignments(branches);
    
    // Load performance
    loadStaffPerformance(pharmacyId);
    
  } catch (error) {
    console.error('Error loading staff management data:', error);
  }
}

async function loadAllAssignments(branches) {
  try {
    const tbody = document.getElementById('staff-table');
    const { data, error } = await supabase
      .from('staff_branch_assignments')
      .select('*, profiles(full_name, email), branches(name)')
      .order('assigned_date', { ascending: false });
    
    if (error) throw error;
    
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">No staff assignments yet</td></tr>';
      return;
    }
    
    tbody.innerHTML = data.map(a => `
      <tr>
        <td>${a.profiles.full_name}</td>
        <td>${a.profiles.email}</td>
        <td>${a.branches.name}</td>
        <td><span class="badge">${a.role_in_branch}</span></td>
        <td>${new Date(a.assigned_date).toLocaleDateString()}</td>
        <td>${a.is_active ? '✓ Active' : '✗ Inactive'}</td>
        <td>
          <button class="btn btn-small btn-info" onclick="openEditAssignmentModal('${a.id}', '${a.role_in_branch}', ${a.is_active})">Edit</button>
          <button class="btn btn-small btn-danger" onclick="removeAssignment('${a.id}')">Remove</button>
        </td>
      </tr>
    `).join('');
    
  } catch (error) {
    console.error('Error loading assignments:', error);
  }
}

async function loadStaffPerformance(pharmacyId) {
  try {
    const { getStaffPerformance } = await import('../../database.js');
    const today = new Date().toISOString().split('T')[0];
    const performance = await getStaffPerformance(pharmacyId, null, today);
    
    const tbody = document.getElementById('performance-table');
    if (performance.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No sales data for today</td></tr>';
      return;
    }
    
    tbody.innerHTML = performance.map(p => `
      <tr>
        <td>${p.profiles.full_name}</td>
        <td>${p.branch_id || 'N/A'}</td>
        <td>$${p.total_sales.toFixed(2)}</td>
        <td>${p.transaction_count}</td>
        <td>$${p.average_transaction.toFixed(2)}</td>
      </tr>
    `).join('');
    
  } catch (error) {
    console.error('Error loading performance:', error);
  }
}

function openAddStaffModal() {
  document.getElementById('add-staff-modal').style.display = 'block';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

async function saveStaffAssignment(event) {
  event.preventDefault();
  
  try {
    const staffId = document.getElementById('staff-select').value;
    const branchId = document.getElementById('assign-branch-select').value;
    const role = document.getElementById('staff-role').value;
    const notes = document.getElementById('assignment-notes').value;
    
    if (!staffId || !branchId) {
      alert('Please select both staff and branch');
      return;
    }
    
    // Get pharmacy ID from current user
    const { data: userData } = await supabase.auth.getUser();
    const { data: profileData } = await supabase
      .from('profiles')
      .select('pharmacy_id')
      .eq('id', userData.user.id)
      .single();
    
    await assignStaffToBranch(staffId, branchId, profileData.pharmacy_id, role);
    
    alert('Staff assigned successfully!');
    closeModal('add-staff-modal');
    location.reload();
    
  } catch (error) {
    console.error('Error assigning staff:', error);
    alert('Error: ' + error.message);
  }
}

function openEditAssignmentModal(assignmentId, role, isActive) {
  document.getElementById('assignment-id').value = assignmentId;
  document.getElementById('edit-staff-role').value = role;
  document.getElementById('assignment-status').value = isActive;
  document.getElementById('edit-assignment-modal').style.display = 'block';
}

async function updateAssignment(event) {
  event.preventDefault();
  
  try {
    const assignmentId = document.getElementById('assignment-id').value;
    const role = document.getElementById('edit-staff-role').value;
    const isActive = document.getElementById('assignment-status').value === 'true';
    
    await updateStaffAssignment(assignmentId, { role_in_branch: role, is_active: isActive });
    
    alert('Assignment updated successfully!');
    closeModal('edit-assignment-modal');
    location.reload();
    
  } catch (error) {
    console.error('Error updating assignment:', error);
    alert('Error: ' + error.message);
  }
}

async function removeAssignment(assignmentId) {
  if (!confirm('Remove this staff assignment?')) return;
  
  try {
    await removeStaffFromBranch(assignmentId);
    alert('Staff assignment removed successfully!');
    location.reload();
  } catch (error) {
    console.error('Error removing assignment:', error);
    alert('Error: ' + error.message);
  }
}

function filterStaffByBranch() {
  const branchFilter = document.getElementById('branch-filter').value;
  alert('Filter by branch: ' + branchFilter);
  // TODO: Implement branch filter
}

function filterStaff() {
  const searchTerm = document.getElementById('staff-search').value.toLowerCase();
  const rows = document.querySelectorAll('#staff-table tr');
  
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(searchTerm) ? '' : 'none';
  });
}

async function loadStaffDetails() {
  // Optional: Load additional details when staff is selected
}
