import { getCustomers, createCustomer, updateCustomer, deleteCustomer, getSales, enrichSalesWithItems, getPharmacySettings } from '../../database.js';
import { formatDate, formatDateTime, formatCurrency, showToast, showConfirm, debounce } from '../../utils.js';
import { createModal } from '../../components/modal.js';

export async function renderCustomers(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) { container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`; return; }

  try {
    // Ensure pharmacy settings are loaded globally
    if (!window.pharmacySettings?.currency_symbol) {
      const settings = await getPharmacySettings(pharmacyId);
      window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    }
    
    const customers = await getCustomers(pharmacyId);
    renderView(container, customers, user);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load customers: ${err.message}</div>`;
  }
}

function renderView(container, customers, user) {
  container.innerHTML = `
    <div class="animate-in">
      <div class="page-header">
        <div>
          <div class="page-title">Customers</div>
          <div class="page-subtitle">Manage customer records and purchase history</div>
        </div>
        <button class="btn btn-primary" id="add-customer-btn">+ Add Customer</button>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Customers (${customers.length})</span>
          <div class="search-box" style="min-width:220px">
            <span style="color:var(--gray-400)">&#128269;</span>
            <input type="text" id="customer-search" placeholder="Search customers..." />
          </div>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Address</th>
                <th>Since</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="customers-tbody">
              ${renderRows(customers)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const reload = () => renderCustomers(container, user);
  document.getElementById('add-customer-btn').addEventListener('click', () => showCustomerModal(null, user, reload));

  const search = debounce((q) => {
    const filtered = customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
    document.getElementById('customers-tbody').innerHTML = renderRows(filtered);
    bindActions(filtered, user, reload);
  });

  document.getElementById('customer-search').addEventListener('input', (e) => search(e.target.value.toLowerCase()));
  bindActions(customers, user, reload);
}

function renderRows(customers) {
  if (!customers.length) return `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">&#128100;</div><div class="empty-state-title">No customers yet</div><div class="empty-state-desc">Add your first customer to get started</div></div></td></tr>`;

  return customers.map(c => `
    <tr>
      <td class="font-semibold">${c.name}</td>
      <td class="text-sm text-muted">${c.phone || '—'}</td>
      <td class="text-sm text-muted">${c.email || '—'}</td>
      <td class="text-sm text-muted">${c.address || '—'}</td>
      <td class="text-xs text-muted">${formatDate(c.created_at)}</td>
      <td>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm edit-customer-btn" data-id="${c.id}">Edit</button>
          <button class="btn btn-ghost btn-sm history-customer-btn" data-id="${c.id}" data-name="${c.name}">History</button>
          <button class="btn btn-ghost btn-sm delete-customer-btn" data-id="${c.id}" style="color:var(--danger)">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function bindActions(customers, user, reload) {
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]));

  document.querySelectorAll('.edit-customer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = customerMap[btn.dataset.id];
      if (c) showCustomerModal(c, user, reload);
    });
  });

  document.querySelectorAll('.delete-customer-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm('Delete this customer? This cannot be undone.');
      if (!confirmed) return;
      try {
        await deleteCustomer(btn.dataset.id);
        showToast('Customer deleted');
        reload();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  document.querySelectorAll('.history-customer-btn').forEach(btn => {
    btn.addEventListener('click', () => showPurchaseHistory(btn.dataset.id, btn.dataset.name, user));
  });
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
          <input type="text" class="form-input" id="cust-name" value="${customer?.name || ''}" placeholder="John Doe" required />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="tel" class="form-input" id="cust-phone" value="${customer?.phone || ''}" placeholder="+1 555 0000" />
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="cust-email" value="${customer?.email || ''}" placeholder="customer@example.com" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" class="form-input" id="cust-addr" value="${customer?.address || ''}" placeholder="123 Main St" />
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
    const saveBtn = overlay.querySelector('#save-customer');
    const errEl = overlay.querySelector('#cust-err');
    errEl.classList.add('hidden');

    const payload = {
      name: overlay.querySelector('#cust-name').value.trim(),
      phone: overlay.querySelector('#cust-phone').value.trim(),
      email: overlay.querySelector('#cust-email').value.trim(),
      address: overlay.querySelector('#cust-addr').value.trim(),
      pharmacy_id: user.profile.pharmacy_id
    };

    if (!payload.name) { errEl.textContent = 'Name is required.'; errEl.classList.remove('hidden'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      if (isEdit) {
        await updateCustomer(customer.id, payload);
        showToast('Customer updated');
      } else {
        await createCustomer(payload);
        showToast('Customer added');
      }
      closeModal();
      reload();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Add Customer';
    }
  });
}

async function showPurchaseHistory(customerId, customerName, user) {
  const salesData = await getSales(user.profile.pharmacy_id, 200);
  const customerSalesData = salesData.filter(s => s.customer_id === customerId);
  const customerSales = await enrichSalesWithItems(customerSalesData);
  const totalSpent = customerSales.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);

  createModal({
    id: 'purchase-history',
    title: `Purchase History — ${customerName}`,
    size: 'modal-lg',
    body: `
      <div style="display:flex;gap:1rem;margin-bottom:1.25rem">
        <div class="stat-card" style="flex:1;padding:1rem">
          <div class="stat-card-label">Total Purchases</div>
          <div class="stat-card-value" style="font-size:1.5rem">${customerSales.length}</div>
        </div>
        <div class="stat-card" style="flex:1;padding:1rem">
          <div class="stat-card-label">Total Spent</div>
          <div class="stat-card-value" style="font-size:1.5rem;color:var(--success)">${formatCurrency(totalSpent)}</div>
        </div>
      </div>
      <div class="table-container" style="max-height:400px;overflow-y:auto">
        <table>
          <thead><tr><th>Invoice</th><th>Items</th><th>Total</th><th>Payment</th><th>Date</th></tr></thead>
          <tbody>
            ${customerSales.length === 0 ? `<tr><td colspan="5"><div class="empty-state"><div class="empty-state-title">No purchases yet</div></div></td></tr>` :
              customerSales.map(s => `
                <tr>
                  <td class="font-semibold text-sm">${s.invoice_number}</td>
                  <td class="text-sm">${(s.sale_items || []).length}</td>
                  <td class="font-semibold" style="color:var(--success)">${formatCurrency(s.total_amount)}</td>
                  <td><span class="badge badge-gray">${s.payment_method?.replace('_', ' ')}</span></td>
                  <td class="text-xs text-muted">${formatDateTime(s.created_at)}</td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>
    `
  });
}
