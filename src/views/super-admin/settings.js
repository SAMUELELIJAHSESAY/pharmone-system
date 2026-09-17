import {
  getSuperAdminPlatformSettings,
  updateSuperAdminPlatformSettings,
  getSuperAdminPharmaciesPage,
  getSuperAdminPharmacyConfiguration,
  updateSuperAdminPharmacyConfiguration,
  resetSuperAdminPharmacyConfiguration,
  getSuperAdminSettingsAuditPage
} from '../../database.js';
import { showToast, showConfirm } from '../../utils.js';
import { createModal } from '../../components/modal.js';

const MODULES = [
  ['inventory', 'Inventory', 'Products, stock levels and inventory movements'],
  ['sales', 'Sales', 'Sales history and point-of-sale access'],
  ['customers', 'Customers', 'Customer directory and customer profiles'],
  ['patients', 'Patients', 'Clinic/patient records'],
  ['suppliers', 'Suppliers', 'Supplier management'],
  ['purchases', 'Purchase Orders', 'Purchasing and receiving stock'],
  ['returns', 'Returns', 'Returns and return requests'],
  ['alerts', 'Alerts', 'Inventory and operational alerts'],
  ['stock_transfers', 'Stock Transfers', 'Branch-to-branch stock transfer workspace'],
  ['staff', 'Staff', 'Staff management and staff profiles'],
  ['branches', 'Branches', 'Branch management and branch workspaces'],
  ['expenses', 'Expenses', 'Expense management'],
  ['reports', 'Reports & Analytics', 'Business reporting and analytics'],
  ['sales_reports', 'Sales Reports', 'Employee/product sales reporting'],
  ['daily_records', 'Daily Records', 'Daily closing reports and cash reconciliation']
];

const DEFAULT_MODULES = Object.fromEntries(MODULES.map(([key]) => [key, true]));

