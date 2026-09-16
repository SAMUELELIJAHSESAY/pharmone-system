import {
  getCustomersPage,
  getCustomerMetricsForIds,
  getCustomerSalesPage,
  getCustomerSalesSummary,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getPharmacySettings
} from '../../database.js';
import { formatDate, formatDateTime, formatCurrency, showToast, showConfirm } from '../../utils.js';
import { createModal } from '../../components/modal.js';

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function customerStatus(customer, metric = {}) {
  const purchases = Number(metric.purchaseCount || 0);
  const createdAt = customer?.created_at ? new Date(customer.created_at) : null;
  const lastPurchase = metric.lastPurchaseAt ? new Date(metric.lastPurchaseAt) : null;
  const now = Date.now();
  const daysSinceCreated = createdAt ? (now - createdAt.getTime()) / 86400000 : Infinity;
  const daysSincePurchase = lastPurchase ? (now - lastPurchase.getTime()) / 86400000 : Infinity;

  if (purchases === 0) {
    return daysSinceCreated <= 30
      ? { label: 'New', className: 'customer-status-new', description: 'No completed purchase yet' }
      : { label: 'Inactive', className: 'customer-status-inactive', description: 'No completed purchases' };
  }
  if (daysSincePurchase > 90) {
    return { label: 'Inactive', className: 'customer-status-inactive', description: 'No purchase in 90+ days' };
  }
  if (purchases >= 5) {
    return { label: 'Frequent', className: 'customer-status-frequent', description: `${purchases} completed purchases` };
  }
  if (purchases >= 2) {
    return { label: 'Returning', className: 'customer-status-returning', description: `${purchases} completed purchases` };
  }
  return { label: 'New', className: 'customer-status-new', description: 'First completed purchase' };
}

function renderCustomerPagination(page, totalPages) {
  const current = Math.max(1, Number(page) || 1);
  const total = Math.max(1, Number(totalPages) || 1);
  const pages = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]);
  const valid = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const parts = [];
  let previous = 0;
  valid.forEach((number) => {
    if (previous && number - previous > 1) parts.push('<span class="customer-page-ellipsis">…</span>');
    parts.push(`<button type="button" class="btn btn-ghost btn-sm customer-page-btn ${number === current ? 'active' : ''}" data-customer-page="${number}">${number}</button>`);
    previous = number;
  });

  return `
    <div class="customer-pagination">
      <button type="button" class="btn btn-ghost btn-sm" data-customer-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>← Previous</button>
      <div class="customer-page-numbers">${parts.join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-customer-page="${current + 1}" ${current >= total ? 'disabled' : ''}>Next →</button>
    </div>
  `;
}

