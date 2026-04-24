// Branch Details Dashboard
import { supabase } from '../../config.js';
import { getBranchDetails, getBranchDashboard, getBranchAssignments, updateBranchDetails, getPharmacyStaff, assignStaffToBranch } from '../../database.js';
import { createModal } from '../../components/modal.js';
import { showToast, formatUTCDate, formatUTCDateTime } from '../../utils.js';

export function renderBranchDetailsView(branchId, pharmacyId) {
  const mainContent = document.getElementById('page-content');
  
  // Store pharmacyId in a global variable for later access in functions
  window.currentPharmacyId = pharmacyId;
  window.currentBranchId = branchId;
  
  mainContent.innerHTML = `
    <div class="branch-details-container">
      <!-- Header Section -->
      <div class="details-header">
        <h1 id="branch-name">Loading...</h1>
        <button id="back-to-branches-btn" class="btn btn-secondary">← Back to Branches</button>
      </div>
      
      <!-- Navigation Tabs -->
      <div class="tabs">
        <button class="tab-btn active" data-tab="overview">📊 Overview</button>
        <button class="tab-btn" data-tab="inventory">📦 Inventory</button>
        <button class="tab-btn" data-tab="sales">💰 Sales</button>
        <button class="tab-btn" data-tab="staff">👥 Staff</button>
        <button class="tab-btn" data-tab="details">ℹ️ Details</button>
      </div>
      
      <!-- Overview Tab -->
      <div id="overview-tab" class="tab-content">
        <div class="dashboard-grid">
          <!-- Key Metrics -->
          <div class="metric-card">
            <div class="metric-label">Daily Sales</div>
            <div class="metric-value" id="daily-sales">Le0</div>
          </div>
          
          <div class="metric-card">
            <div class="metric-label">Monthly Revenue</div>
            <div class="metric-value" id="monthly-revenue">Le0</div>
          </div>
          
          <div class="metric-card alert">
            <div class="metric-label">Low Stock Items</div>
            <div class="metric-value" id="low-stock-count">0</div>
          </div>
          
          <div class="metric-card alert">
            <div class="metric-label">Expiring Soon</div>
            <div class="metric-value" id="alert-count">0</div>
          </div>
        </div>
        
        <!-- Recent Activity -->
        <div class="section">
          <h3>Recent Activity</h3>
          <div id="recent-activity" class="activity-list">
            <p>Loading...</p>
          </div>
        </div>
      </div>
      
      <!-- Inventory Tab -->
      <div id="inventory-tab" class="tab-content" style="display: none;">
        <div class="section">
          <h3>Branch Inventory</h3>
          <div class="filter-bar">
            <input type="text" id="inventory-search" placeholder="Search products..." class="search-input">
            <select id="stock-filter" class="filter-select">
              <option value="">All Stock Levels</option>
              <option value="low">Low Stock Only</option>
              <option value="out">Out of Stock</option>
            </select>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Stock (Boxes)</th>
                <th>Stock (Units)</th>
                <th>Low Stock Alert</th>
                <th>Expiry Date</th>
              </tr>
            </thead>
            <tbody id="inventory-table">
              <tr><td colspan="5">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- Sales Tab -->
      <div id="sales-tab" class="tab-content" style="display: none;">
        <div class="section">
          <h3>Branch Sales History</h3>
          <div class="filter-bar">
            <input type="date" id="sales-date-filter" class="filter-input">
            <button class="btn btn-primary" id="filter-sales-btn">Filter</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Staff</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody id="sales-table">
              <tr><td colspan="6">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- Staff Tab -->
      <div id="staff-tab" class="tab-content" style="display: none;">
        <div class="section">
          <h3>Branch Staff</h3>
          <button class="btn btn-primary" onclick="openAssignStaffModal()">+ Assign Staff</button>
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Total Sales</th>
                <th>Transactions</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="staff-table">
              <tr><td colspan="5">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- Details Tab -->
      <div id="details-tab" class="tab-content" style="display: none;">
        <div class="section">
          <h3>Branch Information</h3>
          <form id="branch-details-form" onsubmit="saveBranchDetails(event, '${branchId}')">
            <div class="form-row">
              <div class="form-group">
                <label>Branch Name</label>
                <input type="text" id="branch-name-input" class="form-control" required>
              </div>
              <div class="form-group">
                <label>Location</label>
                <input type="text" id="branch-location" class="form-control">
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label>Contact Person</label>
                <input type="text" id="branch-contact-person" class="form-control">
              </div>
              <div class="form-group">
                <label>Phone</label>
                <input type="tel" id="branch-phone" class="form-control">
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label>Email</label>
                <input type="email" id="branch-email" class="form-control">
              </div>
            </div>
            
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </form>
        </div>
      </div>
    </div>
  `;
  
  // Add event listeners for tab buttons
  setTimeout(() => {
    // Add event listener for back button
    const backBtn = document.getElementById('back-to-branches-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => window.navigate('branches'));
    }
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        switchBranchTab(btn.dataset.tab);
      });
    });
    
    // Add event listener for filter button
    const filterBtn = document.getElementById('filter-sales-btn');
    if (filterBtn) {
      filterBtn.addEventListener('click', () => filterBranchSales());
    }
  }, 100);
  
  // Load branch data
  loadBranchData(branchId, pharmacyId);
}