const state = {
  tab: 'platform',
  platform: null,
  migrationRequired: false,
  pharmacies: [],
  pharmacyCount: 0,
  pharmacyPage: 1,
  pharmacyPageSize: 30,
  pharmacyPageCount: 1,
  pharmacySearch: '',
  pharmacyStatus: 'all',
  auditRows: [],
  auditCount: 0,
  auditPage: 1,
  auditPageSize: 30,
  auditPageCount: 1,
  auditScope: 'all',
  loadingPharmacies: false,
  loadingAudit: false,
  searchTimer: null
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeModules(value) {
  return { ...DEFAULT_MODULES, ...(value || {}) };
}

function yesNo(value) {
  return value ? 'Enabled' : 'Disabled';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function getOperational(pharmacy = {}) {
  return {
    default_low_stock_threshold: 5,
    receipt_footer: 'Thank you for choosing SamMia Pharm.',
    ...(pharmacy.operational_settings || {})
  };
}

function enabledModuleCount(features) {
  const normalized = normalizeModules(features);
  return MODULES.filter(([key]) => normalized[key] !== false).length;
}

function disabledModuleNames(features) {
  const normalized = normalizeModules(features);
  return MODULES.filter(([key]) => normalized[key] === false).map(([, label]) => label);
}

function renderPagination(page, pageCount, prefix) {
  if (pageCount <= 1) return '';
  const pages = new Set([1, pageCount, page - 1, page, page + 1].filter(v => v >= 1 && v <= pageCount));
  const sorted = [...pages].sort((a, b) => a - b);
  let previous = 0;
  const buttons = [];
  for (const number of sorted) {
    if (previous && number - previous > 1) buttons.push('<span class="pagination-ellipsis">…</span>');
    buttons.push(`<button type="button" class="pagination-page ${number === page ? 'active' : ''}" data-${prefix}-page="${number}">${number}</button>`);
    previous = number;
  }
  return `
    <div class="pagination-controls settings-pagination">
      <button type="button" class="btn btn-ghost btn-sm" data-${prefix}-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Previous</button>
      <div class="pagination-pages">${buttons.join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-${prefix}-page="${page + 1}" ${page >= pageCount ? 'disabled' : ''}>Next →</button>
    </div>
  `;
}

export async function renderSettings(container, user) {
  if (user.profile?.role !== 'super_admin') {
    container.innerHTML = '<div class="alert alert-danger">Access denied. Only Super Admins can manage platform settings.</div>';
    return;
  }

  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const [platformResult, pharmacyResult, auditResult] = await Promise.all([
      getSuperAdminPlatformSettings(),
      getSuperAdminPharmaciesPage({ page: 1, pageSize: state.pharmacyPageSize }),
      getSuperAdminSettingsAuditPage({ page: 1, pageSize: state.auditPageSize })
    ]);

    state.platform = platformResult;
    state.migrationRequired = Boolean(platformResult?.migrationRequired || auditResult?.migrationRequired);
    applyPharmacyResult(pharmacyResult);
    applyAuditResult(auditResult);
    renderView(container, user);
  } catch (error) {
    console.error('Super Admin settings load failed:', error);
    container.innerHTML = `<div class="alert alert-danger">Failed to load settings: ${esc(error.message)}</div>`;
  }
}

function applyPharmacyResult(result = {}) {
  state.pharmacies = result.rows || [];
  state.pharmacyCount = Number(result.count || 0);
  state.pharmacyPage = Number(result.page || 1);
  state.pharmacyPageSize = Number(result.pageSize || result.page_size || state.pharmacyPageSize || 30);
  state.pharmacyPageCount = Number(result.pageCount || result.page_count || 1);
}

function applyAuditResult(result = {}) {
  state.auditRows = result.rows || [];
  state.auditCount = Number(result.count || 0);
  state.auditPage = Number(result.page || 1);
  state.auditPageSize = Number(result.page_size || state.auditPageSize || 30);
  state.auditPageCount = Number(result.page_count || 1);
}

function renderView(container, user) {
  const platform = state.platform?.settings || {};
  const summary = state.platform?.summary || {};
  container.innerHTML = `
    <div class="animate-in super-settings-page">
      <div class="page-header settings-page-header">
        <div>
          <div class="page-title">Platform Settings</div>
          <div class="page-subtitle">Manage SamMia Pharm defaults, pharmacy overrides, module availability and configuration history</div>
        </div>
        <div class="settings-updated-label">${platform.updated_at ? `Last platform update: ${esc(formatDate(platform.updated_at))}` : 'Platform defaults'}</div>
      </div>

      ${state.migrationRequired ? `
        <div class="alert alert-warning settings-migration-alert">
          <strong>Database upgrade required.</strong> Apply <code>20260917054500_super_admin_settings_center.sql</code> to enable saved platform defaults, module controls and audit history.
        </div>
      ` : ''}

      <div class="settings-summary-grid">
        <button type="button" class="settings-summary-card" data-settings-tab="pharmacies">
          <span class="settings-summary-icon">🏪</span>
          <span class="settings-summary-label">Pharmacies</span>
          <strong>${Number(summary.total_pharmacies ?? state.pharmacyCount ?? 0).toLocaleString()}</strong>
          <small>Configured tenants</small>
        </button>
        <button type="button" class="settings-summary-card" data-settings-tab="platform">
          <span class="settings-summary-icon">🧾</span>
          <span class="settings-summary-label">Tax Enabled</span>
          <strong>${Number(summary.tax_enabled_pharmacies || 0).toLocaleString()}</strong>
          <small>Pharmacies charging tax</small>
        </button>
        <button type="button" class="settings-summary-card" data-settings-tab="features">
          <span class="settings-summary-icon">⚙️</span>
          <span class="settings-summary-label">Restricted Pharmacies</span>
          <strong>${Number(summary.restricted_pharmacies || 0).toLocaleString()}</strong>
          <small>Custom module access</small>
        </button>
        <button type="button" class="settings-summary-card" data-settings-tab="audit">
          <span class="settings-summary-icon">🕘</span>
          <span class="settings-summary-label">Configuration Changes</span>
          <strong>${state.auditCount.toLocaleString()}</strong>
          <small>Audited settings events</small>
        </button>
      </div>

      <div class="settings-tabs" role="tablist" aria-label="Super Admin settings sections">
        ${renderTabButton('platform', 'Platform Defaults', '🌐')}
        ${renderTabButton('pharmacies', 'Pharmacy Overrides', '🏪')}
        ${renderTabButton('features', 'Feature Controls', '🧩')}
        ${renderTabButton('audit', 'Audit History', '🕘')}
      </div>

      <div id="settings-tab-content">
        ${renderActiveTab()}
      </div>
    </div>
  `;

  bindBaseActions(container, user);
  bindActiveTabActions(container, user);
}

function renderTabButton(key, label, icon) {
  return `<button type="button" class="settings-tab ${state.tab === key ? 'active' : ''}" role="tab" aria-selected="${state.tab === key}" data-settings-tab="${key}"><span>${icon}</span>${label}</button>`;
}

function renderActiveTab() {
  if (state.tab === 'pharmacies') return renderPharmacyOverrides();
  if (state.tab === 'features') return renderFeatureControls();
  if (state.tab === 'audit') return renderAuditHistory();
  return renderPlatformDefaults();
}

function renderPlatformDefaults() {
  const settings = state.platform?.settings || {};
  const rules = settings.discount_rules || {};
  return `
    <form id="platform-defaults-form" class="settings-form-stack">
      <div class="settings-section-card">
        <div class="settings-section-heading">
          <div><h3>Brand & Locale Defaults</h3><p>Applied automatically when a new pharmacy is created.</p></div>
          <span class="badge badge-gray">New pharmacies</span>
        </div>
        <div class="settings-form-grid">
          <label class="form-group">
            <span class="form-label">Default Branding Color</span>
            <div class="settings-color-row">
              <input type="color" class="form-input settings-color-input" id="platform-branding-color" value="${esc(settings.branding_color || '#2563eb')}" />
              <input type="text" class="form-input" id="platform-branding-text" value="${esc(settings.branding_color || '#2563eb')}" maxlength="7" />
            </div>
          </label>
          <label class="form-group">
            <span class="form-label">Default Currency</span>
            <select class="form-select" id="platform-currency-code">${currencyOptions(settings.currency_code || 'NLE')}</select>
          </label>
          <label class="form-group">
            <span class="form-label">Currency Symbol</span>
            <input class="form-input" id="platform-currency-symbol" value="${esc(settings.currency_symbol || 'Le')}" maxlength="6" />
          </label>
          <label class="form-group">
            <span class="form-label">Timezone</span>
            <select class="form-select" id="platform-timezone">
              ${timezoneOptions(settings.timezone || 'Africa/Freetown')}
            </select>
          </label>
        </div>
      </div>

      <div class="settings-section-card">
        <div class="settings-section-heading"><div><h3>Sales Defaults</h3><p>Default tax and discount configuration for newly created pharmacies.</p></div></div>
        <div class="settings-form-grid">
          ${toggleField('platform-tax-enabled', 'Enable Tax by Default', 'Automatic tax calculation for new pharmacies', settings.tax_enabled)}
          <label class="form-group">
            <span class="form-label">Tax Rate (%)</span>
            <input type="number" class="form-input" id="platform-tax-rate" min="0" max="100" step="0.01" value="${Number(settings.tax_rate || 0)}" />
          </label>
          ${toggleField('platform-discount-enabled', 'Allow Discounts by Default', 'Staff may use the existing discount workflow', settings.discount_enabled !== false)}
          <label class="form-group">
            <span class="form-label">Maximum Discount (%)</span>
            <input type="number" class="form-input" id="platform-max-discount" min="0" max="100" step="0.01" value="${Number(rules.max_discount ?? 10)}" />
          </label>
          <label class="form-group">
            <span class="form-label">Minimum Cart Amount</span>
            <input type="number" class="form-input" id="platform-min-cart" min="0" step="0.01" value="${Number(rules.min_cart_amount ?? 0)}" />
          </label>
        </div>
        <div class="settings-inline-note">Discount values remain configuration values; the separate POS pricing/calculation audit items are intentionally not changed by this settings upgrade.</div>
      </div>

      <div class="settings-section-card">
        <div class="settings-section-heading"><div><h3>Inventory & Receipt Defaults</h3><p>Operational defaults used by newly created pharmacies.</p></div></div>
        <div class="settings-form-grid">
          <label class="form-group">
            <span class="form-label">Default Low Stock Threshold</span>
            <input type="number" class="form-input" id="platform-low-stock" min="0" step="1" value="${Number(settings.default_low_stock_threshold ?? 5)}" />
            <small class="text-muted">Used as the starting threshold when adding a new product.</small>
          </label>
          <label class="form-group settings-form-span-2">
            <span class="form-label">Default Receipt Footer</span>
            <textarea class="form-input" id="platform-receipt-footer" rows="3" maxlength="300">${esc(settings.receipt_footer || 'Thank you for choosing SamMia Pharm.')}</textarea>
            <small class="text-muted">Shown on POS and sales-history printed receipts.</small>
          </label>
        </div>
      </div>

      <div class="settings-section-card settings-save-card">
        <label class="form-group settings-change-note">
          <span class="form-label">Change Note <span class="text-muted">(optional)</span></span>
          <input class="form-input" id="platform-change-note" maxlength="180" placeholder="e.g. Updated standard Leone configuration" />
        </label>
        <button class="btn btn-primary" type="submit" id="save-platform-defaults" ${state.migrationRequired ? 'disabled' : ''}>Save Platform Defaults</button>
      </div>
    </form>
  `;
}

function renderPharmacyOverrides() {
  return `
    <div class="settings-section-card">
      <div class="settings-section-heading settings-toolbar-heading">
        <div><h3>Pharmacy Overrides</h3><p>Manage branding, currency, sales and operating defaults for an individual pharmacy.</p></div>
      </div>
      ${renderPharmacyToolbar()}
      <div class="table-container settings-table-wrap">
        <table class="settings-table">
          <thead><tr><th>Pharmacy</th><th>Currency</th><th>Tax</th><th>Discounts</th><th>Low Stock Default</th><th>Modules</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody>${renderPharmacyOverrideRows()}</tbody>
        </table>
      </div>
      <div class="settings-table-footer">
        <span>Showing ${state.pharmacyCount ? ((state.pharmacyPage - 1) * state.pharmacyPageSize) + 1 : 0}–${Math.min(state.pharmacyPage * state.pharmacyPageSize, state.pharmacyCount)} of ${state.pharmacyCount.toLocaleString()} pharmacies</span>
        ${renderPagination(state.pharmacyPage, state.pharmacyPageCount, 'pharmacy')}
      </div>
    </div>
  `;
}

function renderPharmacyToolbar() {
  return `
    <div class="settings-directory-toolbar">
      <div class="settings-search-control"><span>🔎</span><input type="search" id="settings-pharmacy-search" class="form-input" value="${esc(state.pharmacySearch)}" placeholder="Search pharmacy name, email, phone or address..." /></div>
      <select class="form-select" id="settings-pharmacy-status">
        <option value="all" ${state.pharmacyStatus === 'all' ? 'selected' : ''}>All statuses</option>
        <option value="active" ${state.pharmacyStatus === 'active' ? 'selected' : ''}>Active</option>
        <option value="suspended" ${state.pharmacyStatus === 'suspended' ? 'selected' : ''}>Suspended</option>
        <option value="disabled" ${state.pharmacyStatus === 'disabled' ? 'selected' : ''}>Disabled</option>
        <option value="archived" ${state.pharmacyStatus === 'archived' ? 'selected' : ''}>Archived</option>
      </select>
      <select class="form-select" id="settings-pharmacy-page-size">
        ${[25,30,50].map(size => `<option value="${size}" ${state.pharmacyPageSize === size ? 'selected' : ''}>${size} / page</option>`).join('')}
      </select>
    </div>
  `;
}

function renderPharmacyOverrideRows() {
  if (state.loadingPharmacies) return '<tr><td colspan="8"><div class="settings-loading-row">Loading pharmacy settings…</div></td></tr>';
  if (!state.pharmacies.length) return '<tr><td colspan="8"><div class="empty-state"><div class="empty-state-title">No pharmacies match these filters</div></div></td></tr>';
  return state.pharmacies.map(pharmacy => {
    const operational = getOperational(pharmacy);
    const enabled = enabledModuleCount(pharmacy.module_features);
    return `
      <tr>
        <td><strong>${esc(pharmacy.name)}</strong><div class="text-xs text-muted">${esc(pharmacy.address || pharmacy.email || 'No address')}</div></td>
        <td><span class="badge badge-gray">${esc(pharmacy.currency_code || 'NLE')} ${esc(pharmacy.currency_symbol || 'Le')}</span></td>
        <td><span class="badge ${pharmacy.tax_enabled ? 'badge-success' : 'badge-gray'}">${pharmacy.tax_enabled ? `${Number(pharmacy.tax_rate || 0)}%` : 'Disabled'}</span></td>
        <td><span class="badge ${pharmacy.discount_enabled ? 'badge-success' : 'badge-gray'}">${yesNo(pharmacy.discount_enabled)}</span></td>
        <td>${Number(operational.default_low_stock_threshold ?? 5)}</td>
        <td><strong>${enabled}/${MODULES.length}</strong><div class="text-xs text-muted">enabled</div></td>
        <td>${esc(formatDate(pharmacy.updated_at))}</td>
        <td><div class="settings-row-actions"><button class="btn btn-primary btn-sm" data-edit-pharmacy-settings="${pharmacy.id}">Edit Settings</button><button class="btn btn-ghost btn-sm" data-reset-pharmacy-settings="${pharmacy.id}">Reset</button></div></td>
      </tr>
    `;
  }).join('');
}

function renderFeatureControls() {
  const defaults = normalizeModules(state.platform?.settings?.module_features);
  return `
    <div class="settings-form-stack">
      <div class="settings-section-card">
        <div class="settings-section-heading">
          <div><h3>Default Modules for New Pharmacies</h3><p>Choose which workspaces are available when a new tenant is created.</p></div>
          <span class="badge badge-gray">${enabledModuleCount(defaults)}/${MODULES.length} enabled</span>
        </div>
        <div class="module-toggle-grid" id="platform-module-grid">
          ${MODULES.map(([key, label, description]) => moduleToggle(key, label, description, defaults[key], 'platform-module')).join('')}
        </div>
        <div class="settings-feature-actions">
          <input class="form-input" id="feature-default-note" maxlength="180" placeholder="Optional change note" />
          <button type="button" class="btn btn-primary" id="save-platform-modules" ${state.migrationRequired ? 'disabled' : ''}>Save Default Modules</button>
        </div>
      </div>

      <div class="settings-section-card">
        <div class="settings-section-heading"><div><h3>Per-Pharmacy Feature Controls</h3><p>Restrict optional workspaces for a specific pharmacy. Dashboard and core authentication remain available.</p></div></div>
        ${renderPharmacyToolbar()}
        <div class="table-container settings-table-wrap">
          <table class="settings-table">
            <thead><tr><th>Pharmacy</th><th>Status</th><th>Modules Enabled</th><th>Disabled Modules</th><th>Actions</th></tr></thead>
            <tbody>${renderFeatureRows()}</tbody>
          </table>
        </div>
        <div class="settings-table-footer">
          <span>${state.pharmacyCount.toLocaleString()} pharmacies</span>
          ${renderPagination(state.pharmacyPage, state.pharmacyPageCount, 'pharmacy')}
        </div>
      </div>
    </div>
  `;
}

function renderFeatureRows() {
  if (state.loadingPharmacies) return '<tr><td colspan="5"><div class="settings-loading-row">Loading module controls…</div></td></tr>';
  if (!state.pharmacies.length) return '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-title">No pharmacies match these filters</div></div></td></tr>';
  return state.pharmacies.map(pharmacy => {
    const disabled = disabledModuleNames(pharmacy.module_features);
    return `
      <tr>
        <td><strong>${esc(pharmacy.name)}</strong><div class="text-xs text-muted">${esc(pharmacy.email || pharmacy.address || '—')}</div></td>
        <td><span class="badge ${pharmacy.is_active ? 'badge-success' : 'badge-gray'}">${esc(pharmacy.platform_status || (pharmacy.is_active ? 'active' : 'disabled'))}</span></td>
        <td><strong>${enabledModuleCount(pharmacy.module_features)}/${MODULES.length}</strong></td>
        <td>${disabled.length ? `<div class="settings-disabled-modules">${disabled.slice(0,4).map(name => `<span>${esc(name)}</span>`).join('')}${disabled.length > 4 ? `<span>+${disabled.length - 4} more</span>` : ''}</div>` : '<span class="text-muted">All modules enabled</span>'}</td>
        <td><button class="btn btn-primary btn-sm" data-manage-modules="${pharmacy.id}">Manage Modules</button></td>
      </tr>
    `;
  }).join('');
}

function renderAuditHistory() {
  return `
    <div class="settings-section-card">
      <div class="settings-section-heading"><div><h3>Configuration Audit History</h3><p>Track platform-default, pharmacy-override and module-access changes.</p></div></div>
      <div class="settings-directory-toolbar settings-audit-toolbar">
        <select class="form-select" id="settings-audit-scope">
          <option value="all" ${state.auditScope === 'all' ? 'selected' : ''}>All changes</option>
          <option value="platform" ${state.auditScope === 'platform' ? 'selected' : ''}>Platform defaults</option>
          <option value="pharmacy" ${state.auditScope === 'pharmacy' ? 'selected' : ''}>Pharmacy settings</option>
        </select>
        <select class="form-select" id="settings-audit-page-size">
          ${[25,30,50].map(size => `<option value="${size}" ${state.auditPageSize === size ? 'selected' : ''}>${size} / page</option>`).join('')}
        </select>
      </div>
      <div class="table-container settings-table-wrap">
        <table class="settings-table">
          <thead><tr><th>Date</th><th>Scope</th><th>Pharmacy</th><th>Section</th><th>Action</th><th>Changed By</th><th>Note</th><th></th></tr></thead>
          <tbody>${renderAuditRows()}</tbody>
        </table>
      </div>
      <div class="settings-table-footer">
        <span>${state.auditCount.toLocaleString()} audited changes</span>
        ${renderPagination(state.auditPage, state.auditPageCount, 'audit')}
      </div>
    </div>
  `;
}

function renderAuditRows() {
  if (state.loadingAudit) return '<tr><td colspan="8"><div class="settings-loading-row">Loading audit history…</div></td></tr>';
  if (!state.auditRows.length) return `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-title">${state.migrationRequired ? 'Apply the settings migration to begin audit logging' : 'No configuration changes recorded yet'}</div></div></td></tr>`;
  return state.auditRows.map(row => `
    <tr>
      <td>${esc(formatDate(row.created_at))}</td>
      <td><span class="badge ${row.scope === 'platform' ? 'badge-info' : 'badge-gray'}">${esc(row.scope)}</span></td>
      <td>${esc(row.pharmacy_name || 'Platform')}</td>
      <td>${esc(humanize(row.section))}</td>
      <td>${esc(humanize(row.action))}</td>
      <td>${esc(row.actor_name || 'System')}</td>
      <td>${esc(row.note || '—')}</td>
      <td><button class="btn btn-ghost btn-sm" data-view-audit="${row.id}">View</button></td>
    </tr>
  `).join('');
}

function humanize(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function currencyOptions(selected) {
  const options = [
    ['NLE', 'NLE — Sierra Leonean Leone'],
    ['SLL', 'SLL — Sierra Leonean Leone (legacy code)'],
    ['USD', 'USD — United States Dollar'],
    ['GBP', 'GBP — British Pound'],
    ['EUR', 'EUR — Euro'],
    ['NGN', 'NGN — Nigerian Naira'],
    ['GHS', 'GHS — Ghanaian Cedi'],
    ['ZAR', 'ZAR — South African Rand']
  ];
  return options.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function timezoneOptions(selected) {
  const values = ['Africa/Freetown', 'UTC', 'Africa/Monrovia', 'Africa/Accra', 'Africa/Lagos', 'Europe/London'];
  return values.map(value => `<option value="${value}" ${selected === value ? 'selected' : ''}>${value}</option>`).join('');
}

function toggleField(id, label, description, checked) {
  return `
    <label class="settings-toggle-field" for="${id}">
      <span><strong>${label}</strong><small>${description}</small></span>
      <span class="settings-switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} /><span></span></span>
    </label>
  `;
}

function moduleToggle(key, label, description, checked, prefix) {
  const id = `${prefix}-${key}`;
  return `
    <label class="module-toggle-card" for="${id}">
      <span class="module-toggle-copy"><strong>${esc(label)}</strong><small>${esc(description)}</small></span>
      <span class="settings-switch"><input type="checkbox" id="${id}" data-module-key="${key}" ${checked !== false ? 'checked' : ''} /><span></span></span>
    </label>
  `;
}

function bindBaseActions(container, user) {
  container.querySelectorAll('[data-settings-tab]').forEach(button => {
    button.addEventListener('click', async () => {
      const tab = button.dataset.settingsTab;
      if (!tab || tab === state.tab) return;
      state.tab = tab;
      renderView(container, user);
      if (tab === 'audit' && !state.auditRows.length && !state.migrationRequired) await reloadAudit(container, user);
    });
  });
}

function bindActiveTabActions(container, user) {
  if (state.tab === 'platform') bindPlatformActions(container, user);
  if (state.tab === 'pharmacies') bindPharmacyDirectoryActions(container, user, { featuresOnly: false });
  if (state.tab === 'features') bindFeatureActions(container, user);
  if (state.tab === 'audit') bindAuditActions(container, user);
}

function bindPlatformActions(container, user) {
  const color = container.querySelector('#platform-branding-color');
  const text = container.querySelector('#platform-branding-text');
  color?.addEventListener('input', () => { if (text) text.value = color.value.toUpperCase(); });
  text?.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(text.value)) color.value = text.value;
  });

  container.querySelector('#platform-defaults-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.migrationRequired) return;
    const button = container.querySelector('#save-platform-defaults');
    button.disabled = true;
    try {
      const payload = collectPlatformForm(container);
      validateSettingsPayload(payload);
      state.platform = await updateSuperAdminPlatformSettings(payload, container.querySelector('#platform-change-note')?.value || '');
      showToast('Platform defaults updated successfully', 'success');
      await reloadPharmacies(container, user, { preservePage: true, rerender: false });
      renderView(container, user);
    } catch (error) {
      showToast(error.message || 'Failed to save platform defaults', 'error');
      button.disabled = false;
    }
  });
}

