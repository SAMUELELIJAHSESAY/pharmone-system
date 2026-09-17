function safeImageUrl(value) {
  const url = String(value || '').trim();
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
  return '';
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const DEFAULT_MODULE_FEATURES = {
  inventory: true,
  sales: true,
  customers: true,
  patients: true,
  suppliers: true,
  purchases: true,
  returns: true,
  alerts: true,
  stock_transfers: true,
  staff: true,
  branches: true,
  expenses: true,
  reports: true,
  sales_reports: true,
  daily_records: true
};

export function renderSidebar(user, features = null, moduleFeatures = null) {
  const role = user.profile?.role || 'salesman';
  const name = user.profile?.full_name || user.email || 'User';
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const pharmacyName = user.profile?.pharmacies?.name || window.pharmacySettings?.name || 'Your pharmacy';
  const pharmacyLogo = role === 'super_admin' ? '' : safeImageUrl(window.pharmacySettings?.logo_url || user.profile?.pharmacies?.logo_url || '');
  const modules = { ...DEFAULT_MODULE_FEATURES, ...(moduleFeatures || {}) };
  const moduleEnabled = (key) => modules[key] !== false;

  let navItems = '';

  if (role === 'super_admin') {
    navItems = `
      <div class="sidebar-section-label">Platform</div>
      <button class="nav-item" data-view="super-dashboard">
        <span class="nav-icon">&#128200;</span> Overview
      </button>
      <button class="nav-item" data-view="pharmacies">
        <span class="nav-icon">&#127978;</span> Pharmacies
      </button>
      <button class="nav-item" data-view="all-users">
        <span class="nav-icon">&#128101;</span> All Users
      </button>
      <div class="sidebar-section-label">Configuration</div>
      <button class="nav-item" data-view="settings">
        <span class="nav-icon">&#9881;</span> Settings
      </button>
    `;
  } else if (role === 'admin') {
    const management = [
      `<button class="nav-item" data-view="admin-dashboard"><span class="nav-icon">&#128200;</span> Dashboard</button>`,
      moduleEnabled('inventory') ? `<button class="nav-item" data-view="inventory"><span class="nav-icon">&#128230;</span> Inventory</button>` : '',
      moduleEnabled('sales') ? `<button class="nav-item" data-view="sales"><span class="nav-icon">&#128176;</span> Sales</button>` : '',
      moduleEnabled('customers') ? `<button class="nav-item" data-view="customers"><span class="nav-icon">&#128100;</span> Customers</button>` : ''
    ].join('');

    const clinic = moduleEnabled('patients') ? `
      <div class="sidebar-section-label">Clinic</div>
      <button class="nav-item" data-view="patients"><span class="nav-icon">&#128104;</span> Patients</button>
    ` : '';

    const supplyItems = [
      moduleEnabled('suppliers') ? `<button class="nav-item" data-view="suppliers"><span class="nav-icon">&#x1F6DB;</span> Suppliers</button>` : '',
      moduleEnabled('purchases') ? `<button class="nav-item" data-view="purchases"><span class="nav-icon">&#x1F4E6;</span> Purchase Orders</button>` : '',
      moduleEnabled('returns') ? `<button class="nav-item" data-view="returns"><span class="nav-icon">&#x21A9;</span> Returns</button>` : '',
      moduleEnabled('returns') ? `<button class="nav-item" data-view="returns-management"><span class="nav-icon">📋</span> Return Requests</button>` : '',
      moduleEnabled('alerts') ? `<button class="nav-item" data-view="alerts"><span class="nav-icon">&#x1F514;</span> Alerts</button>` : '',
      moduleEnabled('stock_transfers') ? `<button class="nav-item" data-view="stock-transfers"><span class="nav-icon">&#x21C4;</span> Stock Transfers</button>` : ''
    ].filter(Boolean).join('');
    const supply = supplyItems ? `<div class="sidebar-section-label">Stock & Supply</div>${supplyItems}` : '';

    const organizationItems = [
      moduleEnabled('staff') ? `<button class="nav-item" data-view="staff"><span class="nav-icon">&#128101;</span> Staff</button>` : '',
      moduleEnabled('branches') ? `<button class="nav-item" data-view="branches"><span class="nav-icon">&#127968;</span> Branches</button>` : '',
      moduleEnabled('expenses') ? `<button class="nav-item" data-view="expenses"><span class="nav-icon">&#128181;</span> Expenses</button>` : '',
      moduleEnabled('reports') ? `<button class="nav-item" data-view="reports"><span class="nav-icon">&#128202;</span> Reports</button>` : '',
      moduleEnabled('sales_reports') ? `<button class="nav-item" data-view="sales-reports"><span class="nav-icon">&#128202;</span> Sales Reports</button>` : '',
      moduleEnabled('daily_records') ? `<button class="nav-item" data-view="daily-reports"><span class="nav-icon">📊</span> Daily Records</button>` : ''
    ].filter(Boolean).join('');
    const organization = organizationItems ? `<div class="sidebar-section-label">Organization</div>${organizationItems}` : '';

    navItems = `
      <div class="sidebar-section-label">Management</div>
      ${management}
      ${clinic}
      ${supply}
      ${organization}
      <div class="sidebar-section-label">Configuration</div>
      <button class="nav-item" data-view="salesman-features"><span class="nav-icon">⚙️</span> Salesman Features</button>
      <button class="nav-item" data-view="branding"><span class="nav-icon">🎨</span> Branding</button>
    `;
  } else if (role === 'inventory_manager') {
    const items = [
      moduleEnabled('inventory') ? `<div class="sidebar-section-label">Inventory</div><button class="nav-item" data-view="inventory"><span class="nav-icon">&#128230;</span> Inventory</button>` : '',
      moduleEnabled('branches') ? `<div class="sidebar-section-label">Organization</div><button class="nav-item" data-view="branches"><span class="nav-icon">&#127968;</span> Branches</button>` : ''
    ];
    navItems = items.join('');
  } else {
    // Salesman navigation is filtered by both pharmacy-level module availability
    // and the pharmacy Admin's salesman feature settings.
    const feat = features || {
      pos: true,
      customers: true,
      patients: true,
      expenses: true,
      returns_request: true,
      dashboard: true,
      sales_history: true,
      daily_records: true
    };

    let salesSection = '<div class="sidebar-section-label">Sales</div>';
    if (feat.dashboard) {
      salesSection += `<button class="nav-item" data-view="salesman-dashboard"><span class="nav-icon">&#128200;</span> Dashboard</button>`;
    }
    if (feat.pos && moduleEnabled('sales')) {
      salesSection += `<button class="nav-item" data-view="pos"><span class="nav-icon">&#128179;</span> Point of Sale</button>`;
    }
    if (feat.sales_history && moduleEnabled('sales')) {
      salesSection += `<button class="nav-item" data-view="sales-history"><span class="nav-icon">&#128202;</span> Sales History</button>`;
    }
    if (feat.daily_records && moduleEnabled('daily_records')) {
      salesSection += `<button class="nav-item" data-view="daily-reports"><span class="nav-icon">📊</span> Daily Records</button>`;
    }
    if (feat.customers && moduleEnabled('customers')) {
      salesSection += `<button class="nav-item" data-view="customers"><span class="nav-icon">&#128100;</span> Customers</button>`;
    }

    let clinicSection = '';
    if (feat.patients && moduleEnabled('patients')) {
      clinicSection = `<div class="sidebar-section-label">Clinic</div><button class="nav-item" data-view="patients"><span class="nav-icon">&#128104;</span> Patients</button>`;
    }

    let operationsItems = '';
    if (feat.returns_request && moduleEnabled('returns')) {
      operationsItems += `<button class="nav-item" data-view="returns-request"><span class="nav-icon">&#x21A9;</span> Return Requests</button>`;
    }
    if (feat.expenses && moduleEnabled('expenses')) {
      operationsItems += `<button class="nav-item" data-view="expenses"><span class="nav-icon">&#128181;</span> Expenses</button>`;
    }
    const operationsSection = operationsItems ? `<div class="sidebar-section-label">Operations</div>${operationsItems}` : '';
    navItems = salesSection + clinicSection + operationsSection;
  }

  const roleLabel = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    salesman: 'Salesman',
    inventory_manager: 'Inventory Manager'
  }[role] || role;

  return `
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon ${pharmacyLogo ? 'has-pharmacy-logo' : ''}"><img src="${pharmacyLogo || '/brand/sammia-mark.png'}" alt="${pharmacyLogo ? esc(pharmacyName) + ' logo' : ''}" ${pharmacyLogo ? '' : 'aria-hidden="true"'} /></div>
      <div class="sidebar-brand-copy">
        <div class="sidebar-brand-name"><span>SamMia</span> <strong>Pharm</strong></div>
        <div class="sidebar-brand-sub" title="${esc(pharmacyName)} · ${roleLabel}">${esc(pharmacyName)} · ${roleLabel}</div>
      </div>
      <button class="sidebar-mobile-close" id="sidebar-mobile-close" type="button" aria-label="Close navigation menu">&#10005;</button>
    </div>
    <nav class="sidebar-nav">
      ${navItems}
    </nav>
    <div class="sidebar-footer">
      <div class="user-card">
        <div class="user-avatar">${initials}</div>
        <div class="user-info">
          <div class="user-name">${name}</div>
          <div class="user-role">${roleLabel}</div>
        </div>
      </div>
    </div>
  `;
}
