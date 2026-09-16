// Branch Details Dashboard
import { supabase } from '../../config.js';
import { getBranchDetails, getBranchDashboard, getBranchAssignments, getBranchStaffSalesStats, getSalesForReport, updateBranchDetails, getPharmacyStaff, assignStaffToBranch } from '../../database.js';
import { createModal } from '../../components/modal.js';
import { showToast, formatCurrency, formatUTCDate, formatUTCDateTime } from '../../utils.js';
import { isViewLifecycleActive } from '../../view-lifecycle.js';

let currentBranchSales = [];
let currentBranchInventory = [];

export function renderBranchDetailsView(branchId, pharmacyId, lifecycleToken) {
  const mainContent = document.getElementById('page-content');
  currentBranchSales = [];
  currentBranchInventory = [];
  
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
                <th>Daily Sales</th>
                <th>Total Sales</th>
                <th>Transactions</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="staff-table">
              <tr><td colspan="6">Loading...</td></tr>
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
  
  // The elements exist immediately after innerHTML assignment, so listeners can be
  // attached synchronously without leaving an orphan timeout behind.
  const backBtn = document.getElementById('back-to-branches-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => window.navigate('branches'));
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchBranchTab(btn.dataset.tab));
  });

  const inventorySearch = document.getElementById('inventory-search');
  const stockFilter = document.getElementById('stock-filter');
  inventorySearch?.addEventListener('input', filterBranchInventory);
  stockFilter?.addEventListener('change', filterBranchInventory);

  const salesDateFilter = document.getElementById('sales-date-filter');
  const filterBtn = document.getElementById('filter-sales-btn');
  if (filterBtn) filterBtn.addEventListener('click', filterBranchSales);
  salesDateFilter?.addEventListener('change', filterBranchSales);

  // Load branch data. Async completion is guarded by the current view token.
  loadBranchData(branchId, pharmacyId, lifecycleToken);
}

async function loadBranchData(branchId, pharmacyId, lifecycleToken) {
  try {
    const [branch, dashboard] = await Promise.all([
      getBranchDetails(branchId),
      getBranchDashboard(branchId, pharmacyId)
    ]);

    if (!isViewLifecycleActive(lifecycleToken)) return;

    document.getElementById('branch-name').textContent = branch.name;
    document.title = `${branch.name} | Branch Details | SamMia Pharm`;
    document.getElementById('branch-name-input').value = branch.name;
    document.getElementById('branch-location').value = branch.address || '';
    document.getElementById('branch-contact-person').value = branch.contact_person || '';
    document.getElementById('branch-phone').value = branch.phone || '';
    document.getElementById('branch-email').value = branch.email || '';

    const currencySymbol = window.pharmacySettings?.currency_symbol || 'Le';
    document.getElementById('daily-sales').textContent = `${currencySymbol}${dashboard.dailySales.toFixed(2)}`;
    document.getElementById('monthly-revenue').textContent = `${currencySymbol}${dashboard.monthlyRevenue.toFixed(2)}`;
    document.getElementById('low-stock-count').textContent = dashboard.lowStockCount;
    document.getElementById('alert-count').textContent = dashboard.alertCount;
    
    // Load tab data once. Branch staff totals are now aggregated server-side, so
    // there is no background polling that keeps downloading historical sales.
    await Promise.all([
      loadBranchInventory(branchId),
      loadBranchSales(branchId),
      loadBranchStaff(branchId, pharmacyId),
      loadRecentActivity(branchId)
    ]);
    
  } catch (error) {
    if (!isViewLifecycleActive(lifecycleToken)) return;
    console.error('Error loading branch data:', error);
    alert('Error loading branch details: ' + error.message);
  }
}

async function loadBranchInventory(branchId) {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, stock_boxes, stock_units, low_stock_threshold, expiry_date')
      .eq('branch_id', branchId)
      .eq('is_active', true);

    if (error) throw error;

    currentBranchInventory = data || [];
    displayBranchInventory(currentBranchInventory);
  } catch (error) {
    console.error('Error loading inventory:', error);
    const tbody = document.getElementById('inventory-table');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5">Unable to load branch inventory</td></tr>';
  }
}