function collectPlatformForm(container) {
  return {
    branding_color: container.querySelector('#platform-branding-text')?.value?.trim() || '#2563eb',
    currency_code: container.querySelector('#platform-currency-code')?.value || 'NLE',
    currency_symbol: container.querySelector('#platform-currency-symbol')?.value?.trim() || 'Le',
    timezone: container.querySelector('#platform-timezone')?.value || 'Africa/Freetown',
    tax_enabled: Boolean(container.querySelector('#platform-tax-enabled')?.checked),
    tax_rate: Number(container.querySelector('#platform-tax-rate')?.value || 0),
    discount_enabled: Boolean(container.querySelector('#platform-discount-enabled')?.checked),
    discount_rules: {
      max_discount: Number(container.querySelector('#platform-max-discount')?.value || 0),
      min_cart_amount: Number(container.querySelector('#platform-min-cart')?.value || 0)
    },
    default_low_stock_threshold: Number(container.querySelector('#platform-low-stock')?.value || 0),
    receipt_footer: container.querySelector('#platform-receipt-footer')?.value?.trim() || ''
  };
}

function validateSettingsPayload(payload) {
  if (!/^#[0-9a-f]{6}$/i.test(payload.branding_color || '')) throw new Error('Branding color must be a six-digit hex color.');
  if (Number(payload.tax_rate) < 0 || Number(payload.tax_rate) > 100) throw new Error('Tax rate must be between 0 and 100.');
  const maxDiscount = Number(payload.discount_rules?.max_discount || 0);
  if (maxDiscount < 0 || maxDiscount > 100) throw new Error('Maximum discount must be between 0 and 100.');
  if (Number(payload.discount_rules?.min_cart_amount || 0) < 0) throw new Error('Minimum cart amount cannot be negative.');
  if (Number(payload.default_low_stock_threshold ?? payload.operational_settings?.default_low_stock_threshold ?? 0) < 0) throw new Error('Low stock threshold cannot be negative.');
  const footer = payload.receipt_footer ?? payload.operational_settings?.receipt_footer ?? '';
  if (String(footer).length > 300) throw new Error('Receipt footer must be 300 characters or fewer.');
}

function bindPharmacyDirectoryActions(container, user, { featuresOnly }) {
  bindPharmacyToolbar(container, user);
  container.querySelectorAll('[data-pharmacy-page]').forEach(button => {
    button.addEventListener('click', async () => {
      const next = Number(button.dataset.pharmacyPage || 1);
      if (button.disabled || next < 1 || next > state.pharmacyPageCount || next === state.pharmacyPage) return;
      state.pharmacyPage = next;
      await reloadPharmacies(container, user);
    });
  });

  if (!featuresOnly) {
    container.querySelectorAll('[data-edit-pharmacy-settings]').forEach(button => {
      button.addEventListener('click', () => showPharmacySettingsModal(button.dataset.editPharmacySettings, container, user));
    });
    container.querySelectorAll('[data-reset-pharmacy-settings]').forEach(button => {
      button.addEventListener('click', async () => {
        const pharmacy = state.pharmacies.find(item => item.id === button.dataset.resetPharmacySettings);
        if (!pharmacy) return;
        const confirmed = await showConfirm(`Reset ${esc(pharmacy.name)} to the current platform defaults? Branding, currency, tax, discount, operational defaults and module access will be reset. The pharmacy logo and business identity are kept.`);
        if (!confirmed) return;
        button.disabled = true;
        try {
          await resetSuperAdminPharmacyConfiguration(pharmacy.id, 'Reset from Super Admin Settings');
          showToast(`${pharmacy.name} reset to platform defaults`, 'success');
          await refreshSettingsData(container, user);
        } catch (error) {
          showToast(error.message || 'Failed to reset pharmacy settings', 'error');
          button.disabled = false;
        }
      });
    });
  }
}

function bindPharmacyToolbar(container, user) {
  const search = container.querySelector('#settings-pharmacy-search');
  search?.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(async () => {
      state.pharmacySearch = search.value.trim();
      state.pharmacyPage = 1;
      await reloadPharmacies(container, user);
    }, 300);
  });

  container.querySelector('#settings-pharmacy-status')?.addEventListener('change', async event => {
    state.pharmacyStatus = event.target.value;
    state.pharmacyPage = 1;
    await reloadPharmacies(container, user);
  });

  container.querySelector('#settings-pharmacy-page-size')?.addEventListener('change', async event => {
    state.pharmacyPageSize = Number(event.target.value || 30);
    state.pharmacyPage = 1;
    await reloadPharmacies(container, user);
  });
}

