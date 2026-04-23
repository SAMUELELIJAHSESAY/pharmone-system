import { getProducts, createProduct, updateProduct, deleteProduct, addStock, getStockLogs, getBranches, getPharmacySettings } from '../../database.js';
import { formatCurrency, formatDate, showToast, showConfirm, isExpired, isExpiringSoon, debounce } from '../../utils.js';
import { createModal } from '../../components/modal.js';

let allProducts = [];
let branches = [];
let selectedBranchId = null;
let currentFilterType = null; // For pre-filtering from dashboard

export async function renderInventory(container, user, filterType = null) {
  // Store filter type for use in rendering
  currentFilterType = filterType;
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
  
  // Detect duplicate products by name
  const productNames = {};
  const duplicates = new Set();
  products.forEach(p => {
    const nameKey = p.name.toLowerCase().trim();
    if (productNames[nameKey]) {
      duplicates.add(nameKey);
      productNames[nameKey].count++;
      productNames[nameKey].ids.push(p.id);
    } else {
      productNames[nameKey] = { count: 1, ids: [p.id], names: [] };
    }
  });
  
  const duplicateCount = duplicates.size;
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
          <button class="btn btn-ghost" id="copy-branch-btn">📋 Copy Inventory</button>
          <button class="btn btn-ghost" id="import-csv-btn">📥 Import CSV/Excel</button>
          <button class="btn btn-ghost" id="add-multiple-btn">➕ Add Multiple</button>
          <button class="btn btn-primary" id="add-product-btn">+ Add Product</button>
        </div>
      </div>
      <input type="file" id="csv-import-input" accept=".csv,.xlsx,.xls" style="display:none;" />
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
        ${duplicateCount > 0 ? `
        <div class="stat-card" style="border:2px solid var(--warning);background:var(--warning-light)">
          <div class="stat-card-header">
            <span class="stat-card-label">Duplicates</span>
            <div class="stat-card-icon" style="background:var(--warning);color:white">⚠️</div>
          </div>
          <div class="stat-card-value" style="color:var(--warning)">${duplicateCount}</div>
          <div style="font-size:0.75rem;color:var(--warning);margin-top:0.25rem"><button class="btn btn-ghost btn-sm" id="show-duplicates-btn" style="padding:0;text-decoration:underline">Show</button></div>
        </div>
        ` : ''}
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Products in ${branchName}</span>
          <div class="flex gap-2" style="flex-wrap:wrap;gap:0.5rem">
            ${currentFilterType === 'low-stock' ? `<button class="btn btn-ghost" id="export-low-stock-csv" title="Download low stock items as CSV">📥 Export Low Stock CSV</button>` : ``}
            <select class="form-select" id="filter-type" style="width:auto;padding:0.4rem 0.75rem;font-size:0.8rem">
              <option value="">All Products</option>
              <option value="low-stock" ${currentFilterType === 'low-stock' ? 'selected' : ''}>Low Stock</option>
              <option value="expired">Expired</option>
              <option value="expiring">Expiring Soon</option>
              <option value="duplicates">Duplicates</option>
            </select>
            <select class="form-select" id="price-sort" style="width:auto;padding:0.4rem 0.75rem;font-size:0.8rem">
              <option value="">Sort by...</option>
              <option value="selling-asc">Selling Price (Low to High)</option>
              <option value="selling-desc">Selling Price (High to Low)</option>
              <option value="cost-asc">Cost Price (Low to High)</option>
              <option value="cost-desc">Cost Price (High to Low)</option>
              <option value="margin-asc">Profit Margin (Low to High)</option>
              <option value="margin-desc">Profit Margin (High to Low)</option>
            </select>
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
        <div id="bulk-actions-bar" style="display:none;padding:1rem;background:var(--blue-light);border-bottom:1px solid var(--border);display:flex;gap:1rem;align-items:center">
          <span id="bulk-count" class="font-semibold"></span>
          <button class="btn btn-ghost btn-sm" id="bulk-edit-btn">✏️ Bulk Edit</button>
          <button class="btn btn-ghost btn-sm" id="bulk-deactivate-btn" style="color:var(--amber)">🔒 Deactivate</button>
          <button class="btn btn-ghost btn-sm" id="bulk-activate-btn" style="color:var(--success)">✓ Activate</button>
          <button class="btn btn-ghost btn-sm" id="bulk-delete-btn" style="color:var(--danger)">🗑️ Delete</button>
          <button class="btn btn-ghost btn-sm" id="bulk-cancel-btn">Cancel</button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th style="width:40px"><input type="checkbox" id="select-all-products" /></th>
                <th>Product Name</th>
                <th>Branch</th>
                <th>Category</th>
                <th>Cost Price</th>
                <th>Selling Price</th>
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
  document.getElementById('add-multiple-btn').addEventListener('click', () => showAddMultipleModal(user, reload, branchList));
  document.getElementById('stock-log-btn').addEventListener('click', () => showStockLogs(user));
  document.getElementById('copy-branch-btn').addEventListener('click', () => showCopyBranchModal(allProducts, user, reload, branchList));
  
  // Show export button for low stock filter
  const exportBtn = document.getElementById('export-low-stock-csv');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportLowStockToCSV(allProducts, branchList));
  }
  
  document.getElementById('import-csv-btn').addEventListener('click', () => {
    document.getElementById('csv-import-input').click();
  });
  
  document.getElementById('csv-import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Show progress indicator
    const progressDiv = document.getElementById('import-progress');
    if (progressDiv) progressDiv.style.display = 'block';
    
    try {
      // Detect file type by extension
      const fileName = file.name.toLowerCase();
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        // Handle Excel files
        const reader = new FileReader();
        reader.onload = async (event) => {
          await importProductsFromExcel(event.target.result, file.name, user, reload, progressDiv);
        };
        reader.readAsArrayBuffer(file);
      } else if (fileName.endsWith('.csv')) {
        // Handle CSV files
        const reader = new FileReader();
        reader.onload = async (event) => {
          await importProductsFromCSV(event.target.result, user, reload, progressDiv);
        };
        reader.readAsText(file);
      } else {
        showToast('File format not supported. Please use CSV or Excel (.xlsx/.xls) files.', 'error');
        if (progressDiv) progressDiv.style.display = 'none';
      }
    } catch (err) {
      showToast('Failed to read file: ' + err.message, 'error');
      if (progressDiv) progressDiv.style.display = 'none';
    }
  });

  const search = debounce((q) => {
    applyAllFilters(allProducts, branchList, user, reload);
  });
  
  const applyAllFilters = (productsToFilter, branchList, user, reload) => {
    const searchTerm = document.getElementById('product-search')?.value.toLowerCase() || '';
    const category = document.getElementById('cat-filter')?.value || '';
    const filterType = document.getElementById('filter-type')?.value || '';
    const sortType = document.getElementById('price-sort')?.value || '';
    
    let filtered = productsToFilter.filter(p => {
      // Text search
      const matchesSearch = !searchTerm || p.name.toLowerCase().includes(searchTerm) || p.category.toLowerCase().includes(searchTerm);
      
      // Category filter
      const matchesCategory = !category || p.category === category;
      
      // Type filter
      let matchesType = true;
      if (filterType === 'low-stock') {
        matchesType = p.stock_boxes <= p.low_stock_threshold;
      } else if (filterType === 'expired') {
        matchesType = isExpired(p.expiry_date);
      } else if (filterType === 'expiring') {
        matchesType = isExpiringSoon(p.expiry_date) && !isExpired(p.expiry_date);
      } else if (filterType === 'duplicates') {
        const nameKey = p.name.toLowerCase().trim();
        const dupCount = productsToFilter.filter(pp => pp.name.toLowerCase().trim() === nameKey).length;
        matchesType = dupCount > 1;
      }
      
      return matchesSearch && matchesCategory && matchesType;
    });
    
    // Apply sorting
    if (sortType) {
      filtered.sort((a, b) => {
        const costA = parseFloat(a.cost_price || 0);
        const costB = parseFloat(b.cost_price || 0);
        const sellA = parseFloat(a.price || 0);
        const sellB = parseFloat(b.price || 0);
        const marginA = sellA - costA;
        const marginB = sellB - costB;
        
        if (sortType === 'selling-asc') return sellA - sellB;
        if (sortType === 'selling-desc') return sellB - sellA;
        if (sortType === 'cost-asc') return costA - costB;
        if (sortType === 'cost-desc') return costB - costA;
        if (sortType === 'margin-asc') return marginA - marginB;
        if (sortType === 'margin-desc') return marginB - marginA;
        return 0;
      });
    }
    
    document.getElementById('inventory-tbody').innerHTML = renderRows(filtered, branchList);
    bindTableActions(filtered, user, reload, branchList);
  };

  document.getElementById('product-search').addEventListener('input', (e) => {
    applyAllFilters(allProducts, branchList, user, reload);
  });
  
  if (document.getElementById('filter-type')) {
    document.getElementById('filter-type').addEventListener('change', () => {
      applyAllFilters(allProducts, branchList, user, reload);
    });
  }
  
  if (document.getElementById('price-sort')) {
    document.getElementById('price-sort').addEventListener('change', () => {
      applyAllFilters(allProducts, branchList, user, reload);
    });
  }
  
  document.getElementById('cat-filter').addEventListener('change', () => {
    applyAllFilters(allProducts, branchList, user, reload);
  });

  // Bulk select all
  document.getElementById('select-all-products').addEventListener('change', (e) => {
    document.querySelectorAll('.product-checkbox').forEach(cb => {
      cb.checked = e.target.checked;
    });
    updateBulkActionsBar();
  });
  
  // Show duplicates handler
  const showDuplicatesBtn = document.getElementById('show-duplicates-btn');
  if (showDuplicatesBtn) {
    showDuplicatesBtn.addEventListener('click', () => {
      document.getElementById('filter-type').value = 'duplicates';
      applyAllFilters(allProducts, branchList, user, reload);
    });
  }
  
  // Apply initial filter if provided (e.g., from dashboard)
  if (currentFilterType) {
    applyAllFilters(allProducts, branchList, user, reload);
  }

  bindTableActions(products, user, reload, branchList);
}

