import { getSalesPage, getSalesFilteredSummary, getBranches, getPharmacyStaff, createSalesReturn, supabase } from '../../database.js';
import { formatCurrency, formatDateTime, showToast } from '../../utils.js';
import { createModal } from '../../components/modal.js';
import { isViewLifecycleActive, registerViewCleanup } from '../../view-lifecycle.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function utcStartOfDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function getSalesDateRange(state) {
  const today = utcStartOfDay();
  const tomorrow = new Date(today.getTime() + 86400000);

  switch (state.datePreset) {
    case 'today':
      return { start: today.toISOString(), end: tomorrow.toISOString(), label: 'Today' };
    case 'yesterday': {
      const start = new Date(today.getTime() - 86400000);
      return { start: start.toISOString(), end: today.toISOString(), label: 'Yesterday' };
    }
    case 'last7': {
      const start = new Date(today.getTime() - (6 * 86400000));
      return { start: start.toISOString(), end: tomorrow.toISOString(), label: 'Last 7 Days' };
    }
    case 'this_month': {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
      return { start: start.toISOString(), end: end.toISOString(), label: 'This Month' };
    }
    case 'custom': {
      const start = state.dateFrom ? new Date(`${state.dateFrom}T00:00:00.000Z`) : null;
      const endBase = state.dateTo ? new Date(`${state.dateTo}T00:00:00.000Z`) : null;
      const end = endBase ? new Date(endBase.getTime() + 86400000) : null;
      const label = state.dateFrom || state.dateTo
        ? `${state.dateFrom || 'Start'} → ${state.dateTo || 'Now'}`
        : 'Custom Range';
      return { start: start?.toISOString() || null, end: end?.toISOString() || null, label };
    }
    default:
      return { start: null, end: null, label: 'All Time' };
  }
}

function renderSalesPagination(page, totalPages) {
  const current = Math.max(1, Number(page) || 1);
  const total = Math.max(1, Number(totalPages) || 1);
  const pages = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]);
  const valid = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const parts = [];
  let previous = 0;
  valid.forEach((number) => {
    if (previous && number - previous > 1) parts.push('<span class="sales-page-ellipsis">…</span>');
    parts.push(`<button type="button" class="btn btn-ghost btn-sm sales-page-btn ${number === current ? 'active' : ''}" data-sales-page="${number}">${number}</button>`);
    previous = number;
  });

  return `
    <div class="sales-pagination">
      <button type="button" class="btn btn-ghost btn-sm" data-sales-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>← Previous</button>
      <div class="sales-page-numbers">${parts.join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-sales-page="${current + 1}" ${current >= total ? 'disabled' : ''}>Next →</button>
    </div>
  `;
}