async function reloadPharmacies(container, user, { preservePage = true, rerender = true } = {}) {
  state.loadingPharmacies = true;
  if (rerender) renderView(container, user);
  try {
    const result = await getSuperAdminPharmaciesPage({
      page: preservePage ? state.pharmacyPage : 1,
      pageSize: state.pharmacyPageSize,
      search: state.pharmacySearch,
      status: state.pharmacyStatus
    });
    applyPharmacyResult(result);
  } catch (error) {
    showToast(error.message || 'Failed to load pharmacies', 'error');
  } finally {
    state.loadingPharmacies = false;
    if (rerender) renderView(container, user);
  }
}

async function refreshSettingsData(container, user) {
  try {
    const [platformResult, pharmacyResult, auditResult] = await Promise.all([
      getSuperAdminPlatformSettings(),
      getSuperAdminPharmaciesPage({ page: state.pharmacyPage, pageSize: state.pharmacyPageSize, search: state.pharmacySearch, status: state.pharmacyStatus }),
      getSuperAdminSettingsAuditPage({ page: state.auditPage, pageSize: state.auditPageSize, scope: state.auditScope })
    ]);
    state.platform = platformResult;
    state.migrationRequired = Boolean(platformResult?.migrationRequired || auditResult?.migrationRequired);
    applyPharmacyResult(pharmacyResult);
    applyAuditResult(auditResult);
    renderView(container, user);
  } catch (error) {
    showToast(error.message || 'Failed to refresh settings', 'error');
  }
}