function renderRows(products, branchList) {
  if (!products.length) return `<tr><td colspan="9"><div class="empty-state"><div class="empty-state-icon">&#128230;</div><div class="empty-state-title">No products found</div><div class="empty-state-desc">Add your first product to this branch to get started</div></div></td></tr>`;

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
        <td style="width:40px"><input type="checkbox" class="product-checkbox" data-id="${p.id}" /></td>
        <td>
          <div class="font-semibold">${p.name}</div>
          <div class="text-xs text-muted">${p.description || ''}</div>
          <div style="margin-top:0.25rem;"><span class="badge" style="background:var(--primary-light);color:var(--primary)">${(p.unit_type || 'box').charAt(0).toUpperCase() + (p.unit_type || 'box').slice(1)}</span></div>
        </td>
        <td><span class="badge badge-blue">${branchName}</span></td>
        <td><span class="badge badge-gray">${p.category}</span></td>
        <td class="font-semibold">${p.cost_price ? formatCurrency(p.cost_price) : '-'}</td>
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

  // Checkbox selection
  document.querySelectorAll('.product-checkbox').forEach(cb => {
    cb.addEventListener('change', updateBulkActionsBar);
  });

  // Bulk edit
  document.getElementById('bulk-edit-btn').addEventListener('click', () => {
    const selected = Array.from(document.querySelectorAll('.product-checkbox:checked')).map(cb => cb.dataset.id);
    if (selected.length === 0) return;
    showBulkEditModal(selected, productMap, user, reload);
  });

  // Bulk deactivate
  document.getElementById('bulk-deactivate-btn').addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('.product-checkbox:checked')).map(cb => cb.dataset.id);
    if (selected.length === 0) return;
    const confirmed = await showConfirm(`Deactivate ${selected.length} product(s)?`);
    if (!confirmed) return;
    await bulkUpdateProducts(selected, { is_active: false }, reload);
  });

  // Bulk activate
  document.getElementById('bulk-activate-btn').addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('.product-checkbox:checked')).map(cb => cb.dataset.id);
    if (selected.length === 0) return;
    const confirmed = await showConfirm(`Activate ${selected.length} product(s)?`);
    if (!confirmed) return;
    await bulkUpdateProducts(selected, { is_active: true }, reload);
  });

  // Bulk delete
  document.getElementById('bulk-delete-btn').addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('.product-checkbox:checked')).map(cb => cb.dataset.id);
    if (selected.length === 0) return;
    const confirmed = await showConfirm(`Delete ${selected.length} product(s)? This cannot be undone.`);
    if (!confirmed) return;
    await bulkDeleteProducts(selected, reload);
  });

  // Cancel bulk selection
  document.getElementById('bulk-cancel-btn').addEventListener('click', () => {
    document.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = false);
    document.getElementById('select-all-products').checked = false;
    updateBulkActionsBar();
  });

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
          <div class="form-group">
            <label class="form-label">Unit Type *</label>
            <select class="form-select" id="prod-unit-type" required>
              <option value="">Select unit type</option>
              <option value="tablet" ${product?.unit_type === 'tablet' ? 'selected' : ''}>Tablet</option>
              <option value="capsule" ${product?.unit_type === 'capsule' ? 'selected' : ''}>Capsule</option>
              <option value="bottle" ${product?.unit_type === 'bottle' ? 'selected' : ''}>Bottle</option>
              <option value="vial" ${product?.unit_type === 'vial' ? 'selected' : ''}>Vial</option>
              <option value="injection" ${product?.unit_type === 'injection' ? 'selected' : ''}>Injection</option>
              <option value="ml" ${product?.unit_type === 'ml' ? 'selected' : ''}>ML (Milliliters)</option>
              <option value="box" ${product?.unit_type === 'box' || !product?.unit_type ? 'selected' : ''}>Box/Carton</option>
              <option value="blister" ${product?.unit_type === 'blister' ? 'selected' : ''}>Blister Pack</option>
              <option value="jar" ${product?.unit_type === 'jar' ? 'selected' : ''}>Jar</option>
              <option value="tube" ${product?.unit_type === 'tube' ? 'selected' : ''}>Tube</option>
              <option value="sachet" ${product?.unit_type === 'sachet' ? 'selected' : ''}>Sachet</option>
              <option value="strip" ${product?.unit_type === 'strip' ? 'selected' : ''}>Strip</option>
              <option value="bag" ${product?.unit_type === 'bag' ? 'selected' : ''}>Bag</option>
              <option value="pack" ${product?.unit_type === 'pack' ? 'selected' : ''}>Pack</option>
              <option value="piece" ${product?.unit_type === 'piece' ? 'selected' : ''}>Piece</option>
              <option value="cup" ${product?.unit_type === 'cup' ? 'selected' : ''}>Cup</option>
              <option value="card" ${product?.unit_type === 'card' ? 'selected' : ''}>Card</option>
            </select>
            <div class="text-xs text-muted" style="margin-top: 0.25rem;">How is this product sold to customers?</div>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Cost Price</label>
            <input type="number" class="form-input" id="prod-cost" value="${product?.cost_price || ''}" min="0" step="0.01" placeholder="0.00" />
          </div>
          <div class="form-group">
            <label class="form-label">Minimum Sell Quantity</label>
            <input type="number" class="form-input" id="prod-min-sell" value="${product?.min_sell_quantity || 1}" min="1" />
            <div class="text-xs text-muted" style="margin-top: 0.25rem;">Minimum units allowed per sale</div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Units Per Box</label>
          <input type="number" class="form-input" id="prod-upb" value="${product?.units_per_box || 1}" min="1" />
          <div class="text-xs text-muted" style="margin-top: 0.25rem;">How many units are in 1 box (for bulk tracking)</div>
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
      unit_type: overlay.querySelector('#prod-unit-type').value,
      min_sell_quantity: parseInt(overlay.querySelector('#prod-min-sell').value) || 1,
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
    if (!payload.unit_type) { errEl.textContent = 'Please select a unit type.'; errEl.classList.remove('hidden'); return; }
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

