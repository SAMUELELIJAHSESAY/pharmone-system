import { signOut } from '../auth.js';
import { renderSidebar } from '../components/sidebar.js';
import { getPharmacySettings, getSalesmanFeatures } from '../database.js';
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
import { renderSalesmanFeatures } from './admin/salesman-features.js';
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
let activeUser = null;
let currentView = null;
let currentParams = {};
let currentSalesmanFeatures = null; // Store salesman features globally
let currentImpersonation = null;

function getActiveUser() {
  if (!currentImpersonation) return currentUser;

  const impersonatedProfile = {
    ...currentUser.profile,
    role: currentImpersonation.role || 'admin',
    pharmacy_id: currentImpersonation.pharmacyId,
    pharmacies: currentImpersonation.pharmacy
  };

  return {
    ...currentUser,
    profile: impersonatedProfile
  };
}

export function impersonatePharmacy(pharmacy) {
  if (!currentUser || currentUser.profile?.role !== 'super_admin') return;
  currentImpersonation = {
    pharmacyId: pharmacy.id,
    role: 'admin',
    pharmacy,
    profile: {
      role: 'admin',
      pharmacy_id: pharmacy.id,
      pharmacies: pharmacy
    }
  };
  localStorage.setItem('impersonation', JSON.stringify(currentImpersonation));
  activeUser = getActiveUser();
  renderApp(currentUser);
  navigate('admin-dashboard');
}

export function clearImpersonation() {
  currentImpersonation = null;
  localStorage.removeItem('impersonation');
  activeUser = currentUser;
  renderApp(currentUser);
  navigate('super-dashboard');
}