async function showPharmacySettingsModal(pharmacyId, container, user) {
  try {
    const detail = await getSuperAdminPharmacyConfiguration(pharmacyId);
    const pharmacy = detail.pharmacy || {};
    const operational = getOperational(pharmacy);
    const rules = pharmacy.discount_rules || {};
    const { overlay, closeModal } = createModal({
      id: 'super-admin-pharmacy-settings',
      title: `Settings: ${esc(pharmacy.name || 'Pharmacy')}`,
      size: 'modal-xl',
      body: `
        ${detail.migrationRequired ? '<div class="alert alert-warning">Apply the Super Admin Settings migration before saving these controls.</div>' : ''}
        <div class="settings-modal-sections">
          <section class="settings-modal-section">
            <h4>Brand & Locale</h4>
            <div class="settings-form-grid">
              <label class="form-group settings-form-span-2"><span class="form-label">Logo URL</span><input type="url" class="form-input" id="ph-logo-url" value="${esc(pharmacy.logo_url || '')}" placeholder="https://…" /></label>
              <label class="form-group"><span class="form-label">Branding Color</span><input type="color" class="form-input settings-color-input" id="ph-branding-color" value="${esc(pharmacy.branding_color || '#2563eb')}" /></label>
              <label class="form-group"><span class="form-label">Currency</span><select class="form-select" id="ph-currency-code">${currencyOptions(pharmacy.currency_code || 'NLE')}</select></label>
              <label class="form-group"><span class="form-label">Currency Symbol</span><input class="form-input" id="ph-currency-symbol" maxlength="6" value="${esc(pharmacy.currency_symbol || 'Le')}" /></label>
              <label class="form-group"><span class="form-label">Timezone</span><select class="form-select" id="ph-timezone">${timezoneOptions(pharmacy.timezone || 'Africa/Freetown')}</select></label>
            </div>
          </section>

          <section class="settings-modal-section">
            <h4>Sales Configuration</h4>
            <div class="settings-form-grid">
              ${toggleField('ph-tax-enabled', 'Tax Enabled', 'Apply automatic tax calculation for this pharmacy', pharmacy.tax_enabled)}
              <label class="form-group"><span class="form-label">Tax Rate (%)</span><input type="number" class="form-input" id="ph-tax-rate" min="0" max="100" step="0.01" value="${Number(pharmacy.tax_rate || 0)}" /></label>
              ${toggleField('ph-discount-enabled', 'Discounts Enabled', 'Allow the existing staff discount workflow', pharmacy.discount_enabled !== false)}
              <label class="form-group"><span class="form-label">Maximum Discount (%)</span><input type="number" class="form-input" id="ph-max-discount" min="0" max="100" step="0.01" value="${Number(rules.max_discount ?? 10)}" /></label>
              <label class="form-group"><span class="form-label">Minimum Cart Amount</span><input type="number" class="form-input" id="ph-min-cart" min="0" step="0.01" value="${Number(rules.min_cart_amount ?? 0)}" /></label>
            </div>
          </section>

          <section class="settings-modal-section">
            <h4>Inventory & Receipts</h4>
            <div class="settings-form-grid">
              <label class="form-group"><span class="form-label">Default Low Stock Threshold</span><input type="number" class="form-input" id="ph-low-stock" min="0" step="1" value="${Number(operational.default_low_stock_threshold ?? 5)}" /></label>
              <label class="form-group settings-form-span-2"><span class="form-label">Receipt Footer</span><textarea class="form-input" id="ph-receipt-footer" rows="3" maxlength="300">${esc(operational.receipt_footer || '')}</textarea></label>
            </div>
          </section>

          <section class="settings-modal-section">
            <h4>Audit Note</h4>
            <input class="form-input" id="ph-change-note" maxlength="180" placeholder="Optional reason for this settings change" />
            ${detail.recent_changes?.length ? `<div class="settings-recent-changes"><strong>Recent changes</strong>${detail.recent_changes.slice(0,3).map(change => `<div><span>${esc(formatDate(change.created_at))}</span><span>${esc(humanize(change.section))}</span><span>${esc(change.actor_name || 'Super Admin')}</span></div>`).join('')}</div>` : ''}
          </section>
        </div>
      `,
      footer: `
        <button type="button" class="btn btn-ghost" id="ph-settings-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="ph-settings-save" ${detail.migrationRequired ? 'disabled' : ''}>Save Settings</button>
      `
    });

    overlay.querySelector('#ph-settings-cancel')?.addEventListener('click', closeModal);
    overlay.querySelector('#ph-settings-save')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const payload = {
          logo_url: overlay.querySelector('#ph-logo-url')?.value?.trim() || '',
          branding_color: overlay.querySelector('#ph-branding-color')?.value || '#2563eb',
          currency_code: overlay.querySelector('#ph-currency-code')?.value || 'NLE',
          currency_symbol: overlay.querySelector('#ph-currency-symbol')?.value?.trim() || 'Le',
          timezone: overlay.querySelector('#ph-timezone')?.value || 'Africa/Freetown',
          tax_enabled: Boolean(overlay.querySelector('#ph-tax-enabled')?.checked),
          tax_rate: Number(overlay.querySelector('#ph-tax-rate')?.value || 0),
          discount_enabled: Boolean(overlay.querySelector('#ph-discount-enabled')?.checked),
          discount_rules: {
            max_discount: Number(overlay.querySelector('#ph-max-discount')?.value || 0),
            min_cart_amount: Number(overlay.querySelector('#ph-min-cart')?.value || 0)
          },
          operational_settings: {
            default_low_stock_threshold: Number(overlay.querySelector('#ph-low-stock')?.value || 0),
            receipt_footer: overlay.querySelector('#ph-receipt-footer')?.value?.trim() || ''
          }
        };
        validateSettingsPayload(payload);
        await updateSuperAdminPharmacyConfiguration(pharmacy.id, payload, overlay.querySelector('#ph-change-note')?.value || '', 'pharmacy_overrides');
        showToast(`${pharmacy.name} settings updated`, 'success');
        closeModal();
        await refreshSettingsData(container, user);
      } catch (error) {
        showToast(error.message || 'Failed to update pharmacy settings', 'error');
        button.disabled = false;
      }
    });
  } catch (error) {
    showToast(error.message || 'Failed to load pharmacy settings', 'error');
  }
}