async function importProductsFromCSV(csvText, user, reload, progressDiv) {
  const { createProduct } = await import('../../database.js');
  const { showToast } = await import('../../utils.js');
  
  try {
    const lines = csvText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length < 2) {
      showToast('CSV file must have header row and at least one product', 'error');
      if (progressDiv) progressDiv.style.display = 'none';
      return;
    }
    
    console.log('CSV import started, total lines:', lines.length);
    
    // Parse CSV header
    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine).map(h => h.trim().toLowerCase());
    
    console.log('CSV Headers:', headers);
    
    // Map header positions for flexible column matching
    const getColumnIndex = (possibleNames) => {
      for (const name of possibleNames) {
        const idx = headers.findIndex(h => h.includes(name.toLowerCase()));
        if (idx !== -1) {
          console.log(`Found column "${name}" at index ${idx}`);
          return idx;
        }
      }
      console.warn(`Column not found for: ${possibleNames.join(', ')}`);
      return -1;
    };
    
    const nameIdx = getColumnIndex(['product', 'name']);
    const categoryIdx = getColumnIndex(['category']);
    const descIdx = getColumnIndex(['description']);
    const costPriceIdx = getColumnIndex(['cost', 'price']);
    const sellingPriceIdx = getColumnIndex(['selling', 'price']);
    const lowStockIdx = getColumnIndex(['low', 'stock']);
    const stockBoxesIdx = getColumnIndex(['stock', 'boxes', 'quantity']);
    
    console.log('Column indices:', { nameIdx, categoryIdx, descIdx, costPriceIdx, sellingPriceIdx, lowStockIdx, stockBoxesIdx });
    console.log('Current branch:', selectedBranchId);
    console.log('Current pharmacy:', user.profile.pharmacy_id);
    
    let successCount = 0;
    let errorCount = 0;
    const statusDiv = document.getElementById('import-status');
    
    for (let i = 1; i < lines.length; i++) {
      try {
        if (statusDiv) statusDiv.textContent = `Processing row ${i} of ${lines.length - 1}...`;
        
        const values = parseCSVLine(lines[i]);
        
        // Skip empty rows
        if (values.every(v => !v || !v.trim())) {
          continue;
        }
        
        const getValue = (idx) => idx !== -1 && values[idx] ? values[idx].trim() : '';
        
        const product = {
          name: getValue(nameIdx),
          category: getValue(categoryIdx) || 'Other',
          description: getValue(descIdx),
          cost_price: parseFloat(getValue(costPriceIdx)) || 0,
          selling_price: parseFloat(getValue(sellingPriceIdx)) || 0,
          low_stock_threshold: parseFloat(getValue(lowStockIdx)) || 10,
          stock_boxes: parseFloat(getValue(stockBoxesIdx)) || 0,
          pharmacy_id: user.profile.pharmacy_id,
          branch_id: selectedBranchId || null,
          is_active: true
        };
        
        console.log(`Row ${i} parsed:`, product);
        
        // Validate required fields
        if (!product.name || product.name.length === 0) {
          console.warn(`Row ${i}: Missing product name (raw value at index ${nameIdx}: "${getValue(nameIdx)}")`);
          errorCount++;
          continue;
        }
        
        if (!product.selling_price || product.selling_price === 0) {
          console.warn(`Row ${i}: Invalid selling price. Raw value: "${getValue(sellingPriceIdx)}", Parsed: ${product.selling_price}`);
          errorCount++;
          continue;
        }
        
        console.log(`Creating CSV product: ${product.name}`);
        const result = await createProduct(product);
        console.log('CSV product created:', result);
        successCount++;
      } catch (err) {
        console.error('Error importing CSV row', i, ':', err);
        errorCount++;
      }
    }
    
    console.log(`CSV Import completed: ${successCount} successful, ${errorCount} failed`);
    showToast(`✓ Imported ${successCount} products. ${errorCount} errors.`, successCount > 0 ? 'success' : 'warning');
    if (progressDiv) progressDiv.style.display = 'none';
    
    if (successCount > 0) {
      setTimeout(() => reload(), 500);
    }
  } catch (err) {
    console.error('CSV import error:', err);
    showToast('Failed to import CSV: ' + err.message, 'error');
    if (progressDiv) progressDiv.style.display = 'none';
  }
}

