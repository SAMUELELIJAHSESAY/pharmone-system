import { signOut } from '../auth.js';
import { renderSidebar } from '../components/sidebar.js';
import { getPharmacySettings, getSalesmanFeatures, searchAdminWorkspace } from '../database.js';
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
import { showToast, formatCurrency } from '../utils.js';
import { showProfileModal } from '../components/profile.js';
import { beginViewLifecycle, cleanupActiveView } from '../view-lifecycle.js';
import { applyPharmacyBranding, resetPharmacyBranding } from '../branding.js';
import { renderBranding } from './admin/branding.js';

let currentUser = null;
let activeUser = null;
let currentView = null;
let currentParams = {};
let currentSalesmanFeatures = null; // Store salesman features globally
const DEFAULT_MODULE_FEATURES = {
  inventory: true, sales: true, customers: true, patients: true, suppliers: true, purchases: true,
  returns: true, alerts: true, stock_transfers: true, staff: true, branches: true, expenses: true,
  reports: true, sales_reports: true, daily_records: true
};
let currentModuleFeatures = { ...DEFAULT_MODULE_FEATURES };
let currentImpersonation = null;
let globalSearchDocumentController = new AbortController();

const PAGE_TITLES = {
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
  'daily-reports': 'Daily Records',
  'staff': 'Staff Management',
  'branches': 'Branches',
  'branch-details': 'Branch Details',
  'salesman-dashboard': 'Dashboard',
  'pos': 'Point of Sale',
  'sales-history': 'My Sales History',
  'returns-request': 'Return Requests',
  'salesman-features': 'Salesman Features',
  'branding': 'Branding'
};

function applyPageTitle(view, overrideTitle = '') {
  const title = overrideTitle || PAGE_TITLES[view] || 'Page Not Found';
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = title;
  document.title = `${title} | SamMia Pharm`;
  return title;
}

function setMobileSidebarOpen(isOpen) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const menuButton = document.getElementById('mobile-menu-btn');
  const shouldOpen = Boolean(isOpen) && window.matchMedia('(max-width: 768px)').matches;

  sidebar?.classList.toggle('open', shouldOpen);
  backdrop?.classList.toggle('show', shouldOpen);
  document.body.classList.toggle('mobile-nav-open', shouldOpen);
  menuButton?.setAttribute('aria-expanded', String(shouldOpen));
  menuButton?.setAttribute('aria-label', shouldOpen ? 'Close navigation menu' : 'Open navigation menu');

  if (shouldOpen) {
    requestAnimationFrame(() => document.getElementById('sidebar-mobile-close')?.focus());
  }
}

function closeMobileSidebar({ restoreFocus = false } = {}) {
  const wasOpen = document.getElementById('sidebar')?.classList.contains('open');
  setMobileSidebarOpen(false);
  if (restoreFocus && wasOpen) document.getElementById('mobile-menu-btn')?.focus();
}

function enhanceResponsiveContent(root = document) {
  const scope = root?.querySelectorAll ? root : document;
  const rootElement = scope instanceof Element ? scope : null;

  // Turn every data table into a responsive table. Desktop keeps normal columns;
  // mobile uses labelled cards so the page never needs horizontal scrolling.
  const tableSet = new Set([
    ...(rootElement?.matches('table') ? [rootElement] : []),
    ...(rootElement?.closest('table') ? [rootElement.closest('table')] : []),
    ...scope.querySelectorAll('table')
  ].filter(Boolean));

  tableSet.forEach((table) => {
    table.classList.add('responsive-data-table');

    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((row) => {
      const cells = [...row.children].filter((cell) => cell.tagName === 'TD');
      cells.forEach((cell, index) => {
        if (cell.hasAttribute('colspan')) {
          cell.dataset.label = '';
          cell.classList.add('responsive-table-full-row');
          return;
        }
        const label = headers[index] || '';
        if (label) cell.dataset.label = label;
      });
    });

    if (!table.closest('.table-container')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'table-container auto-table-container';
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
  });

  // Normalize common inline layouts used throughout legacy views so mobile CSS can override them.
  const styledElements = [
    ...(rootElement?.matches('[style]') ? [rootElement] : []),
    ...scope.querySelectorAll('[style]')
  ];
  styledElements.forEach((element) => {
    const style = element.getAttribute('style') || '';
    if (/grid-template-columns\s*:/i.test(style)) element.classList.add('responsive-inline-grid');
    if (/display\s*:\s*flex/i.test(style) && /justify-content\s*:\s*(space-between|flex-end|center)/i.test(style)) {
      element.classList.add('responsive-flex-row');
    }
    if (/min-width\s*:/i.test(style)) element.classList.add('mobile-min-width-reset');
    if (/width\s*:\s*\d+(?:\.\d+)?(?:px|rem|em)/i.test(style)) element.classList.add('mobile-fixed-width-reset');
  });
}

let responsiveEnhancementObserver = null;
function initResponsiveEnhancements() {
  enhanceResponsiveContent(document);
  if (responsiveEnhancementObserver) return;

  responsiveEnhancementObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        enhanceResponsiveContent(node);
      });
    });
  });

  responsiveEnhancementObserver.observe(document.body, { childList: true, subtree: true });
}