function bindFeatureActions(container, user) {
  bindPharmacyDirectoryActions(container, user, { featuresOnly: true });

  container.querySelector('#save-platform-modules')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const moduleFeatures = collectModules(container, 'platform-module');
      state.platform = await updateSuperAdminPlatformSettings({ module_features: moduleFeatures }, container.querySelector('#feature-default-note')?.value || '');
      showToast('Default module availability updated', 'success');
      await refreshSettingsData(container, user);
    } catch (error) {
      showToast(error.message || 'Failed to save default modules', 'error');
      button.disabled = false;
    }
  });

  container.querySelectorAll('[data-manage-modules]').forEach(button => {
    button.addEventListener('click', () => showModuleModal(button.dataset.manageModules, container, user));
  });
}

function collectModules(root, prefix) {
  return Object.fromEntries(MODULES.map(([key]) => [key, Boolean(root.querySelector(`#${prefix}-${key}`)?.checked)]));
}

async function showModuleModal(pharmacyId, container, user) {
  try {
    const detail = await getSuperAdminPharmacyConfiguration(pharmacyId);
    const pharmacy = detail.pharmacy || {};
    const features = normalizeModules(pharmacy.module_features);
    const defaults = normalizeModules(detail.platform_defaults?.module_features || state.platform?.settings?.module_features);
    const { overlay, closeModal } = createModal({
      id: 'pharmacy-module-controls',
      title: `Module Access: ${esc(pharmacy.name || 'Pharmacy')}`,
      size: 'modal-xl',
      body: `
        <div class="settings-inline-note">Disabled modules are removed from pharmacy role navigation and blocked by the client-side workspace guard. Database RLS remains the security boundary.</div>
        <div class="module-toggle-grid settings-modal-module-grid">
          ${MODULES.map(([key, label, description]) => moduleToggle(key, label, description, features[key], 'ph-module')).join('')}
        </div>
        <label class="form-group"><span class="form-label">Change Note <span class="text-muted">(optional)</span></span><input class="form-input" id="ph-module-note" maxlength="180" placeholder="Why are these modules being changed?" /></label>
      `,
      footer: `
        <button type="button" class="btn btn-ghost" id="ph-module-defaults">Use Platform Defaults</button>
        <button type="button" class="btn btn-ghost" id="ph-module-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="ph-module-save" ${detail.migrationRequired ? 'disabled' : ''}>Save Module Access</button>
      `
    });

    overlay.querySelector('#ph-module-cancel')?.addEventListener('click', closeModal);
    overlay.querySelector('#ph-module-defaults')?.addEventListener('click', () => {
      MODULES.forEach(([key]) => {
        const input = overlay.querySelector(`#ph-module-${key}`);
        if (input) input.checked = defaults[key] !== false;
      });
    });
    overlay.querySelector('#ph-module-save')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await updateSuperAdminPharmacyConfiguration(
          pharmacy.id,
          { module_features: collectModules(overlay, 'ph-module') },
          overlay.querySelector('#ph-module-note')?.value || '',
          'module_features'
        );
        showToast(`${pharmacy.name} module access updated`, 'success');
        closeModal();
        await refreshSettingsData(container, user);
      } catch (error) {
        showToast(error.message || 'Failed to update module access', 'error');
        button.disabled = false;
      }
    });
  } catch (error) {
    showToast(error.message || 'Failed to load module access', 'error');
  }
}