async function loadBranchData(branchId, pharmacyId) {
  try {
    // Get branch details
    const branch = await getBranchDetails(branchId);
    document.getElementById('branch-name').textContent = branch.name;
    document.getElementById('branch-name-input').value = branch.name;
    document.getElementById('branch-location').value = branch.address || '';
    document.getElementById('branch-contact-person').value = branch.contact_person || '';
    document.getElementById('branch-phone').value = branch.phone || '';
    document.getElementById('branch-email').value = branch.email || '';
    
    // Get dashboard stats
    const dashboard = await getBranchDashboard(branchId, pharmacyId);
    const currencySymbol = window.pharmacySettings?.currency_symbol || 'Le';
    document.getElementById('daily-sales').textContent = `${currencySymbol}${dashboard.dailySales.toFixed(2)}`;
    document.getElementById('monthly-revenue').textContent = `${currencySymbol}${dashboard.monthlyRevenue.toFixed(2)}`;
    document.getElementById('low-stock-count').textContent = dashboard.lowStockCount;
    document.getElementById('alert-count').textContent = dashboard.alertCount;
    
    // Load additional data
    loadBranchInventory(branchId);
    loadBranchSales(branchId);
    loadBranchStaff(branchId);
    loadRecentActivity(branchId);
    
  } catch (error) {
    console.error('Error loading branch data:', error);
    alert('Error loading branch details: ' + error.message);
  }
}

async function loadBranchInventory(branchId) {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_active', true);
    
    if (error) throw error;
    
    const tbody = document.getElementById('inventory-table');
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No products in this branch</td></tr>';
      return;
    }
    
    tbody.innerHTML = data.map(p => `
      <tr>
        <td>${p.name}</td>
        <td>${p.stock_boxes}</td>
        <td>${p.stock_units}</td>
        <td>${p.stock_boxes <= p.low_stock_threshold ? '⚠️ Yes' : '✓ No'}</td>
        <td>${p.expiry_date || 'N/A'}</td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading inventory:', error);
  }
}

async function loadBranchSales(branchId) {
  try {
    const { data, error } = await supabase
      .from('sales')
      .select('*')
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (error) throw error;
    
    const tbody = document.getElementById('sales-table');
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No sales in this branch</td></tr>';
      return;
    }
    
    tbody.innerHTML = data.map(s => `
      <tr>
        <td>${s.invoice_number}</td>
        <td>Customer</td>
        <td>$${s.total_amount.toFixed(2)}</td>
        <td>${s.payment_method}</td>
        <td>Staff</td>
        <td>${formatUTCDate(s.created_at)}</td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading sales:', error);
  }
}

async function loadBranchStaff(branchId) {
  try {
    const assignments = await getBranchAssignments(branchId);
    
    const tbody = document.getElementById('staff-table');
    if (assignments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No staff assigned to this branch</td></tr>';
      return;
    }
    
    // Fetch sales data for each staff member
    const { data: allSales } = await supabase
      .from('sales')
      .select('created_by, total_amount')
      .eq('branch_id', branchId);
    
    // Calculate sales per staff member
    const staffSalesMap = {};
    if (allSales) {
      allSales.forEach(sale => {
        if (sale.created_by) {
          if (!staffSalesMap[sale.created_by]) {
            staffSalesMap[sale.created_by] = { total: 0, count: 0 };
          }
          staffSalesMap[sale.created_by].total += sale.total_amount || 0;
          staffSalesMap[sale.created_by].count += 1;
        }
      });
    }
    
    const currencySymbol = window.pharmacySettings?.currency_symbol || 'Le';
    tbody.innerHTML = assignments.map(a => {
      const staffId = a.staff_id;
      const salesData = staffSalesMap[staffId] || { total: 0, count: 0 };
      return `
      <tr>
        <td>${a.profiles.full_name}</td>
        <td>${a.role_in_branch}</td>
        <td>${currencySymbol}${salesData.total.toFixed(2)}</td>
        <td>${salesData.count}</td>
        <td>
          <button class="btn btn-small btn-danger" onclick="removeStaffFromBranch('${a.id}')">Remove</button>
        </td>
      </tr>
    `;
    }).join('');
  } catch (error) {
    console.error('Error loading staff:', error);
  }
}