async function importProductsFromExcel(arrayBuffer, fileName, user, reload, progressDiv) {
  try {
    // Dynamically import xlsx library
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const { createProduct } = await import('../../database.js');
    const { showToast } = await import('../../utils.js');
    
    console.log('Starting Excel import for file:', fileName);
    console.log('Current branch ID:', selectedBranchId);
    console.log('Current pharmacy ID:', user.profile.pharmacy_id);
    
    // Parse Excel file
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    
    if (!sheetName) {
      showToast('Excel file has no sheets', 'error');
      if (progressDiv) progressDiv.style.display = 'none';
      return;
    }
    
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);
    
    console.log('Parsed rows from Excel:', rows.length);
    if (rows.length > 0) {
      console.log('First row keys:', Object.keys(rows[0]));
      console.log('First row data:', rows[0]);
    }
    
    if (rows.length === 0) {
      showToast('Excel sheet is empty or has no valid data', 'error');
      if (progressDiv) progressDiv.style.display = 'none';
      return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    const statusDiv = document.getElementById('import-status');
    
    for (let i = 0; i < rows.length; i++) {
      try {
        if (statusDiv) statusDiv.textContent = `Processing row ${i + 1} of ${rows.length}...`;
        
        const row = rows[i];
        const keys = Object.keys(row);
        
        // Extract values - handle both lowercase and original case headers
        const getValue = (possibleNames) => {
          if (!Array.isArray(possibleNames)) {
            possibleNames = [possibleNames];
          }
          
          for (const name of possibleNames) {
            const matchingKey = keys.find(k => 
              k && k.toLowerCase().includes(name.toLowerCase())
            );
            if (matchingKey !== undefined && row[matchingKey] !== undefined && row[matchingKey] !== null && row[matchingKey] !== '') {
              return row[matchingKey].toString().trim();
            }
          }
          return '';
        };
        
        const product = {
          name: getValue(['Product', 'Name']),
          category: getValue(['Category']) || 'Other',
          description: getValue(['Description']),
          cost_price: parseFloat(getValue(['Cost', 'Price'])) || 0,
          selling_price: parseFloat(getValue(['Selling', 'Price'])) || 0,
          low_stock_threshold: parseFloat(getValue(['Low', 'Stock'])) || 10,
          stock_boxes: parseFloat(getValue(['Stock', 'Boxes'])) || 0,
          pharmacy_id: user.profile.pharmacy_id,
          branch_id: selectedBranchId || null,
          is_active: true
        };
        
        console.log(`Row ${i + 1} parsed product:`, product);
        
        // Validate required fields
        if (!product.name || product.name.length === 0) {
          console.warn(`Row ${i + 1}: Missing product name`);
          errorCount++;
          continue;
        }
        
        if (!product.selling_price || product.selling_price === 0) {
          console.warn(`Row ${i + 1}: Missing or invalid selling price (got: ${getValue(['Selling', 'Price'])})`);
          errorCount++;
          continue;
        }
        
        console.log(`Creating product: ${product.name} - Price: ${product.selling_price}`);
        const result = await createProduct(product);
        console.log(`Product created successfully:`, result);
        successCount++;
      } catch (err) {
        console.error('Error importing row', i + 1, ':', err);
        errorCount++;
      }
    }
    
    console.log(`Import completed: ${successCount} successful, ${errorCount} failed`);
    showToast(`✓ Imported ${successCount} products from Excel. ${errorCount} errors.`, successCount > 0 ? 'success' : 'warning');
    if (progressDiv) progressDiv.style.display = 'none';
    
    if (successCount > 0) {
      setTimeout(() => reload(), 500);
    }
  } catch (err) {
    console.error('Excel import error:', err);
    showToast('Failed to import Excel file: ' + err.message, 'error');
    if (progressDiv) progressDiv.style.display = 'none';
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

function updateBulkActionsBar() {
  const selected = document.querySelectorAll('.product-checkbox:checked');
  const bar = document.getElementById('bulk-actions-bar');
  const count = document.getElementById('bulk-count');
  
  if (selected.length > 0) {
    bar.style.display = 'flex';
    count.textContent = `${selected.length} product(s) selected`;
  } else {
    bar.style.display = 'none';
  }
}

async function bulkUpdateProducts(productIds, updates, reload) {
  try {
    let successCount = 0;
    let errorCount = 0;
    
    for (const productId of productIds) {
      try {
        await updateProduct(productId, updates);
        successCount++;
      } catch (err) {
        console.error(`Failed to update product ${productId}:`, err);
        errorCount++;
      }
    }
    
    showToast(`Updated ${successCount} product(s). ${errorCount} failed.`, errorCount === 0 ? 'success' : 'warning');
    document.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = false);
    document.getElementById('select-all-products').checked = false;
    updateBulkActionsBar();
    reload();
  } catch (err) {
    showToast(`Bulk update failed: ${err.message}`, 'error');
  }
}

async function bulkDeleteProducts(productIds, reload) {
  try {
    let successCount = 0;
    let errorCount = 0;
    
    for (const productId of productIds) {
      try {
        await deleteProduct(productId);
        successCount++;
      } catch (err) {
        console.error(`Failed to delete product ${productId}:`, err);
        errorCount++;
      }
    }
    
    showToast(`Deleted ${successCount} product(s). ${errorCount} failed.`, errorCount === 0 ? 'success' : 'warning');
    document.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = false);
    document.getElementById('select-all-products').checked = false;
    updateBulkActionsBar();
    reload();
  } catch (err) {
    showToast(`Bulk delete failed: ${err.message}`, 'error');
  }
}