function bindAuditActions(container, user) {
  container.querySelector('#settings-audit-scope')?.addEventListener('change', async event => {
    state.auditScope = event.target.value;
    state.auditPage = 1;
    await reloadAudit(container, user);
  });
  container.querySelector('#settings-audit-page-size')?.addEventListener('change', async event => {
    state.auditPageSize = Number(event.target.value || 30);
    state.auditPage = 1;
    await reloadAudit(container, user);
  });
  container.querySelectorAll('[data-audit-page]').forEach(button => {
    button.addEventListener('click', async () => {
      const next = Number(button.dataset.auditPage || 1);
      if (button.disabled || next < 1 || next > state.auditPageCount || next === state.auditPage) return;
      state.auditPage = next;
      await reloadAudit(container, user);
    });
  });
  container.querySelectorAll('[data-view-audit]').forEach(button => {
    button.addEventListener('click', () => {
      const row = state.auditRows.find(item => item.id === button.dataset.viewAudit);
      if (row) showAuditModal(row);
    });
  });
}

async function reloadAudit(container, user) {
  state.loadingAudit = true;
  renderView(container, user);
  try {
    const result = await getSuperAdminSettingsAuditPage({ page: state.auditPage, pageSize: state.auditPageSize, scope: state.auditScope });
    applyAuditResult(result);
    state.migrationRequired = state.migrationRequired || Boolean(result.migrationRequired);
  } catch (error) {
    showToast(error.message || 'Failed to load audit history', 'error');
  } finally {
    state.loadingAudit = false;
    renderView(container, user);
  }
}