function displayBranchInventory(products) {
  const tbody = document.getElementById('inventory-table');
  if (!tbody) return;

  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="5">No matching products in this branch</td></tr>';
    return;
  }

  tbody.innerHTML = products.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.stock_boxes ?? 0}</td>
      <td>${p.stock_units ?? 0}</td>
      <td>${(p.stock_boxes ?? 0) <= (p.low_stock_threshold ?? 0) ? '⚠️ Yes' : '✓ No'}</td>
      <td>${p.expiry_date || 'N/A'}</td>
    </tr>
  `).join('');
}

function filterBranchInventory() {
  const query = (document.getElementById('inventory-search')?.value || '').trim().toLowerCase();
  const stockFilter = document.getElementById('stock-filter')?.value || '';

  const filtered = currentBranchInventory.filter((product) => {
    const nameMatches = !query || String(product.name || '').toLowerCase().includes(query);
    const boxes = Number(product.stock_boxes || 0);
    const units = Number(product.stock_units || 0);
    const threshold = Number(product.low_stock_threshold || 0);
    const stockMatches = stockFilter === 'low'
      ? boxes <= threshold
      : stockFilter === 'out'
        ? boxes <= 0 && units <= 0
        : true;
    return nameMatches && stockMatches;
  });

  displayBranchInventory(filtered);
}

async function loadBranchSales(branchId) {
  try {
    const { data, error } = await supabase
      .from('sales')
      .select('id, invoice_number, total_amount, payment_method, created_by, created_at')
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    currentBranchSales = data || [];
    displayBranchSales(currentBranchSales);
  } catch (error) {
    console.error('Error loading sales:', error);
    const tbody = document.getElementById('sales-table');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6">Unable to load branch sales</td></tr>';
  }
}

function displayBranchSales(sales) {
  const tbody = document.getElementById('sales-table');
  if (!tbody) return;

  if (!sales.length) {
    tbody.innerHTML = '<tr><td colspan="6">No sales match this filter</td></tr>';
    return;
  }

  const currencySymbol = window.pharmacySettings?.currency_symbol || 'Le';
  tbody.innerHTML = sales.map(s => `
    <tr>
      <td>${s.invoice_number}</td>
      <td>Customer</td>
      <td>${currencySymbol}${Number(s.total_amount || 0).toFixed(2)}</td>
      <td>${String(s.payment_method || '-').replace('_', ' ')}</td>
      <td>Staff</td>
      <td>${formatUTCDate(s.created_at)}</td>
    </tr>
  `).join('');
}

async function loadBranchStaff(branchId, pharmacyId = window.currentPharmacyId) {
  try {
    const [assignments, staffStats] = await Promise.all([
      getBranchAssignments(branchId),
      getBranchStaffSalesStats(pharmacyId, branchId)
    ]);

    const tbody = document.getElementById('staff-table');
    if (!tbody) return;

    if (assignments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No staff assigned to this branch</td></tr>';
      return;
    }

    const staffSalesMap = new Map(staffStats.map(stat => [stat.staffId, stat]));
    const currencySymbol = window.pharmacySettings?.currency_symbol || 'Le';

    tbody.innerHTML = assignments.map(a => {
      const salesData = staffSalesMap.get(a.staff_id) || {
        dailyTotal: 0,
        dailyCount: 0,
        total: 0,
        count: 0
      };

      return `
      <tr>
        <td>${a.profiles.full_name}</td>
        <td>${a.role_in_branch}</td>
        <td>${currencySymbol}${salesData.dailyTotal.toFixed(2)}</td>
        <td>${currencySymbol}${salesData.total.toFixed(2)}</td>
        <td>${salesData.count}</td>
        <td>
          <div class="branch-staff-actions">
            <button
              type="button"
              class="btn btn-small btn-secondary staff-sales-history-btn"
              data-staff-id="${a.staff_id}"
              data-staff-name="${encodeURIComponent(a.profiles.full_name || 'Staff')}"
            >Sales History</button>
            <button class="btn btn-small btn-danger" onclick="removeStaffFromBranch('${a.id}')">Remove</button>
          </div>
        </td>
      </tr>
    `;
    }).join('');

    tbody.querySelectorAll('.staff-sales-history-btn').forEach(button => {
      button.addEventListener('click', () => {
        const staffId = button.dataset.staffId;
        const staffName = decodeURIComponent(button.dataset.staffName || 'Staff');
        showStaffSalesHistoryModal(staffId, staffName, branchId, pharmacyId);
      });
    });
  } catch (error) {
    console.error('Error loading staff:', error);
  }
}

function getStaffHistoryRange(period, customStart = '', customEnd = '') {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (period === 'last-7') {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 6);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  if (period === 'last-30') {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 29);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  if (period === 'this-year') {
    return {
      start: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)),
      end: new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1))
    };
  }

  if (period === 'custom') {
    const [sy, sm, sd] = String(customStart || '').split('-').map(Number);
    const [ey, em, ed] = String(customEnd || '').split('-').map(Number);
    if (!sy || !sm || !sd || !ey || !em || !ed) throw new Error('Choose both custom dates.');
    const start = new Date(Date.UTC(sy, sm - 1, sd));
    const end = new Date(Date.UTC(ey, em - 1, ed + 1));
    if (end <= start) throw new Error('End date must be on or after the start date.');
    return { start, end };
  }

  return {
    start: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    end: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))
  };
}

function groupStaffSalesByDay(sales) {
  const byDay = new Map();
  for (const sale of sales || []) {
    const key = new Date(sale.created_at).toISOString().slice(0, 10);
    const current = byDay.get(key) || { date: key, transactions: 0, total: 0 };
    current.transactions += 1;
    current.total += Number(sale.total_amount || 0);
    byDay.set(key, current);
  }
  return [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function formatStaffSalesDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

async function showStaffSalesHistoryModal(staffId, staffName, branchId, pharmacyId) {
  const today = new Date().toISOString().slice(0, 10);
  const { overlay } = createModal({
    id: 'staff-sales-history',
    title: `${staffName} · Daily Sales`,
    size: 'modal-xl',
    body: `
      <div class="staff-sales-history-controls">
        <div class="form-group" style="margin:0">
          <label class="form-label">Period</label>
          <select id="staff-sales-period" class="form-control">
            <option value="this-month">This Month</option>
            <option value="last-7">Last 7 Days</option>
            <option value="last-30">Last 30 Days</option>
            <option value="this-year">This Year</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>
        <div class="form-group staff-sales-custom-date" style="margin:0;display:none">
          <label class="form-label">Start Date</label>
          <input type="date" id="staff-sales-start" class="form-control" value="${today}">
        </div>
        <div class="form-group staff-sales-custom-date" style="margin:0;display:none">
          <label class="form-label">End Date</label>
          <input type="date" id="staff-sales-end" class="form-control" value="${today}">
        </div>
        <div class="form-group" style="margin:0;display:flex;align-items:flex-end">
          <button type="button" class="btn btn-primary" id="load-staff-sales-history">Load</button>
        </div>
      </div>

      <div id="staff-sales-history-content" class="staff-sales-history-content">
        <div style="padding:2rem;text-align:center;color:var(--gray-500)">Loading sales history...</div>
      </div>
    `,
    footer: `
      <button type="button" class="btn btn-secondary" id="export-staff-sales-history">Export CSV</button>
    `
  });

  const periodSelect = overlay.querySelector('#staff-sales-period');
  const customFields = overlay.querySelectorAll('.staff-sales-custom-date');
  const loadButton = overlay.querySelector('#load-staff-sales-history');
  const exportButton = overlay.querySelector('#export-staff-sales-history');
  let currentRows = [];

  const toggleCustomFields = () => {
    const isCustom = periodSelect.value === 'custom';
    customFields.forEach(field => { field.style.display = isCustom ? '' : 'none'; });
  };

  const loadHistory = async () => {
    const content = overlay.querySelector('#staff-sales-history-content');
    loadButton.disabled = true;
    loadButton.textContent = 'Loading...';
    content.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--gray-500)">Loading sales history...</div>';

    try {
      const { start, end } = getStaffHistoryRange(
        periodSelect.value,
        overlay.querySelector('#staff-sales-start')?.value,
        overlay.querySelector('#staff-sales-end')?.value
      );
      const sales = await getSalesForReport(pharmacyId, {
        branchId,
        staffId,
        start: start.toISOString(),
        end: end.toISOString()
      });
      currentRows = groupStaffSalesByDay(sales);
      const totalSales = currentRows.reduce((sum, row) => sum + row.total, 0);
      const totalTransactions = currentRows.reduce((sum, row) => sum + row.transactions, 0);
      const averagePerSalesDay = currentRows.length ? totalSales / currentRows.length : 0;

      content.innerHTML = `
        <div class="staff-report-summary-grid staff-history-summary">
          <div class="staff-report-summary-card">
            <span>Total Sales</span>
            <strong>${formatCurrency(totalSales)}</strong>
          </div>
          <div class="staff-report-summary-card">
            <span>Transactions</span>
            <strong>${totalTransactions}</strong>
          </div>
          <div class="staff-report-summary-card">
            <span>Sales Days</span>
            <strong>${currentRows.length}</strong>
          </div>
          <div class="staff-report-summary-card">
            <span>Average / Sales Day</span>
            <strong>${formatCurrency(averagePerSalesDay)}</strong>
          </div>
        </div>

        <div class="table-responsive staff-sales-daily-table">
          <table class="data-table responsive-data-table">
            <thead>
              <tr><th>Date</th><th>Transactions</th><th>Total Sales</th></tr>
            </thead>
            <tbody>
              ${currentRows.length ? currentRows.map(row => `
                <tr>
                  <td>${formatStaffSalesDate(row.date)}</td>
                  <td>${row.transactions}</td>
                  <td><strong>${formatCurrency(row.total)}</strong></td>
                </tr>
              `).join('') : '<tr><td colspan="3" style="text-align:center">No sales found for this period.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    } catch (error) {
      console.error('Failed to load staff sales history:', error);
      content.innerHTML = `<div class="alert alert-danger">${error.message || 'Failed to load employee sales history.'}</div>`;
    } finally {
      loadButton.disabled = false;
      loadButton.textContent = 'Load';
    }
  };

  periodSelect.addEventListener('change', toggleCustomFields);
  loadButton.addEventListener('click', loadHistory);
  exportButton.addEventListener('click', () => {
    if (!currentRows.length) {
      showToast('No employee sales data to export', 'warning');
      return;
    }
    const rows = [
      [`Employee Sales History - ${staffName}`],
      ['Date', 'Transactions', 'Total Sales'],
      ...currentRows.map(row => [row.date, row.transactions, row.total.toFixed(2)])
    ];
    const csv = rows.map(row => row.map(cell => {
      const value = String(cell ?? '').replaceAll('"', '""');
      return /[",\n]/.test(value) ? `"${value}"` : value;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${staffName.replace(/[^a-z0-9]+/gi, '_')}_daily_sales.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });

  toggleCustomFields();
  loadHistory();
}

async function loadRecentActivity(branchId) {
  try {
    const { data, error } = await supabase
      .from('sales')
      .select('id, total_amount, created_at')
      .eq('branch_id', branchId)
      .eq('status', 'completed')
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
        loadBranchStaff(branchId, pharmacyId);
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

// Make inline form/action handlers globally accessible
window.saveBranchDetails = saveBranchDetails;
window.openAssignStaffModal = openAssignStaffModal;

async function removeStaffFromBranch(assignmentId) {
  if (!confirm('Remove this staff member from the branch?')) return;
  
  try {
    const { removeStaffFromBranch: removeFn } = await import('../../database.js');
    await removeFn(assignmentId);
    showToast('Staff member removed');
    loadBranchStaff(window.currentBranchId, window.currentPharmacyId);
  } catch (error) {
    console.error('Error removing staff:', error);
    showToast('Error: ' + error.message, 'error');
  }
}

function filterBranchSales() {
  const dateFilter = document.getElementById('sales-date-filter')?.value || '';
  const filtered = dateFilter
    ? currentBranchSales.filter((sale) => String(sale.created_at || '').slice(0, 10) === dateFilter)
    : currentBranchSales;
  displayBranchSales(filtered);
}

// Make functions globally accessible
window.removeStaffFromBranch = removeStaffFromBranch;
window.switchBranchTab = switchBranchTab;
window.openAssignStaffModal = openAssignStaffModal;