export function renderApp(user) {
  currentUser = user;
  const savedImpersonation = localStorage.getItem('impersonation');
  if (savedImpersonation && currentUser.profile?.role === 'super_admin') {
    try {
      currentImpersonation = JSON.parse(savedImpersonation);
    } catch (err) {
      currentImpersonation = null;
      localStorage.removeItem('impersonation');
    }
  } else {
    currentImpersonation = null;
  }
  activeUser = getActiveUser();
  const role = activeUser.profile?.role || 'salesman';

  // Load pharmacy settings globally for currency display on all pages
  if (activeUser.profile?.pharmacy_id) {
    getPharmacySettings(activeUser.profile.pharmacy_id)
      .then(settings => {
        window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
      })
      .catch(err => console.error('Failed to load pharmacy settings:', err));

    // Load salesman features for feature-based navigation filtering
    if (role === 'salesman') {
      getSalesmanFeatures(activeUser.profile.pharmacy_id)
        .then(features => {
          currentSalesmanFeatures = features;
          updateSidebarWithFeatures(activeUser, features);
        })
        .catch(err => {
          console.error('Failed to load salesman features:', err);
          currentSalesmanFeatures = {
            pos: true,
            customers: true,
            patients: true,
            expenses: true,
            returns_request: true,
            dashboard: true,
            sales_history: true,
            daily_records: true
          };
        });
    }
  }

  document.getElementById('app').innerHTML = `
    <div class="app-shell">
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <aside class="sidebar" id="sidebar">
        ${renderSidebar(activeUser, null)}
      </aside>
      <div class="main-content">
        <header class="topbar">
          <div style="display:flex;gap:0.5rem;align-items:center">
            <button class="mobile-toggle" id="mobile-menu-btn" aria-label="Toggle menu">☰</button>
            <button class="btn btn-ghost btn-sm desktop-sidebar-toggle" id="desktop-sidebar-toggle" aria-label="Toggle sidebar" style="display:none;font-size:1.2rem">☰</button>
          </div>
          <span class="topbar-title" id="topbar-title">Dashboard</span>
          <div class="topbar-actions">
            <div class="topbar-search">
              <span style="color:var(--gray-400);font-size:0.9rem">🔍</span>
              <input type="text" id="global-search" placeholder="Search..." />
            </div>
            ${createThemeToggle()}
            <span id="impersonation-note" class="topbar-impersonation-note" style="display:none;align-self:center;font-size:0.9rem;color:var(--gray-700);"></span>
            <button class="btn btn-warning btn-sm" id="exit-impersonation-btn" style="display:none;">Exit Pharmacy View</button>
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

  const impersonationNote = document.getElementById('impersonation-note');
  const exitImpersonationBtn = document.getElementById('exit-impersonation-btn');
  if (currentImpersonation && impersonationNote && exitImpersonationBtn) {
    impersonationNote.textContent = `Viewing as ${currentImpersonation.role.replace('_', ' ')} for ${currentImpersonation.pharmacy?.name || 'selected pharmacy'}`;
    impersonationNote.style.display = 'inline-flex';
    exitImpersonationBtn.style.display = 'inline-flex';
    exitImpersonationBtn.addEventListener('click', () => {
      clearImpersonation();
    });
  } else if (impersonationNote && exitImpersonationBtn) {
    impersonationNote.style.display = 'none';
    exitImpersonationBtn.style.display = 'none';
  }

  document.getElementById('profile-btn').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await showProfileModal(currentUser);
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
        handleGlobalSearch(query, activeUser);
      }
    });
  }

  const defaultView = role === 'super_admin' ? 'super-dashboard'
    : role === 'admin' ? 'admin-dashboard'
    : role === 'inventory_manager' ? 'inventory'
    : 'salesman-dashboard';

  // Try to restore last visited view from localStorage
  const savedView = localStorage.getItem('currentView');
  const savedParams = localStorage.getItem('currentParams');
  let viewToLoad = savedView || defaultView;
  if (role === 'inventory_manager' && !['inventory', 'branches', 'branch-details'].includes(viewToLoad)) {
    viewToLoad = defaultView;
  }
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

/**
 * Update sidebar with feature-filtered navigation for salesman
 * Called after features are loaded from database
 */
function updateSidebarWithFeatures(user, features) {
  const sidebarNav = document.querySelector('.sidebar-nav');
  if (sidebarNav && user) {
    sidebarNav.innerHTML = renderSidebar(user, features).match(/<nav class="sidebar-nav">([\s\S]*?)<\/nav>/)?.[1] || '';
    // Re-attach click handlers to new nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        if (view) navigate(view);
        document.getElementById('sidebar').classList.remove('open');
      });
    });
  }
}

/**
 * Check if a salesman feature is enabled
 * Used to prevent navigation to restricted views
 */
export function isSalesmanFeatureEnabled(featureName) {
  if (!currentSalesmanFeatures) return true; // Default to enabled if not loaded yet
  return currentSalesmanFeatures[featureName] !== false;
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

  const activeRole = activeUser.profile?.role;

  // Check if salesman is trying to access a disabled feature
  if (activeRole === 'salesman') {
    const featureMapping = {
      'salesman-dashboard': 'dashboard',
      'sales-history': 'sales_history',
      'daily-reports': 'daily_records',
      'pos': 'pos',
      'customers': 'customers',
      'patients': 'patients',
      'expenses': 'expenses',
      'returns-request': 'returns_request'
    };
    
    const requiredFeature = featureMapping[view];
    if (requiredFeature && !isSalesmanFeatureEnabled(requiredFeature)) {
      content.innerHTML = `
        <div class="animate-in">
          <div style="padding: 2rem; text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem">🔒</div>
            <div style="font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem">Access Denied</div>
            <div style="color: var(--gray-600); margin-bottom: 2rem">This feature is not available for your account. Please contact your administrator.</div>
            <button class="btn btn-primary" onclick="(async () => {
              const { navigate } = await import('./app.js');
              navigate('pos');
            })()">Go to Point of Sale</button>
          </div>
        </div>
      `;
      if (titleEl) titleEl.textContent = 'Access Denied';
      return;
    }
  }

  if (activeRole === 'inventory_manager') {
    const allowedViews = new Set(['inventory', 'branches', 'branch-details']);
    if (!allowedViews.has(view)) {
      content.innerHTML = `
        <div class="animate-in">
          <div style="padding: 2rem; text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem">🔒</div>
            <div style="font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem">Access Denied</div>
            <div style="color: var(--gray-600); margin-bottom: 2rem">You only have access to Inventory and Branches. Please contact your administrator for additional access.</div>
            <button class="btn btn-primary" onclick="(async () => {
              const { navigate } = await import('./app.js');
              navigate('inventory');
            })()">Go to Inventory</button>
          </div>
        </div>
      `;
      if (titleEl) titleEl.textContent = 'Access Denied';
      return;
    }
  }

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
    'salesman-features': 'Salesman Features',
  };

  if (titleEl) titleEl.textContent = titles[view] || 'Dashboard';

  switch (view) {
    case 'super-dashboard': renderSuperAdminDashboard(content, activeUser); break;
    case 'pharmacies': renderPharmacies(content, activeUser); break;
    case 'all-users': renderAllUsers(content, activeUser); break;
    case 'settings': renderSettings(content, activeUser); break;
    case 'admin-dashboard': renderAdminDashboard(content, activeUser); break;
    case 'inventory': renderInventory(content, activeUser, currentParams.filterType); break;
    case 'sales': renderSales(content, activeUser); break;
    case 'customers': renderCustomers(content, activeUser); break;
    case 'patients': renderPatientManagementView(content, activeUser); break;
    case 'expenses': renderExpenseManagement(content, activeUser); break;
    case 'stock-transfers': renderStockTransfers(content, activeUser); break;
    case 'suppliers': renderSuppliers(content, activeUser); break;
    case 'purchases': renderPurchases(content, activeUser); break;
    case 'returns': renderReturns(content, activeUser); break;
    case 'returns-management': renderAdminReturnsManagement(content, activeUser); break;
    case 'alerts': renderAlerts(content, activeUser); break;
    case 'reports': renderReports(content, activeUser); break;
    case 'sales-reports': renderAdminSalesReports(content, activeUser); break;
    case 'daily-reports': renderDailyReports(content, activeUser); break;
    case 'staff': renderStaff(content, activeUser); break;
    case 'branches': renderBranches(content, activeUser); break;
    case 'branch-details': 
      if (params.branchId && params.pharmacyId) {
        renderBranchDetailsView(params.branchId, params.pharmacyId);
      }
      break;
    case 'salesman-dashboard': renderSalesmanDashboard(content, activeUser); break;
    case 'pos': renderPOS(content, activeUser); break;
    case 'sales-history': renderSalesHistory(content, activeUser); break;
    case 'returns-request': renderSalesmanReturnsRequest(content, activeUser); break;
    case 'salesman-features': renderSalesmanFeatures(content, activeUser); break;
    default: content.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-title">Page not found</div></div>';
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
            <div class="empty-state-icon">🔍</div>
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