function showBulkEditModal(productIds, productMap, user, reload) {
  const { overlay, closeModal } = createModal({
    id: 'bulk-edit-modal',
    title: `Bulk Edit (${productIds.length} products)`,
    size: 'modal-lg',
    body: `
      <div class="alert alert-info">
        <strong>Tip:</strong> Leave a field empty to keep the current values for each product
      </div>
      <form id="bulk-edit-form">
        <div class="form-group">
          <label class="form-label">Category</label>
          <input type="text" class="form-input" id="bulk-category" placeholder="Leave empty to skip this field" />
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Selling Price</label>
            <input type="number" class="form-input" id="bulk-price" min="0" step="0.01" placeholder="Leave empty to skip this field" />
          </div>
          <div class="form-group">
            <label class="form-label">Cost Price</label>
            <input type="number" class="form-input" id="bulk-cost" min="0" step="0.01" placeholder="Leave empty to skip this field" />
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Low Stock Threshold</label>
            <input type="number" class="form-input" id="bulk-threshold" min="0" placeholder="Leave empty to skip this field" />
          </div>
          <div class="form-group">
            <label class="form-label">Units Per Box</label>
            <input type="number" class="form-input" id="bulk-upb" min="1" placeholder="Leave empty to skip this field" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-select" id="bulk-status">
            <option value="">Don't change status</option>
            <option value="active">Activate</option>
            <option value="inactive">Deactivate</option>
          </select>
        </div>
        <div id="bulk-edit-err" class="alert alert-danger hidden"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-bulk-edit">Cancel</button>
      <button class="btn btn-primary" id="save-bulk-edit">Update Products</button>
    `
  });

  overlay.querySelector('#cancel-bulk-edit').addEventListener('click', closeModal);
  overlay.querySelector('#save-bulk-edit').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-bulk-edit');
    const errEl = overlay.querySelector('#bulk-edit-err');
    errEl.classList.add('hidden');

    const updates = {};
    
    // Only include fields that have values
    const category = overlay.querySelector('#bulk-category').value.trim();
    if (category) updates.category = category;
    
    const price = overlay.querySelector('#bulk-price').value;
    if (price !== '') updates.price = parseFloat(price);
    
    const cost = overlay.querySelector('#bulk-cost').value;
    if (cost !== '') updates.cost_price = parseFloat(cost);
    
    const threshold = overlay.querySelector('#bulk-threshold').value;
    if (threshold !== '') updates.low_stock_threshold = parseInt(threshold);
    
    const upb = overlay.querySelector('#bulk-upb').value;
    if (upb !== '') updates.units_per_box = parseInt(upb);
    
    const status = overlay.querySelector('#bulk-status').value;
    if (status === 'active') updates.is_active = true;
    else if (status === 'inactive') updates.is_active = false;

    if (Object.keys(updates).length === 0) {
      errEl.textContent = 'Please fill in at least one field to update.';
      errEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Updating...';

    try {
      let successCount = 0;
      let errorCount = 0;
      
      for (const productId of productIds) {
        try {
          await updateProduct(productId, updates);
          successCount++;
        } catch (err) {
          console.error(`Failed to update product ${productId}:`, err);
          errorCount++;
        }
      }
      
      showToast(`Updated ${successCount} product(s). ${errorCount} failed.`, errorCount === 0 ? 'success' : 'warning');
      closeModal();
      document.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = false);
      document.getElementById('select-all-products').checked = false;
      updateBulkActionsBar();
      reload();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Update Products';
    }
  });
}