function showAuditModal(row) {
  const cleanPrevious = cleanAuditJson(row.previous_values);
  const cleanNew = cleanAuditJson(row.new_values);
  createModal({
    id: 'settings-audit-detail',
    title: `Configuration Change · ${esc(formatDate(row.created_at))}`,
    size: 'modal-xl',
    body: `
      <div class="settings-audit-detail-meta">
        <div><span>Scope</span><strong>${esc(humanize(row.scope))}</strong></div>
        <div><span>Pharmacy</span><strong>${esc(row.pharmacy_name || 'Platform')}</strong></div>
        <div><span>Changed By</span><strong>${esc(row.actor_name || 'System')}</strong></div>
        <div><span>Section</span><strong>${esc(humanize(row.section))}</strong></div>
      </div>
      ${row.note ? `<div class="settings-audit-note"><strong>Change note:</strong> ${esc(row.note)}</div>` : ''}
      <div class="settings-audit-json-grid">
        <div><h4>Before</h4><pre>${esc(JSON.stringify(cleanPrevious, null, 2))}</pre></div>
        <div><h4>After</h4><pre>${esc(JSON.stringify(cleanNew, null, 2))}</pre></div>
      </div>
    `
  });
}

function cleanAuditJson(value) {
  if (!value || typeof value !== 'object') return value || {};
  const hidden = new Set(['owner_id', 'updated_by']);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !hidden.has(key)));
}