// Global mobile-navigation safety. The module is evaluated once, so these listeners cannot stack.
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    const searchInput = document.getElementById('global-search');
    if (searchInput && searchInput.offsetParent !== null) {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  }

  if (event.key === 'Escape' && document.getElementById('sidebar')?.classList.contains('open')) {
    closeMobileSidebar({ restoreFocus: true });
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 768) closeMobileSidebar();
});

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
  globalSearchDocumentController.abort();
  globalSearchDocumentController = new AbortController();
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

  // Load pharmacy settings globally for currency, tenant branding and module availability.
  // Reset first so switching/impersonating pharmacies never leaks the previous tenant color/logo.
  currentModuleFeatures = { ...DEFAULT_MODULE_FEATURES };
  window.pharmacySettings = null;
  resetPharmacyBranding();
  if (activeUser.profile?.pharmacy_id) {
    getPharmacySettings(activeUser.profile.pharmacy_id)
      .then(settings => {
        window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
        applyPharmacyBranding(window.pharmacySettings);
        currentModuleFeatures = { ...DEFAULT_MODULE_FEATURES, ...(settings?.module_features || {}) };
        refreshSidebarNavigation(activeUser);

        // If a restored/deep-linked view has since been disabled by Super Admin,
        // immediately replace it with the role's safe landing page.
        if (!isModuleViewEnabled(currentView)) {
          const fallback = role === 'admin' ? 'admin-dashboard'
            : role === 'inventory_manager' ? (currentModuleFeatures.inventory !== false ? 'inventory' : currentModuleFeatures.branches !== false ? 'branches' : null)
            : 'salesman-dashboard';
          if (fallback && currentView && currentView !== fallback) navigate(fallback);
        }
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
      <aside class="sidebar" id="sidebar" aria-label="Primary navigation">
        ${renderSidebar(activeUser, currentSalesmanFeatures, currentModuleFeatures)}
      </aside>
      <div class="main-content">
        <header class="topbar">
          <div style="display:flex;gap:0.5rem;align-items:center">
            <button class="mobile-toggle" id="mobile-menu-btn" aria-label="Open navigation menu" aria-controls="sidebar" aria-expanded="false">&#9776;</button>
            <button class="btn btn-ghost btn-sm desktop-sidebar-toggle" id="desktop-sidebar-toggle" aria-label="Collapse sidebar" aria-controls="sidebar" aria-expanded="true" style="font-size:1.2rem">☰</button>
          </div>
          <span class="topbar-title" id="topbar-title">Dashboard</span>
          <div class="topbar-actions">
            <div class="topbar-search" id="global-search-wrap">
              <span class="global-search-icon" aria-hidden="true">&#128269;</span>
              <input
                type="search"
                id="global-search"
                placeholder="Search products, invoices, people..."
                autocomplete="off"
                aria-label="Search this pharmacy"
                aria-controls="global-search-results"
                aria-expanded="false"
                aria-autocomplete="list"
              />
              <kbd class="global-search-shortcut">Ctrl K</kbd>
              <div class="global-search-results" id="global-search-results" role="listbox" aria-label="Search results"></div>
            </div>
            <span id="impersonation-note" class="topbar-impersonation-note" style="display:none;align-self:center;font-size:0.9rem;color:var(--gray-700);"></span>
            <button class="btn btn-warning btn-sm" id="exit-impersonation-btn" aria-label="Exit pharmacy view" style="display:none;">Exit Pharmacy View</button>
            <button class="btn btn-ghost btn-sm topbar-action-btn" id="profile-btn" aria-label="My Account">
              <span aria-hidden="true">👤</span>
              <span class="topbar-action-label">My Account</span>
            </button>
            <button class="btn btn-ghost btn-sm topbar-action-btn" id="signout-btn" aria-label="Sign out">
              <span aria-hidden="true">↪</span>
              <span class="topbar-action-label">Sign out</span>
            </button>
          </div>
        </header>
        ${currentImpersonation ? `<div class="super-admin-access-banner"><strong>SUPER ADMIN ACCESS MODE</strong><span>You are viewing: ${currentImpersonation.pharmacy?.name || 'Selected pharmacy'}</span><button type="button" class="btn btn-warning btn-sm" id="access-banner-exit">Exit Pharmacy</button></div>` : ''}
        <main class="page-content" id="page-content">
          <div class="loading-spinner"></div>
        </main>
      </div>
    </div>
  `;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    cleanupActiveView();
    await signOut();
  });

  const accessBannerExit = document.getElementById('access-banner-exit');
  if (accessBannerExit) accessBannerExit.addEventListener('click', () => clearImpersonation());

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

  initResponsiveEnhancements();

  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');

  mobileMenuBtn?.addEventListener('click', () => {
    setMobileSidebarOpen(!sidebar?.classList.contains('open'));
  });

  document.getElementById('sidebar-mobile-close')?.addEventListener('click', () => {
    closeMobileSidebar({ restoreFocus: true });
  });

  sidebarBackdrop?.addEventListener('click', () => closeMobileSidebar({ restoreFocus: true }));

  // A desktop sidebar preference must never leak into the mobile drawer.
  const desktopMediaQuery = window.matchMedia('(min-width: 769px)');

  // Desktop sidebar collapse toggle. Desktop collapse fully hides the sidebar;
  // mobile keeps using the independent drawer/open behavior above.
  const desktopToggle = document.getElementById('desktop-sidebar-toggle');
  const setDesktopSidebarCollapsed = (collapsed, { persist = true } = {}) => {
    if (!sidebar || !desktopToggle) return;

    const shouldCollapse = Boolean(collapsed) && desktopMediaQuery.matches;
    sidebar.classList.toggle('collapsed', shouldCollapse);
    desktopToggle.setAttribute('aria-expanded', String(!shouldCollapse));
    desktopToggle.setAttribute('aria-label', shouldCollapse ? 'Open sidebar' : 'Collapse sidebar');

    if (persist && desktopMediaQuery.matches) {
      localStorage.setItem('sidebar-collapsed', shouldCollapse ? 'true' : 'false');
    }
  };

  if (desktopToggle) {
    setDesktopSidebarCollapsed(
      desktopMediaQuery.matches && localStorage.getItem('sidebar-collapsed') === 'true',
      { persist: false }
    );

    desktopToggle.addEventListener('click', () => {
      setDesktopSidebarCollapsed(!sidebar?.classList.contains('collapsed'));
    });

    desktopMediaQuery.addEventListener?.('change', (event) => {
      if (event.matches) {
        setDesktopSidebarCollapsed(localStorage.getItem('sidebar-collapsed') === 'true', { persist: false });
      } else {
        // Never carry the desktop collapsed class into the mobile drawer.
        sidebar?.classList.remove('collapsed');
      }
    });
  }

  // Global pharmacy search (Admin workspace). Results are queried from Supabase
  // after a short debounce instead of downloading entire modules to the browser.
  initGlobalSearch(activeUser);

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
      closeMobileSidebar();
    });
  });
}

/**
 * Update sidebar with feature-filtered navigation for salesman
 * Called after features are loaded from database
 */
function refreshSidebarNavigation(user = activeUser) {
  const sidebarNav = document.querySelector('.sidebar-nav');
  if (!sidebarNav || !user) return;
  sidebarNav.innerHTML = renderSidebar(user, currentSalesmanFeatures, currentModuleFeatures).match(/<nav class="sidebar-nav">([\s\S]*?)<\/nav>/)?.[1] || '';
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === currentView);
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (view) navigate(view);
      closeMobileSidebar();
    });
  });
}

function updateSidebarWithFeatures(user, features) {
  currentSalesmanFeatures = features;
  refreshSidebarNavigation(user);
}

window.addEventListener('pharmacy-branding-updated', (event) => {
  const settings = event.detail?.settings;
  if (!settings || !activeUser?.profile?.pharmacy_id) return;
  if (settings.id && settings.id !== activeUser.profile.pharmacy_id) return;
  window.pharmacySettings = settings;
  applyPharmacyBranding(settings);
  refreshSidebarNavigation(activeUser);
});

const VIEW_MODULE_MAP = {
  inventory: 'inventory',
  sales: 'sales',
  pos: 'sales',
  'sales-history': 'sales',
  customers: 'customers',
  patients: 'patients',
  suppliers: 'suppliers',
  purchases: 'purchases',
  returns: 'returns',
  'returns-management': 'returns',
  'returns-request': 'returns',
  alerts: 'alerts',
  'stock-transfers': 'stock_transfers',
  staff: 'staff',
  branches: 'branches',
  'branch-details': 'branches',
  expenses: 'expenses',
  reports: 'reports',
  'sales-reports': 'sales_reports',
  'daily-reports': 'daily_records'
};

function isModuleViewEnabled(view) {
  const key = VIEW_MODULE_MAP[view];
  return !key || currentModuleFeatures?.[key] !== false;
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
  // Programmatic navigation must also dismiss the mobile drawer/backdrop.
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('show');
  document.body.classList.remove('mobile-nav-open');
  document.getElementById('mobile-menu-btn')?.setAttribute('aria-expanded', 'false');

  // End timers/subscriptions owned by the previous SPA view before rendering the next one.
  const lifecycleToken = beginViewLifecycle();

  currentView = view;
  currentParams = params;

  // Save current view to localStorage for persistence on refresh
  localStorage.setItem('currentView', view);
  localStorage.setItem('currentParams', JSON.stringify(params));

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  const content = document.getElementById('page-content');
  if (!content) return;

  content.innerHTML = '<div class="loading-spinner"></div>';

  const activeRole = activeUser.profile?.role;

  if (activeRole !== 'super_admin' && !isModuleViewEnabled(view)) {
    const moduleKey = VIEW_MODULE_MAP[view];
    content.innerHTML = `
      <div class="animate-in">
        <div style="padding: 2rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem">🔒</div>
          <div style="font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem">Module Disabled</div>
          <div style="color: var(--gray-600); margin-bottom: 2rem">The ${moduleKey?.replace(/_/g, ' ') || 'requested'} workspace has been disabled for this pharmacy by the platform administrator.</div>
          <button type="button" class="btn btn-primary" id="module-disabled-home">Go to Dashboard</button>
        </div>
      </div>
    `;
    document.getElementById('module-disabled-home')?.addEventListener('click', () => {
      const fallback = activeRole === 'salesman' ? 'salesman-dashboard'
        : activeRole === 'inventory_manager' ? (currentModuleFeatures.inventory !== false ? 'inventory' : 'branches')
        : 'admin-dashboard';
      navigate(fallback);
    });
    applyPageTitle(view, 'Module Disabled');
    return;
  }

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
            <button type="button" class="btn btn-primary" onclick="window.navigate('pos')">Go to Point of Sale</button>
          </div>
        </div>
      `;
      applyPageTitle(view, 'Access Denied');
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
            <button type="button" class="btn btn-primary" onclick="window.navigate('inventory')">Go to Inventory</button>
          </div>
        </div>
      `;
      applyPageTitle(view, 'Access Denied');
      return;
    }
  }

  applyPageTitle(view);

  switch (view) {
    case 'super-dashboard': renderSuperAdminDashboard(content, activeUser); break;
    case 'pharmacies': renderPharmacies(content, activeUser, currentParams); break;
    case 'all-users': renderAllUsers(content, activeUser, currentParams.search || ''); break;
    case 'settings': renderSettings(content, activeUser); break;
    case 'admin-dashboard': renderAdminDashboard(content, activeUser); break;
    case 'inventory': renderInventory(content, activeUser, currentParams.filterType, currentParams.search || '', currentParams.branchId || null); break;
    case 'sales': renderSales(content, activeUser, lifecycleToken, currentParams.search || ''); break;
    case 'customers': renderCustomers(content, activeUser, currentParams.search || ''); break;
    case 'patients': renderPatientManagementView(content, activeUser, currentParams.search || ''); break;
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
    case 'staff': renderStaff(content, activeUser, currentParams.search || ''); break;
    case 'branches': renderBranches(content, activeUser); break;
    case 'branch-details': 
      if (params.branchId && params.pharmacyId) {
        renderBranchDetailsView(params.branchId, params.pharmacyId, lifecycleToken);
      }
      break;
    case 'salesman-dashboard': renderSalesmanDashboard(content, activeUser); break;
    case 'pos': renderPOS(content, activeUser, lifecycleToken); break;
    case 'sales-history': renderSalesHistory(content, activeUser); break;
    case 'returns-request': renderSalesmanReturnsRequest(content, activeUser); break;
    case 'salesman-features': renderSalesmanFeatures(content, activeUser); break;
    case 'branding': renderBranding(content, activeUser); break;
    default:
      applyPageTitle(view, 'Page Not Found');
      content.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128269;</div><div class="empty-state-title">Page not found</div><div class="empty-state-desc">The requested page is not available.</div></div>';
      break;
  }
}

const GLOBAL_SEARCH_GROUPS = [
  { key: 'products', label: 'Products', icon: '📦', view: 'inventory' },
  { key: 'sales', label: 'Sales & Invoices', icon: '🧾', view: 'sales' },
  { key: 'customers', label: 'Customers', icon: '👤', view: 'customers' },
  { key: 'patients', label: 'Patients', icon: '🩺', view: 'patients' },
  { key: 'suppliers', label: 'Suppliers', icon: '🚚', view: 'suppliers' },
  { key: 'purchases', label: 'Purchase Orders', icon: '📋', view: 'purchases' },
  { key: 'staff', label: 'Staff', icon: '👥', view: 'staff' },
  { key: 'branches', label: 'Branches', icon: '🏪', view: 'branches' }
];

let globalSearchRequestId = 0;
let globalSearchItems = [];
let globalSearchActiveIndex = -1;
let globalSearchDebounceTimer = null;

function escapeSearchHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatSearchDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getSearchItemPresentation(type, item) {
  switch (type) {
    case 'products': {
      const boxes = Number(item.stock_boxes || 0);
      const units = Number(item.stock_units || 0);
      return {
        title: item.name,
        subtitle: `${item.category || 'General'} • ${boxes} box${boxes === 1 ? '' : 'es'}${units ? ` + ${units} units` : ''}`,
        meta: formatCurrency(item.price || 0),
        params: { search: item.name, branchId: item.branch_id || null }
      };
    }
    case 'sales':
      return {
        title: item.invoice_number,
        subtitle: `${formatSearchDate(item.created_at)} • ${(item.payment_method || 'cash').replace('_', ' ')}`,
        meta: formatCurrency(item.total_amount || 0),
        params: { search: item.invoice_number }
      };
    case 'customers':
      return {
        title: item.name,
        subtitle: item.phone || item.email || 'Customer record',
        meta: item.email && item.phone ? item.email : '',
        params: { search: item.name }
      };
    case 'patients':
      return {
        title: item.name,
        subtitle: item.patient_id_number || item.phone || 'Patient record',
        meta: item.phone && item.patient_id_number ? item.phone : '',
        params: { search: item.name, branchId: item.branch_id || null }
      };
    case 'suppliers':
      return {
        title: item.name,
        subtitle: item.contact_person || item.phone || item.email || 'Supplier',
        meta: item.phone || '',
        params: { search: item.name }
      };
    case 'purchases':
      return {
        title: item.purchase_number,
        subtitle: `${formatSearchDate(item.created_at)} • ${item.payment_status || 'pending'}`,
        meta: formatCurrency(item.total_cost || 0),
        params: { search: item.purchase_number }
      };
    case 'staff':
      return {
        title: item.full_name || item.email,
        subtitle: (item.role || 'staff').replace('_', ' '),
        meta: item.email || '',
        params: { search: item.full_name || item.email }
      };
    case 'branches':
      return {
        title: item.name,
        subtitle: item.address || 'Branch',
        meta: '',
        params: { branchId: item.id, pharmacyId: activeUser?.profile?.pharmacy_id }
      };
    default:
      return { title: 'Result', subtitle: '', meta: '', params: {} };
  }
}

function closeGlobalSearch({ clear = false } = {}) {
  const input = document.getElementById('global-search');
  const results = document.getElementById('global-search-results');
  if (!input || !results) return;
  results.classList.remove('show');
  results.innerHTML = '';
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  globalSearchItems = [];
  globalSearchActiveIndex = -1;
  if (clear) input.value = '';
}

function setGlobalSearchActiveIndex(nextIndex) {
  if (!globalSearchItems.length) return;
  globalSearchActiveIndex = Math.max(0, Math.min(nextIndex, globalSearchItems.length - 1));
  const resultNodes = [...document.querySelectorAll('.global-search-result-item')];
  resultNodes.forEach((node, index) => node.classList.toggle('active', index === globalSearchActiveIndex));
  const active = resultNodes[globalSearchActiveIndex];
  if (active) {
    document.getElementById('global-search')?.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }
}

function openGlobalSearchResult(result) {
  if (!result) return;
  closeGlobalSearch({ clear: true });
  if (result.type === 'branches') {
    navigate('branch-details', { branchId: result.item.id, pharmacyId: activeUser?.profile?.pharmacy_id });
    return;
  }
  navigate(result.view, result.presentation.params || {});
}

function renderGlobalSearchResults(groupedResults, query) {
  const resultsEl = document.getElementById('global-search-results');
  const input = document.getElementById('global-search');
  if (!resultsEl || !input) return;

  globalSearchItems = [];
  globalSearchActiveIndex = -1;
  const sections = [];

  GLOBAL_SEARCH_GROUPS.forEach(group => {
    const rows = groupedResults?.[group.key] || [];
    if (!rows.length) return;

    const rowHtml = rows.map(item => {
      const presentation = getSearchItemPresentation(group.key, item);
      const flatIndex = globalSearchItems.length;
      globalSearchItems.push({ type: group.key, view: group.view, item, presentation });
      return `
        <button type="button" class="global-search-result-item" id="global-search-option-${flatIndex}" data-search-index="${flatIndex}" role="option">
          <span class="global-search-result-icon" aria-hidden="true">${group.icon}</span>
          <span class="global-search-result-copy">
            <span class="global-search-result-title">${escapeSearchHtml(presentation.title)}</span>
            <span class="global-search-result-subtitle">${escapeSearchHtml(presentation.subtitle)}</span>
          </span>
          ${presentation.meta ? `<span class="global-search-result-meta">${escapeSearchHtml(presentation.meta)}</span>` : ''}
        </button>
      `;
    }).join('');

    sections.push(`
      <section class="global-search-group" aria-label="${escapeSearchHtml(group.label)}">
        <div class="global-search-group-title"><span>${group.icon}</span>${escapeSearchHtml(group.label)}</div>
        ${rowHtml}
      </section>
    `);
  });

  if (!globalSearchItems.length) {
    resultsEl.innerHTML = `
      <div class="global-search-empty">
        <span class="global-search-empty-icon">🔎</span>
        <strong>No results for “${escapeSearchHtml(query)}”</strong>
        <span>Try a product, invoice, customer, patient, supplier, staff member or branch.</span>
      </div>`;
  } else {
    resultsEl.innerHTML = `
      <div class="global-search-results-scroll">${sections.join('')}</div>
      <div class="global-search-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> open</span>
        <span><kbd>Esc</kbd> close</span>
      </div>`;
  }

  resultsEl.classList.add('show');
  input.setAttribute('aria-expanded', 'true');

  resultsEl.querySelectorAll('.global-search-result-item').forEach(button => {
    button.addEventListener('mouseenter', () => {
      setGlobalSearchActiveIndex(Number(button.dataset.searchIndex));
    });
    button.addEventListener('click', () => {
      openGlobalSearchResult(globalSearchItems[Number(button.dataset.searchIndex)]);
    });
  });
}

async function runGlobalSearch(query, user, requestId) {
  const input = document.getElementById('global-search');
  const resultsEl = document.getElementById('global-search-results');
  if (!input || !resultsEl) return;

  const pharmacyId = user?.profile?.pharmacy_id;
  if (!pharmacyId) return;

  resultsEl.innerHTML = `
    <div class="global-search-loading">
      <span class="global-search-loading-dot"></span>
      Searching this pharmacy…
    </div>`;
  resultsEl.classList.add('show');
  input.setAttribute('aria-expanded', 'true');

  try {
    const data = await searchAdminWorkspace(pharmacyId, query, {
      branchId: user?.profile?.branch_id || null,
      limitPerType: 5
    });
    if (requestId !== globalSearchRequestId) return;
    renderGlobalSearchResults(data, query);
  } catch (error) {
    if (requestId !== globalSearchRequestId) return;
    console.error('Global search failed:', error);
    resultsEl.innerHTML = `
      <div class="global-search-empty">
        <span class="global-search-empty-icon">⚠️</span>
        <strong>Search could not be completed</strong>
        <span>Please try again.</span>
      </div>`;
    resultsEl.classList.add('show');
    input.setAttribute('aria-expanded', 'true');
  }
}

function initGlobalSearch(user) {
  const input = document.getElementById('global-search');
  const wrap = document.getElementById('global-search-wrap');
  const resultsEl = document.getElementById('global-search-results');
  if (!input || !wrap || !resultsEl) return;

  // This first global-search rollout is intentionally Admin-only. Other roles
  // will get role-specific search scopes as their workspaces are upgraded.
  if (user?.profile?.role !== 'admin' || !user?.profile?.pharmacy_id) {
    wrap.style.display = 'none';
    return;
  }

  input.addEventListener('input', () => {
    const query = input.value.trim();
    clearTimeout(globalSearchDebounceTimer);
    globalSearchRequestId += 1;

    if (query.length < 2) {
      if (query.length === 1) {
        resultsEl.innerHTML = '<div class="global-search-hint">Type at least 2 characters to search this pharmacy.</div>';
        resultsEl.classList.add('show');
        input.setAttribute('aria-expanded', 'true');
      } else {
        closeGlobalSearch();
      }
      return;
    }

    const requestId = globalSearchRequestId;
    globalSearchDebounceTimer = setTimeout(() => runGlobalSearch(query, user, requestId), 300);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length === 1) {
      resultsEl.innerHTML = '<div class="global-search-hint">Type at least 2 characters to search this pharmacy.</div>';
      resultsEl.classList.add('show');
      input.setAttribute('aria-expanded', 'true');
    }
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (globalSearchItems.length) setGlobalSearchActiveIndex(globalSearchActiveIndex < 0 ? 0 : globalSearchActiveIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (globalSearchItems.length) setGlobalSearchActiveIndex(globalSearchActiveIndex < 0 ? globalSearchItems.length - 1 : globalSearchActiveIndex - 1);
    } else if (event.key === 'Enter') {
      if (globalSearchItems.length) {
        event.preventDefault();
        const index = globalSearchActiveIndex >= 0 ? globalSearchActiveIndex : 0;
        openGlobalSearchResult(globalSearchItems[index]);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeGlobalSearch();
      input.blur();
    }
  });

  document.addEventListener('pointerdown', event => {
    if (!wrap.contains(event.target)) closeGlobalSearch();
  }, { signal: globalSearchDocumentController.signal });
}

// Make navigate globally accessible for use in onclick handlers and dynamic imports
window.navigate = navigate;

export { currentUser };
