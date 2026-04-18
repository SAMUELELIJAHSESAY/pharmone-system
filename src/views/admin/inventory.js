import { getProducts, createProduct, updateProduct, deleteProduct, addStock, getStockLogs, getBranches, getPharmacySettings } from '../../database.js';
import { formatCurrency, formatDate, showToast, showConfirm, isExpired, isExpiringSoon, debounce } from '../../utils.js';
import { createModal } from '../../components/modal.js';

let allProducts = [];
let branches = [];
let selectedBranchId = null;

export async function renderInventory(container, user) {
  if (!user) {
    container.innerHTML = `<div class="alert alert-warning">User not authenticated. Please refresh the page.</div>`;
    return;
  }
  
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) { container.innerHTML = `<div class="alert alert-warning">No pharmacy linked to your account.</div>`; return; }

  try {
    // Ensure pharmacy settings are loaded globally
    if (!window.pharmacySettings?.currency_symbol) {
      const settings = await getPharmacySettings(pharmacyId);
      window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    }
    
    // Load branches for this pharmacy
    branches = await getBranches(pharmacyId);
    
    // Set initial selected branch to the first branch (or null for overview)
    selectedBranchId = branches.length > 0 ? branches[0].id : null;
    
    // Load products - if branch selected, get branch-specific products
    allProducts = await getProducts(pharmacyId, selectedBranchId);
    renderView(container, allProducts, user, branches);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load inventory: ${err.message}</div>`;
  }
}

function renderView(container, products, user, branchList) {
  const lowStockCount = products.filter(p => p.stock_boxes <= p.low_stock_threshold).length;
  const expiredCount = products.filter(p => isExpired(p.expiry_date)).length;
  const branchName = selectedBranchId 
    ? branchList.find(b => b.id === selectedBranchId)?.name || 'Branch'
    : 'All Branches';

  container.innerHTML = `
    <div class="animate-in">
      <div class="page-header">
        <div>
          <div class="page-title">Inventory</div>
          <div class="page-subtitle">Manage drugs and products in your pharmacy</div>
        </div>
        <div class="flex gap-2" style="display:flex;gap:0.5rem">
          <button class="btn btn-ghost" id="stock-log-btn">Stock History</button>
          <button class="btn btn-ghost" id="import-csv-btn">📥 Import CSV</button>
          <button class="btn btn-primary" id="add-product-btn">+ Add Product</button>
        </div>
      </div>
      <input type="file" id="csv-import-input" accept=".csv" style="display:none;" />
      <div id="import-progress" style="display:none;margin-bottom:1rem;padding:1rem;background:var(--info-light);border-radius:var(--radius);">
        <div class="text-sm font-semibold">Importing products...</div>
        <div id="import-status" class="text-xs text-muted" style="margin-top:0.5rem;"></div>
      </div>

      <!-- Branch Selector -->
      <div class="card" style="margin-bottom: 1rem;">
        <div class="form-group" style="margin: 0;">
          <label class="form-label">Select Branch</label>
          <select class="form-select" id="branch-selector">
            ${branchList.map(b => `<option value="${b.id}" ${selectedBranchId === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
          </select>
          <div class="text-xs text-muted" style="margin-top: 0.5rem;">Currently viewing: <strong>${branchName}</strong></div>
        </div>
      </div>

      <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-label">Total Products</span>
            <div class="stat-card-icon teal">&#128230;</div>
          </div>
          <div class="stat-card-value">${products.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-label">Low Stock</span>
            <div class="stat-card-icon amber">&#9888;</div>
          </div>
          <div class="stat-card-value">${lowStockCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-label">Expired</span>
            <div class="stat-card-icon red">&#128683;</div>
          </div>
          <div class="stat-card-value">${expiredCount}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Products in ${branchName}</span>
          <div class="flex gap-2">
            <select class="form-select" id="cat-filter" style="width:auto;padding:0.4rem 0.75rem;font-size:0.8rem">
              <option value="">All Categories</option>
              ${[...new Set(allProducts.map(p => p.category))].map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <div class="search-box" style="min-width:200px">
              <span style="color:var(--gray-400)">&#128269;</span>
              <input type="text" id="product-search" placeholder="Search products..." />
            </div>
          </div>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Branch</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Expiry</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="inventory-tbody">
              ${renderRows(products, branchList)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const reload = () => renderInventory(container, user);

  // Branch selector change handler
  document.getElementById('branch-selector').addEventListener('change', async (e) => {
    selectedBranchId = e.target.value;
    try {
      allProducts = await getProducts(user.profile.pharmacy_id, selectedBranchId);
      renderView(container, allProducts, user, branchList);
    } catch (err) {
      showToast(`Failed to load products: ${err.message}`, 'error');
    }
  });

  document.getElementById('add-product-btn').addEventListener('click', () => showProductModal(null, user, reload, branchList));
  document.getElementById('stock-log-btn').addEventListener('click', () => showStockLogs(user));
  
  document.getElementById('import-csv-btn').addEventListener('click', () => {
    document.getElementById('csv-import-input').click();
  });
  
  document.getElementById('csv-import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      await importProductsFromCSV(event.target.result, user, reload);
    };
    reader.readAsText(file);
  });

  const search = debounce((q) => {
    const cat = document.getElementById('cat-filter').value;
    const filtered = allProducts.filter(p =>
      (p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) &&
      (!cat || p.category === cat)
    );
    document.getElementById('inventory-tbody').innerHTML = renderRows(filtered, branchList);
    bindTableActions(filtered, user, reload, branchList);
  });

  document.getElementById('product-search').addEventListener('input', (e) => search(e.target.value.toLowerCase()));
  document.getElementById('cat-filter').addEventListener('change', () => {
    search(document.getElementById('product-search').value.toLowerCase());
  });

  bindTableActions(products, user, reload, branchList);
}

function renderRows(products, branchList) {
  if (!products.length) return `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">&#128230;</div><div class="empty-state-title">No products found</div><div class="empty-state-desc">Add your first product to this branch to get started</div></div></td></tr>`;

  return products.map(p => {
    const isLow = p.stock_boxes <= p.low_stock_threshold;
    const expired = isExpired(p.expiry_date);
    const expiringSoon = isExpiringSoon(p.expiry_date);
    const totalUnits = (p.stock_boxes * p.units_per_box) + p.stock_units;
    const branchName = branchList.find(b => b.id === p.branch_id)?.name || 'Unknown Branch';

    let expiryHtml = '—';
    if (p.expiry_date) {
      expiryHtml = `<span class="${expired ? 'expiry-expired' : expiringSoon ? 'expiry-soon' : ''}">${formatDate(p.expiry_date)}</span>`;
    }

    return `
      <tr>
        <td>
          <div class="font-semibold">${p.name}</div>
          <div class="text-xs text-muted">${p.description || ''}</div>
        </td>
        <td><span class="badge badge-blue">${branchName}</span></td>
        <td><span class="badge badge-gray">${p.category}</span></td>
        <td class="font-semibold">${formatCurrency(p.price)}</td>
        <td>
          <div class="font-semibold ${isLow ? 'expiry-soon' : ''}">${p.stock_boxes} boxes</div>
          <div class="text-xs text-muted">${totalUnits} units total</div>
        </td>
        <td>${expiryHtml}</td>
        <td>
          ${expired ? '<span class="badge badge-danger">Expired</span>' :
            isLow ? '<span class="badge badge-warning">Low Stock</span>' :
            '<span class="badge badge-success">In Stock</span>'}
        </td>
        <td>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm edit-product-btn" data-id="${p.id}">Edit</button>
            <button class="btn btn-ghost btn-sm restock-btn" data-id="${p.id}" data-name="${p.name}">Restock</button>
            <button class="btn btn-ghost btn-sm delete-product-btn" data-id="${p.id}" style="color:var(--danger)">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function bindTableActions(products, user, reload, branchList) {
  const productMap = Object.fromEntries(products.map(p => [p.id, p]));

  document.querySelectorAll('.edit-product-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const product = productMap[btn.dataset.id];
      if (product) showProductModal(product, user, reload, branchList);
    });
  });

  document.querySelectorAll('.restock-btn').forEach(btn => {
    btn.addEventListener('click', () => showRestockModal(btn.dataset.id, btn.dataset.name, user, reload));
  });

  document.querySelectorAll('.delete-product-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm('Delete this product? This action cannot be undone.');
      if (!confirmed) return;
      try {
        await deleteProduct(btn.dataset.id);
        showToast('Product deleted');
        reload();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function showProductModal(product, user, reload, branchList) {
  const isEdit = !!product;
  const { overlay, closeModal } = createModal({
    id: 'product-modal',
    title: isEdit ? 'Edit Product' : 'Add New Product',
    size: 'modal-lg',
    body: `
      <form id="product-form">
        <div class="form-group">
          <label class="form-label">Branch *</label>
          <select class="form-select" id="prod-branch" required>
            ${branchList.map(b => `<option value="${b.id}" ${product?.branch_id === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
          </select>
          <div class="text-xs text-muted" style="margin-top: 0.25rem;">Product will be assigned to this branch only</div>
        </div>
        <div class="form-group">
          <label class="form-label">Product Name *</label>
          <input type="text" class="form-input" id="prod-name" value="${product?.name || ''}" placeholder="e.g. Amoxicillin 500mg" required />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Category</label>
            <input type="text" class="form-input" id="prod-cat" value="${product?.category || 'General'}" placeholder="Antibiotics, Painkillers..." />
          </div>
          <div class="form-group">
            <label class="form-label">Selling Price *</label>
            <input type="number" class="form-input" id="prod-price" value="${product?.price || ''}" min="0" step="0.01" placeholder="0.00" required />
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Cost Price</label>
            <input type="number" class="form-input" id="prod-cost" value="${product?.cost_price || ''}" min="0" step="0.01" placeholder="0.00" />
          </div>
          <div class="form-group">
            <label class="form-label">Units Per Box</label>
            <input type="number" class="form-input" id="prod-upb" value="${product?.units_per_box || 1}" min="1" />
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Stock (Boxes)</label>
            <input type="number" class="form-input" id="prod-boxes" value="${product?.stock_boxes || 0}" min="0" />
          </div>
          <div class="form-group">
            <label class="form-label">Stock (Extra Units)</label>
            <input type="number" class="form-input" id="prod-units" value="${product?.stock_units || 0}" min="0" />
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Expiry Date</label>
            <input type="date" class="form-input" id="prod-expiry" value="${product?.expiry_date || ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">Low Stock Threshold (boxes)</label>
            <input type="number" class="form-input" id="prod-threshold" value="${product?.low_stock_threshold || 5}" min="0" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-textarea" id="prod-desc" placeholder="Optional description...">${product?.description || ''}</textarea>
        </div>
        <div id="product-err" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-product">Cancel</button>
      <button class="btn btn-primary" id="save-product">${isEdit ? 'Save Changes' : 'Add Product'}</button>
    `
  });

  overlay.querySelector('#cancel-product').addEventListener('click', closeModal);
  overlay.querySelector('#save-product').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-product');
    const errEl = overlay.querySelector('#product-err');
    errEl.classList.add('hidden');

    const payload = {
      name: overlay.querySelector('#prod-name').value.trim(),
      category: overlay.querySelector('#prod-cat').value.trim() || 'General',
      price: parseFloat(overlay.querySelector('#prod-price').value) || 0,
      cost_price: parseFloat(overlay.querySelector('#prod-cost').value) || 0,
      units_per_box: parseInt(overlay.querySelector('#prod-upb').value) || 1,
      stock_boxes: parseInt(overlay.querySelector('#prod-boxes').value) || 0,
      stock_units: parseInt(overlay.querySelector('#prod-units').value) || 0,
      expiry_date: overlay.querySelector('#prod-expiry').value || null,
      low_stock_threshold: parseInt(overlay.querySelector('#prod-threshold').value) || 5,
      description: overlay.querySelector('#prod-desc').value.trim(),
      pharmacy_id: user.profile.pharmacy_id,
      branch_id: overlay.querySelector('#prod-branch').value
    };

    if (!payload.name) { errEl.textContent = 'Product name is required.'; errEl.classList.remove('hidden'); return; }
    if (!payload.branch_id) { errEl.textContent = 'Please select a branch.'; errEl.classList.remove('hidden'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      if (isEdit) {
        await updateProduct(product.id, payload);
        showToast('Product updated successfully');
      } else {
        await createProduct(payload);
        showToast('Product added successfully');
      }
      closeModal();
      reload();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Add Product';
    }
  });
}

function showRestockModal(productId, productName, user, reload) {
  const { overlay, closeModal } = createModal({
    id: 'restock-modal',
    title: `Restock: ${productName}`,
    body: `
      <div class="form-group">
        <label class="form-label">Quantity to Add (boxes) *</label>
        <input type="number" class="form-input" id="restock-qty" min="1" value="1" placeholder="Enter boxes to add" />
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <input type="text" class="form-input" id="restock-notes" placeholder="e.g. Received from supplier" />
      </div>
      <div id="restock-err" class="alert alert-danger hidden"></div>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-restock">Cancel</button>
      <button class="btn btn-success" id="save-restock">Add Stock</button>
    `
  });

  overlay.querySelector('#cancel-restock').addEventListener('click', closeModal);
  overlay.querySelector('#save-restock').addEventListener('click', async () => {
    const qty = parseInt(overlay.querySelector('#restock-qty').value);
    const notes = overlay.querySelector('#restock-notes').value;
    const errEl = overlay.querySelector('#restock-err');
    if (!qty || qty < 1) { errEl.textContent = 'Enter a valid quantity.'; errEl.classList.remove('hidden'); return; }
    try {
      await addStock(productId, productName, qty, notes, user.id, user.profile.pharmacy_id);
      showToast('Stock added successfully');
      closeModal();
      reload();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

async function showStockLogs(user) {
  const { getStockLogs } = await import('../../database.js');
  const { formatDateTime } = await import('../../utils.js');
  const logs = await getStockLogs(user.profile.pharmacy_id, 100);

  const { overlay } = createModal({
    id: 'stock-logs',
    title: 'Stock History',
    size: 'modal-lg',
    body: `
      <div class="table-container" style="max-height:500px;overflow-y:auto">
        <table>
          <thead>
            <tr><th>Product</th><th>Type</th><th>Change</th><th>Notes</th><th>By</th><th>Date</th></tr>
          </thead>
          <tbody>
            ${logs.length === 0 ? `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-title">No stock history</div></div></td></tr>` :
              logs.map(l => `
                <tr>
                  <td class="font-semibold text-sm">${l.product_name}</td>
                  <td><span class="badge ${l.change_type === 'sale' ? 'badge-danger' : 'badge-success'}">${l.change_type}</span></td>
                  <td class="font-semibold ${l.quantity_change < 0 ? 'expiry-expired' : ''}">${l.quantity_change > 0 ? '+' : ''}${l.quantity_change}</td>
                  <td class="text-sm text-muted">${l.notes || '—'}</td>
                  <td class="text-sm text-muted">${l.profiles?.full_name || '—'}</td>
                  <td class="text-xs text-muted">${formatDateTime(l.created_at)}</td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>
    `
  });
}

async function importProductsFromCSV(csvText, user, reload) {
  const { createProduct } = await import('../../database.js');
  const { showToast } = await import('../../utils.js');
  
  try {
    const lines = csvText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length < 2) {
      showToast('CSV file must have header row and at least one product', 'error');
      return;
    }
    
    // Parse CSV - expect: name,category,description,cost_price,selling_price,low_stock_threshold,stock_boxes
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const products = [];
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);
        
        if (values.length < 5) continue; // Skip incomplete rows
        
        const product = {
          name: values[0]?.trim() || '',
          category: values[1]?.trim() || 'Other',
          description: values[2]?.trim() || '',
          cost_price: parseFloat(values[3]) || 0,
          selling_price: parseFloat(values[4]) || 0,
          low_stock_threshold: parseFloat(values[5]) || 10,
          stock_boxes: parseFloat(values[6]) || 0,
          pharmacy_id: user.profile.pharmacy_id,
          branch_id: user.profile.branch_id || null,
          is_active: true
        };
        
        if (!product.name || !product.selling_price) {
          errorCount++;
          continue;
        }
        
        await createProduct(product);
        successCount++;
      } catch (err) {
        console.error('Error importing row', i, err);
        errorCount++;
      }
    }
    
    showToast(`Imported ${successCount} products. ${errorCount} errors.`, successCount > 0 ? 'success' : 'warning');
    reload();
  } catch (err) {
    showToast('Failed to import CSV: ' + err.message, 'error');
  }
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.replace(/"/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  
  values.push(current.replace(/"/g, ''));
  return values;
}
