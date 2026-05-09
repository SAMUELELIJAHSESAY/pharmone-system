import { signOut } from '../auth.js';
import { renderSidebar } from '../components/sidebar.js';
import { getPharmacySettings } from '../database.js';
import { createThemeToggle, initThemeToggle } from '../components/theme-toggle.js';
import { renderSuperAdminDashboard } from './super-admin/dashboard.js';
import { renderAdminDashboard } from './admin/dashboard.js';
import { renderInventory } from './admin/inventory.js';
import { renderSales } from './admin/sales.js';
import { renderCustomers } from './admin/customers.js';
import { renderReports } from './admin/reports.js';
import { renderAdminSalesReports } from './admin/sales-reports.js';
import { renderDailyReports } from './admin/daily-reports.js';
import { renderStaff } from './admin/staff.js';
import { renderBranches } from './admin/branches.js';
import { renderBranchDetailsView } from './admin/branch-details.js';
import { renderSuppliers } from './admin/suppliers.js';
import { renderPurchases } from './admin/purchases.js';
import { renderReturns } from './admin/returns.js';
import { renderAdminReturnsManagement } from './admin/returns-management.js';
import { renderAlerts } from './admin/alerts.js';
import { renderPatientManagementView } from './admin/patients.js';
import { renderExpenseManagement } from './admin/expenses.js';
import { renderStockTransfers } from './admin/stock-transfers.js';
import { renderSalesmanDashboard } from './salesman/dashboard.js';
import { renderPOS } from './salesman/pos.js';
import { renderSalesHistory } from './salesman/sales-history.js';
import { renderSalesmanReturnsRequest } from './salesman/returns-request.js';
import { renderPharmacies } from './super-admin/pharmacies.js';
import { renderAllUsers } from './super-admin/users.js';
import { renderSettings } from './super-admin/settings.js';
import { showToast } from '../utils.js';
import { showProfileModal } from '../components/profile.js';

let currentUser = null;
let currentView = null;
let currentParams = {};

export function renderApp(user) {
  currentUser = user;
  const role = user.profile?.role || 'salesman';

  // Load pharmacy settings globally for currency display on all pages
  if (user.profile?.pharmacy_id) {
    getPharmacySettings(user.profile.pharmacy_id)
      .then(settings => {
        window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
      })
      .catch(err => console.error('Failed to load pharmacy settings:', err));
  }

  document.getElementById('app').innerHTML = `
    <div class="app-shell">
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <aside class="sidebar" id="sidebar">
        ${renderSidebar(user)}
      </aside>
      <div class="main-content">
        <header class="topbar">
          <div style="display:flex;gap:0.5rem;align-items:center">
            <button class="mobile-toggle" id="mobile-menu-btn" aria-label="Toggle menu">&#9776;</button>
            <button class="btn btn-ghost btn-sm desktop-sidebar-toggle" id="desktop-sidebar-toggle" aria-label="Toggle sidebar" style="display:none;font-size:1.2rem">☰</button>
          </div>
          <span class="topbar-title" id="topbar-title">Dashboard</span>
          <div class="topbar-actions">
            <div class="topbar-search">
              <span style="color:var(--gray-400);font-size:0.9rem">&#128269;</span>
              <input type="text" id="global-search" placeholder="Search..." />
            </div>
            ${createThemeToggle()}
            <button class="btn btn-ghost btn-sm" id="profile-btn" style="display:inline-flex;align-items:center;gap:0.5rem;cursor:pointer;padding:0.5rem 0.75rem">
              <span>👤</span>
              <span>My Account</span>
            </button>
            <button class="btn btn-ghost btn-sm" id="signout-btn">Sign out</button>
          </div>
        </header>
        <main class="page-content" id="page-content">
          <div class="loading-spinner"></div>
        </main>
      </div>
    </div>
  `;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut();
  });

  document.getElementById('profile-btn').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Profile button clicked, currentUser:', currentUser);
    try {
      await showProfileModal(currentUser);
      console.log('Profile modal shown');
    } catch (err) {
      console.error('Error showing profile modal:', err);
    }
  });

  // Initialize theme toggle
  initThemeToggle();

  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Desktop sidebar collapse toggle
  const desktopToggle = document.getElementById('desktop-sidebar-toggle');
  if (desktopToggle) {
    desktopToggle.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
    });
    
    // Restore sidebar state
    if (localStorage.getItem('sidebar-collapsed') === 'true') {
      document.getElementById('sidebar').classList.add('collapsed');
    }
    
    // Show desktop toggle on larger screens
    desktopToggle.style.display = 'block';
  }

  document.getElementById('sidebar-backdrop').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
  });

  // Global search functionality
  const globalSearchEl = document.getElementById('global-search');
  if (globalSearchEl) {
    globalSearchEl.addEventListener('keyup', (e) => {
      const query = e.target.value.toLowerCase().trim();
      if (e.key === 'Enter' && query) {
        handleGlobalSearch(query, currentUser);
      }
    });
  }

  const defaultView = role === 'super_admin' ? 'super-dashboard'
    : role === 'admin' ? 'admin-dashboard'
    : 'salesman-dashboard';

  // Try to restore last visited view from localStorage
  const savedView = localStorage.getItem('currentView');
  const savedParams = localStorage.getItem('currentParams');
  const viewToLoad = savedView || defaultView;
  const paramsToLoad = savedParams ? JSON.parse(savedParams) : {};

  navigate(viewToLoad, paramsToLoad);

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (view) navigate(view);
      document.getElementById('sidebar').classList.remove('open');
    });
  });
}

