import {
  getExpenses,
  getExpensesPage,
  getExpenseFilteredSummary,
  getExpenseCreatorProfiles,
  getExpenseCategories,
  getAllExpenseCategories,
  getBranches,
  createExpense,
  updateExpense,
  deleteExpense,
  approveExpense,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  getRecurringExpenses,
  createRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
  getExpenseAttachments,
  uploadExpenseAttachment,
  getExpenseAttachmentUrl,
  deleteExpenseAttachment
} from '../../database.js';
import { supabase } from '../../config.js';
import { formatCurrency, formatDate, showToast, showConfirm, debounce } from '../../utils.js';
import { createModal } from '../../components/modal.js';

const escapeHtml = (value = '') => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

function formatMethod(value = '') {
  return String(value || '—').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getDateRange(state) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const isoDate = (date) => date.toISOString().slice(0, 10);
  if (state.datePreset === 'all') return { startDate: null, endDate: null, label: 'All Time' };
  if (state.datePreset === 'custom') {
    return { startDate: state.dateFrom || null, endDate: state.dateTo || null, label: 'Custom Range' };
  }
  if (state.datePreset === 'today') return { startDate: isoDate(today), endDate: isoDate(today), label: 'Today' };
  if (state.datePreset === 'last7') {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 6);
    return { startDate: isoDate(start), endDate: isoDate(today), label: 'Last 7 Days' };
  }
  if (state.datePreset === 'this_week') {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    return { startDate: isoDate(start), endDate: isoDate(today), label: 'This Week' };
  }
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { startDate: isoDate(start), endDate: isoDate(today), label: 'This Month' };
}

function pagerMarkup(result) {
  const page = Math.max(1, Number(result.page || 1));
  const totalPages = Math.max(1, Number(result.totalPages || 1));
  const total = Number(result.total || 0);
  const start = total ? ((page - 1) * result.pageSize) + 1 : 0;
  const end = Math.min(total, page * result.pageSize);
  const candidates = [...new Set([1, totalPages, page - 2, page - 1, page, page + 1, page + 2])]
    .filter((n) => n >= 1 && n <= totalPages)
    .sort((a, b) => a - b);
  let previous = 0;
  const pages = candidates.map((number) => {
    const gap = previous && number - previous > 1 ? '<span class="expense-page-ellipsis">…</span>' : '';
    previous = number;
    return `${gap}<button class="btn btn-ghost btn-sm ${number === page ? 'active' : ''}" data-expense-page="${number}">${number}</button>`;
  }).join('');
  return `
    <div class="expense-pagination">
      <div class="text-sm text-muted">Showing ${start}–${end} of ${total} expenses</div>
      <div class="expense-page-actions">
        <button class="btn btn-ghost btn-sm" data-expense-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Previous</button>
        <div class="expense-page-numbers">${pages}</div>
        <button class="btn btn-ghost btn-sm" data-expense-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next →</button>
      </div>
    </div>`;
}

function topEntries(map = {}, limit = 6) {
  return Object.entries(map).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, limit);
}