async function loadRecentActivity(branchId) {
  try {
    const { data, error } = await supabase
      .from('sales')
      .select('*')
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) throw error;
    
    const div = document.getElementById('recent-activity');
    if (data.length === 0) {
      div.innerHTML = '<p>No recent activity</p>';
      return;
    }
    
    div.innerHTML = data.map(s => `
      <div class="activity-item">
        <div class="activity-icon">💳</div>
        <div class="activity-details">
          <div class="activity-title">Sale completed</div>
          <div class="activity-amount">Le${s.total_amount.toFixed(2)}</div>
          <div class="activity-time">${formatUTCDateTime(s.created_at)}</div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading activity:', error);
  }
}

function switchBranchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  
  // Show selected tab
  const selectedTab = document.getElementById(tabName + '-tab');
  if (selectedTab) selectedTab.style.display = 'block';
  
  // Mark button as active
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    }
  });
}

// Make switchBranchTab globally accessible
window.switchBranchTab = switchBranchTab;

async function saveBranchDetails(event, branchId) {
  event.preventDefault();
  
  try {
    const updates = {
      name: document.getElementById('branch-name-input').value,
      address: document.getElementById('branch-location').value,
      contact_person: document.getElementById('branch-contact-person').value,
      phone: document.getElementById('branch-phone').value,
      email: document.getElementById('branch-email').value
    };
    
    const { updateBranchDetails } = await import('../../database.js');
    await updateBranchDetails(branchId, updates);
    
    alert('Branch details updated successfully!');
  } catch (error) {
    console.error('Error saving branch details:', error);
    alert('Error saving details: ' + error.message);
  }
}

async function openAssignStaffModal() {
  const branchId = window.currentBranchId;
  const pharmacyId = window.currentPharmacyId;
  
  try {
    // Get all pharmacy staff
    const allStaff = await getPharmacyStaff(pharmacyId);
    
    // Get already assigned staff to this branch
    const assignedStaff = await getBranchAssignments(branchId);
    const assignedIds = new Set(assignedStaff.map(a => a.staff_id));
    
    // Filter out already assigned staff
    const availableStaff = allStaff.filter(s => !assignedIds.has(s.id));
    
    if (availableStaff.length === 0) {
      showToast('No available staff to assign to this branch', 'warning');
      return;
    }
    
    const { overlay, closeModal } = createModal({
      id: 'assign-staff-modal',
      title: 'Assign Staff to Branch',
      size: 'modal-md',
      body: `
        <form id="assign-staff-form">
          <div class="form-group">
            <label class="form-label">Select Staff Member *</label>
            <select class="form-select" id="staff-select" required>
              <option value="">-- Choose a staff member --</option>
              ${availableStaff.map(s => `
                <option value="${s.id}">
                  ${s.full_name} (${s.role})
                </option>
              `).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">Role in Branch *</label>
            <select class="form-select" id="role-select" required>
              <option value="">-- Select role --</option>
              <option value="manager">Manager</option>
              <option value="pharmacist">Pharmacist</option>
              <option value="salesman">Salesman</option>
              <option value="cashier">Cashier</option>
            </select>
          </div>
          
          <div id="assign-error" class="alert alert-danger hidden"></div>
        </form>
      `,
      footer: `
        <button class="btn btn-ghost" id="cancel-assign">Cancel</button>
        <button class="btn btn-primary" id="save-assign">Assign Staff</button>
      `
    });
    
    overlay.querySelector('#cancel-assign').addEventListener('click', closeModal);
    overlay.querySelector('#save-assign').addEventListener('click', async () => {
      const staffSelect = overlay.querySelector('#staff-select');
      const roleSelect = overlay.querySelector('#role-select');
      const errorEl = overlay.querySelector('#assign-error');
      const saveBtn = overlay.querySelector('#save-assign');
      
      errorEl.classList.add('hidden');
      
      if (!staffSelect.value || !roleSelect.value) {
        errorEl.textContent = 'Please select both staff and role';
        errorEl.classList.remove('hidden');
        return;
      }
      
      try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Assigning...';
        
        await assignStaffToBranch(
          staffSelect.value,
          branchId,
          pharmacyId,
          roleSelect.value
        );
        
        showToast('Staff assigned successfully!');
        closeModal();
        
        // Reload the staff table
        loadBranchStaff(branchId);
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Assign Staff';
      }
    });
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
}

// Make openAssignStaffModal globally accessible
window.openAssignStaffModal = openAssignStaffModal;

async function removeStaffFromBranch(assignmentId) {
  if (!confirm('Remove this staff member from the branch?')) return;
  
  try {
    const { removeStaffFromBranch: removeFn } = await import('../../database.js');
    await removeFn(assignmentId);
    showToast('Staff member removed');
    loadBranchStaff(window.currentBranchId);
  } catch (error) {
    console.error('Error removing staff:', error);
    showToast('Error: ' + error.message, 'error');
  }
}

function filterBranchSales() {
  const dateFilter = document.getElementById('sales-date-filter').value;
  alert('Filter sales by date: ' + dateFilter);
  // TODO: Implement date filter
}

// Make functions globally accessible
window.removeStaffFromBranch = removeStaffFromBranch;
window.switchBranchTab = switchBranchTab;
window.openAssignStaffModal = openAssignStaffModal;