export function navigate(view, params = {}) {
  currentView = view;
  currentParams = params;

  // Save current view to localStorage for persistence on refresh
  localStorage.setItem('currentView', view);
  localStorage.setItem('currentParams', JSON.stringify(params));

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  const content = document.getElementById('page-content');
  const titleEl = document.getElementById('topbar-title');
  if (!content) return;

  content.innerHTML = '<div class="loading-spinner"></div>';

  const titles = {
    'super-dashboard': 'Overview',
    'pharmacies': 'Pharmacies',
    'all-users': 'All Users',
    'settings': 'Settings',
    'admin-dashboard': 'Dashboard',
    'inventory': 'Inventory',
    'sales': 'Sales',
    'customers': 'Customers',
    'patients': 'Patients',
    'expenses': 'Expenses',
    'stock-transfers': 'Stock Transfers',
    'suppliers': 'Suppliers',
    'purchases': 'Purchase Orders',
    'returns': 'Sales Returns',
    'returns-management': 'Return Requests',
    'alerts': 'Alerts & Notifications',
    'reports': 'Reports',
    'sales-reports': 'Sales Reports',
    'staff': 'Staff',
    'branches': 'Branches',
    'branch-details': 'Branch Details',
    'salesman-dashboard': 'Dashboard',
    'pos': 'Point of Sale',
    'sales-history': 'My Sales History',
    'returns-request': 'Return Requests',
  };

  if (titleEl) titleEl.textContent = titles[view] || 'Dashboard';

  switch (view) {
    case 'super-dashboard': renderSuperAdminDashboard(content, currentUser); break;
    case 'pharmacies': renderPharmacies(content, currentUser); break;
    case 'all-users': renderAllUsers(content, currentUser); break;
    case 'settings': renderSettings(content, currentUser); break;
    case 'admin-dashboard': renderAdminDashboard(content, currentUser); break;
    case 'inventory': renderInventory(content, currentUser, currentParams.filterType); break;
    case 'sales': renderSales(content, currentUser); break;
    case 'customers': renderCustomers(content, currentUser); break;
    case 'patients': renderPatientManagementView(content, currentUser); break;
    case 'expenses': renderExpenseManagement(content, currentUser); break;
    case 'stock-transfers': renderStockTransfers(content, currentUser); break;
    case 'suppliers': renderSuppliers(content, currentUser); break;
    case 'purchases': renderPurchases(content, currentUser); break;
    case 'returns': renderReturns(content, currentUser); break;
    case 'returns-management': renderAdminReturnsManagement(content, currentUser); break;
    case 'alerts': renderAlerts(content, currentUser); break;
    case 'reports': renderReports(content, currentUser); break;
    case 'sales-reports': renderAdminSalesReports(content, currentUser); break;
    case 'daily-reports': renderDailyReports(content, currentUser); break;
    case 'staff': renderStaff(content, currentUser); break;
    case 'branches': renderBranches(content, currentUser); break;
    case 'branch-details': 
      if (params.branchId && params.pharmacyId) {
        renderBranchDetailsView(params.branchId, params.pharmacyId);
      }
      break;
    case 'salesman-dashboard': renderSalesmanDashboard(content, currentUser); break;
    case 'pos': renderPOS(content, currentUser); break;
    case 'sales-history': renderSalesHistory(content, currentUser); break;
    case 'returns-request': renderSalesmanReturnsRequest(content, currentUser); break;
    default: content.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128269;</div><div class="empty-state-title">Page not found</div></div>';
  }
}

function handleGlobalSearch(query, user) {
  const role = user?.profile?.role || 'salesman';
  const content = document.getElementById('page-content');
  if (!content) return;

  const allSearchableContent = `
    <div class="animate-in">
      <div class="page-header">
        <div>
          <div class="page-title">Search Results</div>
          <div class="page-subtitle">Results for: "${query}"</div>
        </div>
      </div>
      <div class="card">
        <div class="card-body">
          <div class="empty-state">
            <div class="empty-state-icon">&#128269;</div>
            <div class="empty-state-title">Search functionality</div>
            <div class="empty-state-desc">Use the navigation menu to browse specific sections. Search is available within each module.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  content.innerHTML = allSearchableContent;
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = 'Search Results';
  
  document.getElementById('global-search').value = '';
}

// Make navigate globally accessible for use in onclick handlers and dynamic imports
window.navigate = navigate;

export { currentUser };