export async function renderSales(container, user, lifecycleToken, initialSearch = '') {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = '<div class="alert alert-warning">No pharmacy linked.</div>';
    return;
  }

  const state = {
    page: 1,
    pageSize: 30,
    search: initialSearch || '',
    branchId: '',
    paymentMethod: '',
    staffId: '',
    datePreset: initialSearch ? 'all' : 'this_month',
    dateFrom: '',
    dateTo: ''
  };

  try {
    const [branches, staff] = await Promise.all([
      getBranches(pharmacyId),
      getPharmacyStaff(pharmacyId)
    ]);
    if (!isViewLifecycleActive(lifecycleToken)) return;

    const branchMap = new Map((branches || []).map((branch) => [branch.id, branch.name]));
    let currentSales = [];
    let searchTimer = null;
    let loadSequence = 0;

    container.innerHTML = `
      <div class="animate-in admin-sales-page">
        <div class="page-header">
          <div>
            <div class="page-title">Sales</div>
            <div class="page-subtitle">Review transactions, payment mix and staff activity without loading the full sales history.</div>
          </div>
          <button class="btn btn-primary" id="new-sale-btn">+ New Sale</button>
        </div>

        <div class="stats-grid sales-stats-grid sales-filtered-stats">
          <div class="stat-card"><div class="stat-card-header"><span class="stat-card-label">Revenue</span><div class="stat-card-icon teal">&#128176;</div></div><div class="stat-card-value" id="sales-summary-revenue">—</div><div class="stat-card-change" id="sales-period-label">This Month</div></div>
          <div class="stat-card"><div class="stat-card-header"><span class="stat-card-label">Completed Sales</span><div class="stat-card-icon orange">&#128179;</div></div><div class="stat-card-value" id="sales-summary-transactions">—</div><div class="stat-card-change">Transactions in current filter</div></div>
          <div class="stat-card"><div class="stat-card-header"><span class="stat-card-label">Average Sale</span><div class="stat-card-icon blue">&#128200;</div></div><div class="stat-card-value" id="sales-summary-average">—</div><div class="stat-card-change">Revenue ÷ completed sales</div></div>
          <div class="stat-card"><div class="stat-card-header"><span class="stat-card-label">Cash</span><div class="stat-card-icon green">&#128181;</div></div><div class="stat-card-value" id="sales-summary-cash">—</div><div class="stat-card-change">Cash payments</div></div>
          <div class="stat-card"><div class="stat-card-header"><span class="stat-card-label">Mobile Money</span><div class="stat-card-icon purple">&#128241;</div></div><div class="stat-card-value" id="sales-summary-mobile">—</div><div class="stat-card-change">Mobile money payments</div></div>
          <div class="stat-card"><div class="stat-card-header"><span class="stat-card-label">Card</span><div class="stat-card-icon darkgreen">&#128179;</div></div><div class="stat-card-value" id="sales-summary-card">—</div><div class="stat-card-change" id="sales-summary-discount">Discounts: —</div></div>
        </div>

        <div class="card sales-transactions-card">
          <div class="card-header sales-card-header">
            <div>
              <span class="card-title">Transactions</span>
              <div class="text-xs text-muted sales-result-summary" id="sales-result-summary">Loading sales…</div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="sales-refresh-btn">Refresh</button>
          </div>

          <div class="sales-filter-panel">
            <div class="search-box sales-search-box">
              <span style="color:var(--gray-400)">&#128269;</span>
              <input type="text" id="sales-search" placeholder="Search invoice or customer…" value="${escapeHtml(state.search)}" />
            </div>
            <select class="form-select" id="sales-date-preset">
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7">Last 7 Days</option>
              <option value="this_month" ${state.datePreset === 'this_month' ? 'selected' : ''}>This Month</option>
              <option value="all" ${state.datePreset === 'all' ? 'selected' : ''}>All Time</option>
              <option value="custom">Custom Range</option>
            </select>
            <select class="form-select" id="branch-filter">
              <option value="">All Branches</option>
              ${(branches || []).map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join('')}
            </select>
            <select class="form-select" id="staff-filter">
              <option value="">All Staff</option>
              ${(staff || []).map((person) => `<option value="${person.id}">${escapeHtml(person.full_name || person.email || 'Staff')} · ${escapeHtml(person.role || '')}</option>`).join('')}
            </select>
            <select class="form-select" id="payment-filter">
              <option value="">All Payments</option>
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="card">Card</option>
            </select>
            <select class="form-select sales-page-size" id="sales-page-size" title="Sales per page">
              <option value="25">25 / page</option>
              <option value="30" selected>30 / page</option>
              <option value="50">50 / page</option>
            </select>
            <button type="button" class="btn btn-ghost btn-sm" id="sales-reset-filters">Reset</button>
          </div>

          <div class="sales-custom-date-row" id="sales-custom-date-row" hidden>
            <div class="form-group"><label class="form-label" for="date-filter-from">From</label><input type="date" id="date-filter-from" class="form-input" /></div>
            <div class="form-group"><label class="form-label" for="date-filter-to">To</label><input type="date" id="date-filter-to" class="form-input" /></div>
          </div>

          <div class="table-container sales-table-container">
            <table>
              <thead><tr><th>Invoice</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Staff</th><th>Branch</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody id="sales-tbody"><tr><td colspan="10"><div class="empty-state"><div class="empty-state-title">Loading sales…</div></div></td></tr></tbody>
            </table>
          </div>
          <div class="sales-pagination-wrap" id="sales-pagination-wrap"></div>
        </div>
      </div>
    `;

    const setLoading = (loading) => {
      const card = container.querySelector('.sales-transactions-card');
      if (card) card.setAttribute('aria-busy', loading ? 'true' : 'false');
      const refresh = document.getElementById('sales-refresh-btn');
      if (refresh) refresh.disabled = loading;
    };

    const loadSales = async ({ keepPage = true } = {}) => {
      if (!keepPage) state.page = 1;
      const requestId = ++loadSequence;
      setLoading(true);
      const range = getSalesDateRange(state);

      try {
        const filters = {
          page: state.page,
          pageSize: state.pageSize,
          branchId: state.branchId || null,
          paymentMethod: state.paymentMethod || null,
          staffId: state.staffId || null,
          start: range.start,
          end: range.end,
          search: state.search
        };

        const [pageResult, summary] = await Promise.all([
          getSalesPage(pharmacyId, filters),
          getSalesFilteredSummary(pharmacyId, filters)
        ]);

        if (!isViewLifecycleActive(lifecycleToken) || requestId !== loadSequence) return;

        if (state.page > pageResult.totalPages) {
          state.page = pageResult.totalPages;
          return loadSales({ keepPage: true });
        }

        currentSales = pageResult.data || [];
        document.getElementById('sales-tbody').innerHTML = renderRows(currentSales, branchMap);
        bindViewActions(currentSales, branchMap);

        const startIndex = pageResult.total ? ((pageResult.page - 1) * pageResult.pageSize) + 1 : 0;
        const endIndex = Math.min(pageResult.total, pageResult.page * pageResult.pageSize);
        document.getElementById('sales-result-summary').textContent = pageResult.total
          ? `Showing ${startIndex.toLocaleString()}–${endIndex.toLocaleString()} of ${pageResult.total.toLocaleString()} matching sales`
          : 'No matching sales';
        document.getElementById('sales-pagination-wrap').innerHTML = `
          <div class="sales-pagination-info">Page ${pageResult.page} of ${pageResult.totalPages} · ${pageResult.pageSize} sales per page</div>
          ${renderSalesPagination(pageResult.page, pageResult.totalPages)}
        `;

        document.getElementById('sales-summary-revenue').textContent = formatCurrency(summary.totalRevenue);
        document.getElementById('sales-summary-transactions').textContent = Number(summary.totalTransactions || 0).toLocaleString();
        document.getElementById('sales-summary-average').textContent = formatCurrency(summary.averageSale);
        document.getElementById('sales-summary-cash').textContent = formatCurrency(summary.paymentBreakdown?.cash || 0);
        document.getElementById('sales-summary-mobile').textContent = formatCurrency(summary.paymentBreakdown?.mobile_money || 0);
        document.getElementById('sales-summary-card').textContent = formatCurrency(summary.paymentBreakdown?.card || 0);
        document.getElementById('sales-summary-discount').textContent = `Discounts: ${formatCurrency(summary.totalDiscount || 0)}`;
        document.getElementById('sales-period-label').textContent = range.label;
      } catch (err) {
        if (!isViewLifecycleActive(lifecycleToken) || requestId !== loadSequence) return;
        console.error('Failed to load paged sales:', err);
        document.getElementById('sales-tbody').innerHTML = `<tr><td colspan="10"><div class="alert alert-danger">Failed to load sales: ${escapeHtml(err.message)}</div></td></tr>`;
      } finally {
        if (requestId === loadSequence) setLoading(false);
      }
    };

    document.getElementById('new-sale-btn')?.addEventListener('click', () => {
      import('../app.js').then((module) => module.navigate('pos'));
    });

    document.getElementById('sales-search')?.addEventListener('input', (event) => {
      state.search = event.target.value.trim();
      if (searchTimer) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => void loadSales({ keepPage: false }), 350);
    });

    document.getElementById('sales-date-preset')?.addEventListener('change', (event) => {
      state.datePreset = event.target.value;
      const customRow = document.getElementById('sales-custom-date-row');
      if (customRow) customRow.hidden = state.datePreset !== 'custom';
      void loadSales({ keepPage: false });
    });

    document.getElementById('branch-filter')?.addEventListener('change', (event) => {
      state.branchId = event.target.value;
      void loadSales({ keepPage: false });
    });
    document.getElementById('staff-filter')?.addEventListener('change', (event) => {
      state.staffId = event.target.value;
      void loadSales({ keepPage: false });
    });
    document.getElementById('payment-filter')?.addEventListener('change', (event) => {
      state.paymentMethod = event.target.value;
      void loadSales({ keepPage: false });
    });
    document.getElementById('sales-page-size')?.addEventListener('change', (event) => {
      state.pageSize = Number(event.target.value) || 30;
      void loadSales({ keepPage: false });
    });

    const onCustomDateChange = () => {
      state.dateFrom = document.getElementById('date-filter-from')?.value || '';
      state.dateTo = document.getElementById('date-filter-to')?.value || '';
      if (state.dateFrom || state.dateTo) void loadSales({ keepPage: false });
    };
    document.getElementById('date-filter-from')?.addEventListener('change', onCustomDateChange);
    document.getElementById('date-filter-to')?.addEventListener('change', onCustomDateChange);

    document.getElementById('sales-reset-filters')?.addEventListener('click', () => {
      state.page = 1;
      state.pageSize = 30;
      state.search = '';
      state.branchId = '';
      state.paymentMethod = '';
      state.staffId = '';
      state.datePreset = 'this_month';
      state.dateFrom = '';
      state.dateTo = '';
      const values = {
        'sales-search': '', 'branch-filter': '', 'payment-filter': '', 'staff-filter': '',
        'sales-date-preset': 'this_month', 'sales-page-size': '30', 'date-filter-from': '', 'date-filter-to': ''
      };
      Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
      const customRow = document.getElementById('sales-custom-date-row');
      if (customRow) customRow.hidden = true;
      void loadSales({ keepPage: true });
    });

    document.getElementById('sales-refresh-btn')?.addEventListener('click', () => void loadSales({ keepPage: true }));

    document.getElementById('sales-pagination-wrap')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-sales-page]');
      if (!button || button.disabled) return;
      const nextPage = Number(button.dataset.salesPage);
      if (!nextPage || nextPage === state.page) return;
      state.page = nextPage;
      void loadSales({ keepPage: true });
      container.querySelector('.sales-transactions-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    let realtimeTimer = null;
    const queueRealtimeRefresh = () => {
      if (!isViewLifecycleActive(lifecycleToken) || document.visibilityState !== 'visible') return;
      if (realtimeTimer) window.clearTimeout(realtimeTimer);
      realtimeTimer = window.setTimeout(() => {
        realtimeTimer = null;
        void loadSales({ keepPage: true });
      }, 1800);
    };

    const salesChannel = supabase
      .channel(`admin-sales-page-${pharmacyId}-${lifecycleToken}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `pharmacy_id=eq.${pharmacyId}` }, queueRealtimeRefresh)
      .subscribe();

    registerViewCleanup(lifecycleToken, () => {
      if (searchTimer) window.clearTimeout(searchTimer);
      if (realtimeTimer) window.clearTimeout(realtimeTimer);
      void supabase.removeChannel(salesChannel);
    });

    await loadSales({ keepPage: true });
  } catch (err) {
    if (!isViewLifecycleActive(lifecycleToken)) return;
    container.innerHTML = `<div class="alert alert-danger">Failed to load sales: ${escapeHtml(err.message)}</div>`;
  }
}

function renderRows(sales, branchMap) {
  if (!sales.length) {
    return '<tr><td colspan="10"><div class="empty-state"><div class="empty-state-icon">&#128176;</div><div class="empty-state-title">No sales found</div><div class="empty-state-desc">Try changing the date, branch, staff or payment filters.</div></div></td></tr>';
  }

  const paymentColors = { cash: 'badge-success', mobile_money: 'badge-info', card: 'badge-primary' };
  const statusColors = { completed: 'badge-success', pending: 'badge-warning', cancelled: 'badge-danger' };

  return sales.map((sale) => `
    <tr>
      <td class="font-semibold text-sm">${escapeHtml(sale.invoice_number)}</td>
      <td class="text-sm">${escapeHtml(sale.customers?.name || 'Walk-in')}</td>
      <td class="text-sm text-muted">${(sale.sale_items || []).length} item(s)</td>
      <td class="font-semibold sales-money-cell">${formatCurrency(sale.total_amount)}</td>
      <td><span class="badge ${paymentColors[sale.payment_method] || 'badge-gray'}">${escapeHtml((sale.payment_method || 'unknown').replace('_', ' '))}</span></td>
      <td class="text-sm"><div class="font-semibold">${escapeHtml(sale.staff_name || 'Unknown staff')}</div><div class="text-xs text-muted">${escapeHtml(sale.staff_role || '')}</div></td>
      <td class="text-sm text-muted">${escapeHtml(branchMap.get(sale.branch_id) || 'Unassigned')}</td>
      <td class="text-xs text-muted">${formatDateTime(sale.created_at)}</td>
      <td><span class="badge ${statusColors[sale.status] || 'badge-gray'}">${escapeHtml(sale.status || 'unknown')}</span></td>
      <td><button class="btn btn-ghost btn-sm view-sale-btn" data-id="${sale.id}">View</button></td>
    </tr>
  `).join('');
}

function bindViewActions(sales, branchMap) {
  const currentById = new Map(sales.map((sale) => [sale.id, sale]));
  document.querySelectorAll('.view-sale-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const saleId = button.dataset.id;
      try {
        const { data: freshSale, error } = await supabase
          .from('sales')
          .select('*, customers(name), sale_items(*)')
          .eq('id', saleId)
          .single();
        if (error) throw error;
        if (!freshSale) return;
        const context = currentById.get(saleId) || {};
        showSaleDetail({
          ...freshSale,
          staff_name: context.staff_name || 'Unknown staff',
          staff_role: context.staff_role || '',
          branch_name: branchMap.get(freshSale.branch_id) || 'Unassigned'
        });
      } catch (error) {
        console.error('Error fetching sale:', error);
        showToast('Error loading receipt', 'error');
      }
    });
  });
}

function showSaleDetail(sale) {
  const validItems = (sale.sale_items || []).filter((item) => Number(item.quantity || 0) > 0);
  const itemsSubtotal = validItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0);
  const discount = Number(sale.discount || 0);
  const itemsHtml = validItems.map((item) => `
    <tr>
      <td>${escapeHtml(item.product_name)}</td>
      <td class="text-center">${Number(item.quantity || 0).toLocaleString()}</td>
      <td>${formatCurrency(item.unit_price)}</td>
      <td class="font-semibold">${formatCurrency(item.total_price)}</td>
    </tr>
  `).join('');

  const body = `
    <div class="sales-receipt-meta">
      <div><span class="text-xs text-muted">Customer</span><strong>${escapeHtml(sale.customers?.name || 'Walk-in Customer')}</strong></div>
      <div><span class="text-xs text-muted">Staff</span><strong>${escapeHtml(sale.staff_name || 'Unknown staff')}</strong><small>${escapeHtml(sale.staff_role || '')}</small></div>
      <div><span class="text-xs text-muted">Branch</span><strong>${escapeHtml(sale.branch_name || 'Unassigned')}</strong></div>
      <div><span class="text-xs text-muted">Payment</span><strong>${escapeHtml((sale.payment_method || 'unknown').replace('_', ' '))}</strong></div>
      <div><span class="text-xs text-muted">Date</span><strong>${formatDateTime(sale.created_at)}</strong></div>
      <div><span class="text-xs text-muted">Status</span><strong>${escapeHtml((sale.status || 'completed').toUpperCase())}</strong></div>
    </div>
    <div class="table-container">
      <table><thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>${itemsHtml || '<tr><td colspan="4" class="text-center text-muted">No items</td></tr>'}</tbody></table>
    </div>
    <div class="sales-receipt-totals">
      <div><span>Line items subtotal</span><strong>${formatCurrency(itemsSubtotal)}</strong></div>
      ${discount ? `<div><span>Recorded discount</span><strong>-${formatCurrency(discount)}</strong></div>` : ''}
      <div class="sales-receipt-grand-total"><span>Stored sale total</span><strong>${formatCurrency(sale.total_amount)}</strong></div>
      ${sale.notes ? `<div class="sales-receipt-notes"><span class="text-xs text-muted">Notes</span><p>${escapeHtml(sale.notes)}</p></div>` : ''}
    </div>
  `;

  const footer = `
    <button class="btn btn-ghost" id="close-sale-detail">Close</button>
    ${sale.status === 'completed' ? '<button class="btn btn-warning" id="return-sale-btn">↩️ Return Sale</button>' : ''}
  `;

  const modal = createModal({ id: 'sale-detail', title: `Receipt - ${escapeHtml(sale.invoice_number)}`, body, footer, size: 'modal-lg' });
  document.getElementById('close-sale-detail')?.addEventListener('click', modal.closeModal);
  document.getElementById('return-sale-btn')?.addEventListener('click', () => {
    modal.closeModal();
    setTimeout(() => showReturnForm(sale), 250);
  });
}

function showReturnForm(sale) {
  // Only show items that have quantity > 0 (not fully returned)
  const availableItems = (sale.sale_items || []).filter(item => item.quantity > 0);
  
  if (availableItems.length === 0) {
    showToast('No items available to return on this sale', 'info');
    return;
  }

  const itemsOptions = availableItems.map((item, idx) => `
    <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;border:1px solid var(--gray-300);border-radius:6px;margin-bottom:0.5rem">
      <input type="checkbox" class="return-item-checkbox" data-index="${idx}" data-product-id="${item.product_id}" data-quantity="${item.quantity}" data-unit-price="${item.unit_price}" data-product-name="${item.product_name}" onchange="updateReturnTotal()">
      <div style="flex:1">
        <div style="font-weight:600;font-size:0.95rem">${item.product_name}</div>
        <div style="color:var(--gray-500);font-size:0.85rem">Qty: ${item.quantity} × ${formatCurrency(item.unit_price)}</div>
      </div>
      <div style="font-weight:600;color:var(--gray-700)">${formatCurrency(item.total_price)}</div>
    </div>
  `).join('');

  const body = `
    <div class="form-group">
      <label class="form-label">Select Items to Return</label>
      <div id="return-items-container">
        ${itemsOptions}
      </div>
      <div style="margin-top:1rem;padding:1rem;background:var(--gray-100);border-radius:6px">
        <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem">
          <span>Refund Amount:</span>
          <span style="font-weight:600;color:var(--success);font-size:1.1rem" id="refund-amount">${formatCurrency(0)}</span>
        </div>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Reason for Return *</label>
      <select id="return-reason" class="form-select" required>
        <option value="">-- Select reason --</option>
        <option value="Defective">Defective</option>
        <option value="Expired">Expired</option>
        <option value="Wrong Item">Wrong Item</option>
        <option value="Customer Request">Customer Request</option>
        <option value="Other">Other</option>
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">Notes (Optional)</label>
      <textarea id="return-notes" class="form-input" rows="3" placeholder="Add any additional notes..."></textarea>
    </div>
  `;

  const footer = `
    <button class="btn btn-ghost" id="cancel-return-btn">Cancel</button>
    <button class="btn btn-danger" id="confirm-return-btn">Process Return</button>
  `;

  const modal = createModal({
    id: 'return-form',
    title: `Return Sale - ${sale.invoice_number}`,
    body,
    footer
  });

  // Global functions for the return form
  window.updateReturnTotal = () => {
    const checkboxes = document.querySelectorAll('.return-item-checkbox:checked');
    let total = 0;
    checkboxes.forEach(cb => {
      const quantity = parseInt(cb.dataset.quantity);
      const unitPrice = parseFloat(cb.dataset.unitPrice);
      total += quantity * unitPrice;
    });
    const refundEl = document.getElementById('refund-amount');
    if (refundEl) refundEl.textContent = formatCurrency(total);
  };

  // Attach event listeners
  document.getElementById('cancel-return-btn')?.addEventListener('click', modal.closeModal);
  document.getElementById('confirm-return-btn')?.addEventListener('click', async () => {
    const reason = document.getElementById('return-reason')?.value;
    const notes = document.getElementById('return-notes')?.value;
    const checkboxes = document.querySelectorAll('.return-item-checkbox:checked');

    if (!reason) {
      showToast('Please select a reason for return', 'error');
      return;
    }

    if (checkboxes.length === 0) {
      showToast('Please select at least one item to return', 'error');
      return;
    }

    try {
      const { data: userData } = await supabase.auth.getUser();
      const returnItems = Array.from(checkboxes).map(cb => ({
        product_id: cb.dataset.productId,
        product_name: cb.dataset.productName,
        quantity: parseInt(cb.dataset.quantity),
        unit_price: parseFloat(cb.dataset.unitPrice)
      }));

      const totalRefund = returnItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);

      // Create the return
      const returnPayload = {
        sale_id: sale.id,
        customer_id: sale.customer_id || null,
        reason: reason,
        total_refund: totalRefund,
        notes: notes || '',
        created_by: userData.user.id,
        pharmacy_id: sale.pharmacy_id,
        status: 'completed'
      };

      const ret = await createSalesReturn(returnPayload, returnItems);

      // Close modal
      modal.closeModal();

      showToast(`✓ Return processed successfully! ${formatCurrency(totalRefund)} refunded. ${returnItems.length} item(s) restocked.`, 'success');
      
      // Refresh only the Sales SPA view. Avoid a browser-level reload, which would
      // rebuild the whole application and cause unrelated startup queries.
      window.setTimeout(() => {
        import('../app.js').then(m => m.navigate('sales'));
      }, 400);
    } catch (error) {
      console.error('Error processing return:', error);
      showToast(`Error: ${error.message}`, 'error');
    }
  });
}