function showAddMultipleModal(user, reload, branchList) {
  const { overlay, closeModal } = createModal({
    id: 'add-multiple-modal',
    title: 'Add Multiple Products',
    size: 'modal-xl',
    body: `
      <div class="alert alert-info">
        <strong>Add up to 20 products at once.</strong> Fill in the Product Name and Selling Price (required). Other fields are optional.
      </div>
      <div id="product-rows-container" style="max-height:500px;overflow-y:auto;margin-bottom:1rem;">
        ${generateProductRow(0)}
      </div>
      <button type="button" class="btn btn-ghost" id="add-row-btn" style="width:100%;margin-bottom:1rem">+ Add Another Product</button>
      <div id="add-multiple-err" class="alert alert-danger hidden" style="margin-bottom:1rem"></div>
      <div style="display:flex;gap:0.5rem;border-top:1px solid var(--border);padding-top:1rem;margin-top:1rem">
        <button type="button" class="btn btn-ghost" id="cancel-add-multiple">Cancel</button>
        <button type="button" class="btn btn-primary" id="save-add-multiple" style="flex:1">✓ Add All Products</button>
      </div>
    `
  });

  let rowCount = 1;

  overlay.querySelector('#add-row-btn').addEventListener('click', () => {
    if (rowCount >= 20) {
      showToast('Maximum 20 products per batch', 'warning');
      return;
    }
    const container = overlay.querySelector('#product-rows-container');
    container.insertAdjacentHTML('beforeend', generateProductRow(rowCount));
    rowCount++;
    
    // Bind remove buttons for new row
    bindRemoveButtons(overlay, rowCount);
  });

  bindRemoveButtons(overlay, rowCount);

  overlay.querySelector('#cancel-add-multiple').addEventListener('click', closeModal);
  overlay.querySelector('#save-add-multiple').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#save-add-multiple');
    const errEl = overlay.querySelector('#add-multiple-err');
    errEl.classList.add('hidden');

    // Collect all products
    const products = [];
    const rows = overlay.querySelectorAll('.product-row');
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = row.querySelector('.row-name').value.trim();
      const category = row.querySelector('.row-category').value.trim() || 'General';
      const price = parseFloat(row.querySelector('.row-price').value) || 0;
      const cost = parseFloat(row.querySelector('.row-cost').value) || 0;
      const unitType = row.querySelector('.row-unit-type').value;
      const minSell = parseInt(row.querySelector('.row-min-sell').value) || 1;
      const upb = parseInt(row.querySelector('.row-upb').value) || 1;
      const boxes = parseInt(row.querySelector('.row-boxes').value) || 0;
      const units = parseInt(row.querySelector('.row-units').value) || 0;
      const threshold = parseInt(row.querySelector('.row-threshold').value) || 5;
      const expiry = row.querySelector('.row-expiry').value || null;
      const desc = row.querySelector('.row-desc').value.trim();

      // Validate required fields
      if (!name) {
        errEl.textContent = `Row ${i + 1}: Product name is required`;
        errEl.classList.remove('hidden');
        return;
      }

      if (price === 0) {
        errEl.textContent = `Row ${i + 1}: Selling price must be greater than 0`;
        errEl.classList.remove('hidden');
        return;
      }

      if (!unitType) {
        errEl.textContent = `Row ${i + 1}: Please select a unit type`;
        errEl.classList.remove('hidden');
        return;
      }

      products.push({
        name,
        category,
        price,
        cost_price: cost,
        unit_type: unitType,
        min_sell_quantity: minSell,
        units_per_box: upb,
        stock_boxes: boxes,
        stock_units: units,
        low_stock_threshold: threshold,
        expiry_date: expiry,
        description: desc,
        pharmacy_id: user.profile.pharmacy_id,
        branch_id: selectedBranchId || null,
        is_active: true
      });
    }

    if (products.length === 0) {
      errEl.textContent = 'Please add at least one product';
      errEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Adding...';

    try {
      const { createProduct } = await import('../../database.js');
      let successCount = 0;
      let errorCount = 0;

      for (const product of products) {
        try {
          await createProduct(product);
          successCount++;
        } catch (err) {
          console.error('Error creating product:', err);
          errorCount++;
        }
      }

      showToast(`✓ Added ${successCount} product(s). ${errorCount} failed.`, errorCount === 0 ? 'success' : 'warning');
      closeModal();
      reload();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Add All Products';
    }
  });
}