export async function renderExpenseManagement(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;
  const role = user?.profile?.role || 'salesman';
  if (!pharmacyId) {
    container.innerHTML = '<div class="alert alert-warning">No pharmacy linked to your account.</div>';
    return;
  }

  if (role !== 'admin' && role !== 'super_admin') {
    return renderSalesmanExpenses(container, user);
  }

  try {
    const [categories, branches, recurringResult] = await Promise.all([
      getAllExpenseCategories(pharmacyId),
      getBranches(pharmacyId),
      getRecurringExpenses(pharmacyId)
    ]);
    renderAdminExpenses(container, user, categories || [], branches || [], recurringResult);
  } catch (error) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load expenses: ${escapeHtml(error.message)}</div>`;
  }
}

function renderAdminExpenses(container, user, categories, branches, recurringResult) {
  const pharmacyId = user.profile.pharmacy_id;
  const state = {
    page: 1,
    pageSize: 30,
    search: '',
    branchId: '',
    categoryId: '',
    paymentMethod: '',
    status: 'all',
    datePreset: 'this_month',
    dateFrom: '',
    dateTo: ''
  };
  let currentExpenses = [];
  let creatorMap = {};
  let loadSequence = 0;
  let recurring = recurringResult?.data || [];
  const recurringSupported = recurringResult?.supported !== false;

  container.innerHTML = `
    <div class="animate-in admin-expenses-page">
      <div class="page-header">
        <div>
          <div class="page-title">Expense Management</div>
          <div class="page-subtitle">Track operating costs, approvals, recurring obligations and receipts without loading the full ledger.</div>
        </div>
        <button class="btn btn-primary" id="record-expense-btn">+ Record Expense</button>
      </div>

      <div class="stats-grid expense-headline-grid">
        <button class="stat-card expense-headline-card" data-expense-preset="today"><div class="stat-card-label">Today</div><div class="stat-card-value" id="expense-stat-today">—</div><div class="stat-card-change">Recorded today</div></button>
        <button class="stat-card expense-headline-card" data-expense-preset="this_week"><div class="stat-card-label">This Week</div><div class="stat-card-value" id="expense-stat-week">—</div><div class="stat-card-change">Monday to today</div></button>
        <button class="stat-card expense-headline-card" data-expense-preset="this_month"><div class="stat-card-label">This Month</div><div class="stat-card-value" id="expense-stat-month">—</div><div class="stat-card-change">Operating expenses</div></button>
        <button class="stat-card expense-headline-card" data-expense-status="pending"><div class="stat-card-label">Pending Approval</div><div class="stat-card-value" id="expense-stat-pending">—</div><div class="stat-card-change" id="expense-stat-pending-count">—</div></button>
      </div>

      <div class="tabs expense-tabs">
        <button class="tab-btn active" data-expense-tab="expenses">📋 Expenses</button>
        <button class="tab-btn" data-expense-tab="categories">🏷️ Categories</button>
        <button class="tab-btn" data-expense-tab="recurring">🔁 Recurring</button>
      </div>

      <section id="expense-tab-expenses" class="expense-tab-panel">
        <div class="card expense-ledger-card">
          <div class="card-header expense-card-header">
            <div><div class="card-title">Expense Ledger</div><div class="text-xs text-muted" id="expense-result-summary">Loading expenses…</div></div>
            <button class="btn btn-ghost btn-sm" id="expense-refresh-btn">Refresh</button>
          </div>

          <div class="expense-filter-panel">
            <div class="search-box expense-search-box"><span>🔎</span><input id="expense-search" type="search" placeholder="Search description, receipt or notes…" /></div>
            <select class="form-select" id="expense-date-preset">
              <option value="today">Today</option><option value="last7">Last 7 Days</option><option value="this_week">This Week</option><option value="this_month" selected>This Month</option><option value="all">All Time</option><option value="custom">Custom Range</option>
            </select>
            <select class="form-select" id="expense-branch-filter"><option value="">All Branches</option>${branches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')}</select>
            <select class="form-select" id="expense-category-filter"><option value="">All Categories</option>${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.category_name)}</option>`).join('')}</select>
            <select class="form-select" id="expense-payment-filter"><option value="">All Payments</option><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank Transfer</option><option value="check">Check</option><option value="credit_card">Credit Card</option></select>
            <select class="form-select" id="expense-status-filter"><option value="all">All Statuses</option><option value="approved">Approved</option><option value="pending">Pending</option></select>
            <select class="form-select" id="expense-page-size"><option value="25">25 / page</option><option value="30" selected>30 / page</option><option value="50">50 / page</option></select>
            <button class="btn btn-ghost btn-sm" id="expense-reset-filters">Reset</button>
          </div>
          <div class="expense-custom-date-row" id="expense-custom-date-row" hidden>
            <div class="form-group"><label>From</label><input type="date" class="form-input" id="expense-date-from" /></div>
            <div class="form-group"><label>To</label><input type="date" class="form-input" id="expense-date-to" /></div>
          </div>

          <div class="expense-filter-summary-grid">
            <div><span>Matching Total</span><strong id="expense-filter-total">—</strong></div>
            <div><span>Approved</span><strong id="expense-filter-approved">—</strong></div>
            <div><span>Pending</span><strong id="expense-filter-pending">—</strong></div>
            <div><span>Records</span><strong id="expense-filter-count">—</strong></div>
          </div>

          <div class="table-container expense-table-container">
            <table>
              <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Branch</th><th>Amount</th><th>Payment</th><th>Recorded By</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody id="expense-tbody"><tr><td colspan="9"><div class="empty-state"><div class="empty-state-title">Loading expenses…</div></div></td></tr></tbody>
            </table>
          </div>
          <div id="expense-pagination-wrap"></div>
        </div>

        <div class="expense-analytics-grid">
          <div class="card"><div class="card-header"><span class="card-title">Top Expense Categories</span></div><div class="card-body" id="expense-category-analytics"><p class="text-muted">Loading…</p></div></div>
          <div class="card"><div class="card-header"><span class="card-title">Payment Breakdown</span></div><div class="card-body" id="expense-payment-analytics"><p class="text-muted">Loading…</p></div></div>
        </div>
      </section>

      <section id="expense-tab-categories" class="expense-tab-panel" hidden>
        <div class="section-heading-row"><div><h3>Expense Categories</h3><p class="text-muted text-sm">Control the categories available when recording an expense.</p></div><button class="btn btn-primary btn-sm" id="add-expense-category-btn">+ Add Category</button></div>
        <div class="category-grid expense-category-grid" id="expense-category-grid">${renderCategories(categories)}</div>
      </section>

      <section id="expense-tab-recurring" class="expense-tab-panel" hidden>
        <div class="section-heading-row"><div><h3>Recurring Expenses</h3><p class="text-muted text-sm">Track rent, utilities, internet and other repeat obligations. Templates are recorded manually when due.</p></div>${recurringSupported ? '<button class="btn btn-primary btn-sm" id="add-recurring-expense-btn">+ Add Recurring</button>' : ''}</div>
        ${recurringSupported ? `<div id="recurring-expense-list">${renderRecurring(recurring)}</div>` : `<div class="alert alert-info">Recurring expense templates and receipt uploads require the included Supabase migration <strong>20260916072000_add_expense_management_features.sql</strong>.</div>`}
      </section>
    </div>`;

  const tbody = container.querySelector('#expense-tbody');
  const summaryText = container.querySelector('#expense-result-summary');
  const paginationWrap = container.querySelector('#expense-pagination-wrap');
  const searchInput = container.querySelector('#expense-search');

  const getFilters = () => {
    const range = getDateRange(state);
    return {
      branchId: state.branchId || null,
      startDate: range.startDate,
      endDate: range.endDate,
      categoryId: state.categoryId || null,
      paymentMethod: state.paymentMethod || null,
      status: state.status,
      search: state.search
    };
  };

  const renderRows = () => {
    if (!currentExpenses.length) {
      tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="empty-state-icon">💸</div><div class="empty-state-title">No expenses found</div><div class="empty-state-desc">Try another filter or record a new expense.</div></div></td></tr>';
      return;
    }
    tbody.innerHTML = currentExpenses.map((exp) => {
      const creator = creatorMap[exp.created_by];
      return `<tr>
        <td>${formatDate(exp.expense_date)}</td>
        <td>${escapeHtml(exp.expense_categories?.category_name || 'Uncategorized')}</td>
        <td><div class="font-semibold expense-description-cell">${escapeHtml(exp.description)}</div><div class="text-xs text-muted">${escapeHtml(exp.receipt_number ? `Receipt ${exp.receipt_number}` : 'No receipt number')}</div></td>
        <td>${escapeHtml(exp.branches?.name || 'General')}</td>
        <td><strong class="expense-money-value">${formatCurrency(exp.amount)}</strong></td>
        <td>${escapeHtml(formatMethod(exp.payment_method))}</td>
        <td><div>${escapeHtml(creator?.full_name || creator?.email || 'Unknown')}</div><div class="text-xs text-muted">${escapeHtml(creator?.role || '')}</div></td>
        <td><span class="badge ${exp.is_approved ? 'badge-success' : 'badge-warning'}">${exp.is_approved ? 'Approved' : 'Pending'}</span></td>
        <td><div class="expense-row-actions"><button class="btn btn-primary btn-sm" data-expense-action="view" data-id="${exp.id}">View</button><button class="btn btn-ghost btn-sm" data-expense-action="edit" data-id="${exp.id}">Edit</button>${!exp.is_approved ? `<button class="btn btn-ghost btn-sm" data-expense-action="approve" data-id="${exp.id}">Approve</button>` : ''}</div></td>
      </tr>`;
    }).join('');
  };

  const renderAnalytics = (summary) => {
    const categoriesTop = topEntries(summary.categoryBreakdown);
    const payments = topEntries(summary.paymentBreakdown);
    container.querySelector('#expense-category-analytics').innerHTML = categoriesTop.length
      ? categoriesTop.map(([name, amount]) => `<div class="expense-breakdown-row"><span>${escapeHtml(name)}</span><strong>${formatCurrency(amount)}</strong></div>`).join('')
      : '<p class="text-muted">No category data in this period.</p>';
    container.querySelector('#expense-payment-analytics').innerHTML = payments.length
      ? payments.map(([name, amount]) => `<div class="expense-breakdown-row"><span>${escapeHtml(formatMethod(name))}</span><strong>${formatCurrency(amount)}</strong></div>`).join('')
      : '<p class="text-muted">No payment data in this period.</p>';
  };

  const loadExpenses = async ({ resetPage = false } = {}) => {
    if (resetPage) state.page = 1;
    const requestId = ++loadSequence;
    const filters = getFilters();
    summaryText.textContent = 'Loading expenses…';
    try {
      const [pageResult, summary] = await Promise.all([
        getExpensesPage(pharmacyId, { ...filters, page: state.page, pageSize: state.pageSize }),
        getExpenseFilteredSummary(pharmacyId, filters)
      ]);
      if (requestId !== loadSequence) return;
      if (state.page > pageResult.totalPages) {
        state.page = pageResult.totalPages;
        return loadExpenses();
      }
      currentExpenses = pageResult.data || [];
      creatorMap = await getExpenseCreatorProfiles(currentExpenses.map((exp) => exp.created_by));
      renderRows();
      bindRowActions();
      const range = getDateRange(state);
      summaryText.textContent = `${pageResult.total.toLocaleString()} matching expense${pageResult.total === 1 ? '' : 's'} · ${range.label}`;
      paginationWrap.innerHTML = pagerMarkup(pageResult);
      paginationWrap.querySelectorAll('[data-expense-page]').forEach((button) => button.addEventListener('click', () => {
        const page = Number(button.dataset.expensePage);
        if (page >= 1 && page <= pageResult.totalPages && page !== state.page) { state.page = page; loadExpenses(); }
      }));
      container.querySelector('#expense-filter-total').textContent = formatCurrency(summary.totalAmount);
      container.querySelector('#expense-filter-approved').textContent = formatCurrency(summary.approvedAmount);
      container.querySelector('#expense-filter-pending').textContent = formatCurrency(summary.pendingAmount);
      container.querySelector('#expense-filter-count').textContent = Number(summary.count || 0).toLocaleString();
      renderAnalytics(summary);
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="alert alert-danger">Failed to load expenses: ${escapeHtml(error.message)}</div></td></tr>`;
      summaryText.textContent = 'Expense load failed';
    }
  };

  const loadHeadlineStats = async () => {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const iso = (d) => d.toISOString().slice(0, 10);
    const week = new Date(today); week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
    const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    try {
      const [todayStats, weekStats, monthStats, pendingStats] = await Promise.all([
        getExpenseFilteredSummary(pharmacyId, { startDate: iso(today), endDate: iso(today) }),
        getExpenseFilteredSummary(pharmacyId, { startDate: iso(week), endDate: iso(today) }),
        getExpenseFilteredSummary(pharmacyId, { startDate: iso(month), endDate: iso(today) }),
        getExpenseFilteredSummary(pharmacyId, { startDate: iso(month), endDate: iso(today), status: 'pending' })
      ]);
      container.querySelector('#expense-stat-today').textContent = formatCurrency(todayStats.totalAmount);
      container.querySelector('#expense-stat-week').textContent = formatCurrency(weekStats.totalAmount);
      container.querySelector('#expense-stat-month').textContent = formatCurrency(monthStats.totalAmount);
      container.querySelector('#expense-stat-pending').textContent = formatCurrency(pendingStats.totalAmount);
      container.querySelector('#expense-stat-pending-count').textContent = `${pendingStats.count.toLocaleString()} pending record${pendingStats.count === 1 ? '' : 's'}`;
    } catch (_) {}
  };

  const bindRowActions = () => {
    tbody.querySelectorAll('[data-expense-action]').forEach((button) => button.addEventListener('click', async () => {
      const expense = currentExpenses.find((row) => row.id === button.dataset.id);
      if (!expense) return;
      const action = button.dataset.expenseAction;
      if (action === 'view') return showExpenseDetails(expense, creatorMap[expense.created_by]);
      if (action === 'edit') return showExpenseForm(expense);
      if (action === 'approve') {
        try {
          const { data: auth } = await supabase.auth.getUser();
          await approveExpense(expense.id, auth.user?.id);
          showToast('Expense approved.');
          await Promise.all([loadExpenses(), loadHeadlineStats()]);
        } catch (error) { showToast(error.message, 'error'); }
      }
    }));
  };

  const showExpenseDetails = async (expense, creator) => {
    const { overlay, closeModal } = createModal({
      id: 'expense-detail',
      title: 'Expense Details',
      size: 'modal-lg',
      body: `
        <div class="expense-detail-grid">
          <div><span>Date</span><strong>${formatDate(expense.expense_date)}</strong></div><div><span>Amount</span><strong>${formatCurrency(expense.amount)}</strong></div>
          <div><span>Category</span><strong>${escapeHtml(expense.expense_categories?.category_name || 'Uncategorized')}</strong></div><div><span>Branch</span><strong>${escapeHtml(expense.branches?.name || 'General')}</strong></div>
          <div><span>Payment</span><strong>${escapeHtml(formatMethod(expense.payment_method))}</strong></div><div><span>Status</span><strong>${expense.is_approved ? 'Approved' : 'Pending'}</strong></div>
          <div><span>Recorded By</span><strong>${escapeHtml(creator?.full_name || creator?.email || 'Unknown')}</strong></div><div><span>Receipt #</span><strong>${escapeHtml(expense.receipt_number || '—')}</strong></div>
        </div>
        <div class="expense-detail-block"><span>Description</span><p>${escapeHtml(expense.description)}</p></div>
        <div class="expense-detail-block"><span>Notes</span><p>${escapeHtml(expense.notes || 'No notes')}</p></div>
        <div class="expense-attachment-section"><div class="section-heading-row"><h4>Receipt Attachments</h4><label class="btn btn-ghost btn-sm expense-upload-label">Upload<input type="file" id="expense-receipt-file" accept="image/*,.pdf" hidden /></label></div><div id="expense-attachment-list"><p class="text-muted text-sm">Loading attachments…</p></div></div>`,
      footer: `<button class="btn btn-ghost" id="expense-detail-edit">Edit</button>${!expense.is_approved ? '<button class="btn btn-primary" id="expense-detail-approve">Approve</button>' : ''}<button class="btn btn-danger" id="expense-detail-delete">Delete</button>`
    });

    const attachmentList = overlay.querySelector('#expense-attachment-list');
    let attachments = [];
    const loadAttachments = async () => {
      try {
        const result = await getExpenseAttachments(expense.id);
        if (!result.supported) {
          attachmentList.innerHTML = '<div class="alert alert-info">Receipt uploads require the included expense-feature Supabase migration.</div>';
          overlay.querySelector('.expense-upload-label')?.remove();
          return;
        }
        attachments = result.data || [];
        attachmentList.innerHTML = attachments.length ? attachments.map((item) => `<div class="expense-attachment-row"><button class="btn btn-ghost btn-sm" data-open-attachment="${item.id}">📎 ${escapeHtml(item.file_name)}</button><span class="text-xs text-muted">${Math.max(1, Math.round(Number(item.size_bytes || 0) / 1024)).toLocaleString()} KB</span><button class="btn btn-ghost btn-sm" data-delete-attachment="${item.id}" style="color:var(--danger)">Remove</button></div>`).join('') : '<p class="text-muted text-sm">No receipt files attached.</p>';
        attachmentList.querySelectorAll('[data-open-attachment]').forEach((btn) => btn.addEventListener('click', async () => {
          const item = attachments.find((a) => a.id === btn.dataset.openAttachment); if (!item) return;
          try { const url = await getExpenseAttachmentUrl(item.file_path); if (url) window.open(url, '_blank', 'noopener'); } catch (error) { showToast(error.message, 'error'); }
        }));
        attachmentList.querySelectorAll('[data-delete-attachment]').forEach((btn) => btn.addEventListener('click', async () => {
          const item = attachments.find((a) => a.id === btn.dataset.deleteAttachment); if (!item) return;
          if (!await showConfirm(`Remove ${item.file_name}?`)) return;
          try { await deleteExpenseAttachment(item); showToast('Attachment removed.'); loadAttachments(); } catch (error) { showToast(error.message, 'error'); }
        }));
      } catch (error) { attachmentList.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`; }
    };
    loadAttachments();

    overlay.querySelector('#expense-receipt-file')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        const { data: auth } = await supabase.auth.getUser();
        await uploadExpenseAttachment({ expenseId: expense.id, pharmacyId, file, userId: auth.user?.id });
        showToast('Receipt uploaded.'); event.target.value = ''; loadAttachments();
      } catch (error) { showToast(`Upload failed: ${error.message}`, 'error'); }
    });
    overlay.querySelector('#expense-detail-edit')?.addEventListener('click', () => { closeModal(); showExpenseForm(expense); });
    overlay.querySelector('#expense-detail-approve')?.addEventListener('click', async () => {
      try { const { data: auth } = await supabase.auth.getUser(); await approveExpense(expense.id, auth.user?.id); showToast('Expense approved.'); closeModal(); await Promise.all([loadExpenses(), loadHeadlineStats()]); } catch (error) { showToast(error.message, 'error'); }
    });
    overlay.querySelector('#expense-detail-delete')?.addEventListener('click', async () => {
      if (!await showConfirm('Delete this expense permanently?')) return;
      try { await deleteExpense(expense.id); showToast('Expense deleted.'); closeModal(); await Promise.all([loadExpenses(), loadHeadlineStats()]); } catch (error) { showToast(error.message, 'error'); }
    });
  };

  const showExpenseForm = (expense = null) => {
    const { overlay, closeModal } = createModal({
      id: 'expense-form', title: expense ? 'Edit Expense' : 'Record Expense', size: 'modal-lg',
      body: `<form id="expense-form-el" class="expense-form-grid">
        <div class="form-group"><label>Date</label><input class="form-input" type="date" id="expense-form-date" required value="${escapeHtml(expense?.expense_date || new Date().toISOString().slice(0, 10))}" /></div>
        <div class="form-group"><label>Branch</label><select class="form-select" id="expense-form-branch"><option value="">General / No Branch</option>${branches.map((b) => `<option value="${b.id}" ${expense?.branch_id === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Category</label><select class="form-select" id="expense-form-category" required><option value="">Select category</option>${categories.filter((c) => c.is_active || c.id === expense?.category_id).map((c) => `<option value="${c.id}" ${expense?.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.category_name)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Amount</label><input class="form-input" type="number" step="0.01" min="0" id="expense-form-amount" required value="${escapeHtml(expense?.amount ?? '')}" /></div>
        <div class="form-group expense-form-span"><label>Description</label><input class="form-input" id="expense-form-description" required value="${escapeHtml(expense?.description || '')}" /></div>
        <div class="form-group"><label>Payment Method</label><select class="form-select" id="expense-form-payment">${['cash','mobile_money','bank_transfer','check','credit_card'].map((m) => `<option value="${m}" ${expense?.payment_method === m ? 'selected' : ''}>${formatMethod(m)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Receipt Number</label><input class="form-input" id="expense-form-receipt" value="${escapeHtml(expense?.receipt_number || '')}" /></div>
        <div class="form-group expense-form-span"><label>Notes</label><textarea class="form-input" rows="3" id="expense-form-notes">${escapeHtml(expense?.notes || '')}</textarea></div>
        <div class="form-group expense-form-span"><label>Receipt File (optional)</label><input class="form-input" type="file" id="expense-form-file" accept="image/*,.pdf" /><div class="text-xs text-muted">Requires the included Supabase expense-feature migration.</div></div>
        <label class="expense-approved-check expense-form-span"><input type="checkbox" id="expense-form-approved" ${expense?.is_approved || !expense ? 'checked' : ''} /> Mark as approved</label>
      </form>`,
      footer: '<button class="btn btn-ghost" id="expense-form-cancel">Cancel</button><button class="btn btn-primary" id="expense-form-save">Save Expense</button>'
    });
    overlay.querySelector('#expense-form-cancel').addEventListener('click', closeModal);
    overlay.querySelector('#expense-form-save').addEventListener('click', async () => {
      const form = overlay.querySelector('#expense-form-el'); if (!form.reportValidity()) return;
      const saveBtn = overlay.querySelector('#expense-form-save'); saveBtn.disabled = true;
      try {
        const { data: auth } = await supabase.auth.getUser();
        const approved = overlay.querySelector('#expense-form-approved').checked;
        const payload = {
          expense_date: overlay.querySelector('#expense-form-date').value,
          branch_id: overlay.querySelector('#expense-form-branch').value || null,
          category_id: overlay.querySelector('#expense-form-category').value,
          amount: Number(overlay.querySelector('#expense-form-amount').value || 0),
          description: overlay.querySelector('#expense-form-description').value.trim(),
          payment_method: overlay.querySelector('#expense-form-payment').value,
          receipt_number: overlay.querySelector('#expense-form-receipt').value.trim() || null,
          notes: overlay.querySelector('#expense-form-notes').value.trim() || null,
          is_approved: approved,
          approved_by: approved ? auth.user?.id : null
        };
        let saved;
        if (expense) saved = await updateExpense(expense.id, payload);
        else saved = await createExpense({ ...payload, pharmacy_id: pharmacyId, created_by: auth.user?.id });
        const file = overlay.querySelector('#expense-form-file').files?.[0];
        if (file) {
          try { await uploadExpenseAttachment({ expenseId: saved.id, pharmacyId, file, userId: auth.user?.id }); }
          catch (uploadError) { showToast(`Expense saved, but receipt upload failed: ${uploadError.message}`, 'error'); }
        }
        showToast(expense ? 'Expense updated.' : 'Expense recorded.');
        closeModal();
        await Promise.all([loadExpenses({ resetPage: !expense }), loadHeadlineStats()]);
      } catch (error) { showToast(error.message, 'error'); saveBtn.disabled = false; }
    });
  };

  const refreshCategories = () => renderExpenseManagement(container, user);
  const showCategoryForm = (category = null) => {
    const { overlay, closeModal } = createModal({ id: 'expense-category-form', title: category ? 'Edit Category' : 'Add Category', body: `<form id="expense-category-form-el"><div class="form-group"><label>Name</label><input class="form-input" id="expense-category-name" required value="${escapeHtml(category?.category_name || '')}" /></div><div class="form-group"><label>Description</label><textarea class="form-input" id="expense-category-description" rows="3">${escapeHtml(category?.description || '')}</textarea></div><label class="expense-approved-check"><input type="checkbox" id="expense-category-active" ${category?.is_active === false ? '' : 'checked'} /> Active</label></form>`, footer: '<button class="btn btn-ghost" id="expense-category-cancel">Cancel</button><button class="btn btn-primary" id="expense-category-save">Save</button>' });
    overlay.querySelector('#expense-category-cancel').addEventListener('click', closeModal);
    overlay.querySelector('#expense-category-save').addEventListener('click', async () => {
      const form = overlay.querySelector('#expense-category-form-el'); if (!form.reportValidity()) return;
      try {
        const payload = { category_name: overlay.querySelector('#expense-category-name').value.trim(), description: overlay.querySelector('#expense-category-description').value.trim(), is_active: overlay.querySelector('#expense-category-active').checked };
        if (category) await updateExpenseCategory(category.id, payload); else await createExpenseCategory({ ...payload, pharmacy_id: pharmacyId });
        showToast(category ? 'Category updated.' : 'Category created.'); closeModal(); refreshCategories();
      } catch (error) { showToast(error.message, 'error'); }
    });
  };

  const bindCategoryActions = () => {
    container.querySelectorAll('[data-category-edit]').forEach((button) => button.addEventListener('click', () => showCategoryForm(categories.find((c) => c.id === button.dataset.categoryEdit))));
    container.querySelectorAll('[data-category-delete]').forEach((button) => button.addEventListener('click', async () => {
      const category = categories.find((c) => c.id === button.dataset.categoryDelete); if (!category) return;
      if (!await showConfirm(`Delete category “${category.category_name}”? Categories already used by expenses cannot be deleted.`)) return;
      try { await deleteExpenseCategory(category.id); showToast('Category deleted.'); refreshCategories(); } catch (error) { showToast(error.message, 'error'); }
    }));
  };
  bindCategoryActions();

  const nextRecurringDate = (dateStr, frequency) => {
    const date = new Date(`${dateStr}T00:00:00Z`);
    if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
    else if (frequency === 'quarterly') date.setUTCMonth(date.getUTCMonth() + 3);
    else if (frequency === 'yearly') date.setUTCFullYear(date.getUTCFullYear() + 1);
    else date.setUTCMonth(date.getUTCMonth() + 1);
    return date.toISOString().slice(0, 10);
  };

  const refreshRecurring = async () => {
    const result = await getRecurringExpenses(pharmacyId);
    if (!result.supported) return;
    recurring = result.data || [];
    const list = container.querySelector('#recurring-expense-list'); if (list) { list.innerHTML = renderRecurring(recurring); bindRecurringActions(); }
  };

  const showRecurringForm = (item = null) => {
    const { overlay, closeModal } = createModal({ id: 'recurring-expense-form', title: item ? 'Edit Recurring Expense' : 'Add Recurring Expense', size: 'modal-lg', body: `<form id="recurring-expense-form-el" class="expense-form-grid"><div class="form-group expense-form-span"><label>Description</label><input class="form-input" id="recurring-description" required value="${escapeHtml(item?.description || '')}" /></div><div class="form-group"><label>Branch</label><select class="form-select" id="recurring-branch"><option value="">General / No Branch</option>${branches.map((b) => `<option value="${b.id}" ${item?.branch_id === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}</select></div><div class="form-group"><label>Category</label><select class="form-select" id="recurring-category" required>${categories.filter((c) => c.is_active || c.id === item?.category_id).map((c) => `<option value="${c.id}" ${item?.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.category_name)}</option>`).join('')}</select></div><div class="form-group"><label>Amount</label><input class="form-input" type="number" min="0" step="0.01" id="recurring-amount" required value="${escapeHtml(item?.amount ?? '')}" /></div><div class="form-group"><label>Payment Method</label><select class="form-select" id="recurring-payment">${['cash','mobile_money','bank_transfer','check','credit_card'].map((m) => `<option value="${m}" ${item?.payment_method === m ? 'selected' : ''}>${formatMethod(m)}</option>`).join('')}</select></div><div class="form-group"><label>Frequency</label><select class="form-select" id="recurring-frequency">${['weekly','monthly','quarterly','yearly'].map((f) => `<option value="${f}" ${item?.frequency === f ? 'selected' : ''}>${f[0].toUpperCase() + f.slice(1)}</option>`).join('')}</select></div><div class="form-group"><label>Next Due Date</label><input class="form-input" type="date" id="recurring-next-date" required value="${escapeHtml(item?.next_due_date || new Date().toISOString().slice(0,10))}" /></div><div class="form-group expense-form-span"><label>Notes</label><textarea class="form-input" id="recurring-notes" rows="3">${escapeHtml(item?.notes || '')}</textarea></div><label class="expense-approved-check expense-form-span"><input type="checkbox" id="recurring-active" ${item?.is_active === false ? '' : 'checked'} /> Active reminder</label></form>`, footer: '<button class="btn btn-ghost" id="recurring-cancel">Cancel</button><button class="btn btn-primary" id="recurring-save">Save</button>' });
    overlay.querySelector('#recurring-cancel').addEventListener('click', closeModal);
    overlay.querySelector('#recurring-save').addEventListener('click', async () => {
      const form = overlay.querySelector('#recurring-expense-form-el'); if (!form.reportValidity()) return;
      try {
        const { data: auth } = await supabase.auth.getUser();
        const payload = { pharmacy_id: pharmacyId, branch_id: overlay.querySelector('#recurring-branch').value || null, category_id: overlay.querySelector('#recurring-category').value, description: overlay.querySelector('#recurring-description').value.trim(), amount: Number(overlay.querySelector('#recurring-amount').value || 0), payment_method: overlay.querySelector('#recurring-payment').value, frequency: overlay.querySelector('#recurring-frequency').value, next_due_date: overlay.querySelector('#recurring-next-date').value, notes: overlay.querySelector('#recurring-notes').value.trim(), is_active: overlay.querySelector('#recurring-active').checked, created_by: auth.user?.id };
        if (item) { delete payload.created_by; await updateRecurringExpense(item.id, payload); } else await createRecurringExpense(payload);
        showToast(item ? 'Recurring expense updated.' : 'Recurring expense created.'); closeModal(); refreshRecurring();
      } catch (error) { showToast(error.message, 'error'); }
    });
  };

  const bindRecurringActions = () => {
    container.querySelectorAll('[data-recurring-action]').forEach((button) => button.addEventListener('click', async () => {
      const item = recurring.find((row) => row.id === button.dataset.id); if (!item) return;
      const action = button.dataset.recurringAction;
      if (action === 'edit') return showRecurringForm(item);
      if (action === 'toggle') { try { await updateRecurringExpense(item.id, { is_active: !item.is_active }); showToast(item.is_active ? 'Recurring reminder paused.' : 'Recurring reminder resumed.'); refreshRecurring(); } catch (error) { showToast(error.message, 'error'); } return; }
      if (action === 'delete') { if (!await showConfirm(`Delete recurring expense “${item.description}”?`)) return; try { await deleteRecurringExpense(item.id); showToast('Recurring expense deleted.'); refreshRecurring(); } catch (error) { showToast(error.message, 'error'); } return; }
      if (action === 'record') {
        try {
          const { data: auth } = await supabase.auth.getUser();
          await createExpense({ pharmacy_id: pharmacyId, branch_id: item.branch_id || null, category_id: item.category_id, expense_date: new Date().toISOString().slice(0,10), description: item.description, amount: Number(item.amount || 0), payment_method: item.payment_method || 'cash', notes: `Recorded from recurring ${item.frequency} template.${item.notes ? ` ${item.notes}` : ''}`, created_by: auth.user?.id, is_approved: true, approved_by: auth.user?.id });
          await updateRecurringExpense(item.id, { next_due_date: nextRecurringDate(item.next_due_date, item.frequency) });
          showToast('Recurring expense recorded and next due date advanced.');
          await Promise.all([refreshRecurring(), loadExpenses({ resetPage: true }), loadHeadlineStats()]);
        } catch (error) { showToast(error.message, 'error'); }
      }
    }));
  };
  if (recurringSupported) bindRecurringActions();

  container.querySelector('#record-expense-btn').addEventListener('click', () => showExpenseForm());
  container.querySelector('#add-expense-category-btn')?.addEventListener('click', () => showCategoryForm());
  container.querySelector('#add-recurring-expense-btn')?.addEventListener('click', () => showRecurringForm());
  container.querySelectorAll('[data-expense-tab]').forEach((button) => button.addEventListener('click', () => {
    container.querySelectorAll('[data-expense-tab]').forEach((b) => b.classList.toggle('active', b === button));
    container.querySelectorAll('.expense-tab-panel').forEach((panel) => { panel.hidden = panel.id !== `expense-tab-${button.dataset.expenseTab}`; });
  }));
  container.querySelectorAll('[data-expense-preset]').forEach((card) => card.addEventListener('click', () => { state.datePreset = card.dataset.expensePreset; container.querySelector('#expense-date-preset').value = state.datePreset; container.querySelector('[data-expense-tab="expenses"]').click(); loadExpenses({ resetPage: true }); }));
  container.querySelector('[data-expense-status="pending"]')?.addEventListener('click', () => { state.status = 'pending'; container.querySelector('#expense-status-filter').value = 'pending'; container.querySelector('[data-expense-tab="expenses"]').click(); loadExpenses({ resetPage: true }); });
  container.querySelector('#expense-refresh-btn').addEventListener('click', () => Promise.all([loadExpenses(), loadHeadlineStats()]));
  container.querySelector('#expense-page-size').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); loadExpenses({ resetPage: true }); });
  container.querySelector('#expense-date-preset').addEventListener('change', (e) => { state.datePreset = e.target.value; container.querySelector('#expense-custom-date-row').hidden = state.datePreset !== 'custom'; loadExpenses({ resetPage: true }); });
  container.querySelector('#expense-branch-filter').addEventListener('change', (e) => { state.branchId = e.target.value; loadExpenses({ resetPage: true }); });
  container.querySelector('#expense-category-filter').addEventListener('change', (e) => { state.categoryId = e.target.value; loadExpenses({ resetPage: true }); });
  container.querySelector('#expense-payment-filter').addEventListener('change', (e) => { state.paymentMethod = e.target.value; loadExpenses({ resetPage: true }); });
  container.querySelector('#expense-status-filter').addEventListener('change', (e) => { state.status = e.target.value; loadExpenses({ resetPage: true }); });
  container.querySelector('#expense-date-from').addEventListener('change', (e) => { state.dateFrom = e.target.value; if (state.datePreset === 'custom') loadExpenses({ resetPage: true }); });
  container.querySelector('#expense-date-to').addEventListener('change', (e) => { state.dateTo = e.target.value; if (state.datePreset === 'custom') loadExpenses({ resetPage: true }); });
  container.querySelector('#expense-reset-filters').addEventListener('click', () => {
    Object.assign(state, { page: 1, pageSize: 30, search: '', branchId: '', categoryId: '', paymentMethod: '', status: 'all', datePreset: 'this_month', dateFrom: '', dateTo: '' });
    searchInput.value = ''; container.querySelector('#expense-date-preset').value = 'this_month'; container.querySelector('#expense-branch-filter').value = ''; container.querySelector('#expense-category-filter').value = ''; container.querySelector('#expense-payment-filter').value = ''; container.querySelector('#expense-status-filter').value = 'all'; container.querySelector('#expense-page-size').value = '30'; container.querySelector('#expense-custom-date-row').hidden = true; loadExpenses();
  });
  searchInput.addEventListener('input', debounce(() => { state.search = searchInput.value.trim(); loadExpenses({ resetPage: true }); }, 300));

  loadExpenses();
  loadHeadlineStats();
}

function renderCategories(categories) {
  if (!categories.length) return '<div class="empty-state"><div class="empty-state-title">No expense categories</div><div class="empty-state-desc">Create a category to organize expenses.</div></div>';
  return categories.map((cat) => `<article class="category-card"><div class="category-header"><h4>${escapeHtml(cat.category_name)}</h4><span class="badge ${cat.is_active ? 'badge-success' : 'badge-gray'}">${cat.is_active ? 'Active' : 'Inactive'}</span></div><p class="text-sm text-muted">${escapeHtml(cat.description || 'No description')}</p><div class="category-actions"><button class="btn btn-ghost btn-sm" data-category-edit="${cat.id}">Edit</button><button class="btn btn-ghost btn-sm" data-category-delete="${cat.id}" style="color:var(--danger)">Delete</button></div></article>`).join('');
}

function renderRecurring(items) {
  if (!items.length) return '<div class="empty-state"><div class="empty-state-icon">🔁</div><div class="empty-state-title">No recurring expenses</div><div class="empty-state-desc">Create reminders for rent, utilities, internet or other repeating costs.</div></div>';
  const today = new Date().toISOString().slice(0, 10);
  return `<div class="recurring-expense-grid">${items.map((item) => { const overdue = item.is_active && item.next_due_date < today; return `<article class="card recurring-expense-card"><div class="recurring-expense-head"><div><h4>${escapeHtml(item.description)}</h4><div class="text-xs text-muted">${escapeHtml(item.expense_categories?.category_name || 'Uncategorized')} · ${escapeHtml(item.branches?.name || 'General')}</div></div><span class="badge ${!item.is_active ? 'badge-gray' : overdue ? 'badge-danger' : 'badge-success'}">${!item.is_active ? 'Paused' : overdue ? 'Overdue' : 'Active'}</span></div><div class="recurring-expense-metrics"><div><span>Amount</span><strong>${formatCurrency(item.amount)}</strong></div><div><span>Frequency</span><strong>${escapeHtml(item.frequency)}</strong></div><div><span>Next Due</span><strong>${formatDate(item.next_due_date)}</strong></div></div><div class="recurring-expense-actions"><button class="btn btn-primary btn-sm" data-recurring-action="record" data-id="${item.id}">Record Now</button><button class="btn btn-ghost btn-sm" data-recurring-action="edit" data-id="${item.id}">Edit</button><button class="btn btn-ghost btn-sm" data-recurring-action="toggle" data-id="${item.id}">${item.is_active ? 'Pause' : 'Resume'}</button><button class="btn btn-ghost btn-sm" data-recurring-action="delete" data-id="${item.id}" style="color:var(--danger)">Delete</button></div></article>`; }).join('')}</div>`;
}

async function renderSalesmanExpenses(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  let branchId = user.profile?.branch_id || null;
  if (!branchId && user.profile?.id) {
    const { data } = await supabase.from('staff_branch_assignments').select('branch_id').eq('staff_id', user.profile.id).eq('pharmacy_id', pharmacyId).eq('is_active', true).limit(1).maybeSingle();
    branchId = data?.branch_id || null;
  }
  try {
    const [expenses, categories] = await Promise.all([getExpenses(pharmacyId, branchId), getExpenseCategories(pharmacyId)]);
    container.innerHTML = `<div class="animate-in"><div class="page-header"><div><div class="page-title">Expenses</div><div class="page-subtitle">Record and review your branch expenses</div></div><button class="btn btn-primary" id="salesman-record-expense-btn">+ Record Expense</button></div><div class="card"><div class="table-container"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead><tbody>${expenses.length ? expenses.map((exp) => `<tr><td>${formatDate(exp.expense_date)}</td><td>${escapeHtml(exp.expense_categories?.category_name || 'Uncategorized')}</td><td>${escapeHtml(exp.description)}</td><td>${formatCurrency(exp.amount)}</td><td><span class="badge ${exp.is_approved ? 'badge-success' : 'badge-warning'}">${exp.is_approved ? 'Approved' : 'Pending'}</span></td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-title">No expenses recorded</div></div></td></tr>'}</tbody></table></div></div></div>`;

    container.querySelector('#salesman-record-expense-btn')?.addEventListener('click', () => {
      const { overlay, closeModal } = createModal({
        id: 'salesman-expense-form',
        title: 'Record Expense',
        body: `<form id="salesman-expense-form-el"><div class="form-group"><label>Date</label><input class="form-input" type="date" id="salesman-expense-date" value="${new Date().toISOString().slice(0,10)}" required /></div><div class="form-group"><label>Category</label><select class="form-select" id="salesman-expense-category" required><option value="">Select category</option>${categories.map((cat) => `<option value="${cat.id}">${escapeHtml(cat.category_name)}</option>`).join('')}</select></div><div class="form-group"><label>Description</label><input class="form-input" id="salesman-expense-description" required /></div><div class="form-group"><label>Amount</label><input class="form-input" type="number" step="0.01" min="0" id="salesman-expense-amount" required /></div><div class="form-group"><label>Payment Method</label><select class="form-select" id="salesman-expense-payment"><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="check">Check</option></select></div><div class="form-group"><label>Receipt Number</label><input class="form-input" id="salesman-expense-receipt" /></div></form>`,
        footer: '<button class="btn btn-ghost" id="salesman-expense-cancel">Cancel</button><button class="btn btn-primary" id="salesman-expense-save">Submit Expense</button>'
      });
      overlay.querySelector('#salesman-expense-cancel').addEventListener('click', closeModal);
      overlay.querySelector('#salesman-expense-save').addEventListener('click', async () => {
        const form = overlay.querySelector('#salesman-expense-form-el'); if (!form.reportValidity()) return;
        try {
          const { data: auth } = await supabase.auth.getUser();
          await createExpense({ pharmacy_id: pharmacyId, branch_id: branchId, category_id: overlay.querySelector('#salesman-expense-category').value, expense_date: overlay.querySelector('#salesman-expense-date').value, description: overlay.querySelector('#salesman-expense-description').value.trim(), amount: Number(overlay.querySelector('#salesman-expense-amount').value || 0), payment_method: overlay.querySelector('#salesman-expense-payment').value, receipt_number: overlay.querySelector('#salesman-expense-receipt').value.trim() || null, created_by: auth.user?.id, is_approved: false });
          showToast('Expense submitted for approval.'); closeModal(); renderSalesmanExpenses(container, user);
        } catch (error) { showToast(error.message, 'error'); }
      });
    });
  } catch (error) { container.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`; }
}