function renderHistoryPagination(page, totalPages) {
  const current = Math.max(1, Number(page) || 1);
  const total = Math.max(1, Number(totalPages) || 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const valid = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  return `
    <div class="customer-history-pagination">
      <button type="button" class="btn btn-ghost btn-sm" data-history-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>← Previous</button>
      <div class="customer-history-page-numbers">
        ${valid.map((number) => `<button type="button" class="btn btn-ghost btn-sm ${number === current ? 'active' : ''}" data-history-page="${number}">${number}</button>`).join('')}
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-history-page="${current + 1}" ${current >= total ? 'disabled' : ''}>Next →</button>
    </div>
  `;
}

export async function renderCustomers(container, user, initialSearch = '') {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = '<div class="alert alert-warning">No pharmacy linked.</div>';
    return;
  }

  if (!window.pharmacySettings?.currency_symbol) {
    try {
      const settings = await getPharmacySettings(pharmacyId);
      window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    } catch (_) {
      window.pharmacySettings = { currency_symbol: 'Le', currency_code: 'NLE' };
    }
  }

  const state = {
    page: 1,
    pageSize: 30,
    search: initialSearch || ''
  };
  let currentCustomers = [];
  let currentMetrics = {};
  let searchTimer = null;
  let loadSequence = 0;

  container.innerHTML = `
    <div class="animate-in admin-customers-page">
      <div class="page-header">
        <div>
          <div class="page-title">Customers</div>
          <div class="page-subtitle">Manage customer profiles, purchase history and spending activity without loading the full customer list at once.</div>
        </div>
        <button class="btn btn-primary" id="add-customer-btn">+ Add Customer</button>
      </div>

      <div class="card customers-card">
        <div class="card-header customers-card-header">
          <div>
            <span class="card-title">Customer Directory</span>
            <div class="text-xs text-muted" id="customer-result-summary">Loading customers…</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="customer-refresh-btn">Refresh</button>
        </div>

        <div class="customer-filter-panel">
          <div class="search-box customer-search-box">
            <span style="color:var(--gray-400)">&#128269;</span>
            <input type="text" id="customer-search" value="${escapeHtml(state.search)}" placeholder="Search name, phone, email or address…" />
          </div>
          <select class="form-select customer-page-size" id="customer-page-size" title="Customers per page">
            <option value="25">25 / page</option>
            <option value="30" selected>30 / page</option>
            <option value="50">50 / page</option>
          </select>
          <button type="button" class="btn btn-ghost btn-sm" id="customer-clear-search">Clear</button>
        </div>

        <div class="table-container customer-table-container">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th>Address</th>
                <th>Status</th>
                <th>Purchases</th>
                <th>Lifetime Spend</th>
                <th>Last Purchase</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="customers-tbody">
              <tr><td colspan="8"><div class="empty-state"><div class="empty-state-title">Loading customers…</div></div></td></tr>
            </tbody>
          </table>
        </div>
        <div class="customer-pagination-wrap" id="customer-pagination-wrap"></div>
      </div>
    </div>
  `;

  const tbody = container.querySelector('#customers-tbody');
  const card = container.querySelector('.customers-card');
  const summaryEl = container.querySelector('#customer-result-summary');
  const paginationWrap = container.querySelector('#customer-pagination-wrap');
  const searchInput = container.querySelector('#customer-search');

  const renderRows = () => {
    if (!currentCustomers.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">&#128100;</div><div class="empty-state-title">No customers found</div><div class="empty-state-desc">${state.search ? 'Try another search or clear the filter.' : 'Add your first customer to get started.'}</div></div></td></tr>`;
      return;
    }

    tbody.innerHTML = currentCustomers.map((customer) => {
      const metric = currentMetrics[customer.id] || {};
      const status = customerStatus(customer, metric);
      return `
        <tr>
          <td>
            <div class="font-semibold customer-name">${escapeHtml(customer.name)}</div>
            <div class="text-xs text-muted">Customer since ${formatDate(customer.created_at)}</div>
          </td>
          <td>
            <div class="text-sm">${escapeHtml(customer.phone || '—')}</div>
            <div class="text-xs text-muted customer-email">${escapeHtml(customer.email || 'No email')}</div>
          </td>
          <td class="text-sm text-muted customer-address">${escapeHtml(customer.address || '—')}</td>
          <td>
            <span class="customer-status-badge ${status.className}">${status.label}</span>
            <div class="text-xs text-muted customer-status-help">${escapeHtml(status.description)}</div>
          </td>
          <td>
            <div class="font-semibold">${Number(metric.purchaseCount || 0).toLocaleString()}</div>
            <div class="text-xs text-muted">completed sales</div>
          </td>
          <td>
            <div class="font-semibold customer-money-value">${formatCurrency(metric.totalSpent || 0)}</div>
            <div class="text-xs text-muted">Avg ${formatCurrency(metric.averagePurchase || 0)}</div>
          </td>
          <td class="text-sm">${metric.lastPurchaseAt ? formatDateTime(metric.lastPurchaseAt) : 'Never'}</td>
          <td>
            <div class="customer-row-actions">
              <button class="btn btn-primary btn-sm view-customer-btn" data-id="${customer.id}">View</button>
              <button class="btn btn-ghost btn-sm edit-customer-btn" data-id="${customer.id}">Edit</button>
              <button class="btn btn-ghost btn-sm delete-customer-btn" data-id="${customer.id}" style="color:var(--danger)">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  };

  const bindRows = () => {
    const customerMap = Object.fromEntries(currentCustomers.map((customer) => [customer.id, customer]));
    container.querySelectorAll('.view-customer-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const customer = customerMap[button.dataset.id];
        if (customer) showCustomerProfile(customer, user, () => loadPage(false));
      });
    });
    container.querySelectorAll('.edit-customer-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const customer = customerMap[button.dataset.id];
        if (customer) showCustomerModal(customer, user, () => loadPage(false));
      });
    });
    container.querySelectorAll('.delete-customer-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const customer = customerMap[button.dataset.id];
        if (!customer) return;
        const confirmed = await showConfirm(`Delete ${customer.name}? Existing sales will remain but will no longer be linked to this customer.`);
        if (!confirmed) return;
        try {
          await deleteCustomer(customer.id);
          showToast('Customer deleted');
          await loadPage(true);
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  };

  const bindPagination = () => {
    paginationWrap.querySelectorAll('[data-customer-page]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextPage = Number(button.dataset.customerPage);
        if (!nextPage || nextPage === state.page || button.disabled) return;
        state.page = nextPage;
        loadPage(false);
      });
    });
  };

  const loadPage = async (keepPageInRange = false) => {
    const sequence = ++loadSequence;
    card?.setAttribute('aria-busy', 'true');
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-title">Loading customers…</div></div></td></tr>`;
    summaryEl.textContent = 'Loading customers…';

    try {
      let pageResult = await getCustomersPage(pharmacyId, state);
      if (sequence !== loadSequence) return;

      if (keepPageInRange && pageResult.totalPages < state.page) {
        state.page = pageResult.totalPages;
        pageResult = await getCustomersPage(pharmacyId, state);
        if (sequence !== loadSequence) return;
      }

      currentCustomers = pageResult.data || [];
      currentMetrics = await getCustomerMetricsForIds(pharmacyId, currentCustomers.map((customer) => customer.id));
      if (sequence !== loadSequence) return;

      state.page = pageResult.page;
      const start = pageResult.total ? ((pageResult.page - 1) * pageResult.pageSize) + 1 : 0;
      const end = Math.min(pageResult.page * pageResult.pageSize, pageResult.total);
      summaryEl.textContent = `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${pageResult.total.toLocaleString()} customers`;
      renderRows();
      bindRows();
      paginationWrap.innerHTML = `
        <div class="customer-pagination-info">Page ${pageResult.page.toLocaleString()} of ${pageResult.totalPages.toLocaleString()} · ${pageResult.pageSize} customers per page</div>
        ${renderCustomerPagination(pageResult.page, pageResult.totalPages)}
      `;
      bindPagination();
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="alert alert-danger">Failed to load customers: ${escapeHtml(error.message)}</div></td></tr>`;
      summaryEl.textContent = 'Customer loading failed';
      paginationWrap.innerHTML = '';
    } finally {
      if (sequence === loadSequence) card?.removeAttribute('aria-busy');
    }
  };

  container.querySelector('#add-customer-btn').addEventListener('click', () => showCustomerModal(null, user, () => loadPage(true)));
  container.querySelector('#customer-refresh-btn').addEventListener('click', () => loadPage(false));
  container.querySelector('#customer-page-size').addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value) || 30;
    state.page = 1;
    loadPage(false);
  });
  container.querySelector('#customer-clear-search').addEventListener('click', () => {
    state.search = '';
    state.page = 1;
    searchInput.value = '';
    loadPage(false);
  });
  searchInput.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = event.target.value.trim();
      state.page = 1;
      loadPage(false);
    }, 300);
  });

  await loadPage(false);
}

function showCustomerModal(customer, user, reload) {
  const isEdit = !!customer;
  const { overlay, closeModal } = createModal({
    id: 'customer-modal',
    title: isEdit ? 'Edit Customer' : 'Add Customer',
    body: `
      <form id="customer-form">
        <div class="form-group">
          <label class="form-label">Full Name *</label>
          <input type="text" class="form-input" id="cust-name" value="${escapeHtml(customer?.name || '')}" placeholder="Customer name" required />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="tel" class="form-input" id="cust-phone" value="${escapeHtml(customer?.phone || '')}" placeholder="Phone number" />
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="cust-email" value="${escapeHtml(customer?.email || '')}" placeholder="customer@example.com" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" class="form-input" id="cust-addr" value="${escapeHtml(customer?.address || '')}" placeholder="Customer address" />
        </div>
        <div id="cust-err" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-customer">Cancel</button>
      <button class="btn btn-primary" id="save-customer">${isEdit ? 'Save Changes' : 'Add Customer'}</button>
    `
  });

  overlay.querySelector('#cancel-customer').addEventListener('click', closeModal);
  overlay.querySelector('#save-customer').addEventListener('click', async () => {
    const saveButton = overlay.querySelector('#save-customer');
    const errorElement = overlay.querySelector('#cust-err');
    errorElement.classList.add('hidden');

    const payload = {
      name: overlay.querySelector('#cust-name').value.trim(),
      phone: overlay.querySelector('#cust-phone').value.trim(),
      email: overlay.querySelector('#cust-email').value.trim(),
      address: overlay.querySelector('#cust-addr').value.trim(),
      pharmacy_id: user.profile.pharmacy_id
    };
    if (!payload.name) {
      errorElement.textContent = 'Name is required.';
      errorElement.classList.remove('hidden');
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
      if (isEdit) {
        await updateCustomer(customer.id, payload);
        showToast('Customer updated');
      } else {
        await createCustomer(payload);
        showToast('Customer added');
      }
      closeModal();
      await reload();
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.classList.remove('hidden');
      saveButton.disabled = false;
      saveButton.textContent = isEdit ? 'Save Changes' : 'Add Customer';
    }
  });
}

async function showCustomerProfile(customer, user, reloadCustomers) {
  const pharmacyId = user.profile.pharmacy_id;
  const { overlay, closeModal } = createModal({
    id: 'customer-profile',
    title: escapeHtml(customer.name),
    size: 'modal-xl',
    body: `
      <div class="customer-profile-shell">
        <div class="customer-profile-loading"><div class="empty-state"><div class="empty-state-title">Loading customer profile…</div></div></div>
      </div>
    `,
    footer: `
      <button type="button" class="btn btn-ghost" id="customer-profile-close">Close</button>
      <button type="button" class="btn btn-primary" id="customer-profile-edit">Edit Customer</button>
    `
  });

  overlay.querySelector('#customer-profile-close').addEventListener('click', closeModal);
  overlay.querySelector('#customer-profile-edit').addEventListener('click', () => {
    closeModal();
    setTimeout(() => showCustomerModal(customer, user, reloadCustomers), 220);
  });

  const shell = overlay.querySelector('.customer-profile-shell');
  let historyPage = 1;
  let historyPageSize = 10;
  let summary = null;

  const renderProfileHeader = () => {
    const status = customerStatus(customer, {
      purchaseCount: summary?.purchaseCount || 0,
      lastPurchaseAt: summary?.lastPurchaseAt || null
    });
    return `
      <div class="customer-profile-top">
        <div class="customer-profile-identity">
          <div class="customer-profile-avatar">${escapeHtml((customer.name || '?').trim().charAt(0).toUpperCase())}</div>
          <div>
            <h3>${escapeHtml(customer.name)}</h3>
            <div class="customer-profile-contact">${escapeHtml(customer.phone || 'No phone')} · ${escapeHtml(customer.email || 'No email')}</div>
            <div class="text-sm text-muted">${escapeHtml(customer.address || 'No address recorded')}</div>
            <div class="customer-profile-meta">Customer since ${formatDate(customer.created_at)} <span class="customer-status-badge ${status.className}">${status.label}</span></div>
          </div>
        </div>
      </div>
      <div class="customer-profile-stats">
        <div class="stat-card"><div class="stat-card-label">Lifetime Spend</div><div class="stat-card-value customer-money-value">${formatCurrency(summary?.totalSpent || 0)}</div><div class="stat-card-change">Completed purchases only</div></div>
        <div class="stat-card"><div class="stat-card-label">Total Purchases</div><div class="stat-card-value">${Number(summary?.purchaseCount || 0).toLocaleString()}</div><div class="stat-card-change">Completed sales</div></div>
        <div class="stat-card"><div class="stat-card-label">Average Purchase</div><div class="stat-card-value customer-money-value">${formatCurrency(summary?.averagePurchase || 0)}</div><div class="stat-card-change">Lifetime average</div></div>
        <div class="stat-card"><div class="stat-card-label">Last Purchase</div><div class="stat-card-value customer-last-purchase">${summary?.lastPurchaseAt ? formatDate(summary.lastPurchaseAt) : 'Never'}</div><div class="stat-card-change">Most recent completed sale</div></div>
      </div>
      <div class="customer-payment-summary">
        <span><strong>${formatCurrency(summary?.paymentBreakdown?.cash || 0)}</strong><small>Cash</small></span>
        <span><strong>${formatCurrency(summary?.paymentBreakdown?.mobile_money || 0)}</strong><small>Mobile Money</small></span>
        <span><strong>${formatCurrency(summary?.paymentBreakdown?.card || 0)}</strong><small>Card</small></span>
      </div>
    `;
  };

  const loadHistory = async () => {
    const historyHost = shell.querySelector('.customer-history-host');
    if (historyHost) historyHost.innerHTML = '<div class="empty-state"><div class="empty-state-title">Loading purchase history…</div></div>';
    const result = await getCustomerSalesPage(pharmacyId, customer.id, { page: historyPage, pageSize: historyPageSize });
    historyPage = result.page;
    const start = result.total ? ((result.page - 1) * result.pageSize) + 1 : 0;
    const end = Math.min(result.page * result.pageSize, result.total);

    const rows = result.data.length ? result.data.map((sale) => `
      <tr>
        <td class="font-semibold">${escapeHtml(sale.invoice_number)}</td>
        <td class="text-sm customer-history-products">${escapeHtml((sale.sale_items || []).map((item) => item.product_name).slice(0, 3).join(', ') || 'No item details')}${(sale.sale_items || []).length > 3 ? ` +${(sale.sale_items || []).length - 3} more` : ''}</td>
        <td>${(sale.sale_items || []).length}</td>
        <td class="font-semibold customer-money-value">${formatCurrency(sale.total_amount)}</td>
        <td><span class="badge badge-gray">${escapeHtml((sale.payment_method || 'unknown').replace('_', ' '))}</span></td>
        <td><span class="badge ${sale.status === 'completed' ? 'badge-success' : sale.status === 'cancelled' ? 'badge-danger' : 'badge-warning'}">${escapeHtml(sale.status || 'unknown')}</span></td>
        <td class="text-xs text-muted">${formatDateTime(sale.created_at)}</td>
      </tr>
    `).join('') : `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No purchases yet</div><div class="empty-state-desc">Completed and pending customer sales will appear here.</div></div></td></tr>`;

    const next = `
      <div class="customer-history-header">
        <div><h4>Purchase History</h4><div class="text-xs text-muted">Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${result.total.toLocaleString()} transactions</div></div>
        <select class="form-select customer-history-page-size" id="customer-history-page-size">
          <option value="10" ${historyPageSize === 10 ? 'selected' : ''}>10 / page</option>
          <option value="20" ${historyPageSize === 20 ? 'selected' : ''}>20 / page</option>
          <option value="30" ${historyPageSize === 30 ? 'selected' : ''}>30 / page</option>
        </select>
      </div>
      <div class="table-container customer-history-table">
        <table>
          <thead><tr><th>Invoice</th><th>Products</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="customer-history-footer">
        <div class="text-xs text-muted">Page ${result.page} of ${result.totalPages}</div>
        ${renderHistoryPagination(result.page, result.totalPages)}
      </div>
    `;
    shell.querySelector('.customer-history-host').innerHTML = next;

    shell.querySelector('#customer-history-page-size')?.addEventListener('change', (event) => {
      historyPageSize = Number(event.target.value) || 10;
      historyPage = 1;
      loadHistory().catch((error) => showToast(error.message, 'error'));
    });
    shell.querySelectorAll('[data-history-page]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextPage = Number(button.dataset.historyPage);
        if (!nextPage || nextPage === historyPage || button.disabled) return;
        historyPage = nextPage;
        loadHistory().catch((error) => showToast(error.message, 'error'));
      });
    });
  };

  try {
    summary = await getCustomerSalesSummary(pharmacyId, customer.id);
    shell.innerHTML = `${renderProfileHeader()}<div class="customer-history-host"></div>`;
    await loadHistory();
  } catch (error) {
    shell.innerHTML = `<div class="alert alert-danger">Failed to load customer profile: ${escapeHtml(error.message)}</div>`;
  }
}