function generateProductRow(rowId) {
  return `
    <div class="product-row" style="padding:1rem;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:0.5rem;background:var(--bg-secondary)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
        <span class="font-semibold">Product ${rowId + 1}</span>
        ${rowId > 0 ? `<button type="button" class="btn btn-ghost btn-sm remove-row-btn" data-row="${rowId}" style="color:var(--danger)">Remove</button>` : ''}
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Product Name *</label>
          <input type="text" class="form-input row-name" placeholder="e.g. Amoxicillin 500mg" />
        </div>
        <div class="form-group">
          <label class="form-label">Selling Price *</label>
          <input type="number" class="form-input row-price" min="0" step="0.01" placeholder="0.00" />
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Category</label>
          <input type="text" class="form-input row-category" placeholder="Antibiotics, Painkillers..." />
        </div>
        <div class="form-group">
          <label class="form-label">Cost Price</label>
          <input type="number" class="form-input row-cost" min="0" step="0.01" placeholder="0.00" />
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Unit Type *</label>
          <select class="form-input row-unit-type">
            <option value="">Select unit type</option>
            <option value="tablet">Tablet</option>
            <option value="capsule">Capsule</option>
            <option value="bottle">Bottle</option>
            <option value="vial">Vial</option>
            <option value="injection">Injection</option>
            <option value="ml">ML</option>
            <option value="box">Box</option>
            <option value="blister">Blister</option>
            <option value="jar">Jar</option>
            <option value="tube">Tube</option>
            <option value="sachet">Sachet</option>
            <option value="strip">Strip</option>
            <option value="bag">Bag</option>
            <option value="pack">Pack</option>
            <option value="piece">Piece</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Min Sell Quantity</label>
          <input type="number" class="form-input row-min-sell" value="1" min="1" />
        </div>
      </div>
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Units Per Box</label>
          <input type="number" class="form-input row-upb" value="1" min="1" />
        </div>
        <div class="form-group">
          <label class="form-label">Stock (Boxes)</label>
          <input type="number" class="form-input row-boxes" value="0" min="0" />
        </div>
        <div class="form-group">
          <label class="form-label">Stock (Units)</label>
          <input type="number" class="form-input row-units" value="0" min="0" />
        </div>
      </div>
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Low Stock Threshold</label>
          <input type="number" class="form-input row-threshold" value="5" min="0" />
        </div>
        <div class="form-group">
          <label class="form-label">Expiry Date</label>
          <input type="date" class="form-input row-expiry" />
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <input type="text" class="form-input row-desc" placeholder="Optional description" />
        </div>
      </div>
    </div>
  `;
}

function bindRemoveButtons(overlay, rowCount) {
  overlay.querySelectorAll('.remove-row-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const row = btn.closest('.product-row');
      if (row) row.remove();
    });
  });
}

