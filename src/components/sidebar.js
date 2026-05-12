export function renderSidebar(user, features = null) {
  const role = user.profile?.role || 'salesman';
  const name = user.profile?.full_name || user.email || 'User';
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const pharmacyName = user.profile?.pharmacies?.name || 'PharmaCare';

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
    navItems = `
      <div class="sidebar-section-label">Management</div>
      <button class="nav-item" data-view="admin-dashboard">
        <span class="nav-icon">&#128200;</span> Dashboard
      </button>
      <button class="nav-item" data-view="inventory">
        <span class="nav-icon">&#128230;</span> Inventory
      </button>
      <button class="nav-item" data-view="sales">
        <span class="nav-icon">&#128176;</span> Sales
      </button>
      <button class="nav-item" data-view="customers">
        <span class="nav-icon">&#128100;</span> Customers
      </button>
      <div class="sidebar-section-label">Clinic</div>
      <button class="nav-item" data-view="patients">
        <span class="nav-icon">&#128104;</span> Patients
      </button>
      <div class="sidebar-section-label">Stock & Supply</div>
      <button class="nav-item" data-view="suppliers">
        <span class="nav-icon">&#x1F6DB;</span> Suppliers
      </button>
      <button class="nav-item" data-view="purchases">
        <span class="nav-icon">&#x1F4E6;</span> Purchase Orders
      </button>
      <button class="nav-item" data-view="returns">
        <span class="nav-icon">&#x21A9;</span> Returns
      </button>
      <button class="nav-item" data-view="returns-management">
        <span class="nav-icon">📋</span> Return Requests
      </button>
      <button class="nav-item" data-view="alerts">
        <span class="nav-icon">&#x1F514;</span> Alerts
      </button>
      <button class="nav-item" data-view="stock-transfers">
        <span class="nav-icon">&#x21C4;</span> Stock Transfers
      </button>
      <div class="sidebar-section-label">Organization</div>
      <button class="nav-item" data-view="staff">
        <span class="nav-icon">&#128101;</span> Staff
      </button>
      <button class="nav-item" data-view="branches">
        <span class="nav-icon">&#127968;</span> Branches
      </button>
      <button class="nav-item" data-view="expenses">
        <span class="nav-icon">&#128181;</span> Expenses
      </button>
      <button class="nav-item" data-view="reports">
        <span class="nav-icon">&#128202;</span> Reports
      </button>
      <button class="nav-item" data-view="sales-reports">
        <span class="nav-icon">&#128202;</span> Sales Reports
      </button>
      <button class="nav-item" data-view="daily-reports">
        <span class="nav-icon">📊</span> Daily Records
      </button>
      <div class="sidebar-section-label">Configuration</div>
      <button class="nav-item" data-view="salesman-features">
        <span class="nav-icon">⚙️</span> Salesman Features
      </button>
    `;
  } else {
    // Salesman navigation with feature filtering
    // Default to all features enabled for backward compatibility if features not provided
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
      salesSection += `
        <button class="nav-item" data-view="salesman-dashboard">
          <span class="nav-icon">&#128200;</span> Dashboard
        </button>
      `;
    }
    
    if (feat.pos) {
      salesSection += `
        <button class="nav-item" data-view="pos">
          <span class="nav-icon">&#128179;</span> Point of Sale
        </button>
      `;
    }
    
    if (feat.sales_history) {
      salesSection += `
        <button class="nav-item" data-view="sales-history">
          <span class="nav-icon">&#128202;</span> Sales History
        </button>
      `;
    }
    
    if (feat.daily_records) {
      salesSection += `
        <button class="nav-item" data-view="daily-reports">
          <span class="nav-icon">📊</span> Daily Records
        </button>
      `;
    }
    
    if (feat.customers) {
      salesSection += `
        <button class="nav-item" data-view="customers">
          <span class="nav-icon">&#128100;</span> Customers
        </button>
      `;
    }
    
    let clinicSection = '';
    if (feat.patients) {
      clinicSection = `
        <div class="sidebar-section-label">Clinic</div>
        <button class="nav-item" data-view="patients">
          <span class="nav-icon">&#128104;</span> Patients
        </button>
      `;
    }
    
    let operationsSection = '<div class="sidebar-section-label">Operations</div>';
    
    if (feat.returns_request) {
      operationsSection += `
        <button class="nav-item" data-view="returns-request">
          <span class="nav-icon">&#x21A9;</span> Return Requests
        </button>
      `;
    }
    
    if (feat.expenses) {
      operationsSection += `
        <button class="nav-item" data-view="expenses">
          <span class="nav-icon">&#128181;</span> Expenses
        </button>
      `;
    }
    
    navItems = salesSection + clinicSection + operationsSection;
  }

  const roleLabel = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    salesman: 'Salesman'
  }[role] || role;

  return `
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon">&#x2695;</div>
      <div>
        <div class="sidebar-brand-name">${pharmacyName}</div>
        <div class="sidebar-brand-sub">${roleLabel}</div>
      </div>
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
