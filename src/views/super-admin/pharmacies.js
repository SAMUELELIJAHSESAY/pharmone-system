import { getSuperAdminPharmaciesPage, getSuperAdminPharmacyProfile, createPharmacy, updatePharmacy } from '../../database.js';
import { signUp } from '../../auth.js';
import { formatDate, formatDateTime, formatCurrency, showToast, showConfirm } from '../../utils.js';
import { createModal } from '../../components/modal.js';

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

export async function renderPharmacies(container, user, initialParams = {}) {
  if (initialParams?.detailId) {
    await renderPharmacyWorkspace(container, user, initialParams.detailId, initialParams.tab || 'overview');
    return;
  }

  const state = {
    page: Math.max(1, Number(initialParams.page) || 1),
    pageSize: [25, 30, 50].includes(Number(initialParams.pageSize)) ? Number(initialParams.pageSize) : 30,
    search: initialParams.search || '',
    status: initialParams.status || 'all'
  };

  container.innerHTML = `
    <div class="animate-in super-pharmacy-directory">
      <div class="page-header">
        <div>
          <div class="page-title">Pharmacies</div>
          <div class="page-subtitle">Manage, monitor and safely access every pharmacy on the platform</div>
        </div>
        <button class="btn btn-primary" id="add-pharmacy-btn">+ New Pharmacy</button>
      </div>

      <div class="card super-pharmacy-filter-card">
        <div class="super-pharmacy-filters">
          <div class="form-group" style="margin:0">
            <label class="form-label">Search</label>
            <input class="form-input" id="pharmacy-search" type="search" value="${esc(state.search)}" placeholder="Name, email, phone or address" />
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Status</label>
            <select class="form-select" id="pharmacy-status">
              <option value="all">All statuses</option>
              <option value="active" ${state.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="suspended" ${state.status === 'suspended' ? 'selected' : ''}>Suspended</option>
              <option value="disabled" ${state.status === 'disabled' ? 'selected' : ''}>Disabled</option>
              <option value="archived" ${state.status === 'archived' ? 'selected' : ''}>Archived</option>
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Per page</label>
            <select class="form-select" id="pharmacy-page-size">
              ${[25,30,50].map(n => `<option value="${n}" ${state.pageSize===n?'selected':''}>${n} / page</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-ghost" id="pharmacy-clear" type="button">Clear</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title" id="pharmacy-list-title">Pharmacies</span></div>
        <div id="pharmacy-list-body"><div class="loading-spinner"></div></div>
      </div>
    </div>`;

  document.getElementById('add-pharmacy-btn').addEventListener('click', showAddPharmacyModal);
  const searchEl = document.getElementById('pharmacy-search');
  const statusEl = document.getElementById('pharmacy-status');
  const sizeEl = document.getElementById('pharmacy-page-size');
  let timer;
  searchEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.search = searchEl.value.trim(); state.page = 1; load(); }, 300);
  });
  statusEl.addEventListener('change', () => { state.status = statusEl.value; state.page = 1; load(); });
  sizeEl.addEventListener('change', () => { state.pageSize = Number(sizeEl.value); state.page = 1; load(); });
  document.getElementById('pharmacy-clear').addEventListener('click', () => {
    state.search=''; state.status='all'; state.page=1; state.pageSize=30;
    searchEl.value=''; statusEl.value='all'; sizeEl.value='30'; load();
  });

  async function load() {
    const body = document.getElementById('pharmacy-list-body');
    body.innerHTML = '<div class="loading-spinner"></div>';
    try {
      let result;
      try {
        result = await getSuperAdminPharmaciesPage(state);
      } catch (err) {
        if ((state.status === 'suspended' || state.status === 'archived') && /platform_status/i.test(err.message || '')) {
          result = { rows: [], count: 0, page: 1, pageSize: state.pageSize, pageCount: 1 };
        } else throw err;
      }
      if ((state.status === 'suspended' || state.status === 'archived') && result.rows.length) {
        result.rows = result.rows.filter(p => (p.platform_status || (p.is_active ? 'active':'disabled')) === state.status);
      }
      document.getElementById('pharmacy-list-title').textContent = `All Pharmacies (${result.count})`;
      body.innerHTML = renderDirectory(result, state);
      bindDirectoryActions(result.rows, state, load);
    } catch (err) {
      body.innerHTML = `<div class="alert alert-danger">Failed to load pharmacies: ${esc(err.message)}</div>`;
    }
  }
  await load();
}

function pharmacyStatus(p) {
  return p.platform_status || (p.is_active ? 'active' : 'disabled');
}
function statusBadge(status) {
  const cls = status === 'active' ? 'badge-success' : status === 'suspended' ? 'badge-warning' : 'badge-danger';
  return `<span class="badge ${cls}">${esc(status.charAt(0).toUpperCase()+status.slice(1))}</span>`;
}

function renderDirectory(result, state) {
  if (!result.rows.length) return `<div class="empty-state"><div class="empty-state-icon">🏥</div><div class="empty-state-title">No pharmacies found</div><div class="empty-state-desc">Try changing the search or status filter.</div></div>`;
  return `
    <div class="table-container"><table class="super-pharmacy-table">
      <thead><tr><th>Name</th><th>Contact</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>${result.rows.map(p => `<tr>
        <td><div class="font-semibold">${esc(p.name)}</div><div class="text-sm text-muted">${esc(p.address || 'No address')}</div></td>
        <td><div>${esc(p.email || '—')}</div><div class="text-sm text-muted">${esc(p.phone || '—')}</div></td>
        <td>${statusBadge(pharmacyStatus(p))}</td>
        <td class="text-sm text-muted">${formatDate(p.created_at)}</td>
        <td><div class="flex gap-2 flex-wrap">
          <button class="btn btn-primary btn-sm pharmacy-view-btn" data-id="${p.id}">View Details</button>
          <button class="btn btn-ghost btn-sm access-pharmacy-btn" data-id="${p.id}">Access Pharmacy</button>
          <button class="btn btn-ghost btn-sm edit-pharmacy-btn" data-id="${p.id}">Edit</button>
          <button class="btn btn-ghost btn-sm pharmacy-status-btn" data-id="${p.id}">Status</button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${renderPagination(result.page, result.pageCount, result.count, result.pageSize)}`;
}

function renderPagination(page, pageCount, count, pageSize) {
  const start = count ? ((page-1)*pageSize)+1 : 0;
  const end = Math.min(page*pageSize, count);
  const nums=[]; const from=Math.max(1,page-2); const to=Math.min(pageCount,page+2);
  for(let i=from;i<=to;i++) nums.push(i);
  return `<div class="pagination-bar"><div class="text-sm text-muted">Showing ${start}–${end} of ${count} pharmacies</div><div class="pagination-controls">
    <button class="btn btn-ghost btn-sm pharmacy-page" data-page="${page-1}" ${page<=1?'disabled':''}>Previous</button>
    ${nums.map(n=>`<button class="btn ${n===page?'btn-primary':'btn-ghost'} btn-sm pharmacy-page" data-page="${n}">${n}</button>`).join('')}
    <button class="btn btn-ghost btn-sm pharmacy-page" data-page="${page+1}" ${page>=pageCount?'disabled':''}>Next</button>
  </div></div>`;
}

function bindDirectoryActions(rows, state, reload) {
  const byId = new Map(rows.map(p => [String(p.id), p]));
  document.querySelectorAll('.pharmacy-page').forEach(btn => btn.addEventListener('click', () => {
    if (btn.disabled) return; state.page=Number(btn.dataset.page); reload();
  }));
  document.querySelectorAll('.pharmacy-view-btn').forEach(btn => btn.addEventListener('click', () => import('../app.js').then(m => m.navigate('pharmacies',{detailId:btn.dataset.id}))));
  document.querySelectorAll('.edit-pharmacy-btn').forEach(btn => btn.addEventListener('click', () => showEditPharmacyModal(byId.get(btn.dataset.id), reload)));
  document.querySelectorAll('.access-pharmacy-btn').forEach(btn => btn.addEventListener('click', async () => {
    const pharmacy=byId.get(btn.dataset.id); const { impersonatePharmacy }=await import('../app.js'); impersonatePharmacy(pharmacy);
  }));
  document.querySelectorAll('.pharmacy-status-btn').forEach(btn => btn.addEventListener('click', () => showPharmacyStatusModal(byId.get(btn.dataset.id), reload)));
}

async function renderPharmacyWorkspace(container, user, pharmacyId, tab='overview') {
  container.innerHTML='<div class="loading-spinner"></div>';
  try {
    const data=await getSuperAdminPharmacyProfile(pharmacyId);
    const p=data.pharmacy; const s=data.summary;
    const health = !p.is_active ? 'Disabled' : !s.lastSale ? 'No sales yet' : ((Date.now()-new Date(s.lastSale.created_at).getTime())/86400000>30?'No Recent Sales':((Date.now()-new Date(s.lastSale.created_at).getTime())/86400000>7?'Low Activity':'Healthy'));
    container.innerHTML=`<div class="animate-in super-pharmacy-workspace">
      <div class="page-header"><div><button class="btn btn-ghost btn-sm" id="back-pharmacies">← Pharmacies</button><div class="page-title" style="margin-top:.6rem">${esc(p.name)}</div><div class="page-subtitle">Super Admin pharmacy workspace · ${statusBadge(pharmacyStatus(p))}</div></div><div class="flex gap-2 flex-wrap"><button class="btn btn-primary" id="workspace-access">Access Pharmacy</button><button class="btn btn-ghost" id="workspace-edit">Edit</button><button class="btn btn-ghost" id="workspace-status">Manage Status</button></div></div>
      <div class="super-pharmacy-metrics">
        ${metricCard('Today Revenue',formatCurrency(s.todayRevenue),`${s.todayTransactions} transactions`)}
        ${metricCard('This Month',formatCurrency(s.monthRevenue),`${s.monthTransactions} transactions`)}
        ${metricCard('Users',s.totalUsers,`${s.activeUsers} active`)}
        ${metricCard('Branches',s.branches,'Active locations')}
        ${metricCard('Inventory',s.products,`${s.lowStock} low stock`)}
        ${metricCard('Operating Balance',formatCurrency(s.operatingBalance),'Revenue − approved expenses')}
      </div>
      <div class="card super-health-card"><div class="card-header"><span class="card-title">Operational Health</span>${statusBadge(health==='Healthy'?'active':health==='Low Activity'?'suspended':'disabled')}</div><div class="super-health-grid"><div><span>Health</span><strong>${esc(health)}</strong></div><div><span>Last sale</span><strong>${s.lastSale?formatDateTime(s.lastSale.created_at):'No sale recorded'}</strong></div><div><span>Monthly expenses</span><strong>${formatCurrency(s.monthExpenses)}</strong></div><div><span>Low stock products</span><strong>${s.lowStock}</strong></div></div></div>
      <div class="super-workspace-tabs">
        ${['overview','branches','users','activity','settings'].map(t=>`<button class="super-workspace-tab ${tab===t?'active':''}" data-tab="${t}">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`).join('')}
      </div>
      <div id="super-workspace-content">${renderWorkspaceTab(tab,data)}</div>
    </div>`;
    document.getElementById('back-pharmacies').onclick=()=>import('../app.js').then(m=>m.navigate('pharmacies'));
    document.getElementById('workspace-access').onclick=()=>import('../app.js').then(m=>m.impersonatePharmacy(p));
    document.getElementById('workspace-edit').onclick=()=>showEditPharmacyModal(p,()=>renderPharmacyWorkspace(container,user,pharmacyId,tab));
    document.getElementById('workspace-status').onclick=()=>showPharmacyStatusModal(p,()=>renderPharmacyWorkspace(container,user,pharmacyId,tab));
    document.querySelectorAll('.super-workspace-tab').forEach(btn=>btn.onclick=()=>renderPharmacyWorkspace(container,user,pharmacyId,btn.dataset.tab));
  } catch(err) { container.innerHTML=`<div class="alert alert-danger">Failed to load pharmacy workspace: ${esc(err.message)}</div>`; }
}

function metricCard(label,value,sub){ return `<div class="stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value super-value">${esc(value)}</div><div class="stat-subtitle">${esc(sub)}</div></div>`; }
function renderWorkspaceTab(tab,data){
  const p=data.pharmacy,s=data.summary;
  if(tab==='branches') return `<div class="card"><div class="card-header"><span class="card-title">Branches (${data.branches.length})</span></div><div class="table-container"><table><thead><tr><th>Branch</th><th>Address</th><th>Status</th><th>Created</th></tr></thead><tbody>${data.branches.map(b=>`<tr><td class="font-semibold">${esc(b.name)}</td><td>${esc(b.address||'—')}</td><td>${b.is_active?'<span class="badge badge-success">Active</span>':'<span class="badge badge-danger">Disabled</span>'}</td><td>${formatDate(b.created_at)}</td></tr>`).join('')||'<tr><td colspan="4">No branches</td></tr>'}</tbody></table></div></div>`;
  if(tab==='users') return `<div class="card"><div class="card-header"><span class="card-title">Recent Users (${s.totalUsers})</span></div><div class="table-container"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead><tbody>${data.users.map(u=>`<tr><td class="font-semibold">${esc(u.full_name||'Unnamed')}</td><td>${esc(u.email||'—')}</td><td>${esc((u.role||'').replaceAll('_',' '))}</td><td>${u.is_active!==false?'<span class="badge badge-success">Active</span>':'<span class="badge badge-danger">Disabled</span>'}</td><td>${formatDate(u.created_at)}</td></tr>`).join('')}</tbody></table></div></div>`;
  if(tab==='activity') return `<div class="card"><div class="card-header"><span class="card-title">Activity Snapshot</span></div><div class="super-activity-summary"><div><strong>${s.monthTransactions}</strong><span>Transactions this month</span></div><div><strong>${s.todayTransactions}</strong><span>Transactions today</span></div><div><strong>${s.lastSale?esc(s.lastSale.invoice_number||'Latest sale'):'—'}</strong><span>Latest invoice</span></div><div><strong>${s.lastSale?formatDateTime(s.lastSale.created_at):'—'}</strong><span>Last sales activity</span></div></div></div>`;
  if(tab==='settings') return `<div class="card"><div class="card-header"><span class="card-title">Pharmacy Configuration</span></div><div class="settings-detail-grid"><div><span>Name</span><strong>${esc(p.name)}</strong></div><div><span>Email</span><strong>${esc(p.email||'—')}</strong></div><div><span>Phone</span><strong>${esc(p.phone||'—')}</strong></div><div><span>Currency</span><strong>${esc(p.currency_code||'NLE')} · ${esc(p.currency_symbol||'Le')}</strong></div><div><span>Created</span><strong>${formatDate(p.created_at)}</strong></div><div><span>Platform status</span><strong>${esc(pharmacyStatus(p))}</strong></div></div></div>`;
  return `<div class="super-overview-grid"><div class="card"><div class="card-header"><span class="card-title">Business Snapshot</span></div><div class="settings-detail-grid"><div><span>Today's revenue</span><strong>${formatCurrency(s.todayRevenue)}</strong></div><div><span>Monthly revenue</span><strong>${formatCurrency(s.monthRevenue)}</strong></div><div><span>Approved expenses</span><strong>${formatCurrency(s.monthExpenses)}</strong></div><div><span>Revenue − expenses</span><strong>${formatCurrency(s.operatingBalance)}</strong></div></div></div><div class="card"><div class="card-header"><span class="card-title">Platform Usage</span></div><div class="settings-detail-grid"><div><span>Total users</span><strong>${s.totalUsers}</strong></div><div><span>Active users</span><strong>${s.activeUsers}</strong></div><div><span>Branches</span><strong>${s.branches}</strong></div><div><span>Products</span><strong>${s.products}</strong></div></div></div></div>`;
}

function showPharmacyStatusModal(pharmacy,onSave){
  const current=pharmacyStatus(pharmacy);
  const {overlay,closeModal}=createModal({id:'pharmacy-status',title:'Manage Pharmacy Status',body:`<div class="form-group"><label class="form-label">Status</label><select class="form-select" id="ps-status"><option value="active" ${current==='active'?'selected':''}>Active</option><option value="suspended" ${current==='suspended'?'selected':''}>Suspended</option><option value="disabled" ${current==='disabled'?'selected':''}>Disabled</option><option value="archived" ${current==='archived'?'selected':''}>Archived</option></select></div><div class="form-group"><label class="form-label">Reason / internal note</label><textarea class="form-input" id="ps-reason" rows="4" placeholder="Why is this status being changed?">${esc(pharmacy.status_reason||'')}</textarea></div><div class="alert alert-info">Suspending or disabling does not delete pharmacy data. The pharmacy can be reactivated later.</div>`,footer:`<button class="btn btn-ghost" id="ps-cancel">Cancel</button><button class="btn btn-primary" id="ps-save">Save Status</button>`});
  overlay.querySelector('#ps-cancel').onclick=closeModal;
  overlay.querySelector('#ps-save').onclick=async()=>{const status=overlay.querySelector('#ps-status').value;const reason=overlay.querySelector('#ps-reason').value.trim();const btn=overlay.querySelector('#ps-save');btn.disabled=true;try{await updatePharmacy(pharmacy.id,{platform_status:status,status_reason:reason||null,status_changed_at:new Date().toISOString(),is_active:status==='active'});showToast('Pharmacy status updated');closeModal();onSave?.();}catch(err){showToast(err.message,'error');btn.disabled=false;}};
}

export function showAddPharmacyModal() {
  const { overlay, closeModal } = createModal({
    id: 'add-pharmacy',
    title: 'Add New Pharmacy',
    body: `
      <form id="add-pharmacy-form">
        <div class="form-group">
          <label class="form-label">Pharmacy Name *</label>
          <input type="text" class="form-input" id="p-name" placeholder="City Health Pharmacy" required />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="p-email" placeholder="pharmacy@example.com" />
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="text" class="form-input" id="p-phone" placeholder="+1 555 0000" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" class="form-input" id="p-address" placeholder="123 Main St, City" />
        </div>
        <hr class="divider" />
        <p class="text-sm font-semibold" style="margin-bottom:0.75rem;color:var(--gray-700)">Admin Account</p>
        <div class="form-group">
          <label class="form-label">Admin Full Name *</label>
          <input type="text" class="form-input" id="p-admin-name" placeholder="John Smith" required />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Admin Email *</label>
            <input type="email" class="form-input" id="p-admin-email" required placeholder="admin@pharmacy.com" />
          </div>
          <div class="form-group">
            <label class="form-label">Password *</label>
            <input type="password" class="form-input" id="p-admin-pass" required placeholder="Min 8 chars" minlength="8" />
          </div>
        </div>
        <div id="pharmacy-form-error" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-pharmacy">Cancel</button>
      <button class="btn btn-primary" id="save-pharmacy">Create Pharmacy</button>
    `
  });

  overlay.querySelector('#cancel-pharmacy').addEventListener('click', closeModal);

  overlay.querySelector('#save-pharmacy').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-pharmacy');
    const errEl = overlay.querySelector('#pharmacy-form-error');
    errEl.classList.add('hidden');

    const name = overlay.querySelector('#p-name').value.trim();
    const email = overlay.querySelector('#p-email').value.trim();
    const phone = overlay.querySelector('#p-phone').value.trim();
    const address = overlay.querySelector('#p-address').value.trim();
    const adminName = overlay.querySelector('#p-admin-name').value.trim();
    const adminEmail = overlay.querySelector('#p-admin-email').value.trim();
    const adminPass = overlay.querySelector('#p-admin-pass').value;

    if (!name || !adminName || !adminEmail || !adminPass) {
      errEl.textContent = 'Please fill all required fields.';
      errEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Creating...';

    try {
      const pharmacy = await createPharmacy({ name, email, phone, address });
      await signUp(adminEmail, adminPass, adminName, 'admin', pharmacy.id);
      const { getCurrentUser } = await import('../../auth.js');
      const currentUser = await getCurrentUser();
      if (currentUser) await updatePharmacy(pharmacy.id, { owner_id: currentUser.id });
      showToast('Pharmacy created successfully!');
      closeModal();
      import('../app.js').then(m => m.navigate('pharmacies'));
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Create Pharmacy';
    }
  });
}

export function showEditPharmacyModal(pharmacy, onSave) {
  const { overlay, closeModal } = createModal({
    id: 'edit-pharmacy',
    title: 'Edit Pharmacy Information',
    body: `
      <form id="edit-pharmacy-form">
        <div class="form-group">
          <label class="form-label">Pharmacy Name *</label>
          <input type="text" class="form-input" id="ep-name" value="${pharmacy.name}" required />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="ep-email" value="${pharmacy.email || ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="text" class="form-input" id="ep-phone" value="${pharmacy.phone || ''}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" class="form-input" id="ep-address" value="${pharmacy.address || ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Currency Code</label>
          <input type="text" class="form-input" id="ep-currency" value="${pharmacy.currency_code || 'USD'}" placeholder="USD" />
        </div>
        <div class="form-group">
          <label class="form-label">Currency Symbol</label>
          <input type="text" class="form-input" id="ep-symbol" value="${pharmacy.currency_symbol || '$'}" placeholder="$" />
        </div>
        <div id="edit-pharmacy-error" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-edit-pharmacy">Cancel</button>
      <button class="btn btn-primary" id="save-edit-pharmacy">Save Changes</button>
    `
  });

  overlay.querySelector('#cancel-edit-pharmacy').addEventListener('click', closeModal);

  overlay.querySelector('#save-edit-pharmacy').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-edit-pharmacy');
    const errEl = overlay.querySelector('#edit-pharmacy-error');
    errEl.classList.add('hidden');

    const name = overlay.querySelector('#ep-name').value.trim();
    const email = overlay.querySelector('#ep-email').value.trim();
    const phone = overlay.querySelector('#ep-phone').value.trim();
    const address = overlay.querySelector('#ep-address').value.trim();
    const currencyCode = overlay.querySelector('#ep-currency').value.trim();
    const currencySymbol = overlay.querySelector('#ep-symbol').value.trim();

    if (!name) {
      errEl.textContent = 'Pharmacy name is required.';
      errEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      await updatePharmacy(pharmacy.id, { 
        name, 
        email, 
        phone, 
        address,
        currency_code: currencyCode,
        currency_symbol: currencySymbol
      });
      showToast('Pharmacy updated successfully!');
      closeModal();
      onSave();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });
}