// ===================== CSV EXPORT FOR LOW STOCK =====================
function exportLowStockToCSV(products, branchList) {
  // Filter for low stock items
  const lowStockProducts = products.filter(p => p.stock_boxes <= p.low_stock_threshold);
  
  if (lowStockProducts.length === 0) {
    showToast('No low stock items to export', 'warning');
    return;
  }

  // Prepare CSV headers
  const headers = ['Product Name', 'Cost Price', 'Box Remains', 'Category', 'Threshold', 'Branch'];
  
  // Prepare CSV rows
  const rows = lowStockProducts.map(p => [
    p.name,
    p.cost_price || 0,
    p.stock_boxes,
    p.category || '',
    p.low_stock_threshold || 0,
    branchList.find(b => b.id === p.branch_id)?.name || ''
  ]);

  // Create CSV content
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => {
      // Escape cells containing commas or quotes
      const cellStr = String(cell);
      if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    }).join(','))
  ].join('\n');

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  const timestamp = new Date().toISOString().split('T')[0];
  link.setAttribute('href', url);
  link.setAttribute('download', `low-stock-${timestamp}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast(`✓ Exported ${lowStockProducts.length} low stock items to CSV`, 'success');
}

// ===================== COPY INVENTORY BETWEEN BRANCHES =====================
function showCopyBranchModal(allProducts, user, reload, branchList) {
  if (branchList.length < 2) {
    showToast('You need at least 2 branches to copy inventory', 'warning');
    return;
  }

  // Get all unique branch IDs from products
  const branchesWithProducts = new Set();
  allProducts.forEach(p => {
    if (p.branch_id) branchesWithProducts.add(p.branch_id);
  });

  const activeBranches = branchList.filter(b => branchesWithProducts.has(b.id));
  
  if (activeBranches.length < 2) {
    showToast('You need products in at least 2 branches to copy inventory', 'warning');
    return;
  }

  const { overlay, closeModal } = createModal({
    id: 'copy-branch-modal',
    title: 'Copy Inventory Between Branches',
    size: 'modal-lg',
    body: `
      <div class="alert alert-info">
        <strong>Copy inventory from one branch to another.</strong> Only product names and cost prices will be copied. Existing products with the same name will be skipped.
      </div>
      
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Source Branch (Copy From) *</label>
          <select class="form-select" id="copy-from-branch" required>
            <option value="">-- Select source branch --</option>
            ${activeBranches.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Destination Branch (Copy To) *</label>
          <select class="form-select" id="copy-to-branch" required>
            <option value="">-- Select destination branch --</option>
            ${activeBranches.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" id="copy-all-products" checked />
          <span>Copy all products from source branch</span>
        </label>
        <div class="text-xs text-muted" style="margin-top: 0.5rem;">Uncheck to select specific products</div>
      </div>

      <div id="product-list-container" style="display:none;max-height:300px;overflow-y:auto;padding:1rem;background:var(--bg-secondary);border-radius:var(--radius);margin:1rem 0;border:1px solid var(--border);">
        <div class="text-sm font-semibold" style="margin-bottom:0.75rem;">Select Products to Copy:</div>
        <div id="product-list"></div>
      </div>

      <div id="copy-branch-err" class="alert alert-danger hidden"></div>
    `,
    footer: `
      <button class="btn btn-ghost" id="cancel-copy-branch">Cancel</button>
      <button class="btn btn-primary" id="execute-copy-branch">Copy Inventory</button>
    `
  });

  const fromSelect = overlay.querySelector('#copy-from-branch');
  const toSelect = overlay.querySelector('#copy-to-branch');
  const copyAllCheckbox = overlay.querySelector('#copy-all-products');
  const productListContainer = overlay.querySelector('#product-list-container');
  const productList = overlay.querySelector('#product-list');
  const errEl = overlay.querySelector('#copy-branch-err');

  // Update product list when source branch changes
  const updateProductList = () => {
    const sourceBranchId = fromSelect.value;
    if (!sourceBranchId) {
      productListContainer.style.display = 'none';
      return;
    }

    const sourceProducts = allProducts.filter(p => p.branch_id === sourceBranchId);
    
    if (sourceProducts.length === 0) {
      productListContainer.style.display = 'none';
      return;
    }

    if (!copyAllCheckbox.checked) {
      productListContainer.style.display = 'block';
      productList.innerHTML = sourceProducts.map((p, idx) => `
        <label class="form-checkbox" style="margin-bottom:0.5rem;padding:0.5rem;background:var(--bg-primary);border-radius:var(--radius)">
          <input type="checkbox" class="product-select-checkbox" value="${p.id}" checked />
          <span class="text-sm"><strong>${p.name}</strong> - ${formatCurrency(p.cost_price || 0)}</span>
        </label>
      `).join('');
    } else {
      productListContainer.style.display = 'none';
    }
  };

  copyAllCheckbox.addEventListener('change', updateProductList);
  fromSelect.addEventListener('change', updateProductList);

  overlay.querySelector('#cancel-copy-branch').addEventListener('click', closeModal);
  overlay.querySelector('#execute-copy-branch').addEventListener('click', async () => {
    const executeBtn = overlay.querySelector('#execute-copy-branch');
    errEl.classList.add('hidden');

    const sourceBranchId = fromSelect.value;
    const destBranchId = toSelect.value;

    if (!sourceBranchId) {
      errEl.textContent = 'Please select a source branch';
      errEl.classList.remove('hidden');
      return;
    }

    if (!destBranchId) {
      errEl.textContent = 'Please select a destination branch';
      errEl.classList.remove('hidden');
      return;
    }

    if (sourceBranchId === destBranchId) {
      errEl.textContent = 'Source and destination branches must be different';
      errEl.classList.remove('hidden');
      return;
    }

    executeBtn.disabled = true;
    executeBtn.textContent = 'Copying...';

    try {
      const { createProduct } = await import('../../database.js');
      
      // Get products to copy
      let productsToClone = allProducts.filter(p => p.branch_id === sourceBranchId);
      
      // Filter if not copying all
      if (!copyAllCheckbox.checked) {
        const selectedIds = Array.from(overlay.querySelectorAll('.product-select-checkbox:checked')).map(cb => cb.value);
        productsToClone = productsToClone.filter(p => selectedIds.includes(p.id));
      }

      if (productsToClone.length === 0) {
        errEl.textContent = 'Please select at least one product to copy';
        errEl.classList.remove('hidden');
        executeBtn.disabled = false;
        executeBtn.textContent = 'Copy Inventory';
        return;
      }

      // Get existing products in destination branch
      const destProducts = allProducts.filter(p => p.branch_id === destBranchId);
      const destProductNames = new Set(destProducts.map(p => p.name.toLowerCase().trim()));

      let successCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const product of productsToClone) {
        try {
          // Skip if product with same name already exists
          if (destProductNames.has(product.name.toLowerCase().trim())) {
            skippedCount++;
            continue;
          }

          // Create new product in destination branch with only name and cost price
          const newProduct = {
            name: product.name,
            category: product.category || 'General',
            description: product.description || '',
            cost_price: product.cost_price || 0,
            price: product.price || 0, // Keep selling price too
            unit_type: product.unit_type || 'box',
            units_per_box: product.units_per_box || 1,
            low_stock_threshold: product.low_stock_threshold || 5,
            stock_boxes: 0, // Start with 0 stock
            stock_units: 0,
            min_sell_quantity: product.min_sell_quantity || 1,
            expiry_date: null,
            pharmacy_id: user.profile.pharmacy_id,
            branch_id: destBranchId,
            is_active: true
          };

          await createProduct(newProduct);
          successCount++;
        } catch (err) {
          console.error(`Error copying product ${product.name}:`, err);
          errorCount++;
        }
      }

      let message = `✓ Copied ${successCount} product(s)`;
      if (skippedCount > 0) message += `. Skipped ${skippedCount} (duplicates)`;
      if (errorCount > 0) message += `. ${errorCount} errors`;

      showToast(message, errorCount === 0 ? 'success' : 'warning');
      closeModal();
      reload();
    } catch (err) {
      errEl.textContent = `Error: ${err.message}`;
      errEl.classList.remove('hidden');
      executeBtn.disabled = false;
      executeBtn.textContent = 'Copy Inventory';
    }
  });
}
