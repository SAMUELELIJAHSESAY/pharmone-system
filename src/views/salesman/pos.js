import { getPOSProductsPage, getPOSProductsByIds, getProductCategories, getCustomers, createCustomer, createSale, getStaffBranch, getPharmacySettings, getBranchDetails, getSalesPage, getPOSHeldSales, createPOSHeldSale, deletePOSHeldSale } from '../../database.js';
import { formatCurrency, showToast, debounce, formatUTCDateTime } from '../../utils.js';
import { createModal } from '../../components/modal.js';
import { isViewLifecycleActive, registerViewCleanup } from '../../view-lifecycle.js';
import { resolveReceiptFooter, getPharmacyLogoUrl } from '../../branding.js';

let cart = [];
let allProducts = [];
let productPage = 1;
let productPageSize = 24;
let productTotal = 0;
let productHasMore = false;
let productSearch = '';
let productCategory = '';
let inStockOnly = true;
let productLoadSeq = 0;
let productLoading = false;
let productCategories = [];
let heldSales = [];
let recentSales = [];
let splitPaymentEnabled = false;
let allCustomers = [];
let selectedCustomer = null;
let currentUser = null;
let staffBranchId = null;
let currentLifecycleToken = null;
let cleanupPOSInteractions = null;

function escapeReceiptText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getConfiguredReceiptFooter(branchDetails = {}) {
  const branchName = typeof branchDetails === 'string' ? branchDetails : (branchDetails?.name || 'Pharmacy');
  const branchId = typeof branchDetails === 'string' ? staffBranchId : (branchDetails?.id || staffBranchId);
  const resolved = resolveReceiptFooter(window.pharmacySettings || {}, {
    branchId,
    branchName,
    pharmacyName: window.pharmacySettings?.name || branchName
  });
  return escapeReceiptText(resolved).replace(/\n/g, '<br>');
}

function getReceiptLogoHtml() {
  const logo = getPharmacyLogoUrl(window.pharmacySettings || {});
  return logo ? `<img src="${escapeReceiptText(logo)}" alt="" style="max-width:74px;max-height:74px;object-fit:contain;margin:0 auto 6px;display:block" />` : '';
}

function getReceiptCashierName(sale = {}, fallbackUser = currentUser) {
  const historicalName = sale?.staff_name || sale?.staff?.full_name || sale?.creator?.full_name || '';
  if (historicalName) return historicalName;
  if (sale?.created_by && fallbackUser?.id && sale.created_by !== fallbackUser.id) return 'Staff member';
  return fallbackUser?.profile?.full_name || fallbackUser?.email || 'Staff member';
}

export async function renderPOS(container, user, lifecycleToken = null) {
  if (cleanupPOSInteractions) {
    cleanupPOSInteractions();
    cleanupPOSInteractions = null;
  }

  currentLifecycleToken = lifecycleToken;
  currentUser = user;
  cart = [];
  allProducts = [];
  selectedCustomer = null;
  productPage = 1;
  productTotal = 0;
  productHasMore = false;
  productSearch = '';
  productCategory = '';
  inStockOnly = true;

  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) { container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`; return; }

  try {
    const settings = await getPharmacySettings(pharmacyId);
    if (lifecycleToken && !isViewLifecycleActive(lifecycleToken)) return;
    window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };

    staffBranchId = await getStaffBranch(user.id);
    if (lifecycleToken && !isViewLifecycleActive(lifecycleToken)) return;
    if (!staffBranchId) {
      container.innerHTML = `<div class="alert alert-warning">You are not assigned to any branch. Contact your administrator.</div>`;
      return;
    }

    const [customers, categories, held, recent] = await Promise.all([
      getCustomers(pharmacyId),
      getProductCategories(pharmacyId, staffBranchId),
      getPOSHeldSales(pharmacyId, staffBranchId, user.id).catch(() => []),
      getSalesPage(pharmacyId, { page: 1, pageSize: 25, branchId: staffBranchId, staffId: user.id }).then(r => r.data.slice(0, 8)).catch(() => [])
    ]);
    if (lifecycleToken && !isViewLifecycleActive(lifecycleToken)) return;

    allCustomers = customers || [];
    productCategories = categories || [];
    heldSales = held || [];
    recentSales = recent || [];

    renderPOSView(container);
    await loadPOSProducts({ reset: true });
  } catch (err) {
    if (lifecycleToken && !isViewLifecycleActive(lifecycleToken)) return;
    container.innerHTML = `<div class="alert alert-danger">Failed to load POS: ${err.message}</div>`;
  }
}

function renderPOSView(container) {
  container.innerHTML = `
    <div class="pos-page-head">
      <div>
        <div class="page-title">Point of Sale</div>
        <div class="page-subtitle">Fast checkout for your assigned branch</div>
      </div>
      <div class="pos-head-actions">
        <button class="btn btn-ghost" id="pos-held-sales">⏸ Held Sales <span class="badge badge-gray" id="held-sales-count">${heldSales.length}</span></button>
        <button class="btn btn-ghost" id="pos-recent-sales">🧾 Recent Sales</button>
        <select class="form-select" id="customer-select">
          <option value="">Walk-in Customer</option>
          ${allCustomers.map(c => `<option value="${c.id}">${escapeReceiptText(c.name)} ${c.phone ? '('+escapeReceiptText(c.phone)+')' : ''}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" id="add-customer-quick">+ New Customer</button>
      </div>
    </div>

    <div class="pos-layout">
      <div class="pos-products">
        <div class="pos-toolbar">
          <div class="search-box pos-search-box">
            <span style="color:var(--gray-400)">&#128269;</span>
            <input type="search" id="pos-search" placeholder="Search products... (F2)" autocomplete="off" />
          </div>
          <select class="form-select" id="pos-cat-filter">
            <option value="">All Categories</option>
            ${productCategories.map(c => `<option value="${escapeReceiptText(c)}">${escapeReceiptText(c)}</option>`).join('')}
          </select>
          <label class="pos-stock-toggle"><input type="checkbox" id="pos-in-stock" checked /> <span>In Stock Only</span></label>
        </div>

        <div class="pos-quick-row">
          <button type="button" class="btn btn-ghost btn-sm" id="pos-favorites">★ Favorites</button>
          <button type="button" class="btn btn-ghost btn-sm" id="pos-recent-products">↻ Recent Products</button>
          <span class="text-xs text-muted" id="pos-product-count"></span>
        </div>

        <div class="pos-product-grid" id="pos-product-grid">
          <div class="empty-state" style="grid-column:1/-1"><div class="empty-state-title">Loading products…</div></div>
        </div>
        <div class="pos-load-more-wrap" id="pos-load-more-wrap" hidden>
          <button type="button" class="btn btn-ghost" id="pos-load-more">Load More Products</button>
        </div>
      </div>

      <div class="pos-cart">
        <div class="pos-cart-header">
          <span>&#128179; Cart</span>
          <div class="pos-cart-header-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="hold-sale-btn" disabled>Hold Sale</button>
            <span id="cart-count" class="badge badge-gray">0 items</span>
            <button type="button" class="mobile-pos-cart-close" id="mobile-pos-cart-close" aria-label="Close cart">&#10005;</button>
          </div>
        </div>
        <div class="pos-cart-items" id="cart-items">
          <div class="empty-state" style="padding:1.5rem">
            <div class="empty-state-icon" style="font-size:2rem">&#128179;</div>
            <div class="empty-state-title">Cart is empty</div>
            <div class="empty-state-desc">Click products to add them</div>
          </div>
        </div>
        <div class="pos-cart-footer">
          <div class="cart-summary-row"><span>Subtotal</span><span id="cart-subtotal">${formatCurrency(0)}</span></div>
          <div class="cart-summary-row">
            <span>Discount</span>
            <input type="number" id="discount-input" value="0" min="0" step="0.01" class="pos-discount-input" />
          </div>
          <div class="cart-summary-total"><span>Total</span><span id="cart-total" style="color:var(--primary)">${formatCurrency(0)}</span></div>

          <div class="form-group pos-payment-block">
            <label class="form-label">Payment</label>
            <select class="form-select" id="payment-method">
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="card">Card</option>
              <option value="split">Split Payment</option>
            </select>
          </div>

          <div id="cash-payment-fields" class="pos-payment-extra">
            <label class="form-label">Cash Received</label>
            <input type="number" class="form-input" id="cash-received" min="0" step="0.01" placeholder="0.00" />
            <div class="pos-change-row"><span>Change Due</span><strong id="change-due">${formatCurrency(0)}</strong></div>
          </div>

          <div id="split-payment-fields" class="pos-split-payment" hidden>
            <div class="pos-split-grid">
              <label>Cash<input type="number" class="form-input split-pay-input" id="split-cash" min="0" step="0.01" value="0" /></label>
              <label>Mobile Money<input type="number" class="form-input split-pay-input" id="split-mobile" min="0" step="0.01" value="0" /></label>
              <label>Card<input type="number" class="form-input split-pay-input" id="split-card" min="0" step="0.01" value="0" /></label>
            </div>
            <div class="pos-change-row"><span>Amount Remaining</span><strong id="split-remaining">${formatCurrency(0)}</strong></div>
          </div>

          <div class="form-group" style="margin-bottom:0.875rem">
            <label class="form-label">Notes (optional)</label>
            <input type="text" class="form-input" id="sale-notes" placeholder="Any notes..." />
          </div>
          <div class="pos-checkout-actions">
            <button class="btn btn-ghost" id="preview-receipt-btn" disabled>Preview</button>
            <button class="btn btn-primary btn-lg" id="checkout-btn" disabled>Complete Sale</button>
          </div>
        </div>
      </div>
    </div>

    <button type="button" class="mobile-pos-cart-toggle" id="mobile-pos-cart-toggle" aria-expanded="false" aria-controls="pos-cart">
      <span class="mobile-pos-cart-toggle-main"><span aria-hidden="true">&#128722;</span><span>View Cart</span><span class="mobile-pos-cart-count" id="mobile-cart-count">0</span></span>
      <span class="mobile-pos-cart-total" id="mobile-cart-total">${formatCurrency(0)}</span>
    </button>
    <div class="mobile-pos-cart-backdrop" id="mobile-pos-cart-backdrop" aria-hidden="true"></div>
  `;

  const posCart = document.querySelector('.pos-cart');
  if (posCart) posCart.id = 'pos-cart';
  const mobileCartToggle = document.getElementById('mobile-pos-cart-toggle');
  const mobileCartClose = document.getElementById('mobile-pos-cart-close');
  const mobileCartBackdrop = document.getElementById('mobile-pos-cart-backdrop');
  const mobileCartMedia = window.matchMedia('(max-width: 640px)');

  const setMobileCartOpen = (open) => {
    if (!posCart) return;
    const shouldOpen = Boolean(open && mobileCartMedia.matches);
    posCart.classList.toggle('mobile-open', shouldOpen);
    mobileCartBackdrop?.classList.toggle('show', shouldOpen);
    document.body.classList.toggle('mobile-pos-cart-open', shouldOpen);
    mobileCartToggle?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    mobileCartBackdrop?.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    if (mobileCartMedia.matches) posCart.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    else posCart.removeAttribute('aria-hidden');
  };

  const handleMobileCartMediaChange = () => setMobileCartOpen(false);
  const handlePOSKeydown = (e) => {
    if (e.key === 'Escape' && posCart?.classList.contains('mobile-open')) {
      setMobileCartOpen(false); mobileCartToggle?.focus(); return;
    }
    if (e.key === 'F2') { e.preventDefault(); document.getElementById('pos-search')?.focus(); }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); showReceiptPreview(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'h') { e.preventDefault(); if (cart.length) holdCurrentSale(); }
  };

  mobileCartToggle?.addEventListener('click', () => setMobileCartOpen(true));
  mobileCartClose?.addEventListener('click', () => setMobileCartOpen(false));
  mobileCartBackdrop?.addEventListener('click', () => setMobileCartOpen(false));
  mobileCartMedia.addEventListener?.('change', handleMobileCartMediaChange);
  document.addEventListener('keydown', handlePOSKeydown);
  setMobileCartOpen(false);

  const searchEl = document.getElementById('pos-search');
  searchEl.addEventListener('input', debounce(async () => {
    productSearch = searchEl.value.trim();
    await loadPOSProducts({ reset: true });
  }, 300));
  document.getElementById('pos-cat-filter').addEventListener('change', async (e) => { productCategory = e.target.value; await loadPOSProducts({ reset: true }); });
  document.getElementById('pos-in-stock').addEventListener('change', async (e) => { inStockOnly = e.target.checked; await loadPOSProducts({ reset: true }); });
  document.getElementById('pos-load-more')?.addEventListener('click', () => loadPOSProducts({ reset: false }));
  document.getElementById('customer-select').addEventListener('change', (e) => { selectedCustomer = e.target.value || null; });
  document.getElementById('add-customer-quick').addEventListener('click', showQuickAddCustomer);
  document.getElementById('discount-input').addEventListener('input', updateCartTotals);
  document.getElementById('payment-method').addEventListener('change', updatePaymentUI);
  document.getElementById('cash-received').addEventListener('input', updatePaymentUI);
  document.querySelectorAll('.split-pay-input').forEach(el => el.addEventListener('input', updatePaymentUI));
  document.getElementById('checkout-btn').addEventListener('click', processCheckout);
  document.getElementById('preview-receipt-btn').addEventListener('click', showReceiptPreview);
  document.getElementById('hold-sale-btn').addEventListener('click', holdCurrentSale);
  document.getElementById('pos-held-sales').addEventListener('click', showHeldSalesModal);
  document.getElementById('pos-recent-sales').addEventListener('click', showRecentSalesModal);
  document.getElementById('pos-favorites').addEventListener('click', showFavoriteProducts);
  document.getElementById('pos-recent-products').addEventListener('click', showRecentProducts);

  cleanupPOSInteractions = () => {
    mobileCartMedia.removeEventListener?.('change', handleMobileCartMediaChange);
    document.removeEventListener('keydown', handlePOSKeydown);
    document.body.classList.remove('mobile-pos-cart-open');
  };
  if (currentLifecycleToken && isViewLifecycleActive(currentLifecycleToken)) registerViewCleanup(currentLifecycleToken, () => cleanupPOSInteractions?.());
  updatePaymentUI();
}

async function loadPOSProducts({ reset = false } = {}) {
  if (!currentUser?.profile?.pharmacy_id || !staffBranchId || productLoading) return;
  const seq = ++productLoadSeq;
  productLoading = true;
  const grid = document.getElementById('pos-product-grid');
  const loadMore = document.getElementById('pos-load-more');
  if (reset) {
    productPage = 1;
    allProducts = [];
    if (grid) grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-title">Searching inventory…</div></div>`;
  }
  if (loadMore) { loadMore.disabled = true; loadMore.textContent = 'Loading…'; }

  try {
    const result = await getPOSProductsPage(currentUser.profile.pharmacy_id, {
      branchId: staffBranchId,
      page: productPage,
      pageSize: productPageSize,
      search: productSearch,
      category: productCategory,
      inStockOnly
    });
    if (seq !== productLoadSeq) return;
    const rows = result.products || [];
    const byId = new Map(allProducts.map(p => [p.id, p]));
    rows.forEach(p => byId.set(p.id, p));
    allProducts = [...byId.values()];
    productTotal = Number(result.count || 0);
    productHasMore = allProducts.length < productTotal;
    if (grid) grid.innerHTML = renderProductCards(allProducts);
    bindProductClicks();
    const count = document.getElementById('pos-product-count');
    if (count) count.textContent = `Showing ${allProducts.length} of ${productTotal} matching products`;
    const wrap = document.getElementById('pos-load-more-wrap');
    if (wrap) wrap.hidden = !productHasMore;
    if (productHasMore) productPage += 1;
  } catch (err) {
    if (grid) grid.innerHTML = `<div class="alert alert-danger" style="grid-column:1/-1">Could not load products: ${escapeReceiptText(err.message)}</div>`;
  } finally {
    productLoading = false;
    if (loadMore) { loadMore.disabled = false; loadMore.textContent = 'Load More Products'; }
  }
}

function filterProducts() {
  // Kept for cart refresh compatibility. The product list is already filtered server-side.
  const grid = document.getElementById('pos-product-grid');
  if (grid) grid.innerHTML = renderProductCards(allProducts);
  bindProductClicks();
}

function renderProductCards(products) {
  if (!products.length) return `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">&#128230;</div><div class="empty-state-title">No products found</div></div>`;

  return products.map(p => {
    const totalUnits = (Number(p.stock_boxes || 0) * Number(p.units_per_box || 1)) + Number(p.stock_units || 0);
    const inCart = cart.find(c => c.product_id === p.id);
    const outOfStock = totalUnits <= 0;
    const unitType = (p.unit_type || 'box').charAt(0).toUpperCase() + (p.unit_type || 'box').slice(1);
    const favorite = readPOSLocalList('favorites').includes(p.id);
    return `
      <div class="pos-product-card ${outOfStock ? 'out-of-stock' : ''}" data-id="${p.id}" data-stock="${totalUnits}">
        <button type="button" class="pos-product-favorite ${favorite ? 'active' : ''}" data-id="${p.id}" aria-label="${favorite ? 'Remove from favorites' : 'Add to favorites'}">${favorite ? '★' : '☆'}</button>
        <div class="pos-product-category">${escapeReceiptText(p.category || 'Other')}</div>
        <div class="pos-product-name">${escapeReceiptText(p.name)}</div>
        <div style="font-size:0.75rem;color:var(--primary);font-weight:600;margin-top:0.25rem">Sold by: ${unitType}</div>
        <div class="pos-product-price">${formatCurrency(p.price)} per ${unitType.toLowerCase()}</div>
        <div class="pos-product-stock">${outOfStock ? 'Out of stock' : totalUnits + ' units'}</div>
        ${inCart ? `<div style="margin-top:0.375rem"><span class="badge badge-primary">${inCart.quantity} ${unitType.toLowerCase()}s in cart</span></div>` : ''}
      </div>
    `;
  }).join('');
}

function getPOSStorageKey(kind) {
  return `sammia_pos_${kind}_${currentUser?.id || 'anon'}_${staffBranchId || 'branch'}`;
}
function readPOSLocalList(kind) {
  try { return JSON.parse(localStorage.getItem(getPOSStorageKey(kind)) || '[]'); } catch { return []; }
}
function writePOSLocalList(kind, values) {
  localStorage.setItem(getPOSStorageKey(kind), JSON.stringify(values.slice(0, 20)));
}
function rememberRecentProduct(productId) {
  const next = [productId, ...readPOSLocalList('recent_products').filter(id => id !== productId)];
  writePOSLocalList('recent_products', next);
}
function toggleFavoriteProduct(productId) {
  const list = readPOSLocalList('favorites');
  const next = list.includes(productId) ? list.filter(id => id !== productId) : [productId, ...list];
  writePOSLocalList('favorites', next);
  filterProducts();
}

function bindProductClicks() {
  document.querySelectorAll('.pos-product-favorite').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleFavoriteProduct(btn.dataset.id); });
  });
  document.querySelectorAll('.pos-product-card:not(.out-of-stock)').forEach(card => {
    card.addEventListener('click', () => {
      const productId = card.dataset.id;
      const stock = parseInt(card.dataset.stock, 10);
      const product = allProducts.find(p => p.id === productId);
      if (!product) return;
      rememberRecentProduct(productId);
      const existing = cart.find(c => c.product_id === productId);
      if (existing) {
        const nextUnits = getCartItemUnits(existing, existing.quantity + 1);
        if (nextUnits <= stock) existing.quantity++;
        else { showToast('Not enough stock available', 'error'); return; }
      } else {
        const unitType = product.unit_type || 'box';
        const minSell = product.min_sell_quantity || 1;
        const unitsPerBox = product.units_per_box || 1;
        cart.push({
          product_id: productId, product_name: product.name, unit_type: unitType,
          unit_price: Number(product.price || 0), quantity: minSell, maxStock: stock,
          priceSet: Number(product.price || 0) > 0, packaging_type: 'unit',
          units_per_box: unitsPerBox, min_sell_quantity: minSell, notes: ''
        });
      }
      renderCart();
      filterProducts();
    });
  });
}

function getCartItemUnits(item, quantity = item.quantity) {
  const info = getPackagingInfo(item.packaging_type || 'unit', item.units_per_box || 1);
  return Number(quantity || 0) * Number(info.units_per_unit || 1);
}

function renderCart() {
  const cartItems = document.getElementById('cart-items');
  const checkoutBtn = document.getElementById('checkout-btn');
  const countBadge = document.getElementById('cart-count');

  if (!cartItems) return;

  if (cart.length === 0) {
    cartItems.innerHTML = `
      <div class="empty-state" style="padding:1.5rem">
        <div class="empty-state-icon" style="font-size:2rem">&#128179;</div>
        <div class="empty-state-title">Cart is empty</div>
        <div class="empty-state-desc">Click products to add them</div>
      </div>
    `;
    if (checkoutBtn) checkoutBtn.disabled = true;
    document.getElementById('preview-receipt-btn') && (document.getElementById('preview-receipt-btn').disabled = true);
    document.getElementById('hold-sale-btn') && (document.getElementById('hold-sale-btn').disabled = true);
    if (countBadge) countBadge.textContent = '0 items';
    const mobileCount = document.getElementById('mobile-cart-count');
    if (mobileCount) mobileCount.textContent = '0';
    updateCartTotals();
    return;
  }

  cartItems.innerHTML = cart.map(item => {
    const unitType = (item.unit_type || 'unit').charAt(0).toUpperCase() + (item.unit_type || 'unit').slice(1);
    const unitsPerBox = item.units_per_box || 10;
    const unitsPerStrip = Math.ceil(unitsPerBox / 10) || 1;
    
    // Determine display label based on packaging type
    let packagingLabel = unitType;
    let totalUnitsInCart = item.quantity;
    
    if (item.packaging_type === 'strip') {
      packagingLabel = `Strip (${unitsPerStrip} ${unitType.toLowerCase()}s)`;
      totalUnitsInCart = item.quantity * unitsPerStrip;
    } else if (item.packaging_type === 'box') {
      packagingLabel = `Box (${unitsPerBox} ${unitType.toLowerCase()}s)`;
      totalUnitsInCart = item.quantity * unitsPerBox;
    }
    
    return `
    <div class="cart-item" data-id="${item.product_id}">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.product_name}</div>
        <div style="font-size:0.85rem;color:var(--gray-600);margin-top:0.25rem;font-weight:500">
          ${item.quantity} × <strong>${packagingLabel}</strong> <span style="color:var(--gray-500);font-size:0.75rem">(${totalUnitsInCart} ${unitType.toLowerCase()}s)</span>
        </div>
        ${item.notes ? `<div style="font-size:0.8rem;color:var(--primary);font-style:italic;margin-top:0.25rem">📝 ${item.notes}</div>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="window.editCartItemQty('${item.product_id}')" style="margin-top:0.375rem;font-size:0.75rem">
          ✏️ Edit
        </button>
        ${item.unit_price === 0 && !item.priceSet ? `
          <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.25rem">
            <span class="text-xs text-muted">Set price:</span>
            <input type="number" class="price-input" data-id="${item.product_id}" value="0" min="0" step="0.01" 
              style="width:60px;padding:0.25rem 0.5rem;border:1px solid var(--warning);border-radius:4px;font-size:0.8rem;font-family:inherit" 
              placeholder="0.00" />
          </div>
        ` : `
          <div class="cart-item-price">${formatCurrency(item.unit_price)} per ${packagingLabel.toLowerCase()}${item.priceSet && item.unit_price > 0 ? ' (locked)' : ''}</div>
        `}
      </div>
      <div class="cart-item-qty">
        <button class="qty-btn decrease-qty" data-id="${item.product_id}">-</button>
        <span class="qty-num">${item.quantity}</span>
        <button class="qty-btn increase-qty" data-id="${item.product_id}">+</button>
      </div>
      <div class="cart-item-total">${formatCurrency(item.quantity * item.unit_price)}</div>
      <button class="qty-btn remove-item" data-id="${item.product_id}" style="color:var(--danger);border-color:transparent;font-size:0.75rem">&#10005;</button>
    </div>
  `;
  }).join('');

  const totalItems = cart.reduce((sum, i) => sum + i.quantity, 0);
  if (countBadge) countBadge.textContent = totalItems + ' item(s)';
  const mobileCount = document.getElementById('mobile-cart-count');
  if (mobileCount) mobileCount.textContent = String(totalItems);
  if (checkoutBtn) checkoutBtn.disabled = false;
  document.getElementById('preview-receipt-btn') && (document.getElementById('preview-receipt-btn').disabled = false);
  document.getElementById('hold-sale-btn') && (document.getElementById('hold-sale-btn').disabled = false);

  document.querySelectorAll('.decrease-qty').forEach(btn => {
    btn.addEventListener('click', () => adjustQty(btn.dataset.id, -1));
  });
  document.querySelectorAll('.increase-qty').forEach(btn => {
    btn.addEventListener('click', () => adjustQty(btn.dataset.id, 1));
  });
  document.querySelectorAll('.remove-item').forEach(btn => {
    btn.addEventListener('click', () => removeFromCart(btn.dataset.id));
  });

  // Handle manual price entry for zero-price products
  document.querySelectorAll('.price-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const productId = e.target.dataset.id;
      const price = parseFloat(e.target.value) || 0;
      if (price <= 0) {
        showToast('Price must be greater than 0', 'error');
        e.target.value = '0';
        return;
      }
      const item = cart.find(c => c.product_id === productId);
      if (item) {
        item.unit_price = price;
        item.priceSet = true;  // Lock the price to prevent editing
        showToast(`Price set to ${formatCurrency(price)}`);
        renderCart();
      }
    });
  });

  updateCartTotals();
}

function adjustQty(productId, delta) {
  const item = cart.find(c => c.product_id === productId);
  if (!item) return;
  
  const newQty = item.quantity + delta;
  if (newQty <= 0) { removeFromCart(productId); return; }
  
  // Calculate actual units based on packaging type
  const unitsPerBox = item.units_per_box || 10;
  const unitsPerStrip = Math.ceil(unitsPerBox / 10) || 1;
  let unitsToValidate = newQty;
  
  if (item.packaging_type === 'strip') {
    unitsToValidate = newQty * unitsPerStrip;
  } else if (item.packaging_type === 'box') {
    unitsToValidate = newQty * unitsPerBox;
  }
  
  if (unitsToValidate > item.maxStock) { 
    showToast(`Not enough stock (only ${item.maxStock} units available)`, 'error'); 
    return; 
  }
  
  item.quantity = newQty;
  renderCart();
  filterProducts();
}

function removeFromCart(productId) {
  cart = cart.filter(c => c.product_id !== productId);
  renderCart();
  filterProducts();
}

function updateCartTotals() {
  const { subtotal, discount, total } = getCartTotals();
  const subtotalEl = document.getElementById('cart-subtotal');
  const totalEl = document.getElementById('cart-total');
  if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
  if (totalEl) totalEl.textContent = formatCurrency(total);
  const mobileTotalEl = document.getElementById('mobile-cart-total');
  if (mobileTotalEl) mobileTotalEl.textContent = formatCurrency(total);
  updatePaymentUI();
}

function getCartTotals() {
  const subtotal = cart.reduce((sum, i) => sum + (Number(i.quantity || 0) * Number(i.unit_price || 0)), 0);
  const discount = Math.max(0, Number(document.getElementById('discount-input')?.value || 0));
  return { subtotal, discount, total: Math.max(0, subtotal - discount) };
}

function getPaymentState() {
  const { total } = getCartTotals();
  const method = document.getElementById('payment-method')?.value || 'cash';
  if (method === 'split') {
    const cash = Math.max(0, Number(document.getElementById('split-cash')?.value || 0));
    const mobileMoney = Math.max(0, Number(document.getElementById('split-mobile')?.value || 0));
    const card = Math.max(0, Number(document.getElementById('split-card')?.value || 0));
    const paid = cash + mobileMoney + card;
    return { method, details: { cash, mobile_money: mobileMoney, card }, paid, remaining: Math.max(0, total - paid), changeDue: Math.max(0, paid - total) };
  }
  const cashReceived = method === 'cash' ? Math.max(0, Number(document.getElementById('cash-received')?.value || 0)) : total;
  return { method, details: { [method]: total }, paid: method === 'cash' ? cashReceived : total, remaining: method === 'cash' ? Math.max(0, total - cashReceived) : 0, changeDue: method === 'cash' ? Math.max(0, cashReceived - total) : 0 };
}

function updatePaymentUI() {
  const method = document.getElementById('payment-method')?.value || 'cash';
  const cashFields = document.getElementById('cash-payment-fields');
  const splitFields = document.getElementById('split-payment-fields');
  if (cashFields) cashFields.hidden = method !== 'cash';
  if (splitFields) splitFields.hidden = method !== 'split';
  const payment = getPaymentState();
  const change = document.getElementById('change-due');
  if (change) change.textContent = formatCurrency(payment.changeDue);
  const remaining = document.getElementById('split-remaining');
  if (remaining) remaining.textContent = formatCurrency(payment.remaining);
}

async function holdCurrentSale() {
  if (!cart.length) return;
  const name = window.prompt('Name this held sale (optional):', selectedCustomer ? 'Customer order' : 'Walk-in customer');
  if (name === null) return;
  const { discount } = getCartTotals();
  try {
    const held = await createPOSHeldSale({
      pharmacy_id: currentUser.profile.pharmacy_id,
      branch_id: staffBranchId,
      created_by: currentUser.id,
      customer_id: selectedCustomer || null,
      label: name.trim() || 'Held sale',
      cart_json: cart,
      discount,
      notes: document.getElementById('sale-notes')?.value || ''
    });
    heldSales = [held, ...heldSales.filter(h => h.id !== held.id)];
    cart = [];
    selectedCustomer = null;
    document.getElementById('customer-select').value = '';
    document.getElementById('discount-input').value = '0';
    document.getElementById('sale-notes').value = '';
    document.getElementById('held-sales-count').textContent = heldSales.length;
    renderCart();
    filterProducts();
    showToast('Sale held');
  } catch (err) { showToast(`Could not hold sale: ${err.message}`, 'error'); }
}

function showHeldSalesModal() {
  const { overlay, closeModal } = createModal({
    id: 'held-sales-modal', title: `Held Sales (${heldSales.length})`, size: 'modal-lg',
    body: heldSales.length ? `<div class="pos-held-list">${heldSales.map(h => `<div class="pos-held-row"><div><strong>${escapeReceiptText(h.label || 'Held sale')}</strong><small>${new Date(h.created_at).toLocaleString()} · ${(h.cart_json || []).length} product(s)</small></div><div class="flex gap-2"><button class="btn btn-primary btn-sm resume-held" data-id="${h.id}">Resume</button><button class="btn btn-ghost btn-sm delete-held" data-id="${h.id}">Delete</button></div></div>`).join('')}</div>` : `<div class="empty-state"><div class="empty-state-title">No held sales</div></div>`,
    footer: `<button class="btn btn-ghost" id="held-close">Close</button>`
  });
  overlay.querySelector('#held-close').addEventListener('click', closeModal);
  overlay.querySelectorAll('.resume-held').forEach(btn => btn.addEventListener('click', async () => {
    const held = heldSales.find(h => h.id === btn.dataset.id); if (!held) return;
    if (cart.length && !window.confirm('Replace the current cart with this held sale?')) return;
    cart = Array.isArray(held.cart_json) ? held.cart_json : [];
    selectedCustomer = held.customer_id || null;
    document.getElementById('customer-select').value = selectedCustomer || '';
    document.getElementById('discount-input').value = held.discount || 0;
    document.getElementById('sale-notes').value = held.notes || '';
    await deletePOSHeldSale(held.id).catch(() => {});
    heldSales = heldSales.filter(h => h.id !== held.id);
    document.getElementById('held-sales-count').textContent = heldSales.length;
    renderCart(); filterProducts(); closeModal(); showToast('Held sale resumed');
  }));
  overlay.querySelectorAll('.delete-held').forEach(btn => btn.addEventListener('click', async () => {
    if (!window.confirm('Delete this held sale?')) return;
    await deletePOSHeldSale(btn.dataset.id);
    heldSales = heldSales.filter(h => h.id !== btn.dataset.id);
    closeModal(); showHeldSalesModal();
  }));
}

function showRecentSalesModal() {
  const { overlay, closeModal } = createModal({
    id: 'recent-pos-sales', title: 'Recent Sales', size: 'modal-lg',
    body: recentSales.length ? `<div class="pos-recent-sales-list">${recentSales.map(sale => `<button class="pos-recent-sale-row" data-id="${sale.id}"><span><strong>${escapeReceiptText(sale.invoice_number)}</strong><small>${formatUTCDateTime(sale.created_at)}</small></span><strong>${formatCurrency(Number(sale.total_amount || 0))}</strong></button>`).join('')}</div>` : `<div class="empty-state"><div class="empty-state-title">No recent sales</div></div>`,
    footer: `<button class="btn btn-ghost" id="recent-close">Close</button>`
  });
  overlay.querySelector('#recent-close').addEventListener('click', closeModal);
  overlay.querySelectorAll('.pos-recent-sale-row').forEach(btn => btn.addEventListener('click', async () => {
    const sale = recentSales.find(s => s.id === btn.dataset.id); if (!sale) return;
    const branchDetails = await getBranchDetails(staffBranchId).catch(() => ({}));
    showReceiptModal(sale, (sale.sale_items || []).map(i => ({ product_name:i.product_name, quantity:Number(i.packaging_quantity || i.quantity), unit_price:Number(i.total_price || 0) / Math.max(1, Number(i.packaging_quantity || i.quantity)), packaging_type:i.packaging_type || 'unit', units_per_box:1 })), Number(sale.total_amount||0), Number(sale.discount||0), sale.payment_method || 'cash', branchDetails, sale.payment_details || null, Number(sale.change_due||0));
  }));
}

async function showFavoriteProducts() {
  const ids = readPOSLocalList('favorites');
  if (!ids.length) { showToast('No favorite products yet. Use the star on a product card.', 'warning'); return; }
  try {
    const rows = await getPOSProductsByIds(currentUser.profile.pharmacy_id, staffBranchId, ids);
    allProducts = rows;
    document.getElementById('pos-product-grid').innerHTML = renderProductCards(rows);
    bindProductClicks();
    document.getElementById('pos-product-count').textContent = `${rows.length} favorite product(s)`;
    document.getElementById('pos-load-more-wrap').hidden = true;
  } catch (err) { showToast(`Could not load favorites: ${err.message}`, 'error'); }
}
async function showRecentProducts() {
  const ids = readPOSLocalList('recent_products');
  if (!ids.length) { showToast('No recent products yet.', 'warning'); return; }
  try {
    const rows = await getPOSProductsByIds(currentUser.profile.pharmacy_id, staffBranchId, ids);
    allProducts = rows;
    document.getElementById('pos-product-grid').innerHTML = renderProductCards(rows);
    bindProductClicks();
    document.getElementById('pos-product-count').textContent = `${rows.length} recently selected product(s)`;
    document.getElementById('pos-load-more-wrap').hidden = true;
  } catch (err) { showToast(`Could not load recent products: ${err.message}`, 'error'); }
}

async function processCheckout() {
  if (cart.length === 0) { showToast('Cart is empty', 'error'); return; }
  const checkoutBtn = document.getElementById('checkout-btn');
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = 'Processing...';

  const { subtotal, discount, total } = getCartTotals();
  const payment = getPaymentState();
  const paymentMethod = payment.method;
  const notes = document.getElementById('sale-notes').value;

  if (!staffBranchId) {
    showToast('Error: Your branch assignment could not be determined', 'error');
    checkoutBtn.disabled = false; checkoutBtn.textContent = 'Complete Sale'; return;
  }
  if ([subtotal, discount, total].some(Number.isNaN)) {
    showToast('Invalid cart calculations. Please refresh and try again.', 'error');
    checkoutBtn.disabled = false; checkoutBtn.textContent = 'Complete Sale'; return;
  }
  if (payment.remaining > 0.009) {
    showToast(`Payment is short by ${formatCurrency(payment.remaining)}`, 'error');
    checkoutBtn.disabled = false; checkoutBtn.textContent = 'Complete Sale'; return;
  }

  const cartItemsForSale = cart.map(item => {
    const product = allProducts.find(p => p.id === item.product_id);
    const packagingInfo = getPackagingInfo(item.packaging_type, product?.units_per_box || item.units_per_box || 1);
    const actualUnits = item.quantity * packagingInfo.units_per_unit;
    return {
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: actualUnits,
      unit_price: actualUnits > 0 ? Number(item.unit_price || 0) / packagingInfo.units_per_unit : Number(item.unit_price || 0),
      packaging_type: item.packaging_type,
      packaging_quantity: item.quantity
    };
  });

  const salePayload = {
    customer_id: selectedCustomer || null,
    payment_method: paymentMethod,
    total_amount: parseFloat(total.toFixed(2)),
    discount: parseFloat(discount.toFixed(2)),
    notes: notes || '',
    created_by: currentUser.id,
    pharmacy_id: currentUser.profile.pharmacy_id,
    branch_id: staffBranchId,
    status: 'completed',
    payment_details: payment.details,
    cash_received: paymentMethod === 'cash' ? payment.paid : Number(payment.details.cash || 0),
    change_due: payment.changeDue,
    created_at: new Date().toISOString()
  };

  try {
    const sale = await createSale(salePayload, cartItemsForSale);
    showToast(`Sale completed! Invoice: ${sale.invoice_number}`);
    const branchDetails = await getBranchDetails(staffBranchId);
    showReceiptModal(sale, cart.slice(), total, discount, paymentMethod, branchDetails, payment.details, payment.changeDue);
    cart = [];
    selectedCustomer = null;
    await renderPOS(document.getElementById('page-content'), currentUser, currentLifecycleToken);
  } catch (err) {
    let errorMsg = err.message || 'Unknown error occurred';
    if (errorMsg.includes('branch_id')) errorMsg = 'Branch information missing. Please contact administrator.';
    else if (errorMsg.includes('expired')) errorMsg = 'Cannot sell expired products. Remove them and try again.';
    else if (errorMsg.includes('stock')) errorMsg = 'Insufficient stock for some items. Refresh and try again.';
    else if (errorMsg.includes('payment_method')) errorMsg = 'Split payment support requires the latest POS database migration.';
    else if (err.code === '42703' || err.code === 'PGRST204') errorMsg = 'POS database upgrade required. Apply the latest Supabase migration.';
    showToast('Failed to complete sale: ' + errorMsg, 'error');
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = 'Complete Sale';
  }
}

function showReceiptModal(sale, items, total, discount, paymentMethod, branchDetails = {}, paymentDetails = null, changeDue = 0) {
  const saleDate = formatUTCDateTime(sale.created_at);
  const branchName = branchDetails?.name || 'Pharmacy';
  const branchAddress = branchDetails?.address || '';
  const branchEmail = branchDetails?.email || '';
  const cashierName = getReceiptCashierName(sale);
  const { overlay, closeModal } = createModal({
    id: 'receipt-modal',
    title: 'Sale Complete!',
    body: `
      <div id="receipt-content" style="font-family:monospace;font-size:0.9rem">
        <div style="text-align:center;margin-bottom:1.25rem">
          <div style="font-size:3rem;margin-bottom:0.5rem">&#9989;</div>
          <div style="font-size:1.25rem;font-weight:700;color:var(--success)">${formatCurrency(total)}</div>
          <div class="text-sm text-muted">${sale.invoice_number}</div>
          <div class="text-xs text-muted" style="margin-top:0.25rem">${saleDate}</div>
          <div class="text-xs text-muted" style="margin-top:0.2rem">Cashier: ${escapeReceiptText(cashierName)}</div>
        </div>
        <div style="background:var(--gray-50);border-radius:var(--radius);padding:1rem;margin-bottom:1rem">
          ${items.map(i => {
            const packagingInfo = getPackagingInfo(i.packaging_type || 'unit', i.units_per_box || 10);
            return `
            <div class="cart-summary-row">
              <span>${i.product_name} × ${i.quantity} ${packagingInfo.label.toLowerCase()}</span>
              <span>${formatCurrency(i.quantity * i.unit_price)}</span>
            </div>`;
          }).join('')}
          ${discount > 0 ? `<div class="cart-summary-row" style="color:var(--success)"><span>Discount</span><span>-${formatCurrency(discount)}</span></div>` : ''}
          <div class="cart-summary-total">
            <span>Total</span>
            <span style="color:var(--success)">${formatCurrency(total)}</span>
          </div>
          <div class="cart-summary-row">
            <span class="text-muted">Payment</span>
            <span class="font-semibold">${paymentMethod.replace('_', ' ')}${paymentDetails ? ` · ${Object.entries(paymentDetails).filter(([,v]) => Number(v)>0).map(([k,v]) => `${k.replace('_',' ')} ${formatCurrency(Number(v))}`).join(' + ')}` : ''}</span>
          </div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" id="print-receipt-btn">&#128424; Print</button>
      <button class="btn btn-primary" id="receipt-close">Done</button>
    `
  });

  overlay.querySelector('#receipt-close').addEventListener('click', closeModal);
  overlay.querySelector('#print-receipt-btn').addEventListener('click', () => {
    const printContent = overlay.querySelector('#receipt-content').innerHTML;
    const printWindow = window.open('', '', 'width=400,height=600');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt - ${sale.invoice_number}</title>
          <style>
            body { font-family: monospace; font-size: 12px; margin: 0; padding: 20px; }
            .receipt { max-width: 300px; margin: 0 auto; }
            .row { display: flex; justify-content: space-between; margin: 4px 0; }
            .divider { border-bottom: 1px dashed #000; margin: 10px 0; }
            .title { text-align: center; font-weight: bold; margin-bottom: 10px; }
            .total { font-weight: bold; font-size: 14px; }
            .success { color: green; }
          </style>
        </head>
        <body>
          <div class="receipt">
            <div style="text-align: center; margin-bottom: 10px; border-bottom: 1px dashed #000; padding-bottom: 10px;">
              ${getReceiptLogoHtml()}
              <div class="title" style="font-size: 14px; font-weight: bold; margin-bottom: 5px;">${branchName}</div>
              ${branchAddress ? `<div style="font-size: 10px; margin-bottom: 3px;">${branchAddress}</div>` : ''}
              ${branchEmail ? `<div style="font-size: 10px; margin-bottom: 3px;">${branchEmail}</div>` : ''}
            </div>
            <div class="title">Receipt</div>
            <div class="row"><span>Invoice:</span><span><strong>${sale.invoice_number}</strong></span></div>
            <div class="row"><span>Date:</span><span>${formatUTCDateTime(sale.created_at)}</span></div>
            <div class="row"><span>Cashier:</span><span>${escapeReceiptText(cashierName)}</span></div>
            <div class="divider"></div>
            ${items.map(i => {
              const packagingInfo = getPackagingInfo(i.packaging_type || 'unit', i.units_per_box || 10);
              const symbol = window.pharmacySettings?.currency_symbol || 'Le';
              return `<div class="row"><span>${i.product_name} × ${i.quantity} ${packagingInfo.label.toLowerCase()}</span><span>${symbol}${(i.quantity * i.unit_price).toFixed(2)}</span></div>`;
            }).join('')}
            <div class="divider"></div>
            ${discount > 0 ? `<div class="row success"><span>Discount:</span><span>-${window.pharmacySettings?.currency_symbol || 'Le'}${discount.toFixed(2)}</span></div>` : ''}
            <div class="row total success"><span>TOTAL:</span><span>${window.pharmacySettings?.currency_symbol || 'Le'}${total.toFixed(2)}</span></div>
            <div class="row"><span>Payment:</span><span>${paymentMethod.replace('_', ' ')}</span></div>
            ${paymentDetails ? Object.entries(paymentDetails).filter(([,v]) => Number(v)>0).map(([k,v]) => `<div class="row"><span>${k.replace('_',' ')}:</span><span>${window.pharmacySettings?.currency_symbol || 'Le'}${Number(v).toFixed(2)}</span></div>`).join('') : ''}
            ${changeDue > 0 ? `<div class="row"><span>Change:</span><span>${window.pharmacySettings?.currency_symbol || 'Le'}${Number(changeDue).toFixed(2)}</span></div>` : ''}
            <div class="divider"></div>
            <div style="text-align: center; font-size: 10px; margin-top: 10px;">${getConfiguredReceiptFooter(branchDetails)}</div>
          </div>
          <script>window.print(); window.close();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  });
}

function showReceiptPreview() {
  if (cart.length === 0) {
    showToast('Cart is empty - nothing to preview', 'warning');
    return;
  }

  const subtotal = cart.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
  const discount = parseFloat(document.getElementById('discount-input')?.value || 0) || 0;
  const total = Math.max(0, subtotal - discount);
  const paymentMethod = document.getElementById('payment-method').value;
  const previewDate = new Date().toISOString();
  
  // Generate preview invoice number
  const previewInvoiceNumber = 'INV-' + Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  const previewDateFormatted = formatUTCDateTime(previewDate);
  const previewCashierName = getReceiptCashierName({}, currentUser);

  // Get branch details for receipt header
  getBranchDetails(staffBranchId).then(branchDetails => {
    const branchName = branchDetails?.name || 'Pharmacy';
    const branchAddress = branchDetails?.address || '';
    const branchEmail = branchDetails?.email || '';

    const { overlay, closeModal } = createModal({
      id: 'receipt-modal',
      title: 'Sale Complete!',
      body: `
        <div id="receipt-content" style="font-family:monospace;font-size:0.9rem">
          <div style="text-align:center;margin-bottom:1.25rem">
            <div style="font-size:3rem;margin-bottom:0.5rem">&#9989;</div>
            <div style="font-size:1.25rem;font-weight:700;color:var(--success)">${formatCurrency(total)}</div>
            <div class="text-sm text-muted">${previewInvoiceNumber}</div>
            <div class="text-xs text-muted" style="margin-top:0.25rem">${previewDateFormatted}</div>
            <div class="text-xs text-muted" style="margin-top:0.2rem">Cashier: ${escapeReceiptText(previewCashierName)}</div>
          </div>
          <div style="background:var(--gray-50);border-radius:var(--radius);padding:1rem;margin-bottom:1rem">
            ${cart.map(i => {
              const packagingInfo = getPackagingInfo(i.packaging_type || 'unit', i.units_per_box || 10);
              return `
              <div class="cart-summary-row">
                <span>${i.product_name} × ${i.quantity} ${packagingInfo.label.toLowerCase()}</span>
                <span>${formatCurrency(i.quantity * i.unit_price)}</span>
              </div>`;
            }).join('')}
            ${discount > 0 ? `<div class="cart-summary-row" style="color:var(--success)"><span>Discount</span><span>-${formatCurrency(discount)}</span></div>` : ''}
            <div class="cart-summary-total">
              <span>Total</span>
              <span style="color:var(--success)">${formatCurrency(total)}</span>
            </div>
            <div class="cart-summary-row">
              <span class="text-muted">Payment</span>
              <span class="font-semibold">${paymentMethod.replace('_', ' ')}${paymentDetails ? ` · ${Object.entries(paymentDetails).filter(([,v]) => Number(v)>0).map(([k,v]) => `${k.replace('_',' ')} ${formatCurrency(Number(v))}`).join(' + ')}` : ''}</span>
            </div>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="print-receipt-btn">&#128424; Print</button>
        <button class="btn btn-primary" id="receipt-close">Done</button>
      `
    });

    overlay.querySelector('#receipt-close').addEventListener('click', closeModal);
    overlay.querySelector('#print-receipt-btn').addEventListener('click', () => {
      const printContent = overlay.querySelector('#receipt-content').innerHTML;
      const printWindow = window.open('', '', 'width=400,height=600');
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Receipt - ${previewInvoiceNumber}</title>
            <style>
              body { font-family: monospace; font-size: 12px; margin: 0; padding: 20px; }
              .receipt { max-width: 300px; margin: 0 auto; }
              .row { display: flex; justify-content: space-between; margin: 4px 0; }
              .divider { border-bottom: 1px dashed #000; margin: 10px 0; }
              .title { text-align: center; font-weight: bold; margin-bottom: 10px; }
              .total { font-weight: bold; font-size: 14px; }
              .success { color: green; }
            </style>
          </head>
          <body>
            <div class="receipt">
              <div style="text-align: center; margin-bottom: 10px; border-bottom: 1px dashed #000; padding-bottom: 10px;">
                ${getReceiptLogoHtml()}
              <div class="title" style="font-size: 14px; font-weight: bold; margin-bottom: 5px;">${branchName}</div>
                ${branchAddress ? `<div style="font-size: 10px; margin-bottom: 3px;">${branchAddress}</div>` : ''}
                ${branchEmail ? `<div style="font-size: 10px; margin-bottom: 3px;">${branchEmail}</div>` : ''}
              </div>
              <div class="title">Receipt</div>
              <div class="row"><span>Invoice:</span><span><strong>${previewInvoiceNumber}</strong></span></div>
              <div class="row"><span>Date:</span><span>${previewDateFormatted}</span></div>
              <div class="row"><span>Cashier:</span><span>${escapeReceiptText(previewCashierName)}</span></div>
              <div class="divider"></div>
              ${cart.map(i => {
                const packagingInfo = getPackagingInfo(i.packaging_type || 'unit', i.units_per_box || 10);
                const symbol = window.pharmacySettings?.currency_symbol || 'Le';
                return `<div class="row"><span>${i.product_name} × ${i.quantity} ${packagingInfo.label.toLowerCase()}</span><span>${symbol}${(i.quantity * i.unit_price).toFixed(2)}</span></div>`;
              }).join('')}
              <div class="divider"></div>
              ${discount > 0 ? `<div class="row success"><span>Discount:</span><span>-${window.pharmacySettings?.currency_symbol || 'Le'}${discount.toFixed(2)}</span></div>` : ''}
              <div class="row total success"><span>TOTAL:</span><span>${window.pharmacySettings?.currency_symbol || 'Le'}${total.toFixed(2)}</span></div>
              <div class="row"><span>Payment:</span><span>${paymentMethod.replace('_', ' ')}</span></div>
              <div class="divider"></div>
              <div style="text-align: center; font-size: 10px; margin-top: 10px;">${getConfiguredReceiptFooter(branchDetails)}</div>
            </div>
            <script>window.print(); window.close();</script>
          </body>
        </html>
      `);
      printWindow.document.close();
    });
  }).catch(err => {
    console.error('Failed to fetch branch details:', err);
    // Fallback with basic receipt
    const { overlay, closeModal } = createModal({
      id: 'receipt-modal',
      title: 'Sale Complete!',
      body: `
        <div id="receipt-content" style="font-family:monospace;font-size:0.9rem">
          <div style="text-align:center;margin-bottom:1.25rem">
            <div style="font-size:3rem;margin-bottom:0.5rem">&#9989;</div>
            <div style="font-size:1.25rem;font-weight:700;color:var(--success)">${formatCurrency(total)}</div>
            <div class="text-sm text-muted">${previewInvoiceNumber}</div>
            <div class="text-xs text-muted" style="margin-top:0.25rem">${previewDateFormatted}</div>
            <div class="text-xs text-muted" style="margin-top:0.2rem">Cashier: ${escapeReceiptText(previewCashierName)}</div>
          </div>
          <div style="background:var(--gray-50);border-radius:var(--radius);padding:1rem;margin-bottom:1rem">
            ${cart.map(i => {
              const packagingInfo = getPackagingInfo(i.packaging_type || 'unit', i.units_per_box || 10);
              return `
              <div class="cart-summary-row">
                <span>${i.product_name} × ${i.quantity} ${packagingInfo.label.toLowerCase()}</span>
                <span>${formatCurrency(i.quantity * i.unit_price)}</span>
              </div>`;
            }).join('')}
            ${discount > 0 ? `<div class="cart-summary-row" style="color:var(--success)"><span>Discount</span><span>-${formatCurrency(discount)}</span></div>` : ''}
            <div class="cart-summary-total">
              <span>Total</span>
              <span style="color:var(--success)">${formatCurrency(total)}</span>
            </div>
            <div class="cart-summary-row">
              <span class="text-muted">Payment</span>
              <span class="font-semibold">${paymentMethod.replace('_', ' ')}${paymentDetails ? ` · ${Object.entries(paymentDetails).filter(([,v]) => Number(v)>0).map(([k,v]) => `${k.replace('_',' ')} ${formatCurrency(Number(v))}`).join(' + ')}` : ''}</span>
            </div>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="print-receipt-btn">&#128424; Print</button>
        <button class="btn btn-primary" id="receipt-close">Done</button>
      `
    });

    overlay.querySelector('#receipt-close').addEventListener('click', closeModal);
    overlay.querySelector('#print-receipt-btn').addEventListener('click', () => {
      const printWindow = window.open('', '', 'width=400,height=600');
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Receipt - ${previewInvoiceNumber}</title>
            <style>
              body { font-family: monospace; font-size: 12px; margin: 0; padding: 20px; }
              .receipt { max-width: 300px; margin: 0 auto; }
              .row { display: flex; justify-content: space-between; margin: 4px 0; }
              .divider { border-bottom: 1px dashed #000; margin: 10px 0; }
              .title { text-align: center; font-weight: bold; margin-bottom: 10px; }
              .total { font-weight: bold; font-size: 14px; }
              .success { color: green; }
            </style>
          </head>
          <body>
            <div class="receipt">
              <div style="text-align: center; margin-bottom: 10px; border-bottom: 1px dashed #000; padding-bottom: 10px;">
                ${getReceiptLogoHtml()}
                <div class="title" style="font-size: 14px; font-weight: bold; margin-bottom: 5px;">Pharmacy</div>
              </div>
              <div class="title">Receipt</div>
              <div class="row"><span>Invoice:</span><span><strong>${previewInvoiceNumber}</strong></span></div>
              <div class="row"><span>Date:</span><span>${previewDateFormatted}</span></div>
              <div class="row"><span>Cashier:</span><span>${escapeReceiptText(previewCashierName)}</span></div>
              <div class="divider"></div>
              ${cart.map(i => {
                const packagingInfo = getPackagingInfo(i.packaging_type || 'unit', i.units_per_box || 10);
                const symbol = window.pharmacySettings?.currency_symbol || 'Le';
                return `<div class="row"><span>${i.product_name} × ${i.quantity} ${packagingInfo.label.toLowerCase()}</span><span>${symbol}${(i.quantity * i.unit_price).toFixed(2)}</span></div>`;
              }).join('')}
              <div class="divider"></div>
              ${discount > 0 ? `<div class="row success"><span>Discount:</span><span>-${window.pharmacySettings?.currency_symbol || 'Le'}${discount.toFixed(2)}</span></div>` : ''}
              <div class="row total success"><span>TOTAL:</span><span>${window.pharmacySettings?.currency_symbol || 'Le'}${total.toFixed(2)}</span></div>
              <div class="row"><span>Payment:</span><span>${paymentMethod.replace('_', ' ')}</span></div>
              <div class="divider"></div>
              <div style="text-align: center; font-size: 10px; margin-top: 10px;">${getConfiguredReceiptFooter({ id: staffBranchId, name: 'Pharmacy' })}</div>
            </div>
            <script>window.print(); window.close();</script>
          </body>
        </html>
      `);
      printWindow.document.close();
    });
  });
}

function showQuickAddCustomer() {
  const { overlay, closeModal } = createModal({
    id: 'quick-customer',
    title: 'Add Quick Customer',
    body: `
      <div class="form-group">
        <label class="form-label">Name *</label>
        <input type="text" class="form-input" id="qc-name" placeholder="Customer name" required />
      </div>
      <div class="form-group">
        <label class="form-label">Phone</label>
        <input type="tel" class="form-input" id="qc-phone" placeholder="+1 555 0000" />
      </div>
      <div id="qc-err" class="alert alert-danger hidden"></div>
    `,
    footer: `
      <button class="btn btn-ghost" id="qc-cancel">Cancel</button>
      <button class="btn btn-primary" id="qc-save">Add Customer</button>
    `
  });

  overlay.querySelector('#qc-cancel').addEventListener('click', closeModal);
  overlay.querySelector('#qc-save').addEventListener('click', async () => {
    const name = overlay.querySelector('#qc-name').value.trim();
    const phone = overlay.querySelector('#qc-phone').value.trim();
    const errEl = overlay.querySelector('#qc-err');
    if (!name) { errEl.textContent = 'Name is required.'; errEl.classList.remove('hidden'); return; }

    try {
      const customer = await createCustomer({ name, phone, pharmacy_id: currentUser.profile.pharmacy_id });
      allCustomers.push(customer);
      const sel = document.getElementById('customer-select');
      const opt = document.createElement('option');
      opt.value = customer.id;
      opt.textContent = customer.name;
      opt.selected = true;
      sel.appendChild(opt);
      selectedCustomer = customer.id;
      showToast('Customer added');
      closeModal();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

// ===== PACKAGING HELPERS =====
function getPackagingInfo(type, unitsPerBox) {
  // Real pharmacy packaging:
  // Box = full box with all units
  // Card = half box (standard blister card)
  // Strip = smaller quantity (3-5 units)
  // Unit = individual
  const stripUnits = Math.max(3, Math.floor(unitsPerBox / 3)); // ~1/3 of box or 3, whichever is larger
  const cardUnits = Math.floor(unitsPerBox / 2); // Half box
  
  const packagingOptions = {
    'unit': { label: 'Unit', units_per_unit: 1 },
    'strip': { label: 'Strip', units_per_unit: stripUnits },
    'card': { label: 'Card', units_per_unit: cardUnits > 0 ? cardUnits : Math.ceil(unitsPerBox / 2) },
    'box': { label: 'Box', units_per_unit: unitsPerBox || 10 }
  };
  return packagingOptions[type] || packagingOptions['unit'];
}

window.editCartItemQty = function(productId) {
  const item = cart.find(c => c.product_id === productId);
  if (!item) return;

  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const unitType = (item.unit_type || 'unit').charAt(0).toUpperCase() + (item.unit_type || 'unit').slice(1);
  const totalAvailableUnits = item.maxStock;
  const minSellQty = item.min_sell_quantity || 1;
  const unitsPerBox = product.units_per_box || 10;
  const unitsPerStrip = Math.ceil(unitsPerBox / 10) || 1;

  // Calculate base unit price (always per individual unit)
  let baseUnitPrice = item.unit_price;
  if (item.packaging_type === 'strip' && unitsPerStrip > 0) {
    baseUnitPrice = item.unit_price / unitsPerStrip;
  } else if (item.packaging_type === 'box' && unitsPerBox > 0) {
    baseUnitPrice = item.unit_price / unitsPerBox;
  }

  // Determine packaging options
  const stripLabel = `Strip (${unitsPerStrip} ${unitType.toLowerCase()}s)`;
  const boxLabel = `Box (${unitsPerBox} ${unitType.toLowerCase()}s)`;

  const { overlay, closeModal } = createModal({
    id: 'qty-modal',
    title: `Edit: ${item.product_name}`,
    size: 'modal-lg',
    body: `
      <div style="display:flex;flex-direction:column;gap:1rem">
        <div style="background:var(--info-light);padding:0.75rem;border-radius:var(--radius);font-size:0.875rem;border-left:4px solid var(--info)">
          <strong>Product:</strong> ${item.product_name}<br>
          <strong>Unit Type:</strong> ${unitType}<br>
          <strong>Stock Available:</strong> ${totalAvailableUnits} units
        </div>

        <!-- Packaging Type Selection -->
        <div class="form-group">
          <label class="form-label">Sell By:</label>
          <div style="display:grid;grid-template-columns:1fr 1fr ${unitsPerBox > 1 ? '1fr' : ''};gap:0.5rem">
            <label style="display:flex;align-items:center;gap:0.5rem;padding:0.75rem;border:2px solid var(--border);border-radius:var(--radius);cursor:pointer;transition:all 0.2s" id="label-unit">
              <input type="radio" name="packaging-type" value="unit" ${item.packaging_type === 'unit' || !item.packaging_type ? 'checked' : ''} />
              <span style="font-size:0.9rem"><strong>1 ${unitType.toLowerCase()}</strong></span>
            </label>
            <label style="display:flex;align-items:center;gap:0.5rem;padding:0.75rem;border:2px solid var(--border);border-radius:var(--radius);cursor:pointer;transition:all 0.2s" id="label-strip">
              <input type="radio" name="packaging-type" value="strip" ${item.packaging_type === 'strip' ? 'checked' : ''} />
              <span style="font-size:0.9rem"><strong>1 ${stripLabel.toLowerCase()}</strong></span>
            </label>
            ${unitsPerBox > 1 ? `
            <label style="display:flex;align-items:center;gap:0.5rem;padding:0.75rem;border:2px solid var(--border);border-radius:var(--radius);cursor:pointer;transition:all 0.2s" id="label-box">
              <input type="radio" name="packaging-type" value="box" ${item.packaging_type === 'box' ? 'checked' : ''} />
              <span style="font-size:0.9rem"><strong>1 ${boxLabel.toLowerCase()}</strong></span>
            </label>
            ` : ''}
          </div>
        </div>

        <!-- Quantity Input -->
        <div class="form-group">
          <label class="form-label">Quantity</label>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <input type="number" id="qty-input" class="form-input" value="${item.quantity}" min="1" max="999" style="font-size:1rem;padding:0.75rem;flex:1" />
            <span id="qty-unit-label" style="font-weight:600;min-width:100px">${unitType.toLowerCase()}s</span>
          </div>
          <div style="font-size:0.8rem;color:var(--gray-500);margin-top:0.25rem">
            Max available: <span id="max-qty">1</span> (at selected packaging)
          </div>
        </div>

        <!-- Unit Price (editable) -->
        <div class="form-group">
          <label class="form-label">Price Per Unit</label>
          <input type="number" id="unit-price" class="form-input" value="${baseUnitPrice.toFixed(2)}" min="0" step="0.01" style="font-size:1rem;padding:0.75rem" />
        </div>

        <!-- Notes -->
        <div class="form-group">
          <label class="form-label">Notes (Optional)</label>
          <input type="text" id="item-notes" class="form-input" placeholder="e.g. Bulk discount, special request..." value="${item.notes || ''}" style="padding:0.75rem" />
        </div>

        <!-- Summary -->
        <div style="background:var(--success-light);padding:1rem;border-radius:var(--radius);border-left:4px solid var(--success)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
            <div>
              <div style="font-size:0.875rem;color:var(--gray-600);margin-bottom:0.25rem">Quantity</div>
              <div style="font-size:1.5rem;font-weight:700"><span id="qty-display">1</span> <span id="qty-unit-display">${unitType.toLowerCase()}s</span></div>
            </div>
            <div style="text-align:right">
              <div style="font-size:0.875rem;color:var(--gray-600);margin-bottom:0.25rem">Total Price</div>
              <div style="font-size:1.75rem;font-weight:700;color:var(--primary)"><strong id="total-price">${formatCurrency(item.unit_price)}</strong></div>
            </div>
          </div>
        </div>

        <div id="qty-error" style="color:var(--danger);font-weight:600;padding:0.75rem;background:var(--danger-light);border-radius:var(--radius);display:none"></div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" id="qty-cancel">Cancel</button>
      <button class="btn btn-primary" id="qty-save">Update Item</button>
    `
  });

  // Helper function to update display based on packaging type
  function updateDisplay() {
    const packagingType = overlay.querySelector('input[name="packaging-type"]:checked').value;
    const qtyInput = parseInt(overlay.querySelector('#qty-input').value) || 1;
    const unitPrice = parseFloat(overlay.querySelector('#unit-price').value) || baseUnitPrice;
    
    let totalUnits = qtyInput;
    let unitLabel = unitType.toLowerCase();
    let maxAvailable = totalAvailableUnits;

    if (packagingType === 'strip') {
      totalUnits = qtyInput * unitsPerStrip;
      unitLabel = stripLabel.toLowerCase();
      maxAvailable = Math.floor(totalAvailableUnits / unitsPerStrip);
    } else if (packagingType === 'box') {
      totalUnits = qtyInput * unitsPerBox;
      unitLabel = boxLabel.toLowerCase();
      maxAvailable = Math.floor(totalAvailableUnits / unitsPerBox);
    }

    // Update labels
    overlay.querySelector('#qty-unit-label').textContent = unitLabel;
    overlay.querySelector('#qty-unit-display').textContent = unitLabel;
    overlay.querySelector('#max-qty').textContent = maxAvailable;

    // Update display
    overlay.querySelector('#qty-display').textContent = qtyInput;
    overlay.querySelector('#total-price').textContent = formatCurrency(totalUnits * unitPrice);

    // Update radio button styling
    document.querySelectorAll('label[id^="label-"]').forEach(label => {
      label.style.borderColor = label.querySelector('input').checked ? 'var(--primary)' : 'var(--border)';
      label.style.backgroundColor = label.querySelector('input').checked ? 'var(--primary-light)' : 'transparent';
    });
  }

  // Event listeners
  overlay.querySelectorAll('input[name="packaging-type"]').forEach(radio => {
    radio.addEventListener('change', updateDisplay);
  });

  overlay.querySelector('#qty-input').addEventListener('input', updateDisplay);
  overlay.querySelector('#unit-price').addEventListener('input', updateDisplay);

  overlay.querySelector('#qty-cancel').addEventListener('click', closeModal);
  overlay.querySelector('#qty-save').addEventListener('click', () => {
    const packagingType = overlay.querySelector('input[name="packaging-type"]:checked').value;
    const qty = parseInt(overlay.querySelector('#qty-input').value) || 1;
    const newUnitPrice = parseFloat(overlay.querySelector('#unit-price').value) || baseUnitPrice;
    const notes = overlay.querySelector('#item-notes').value.trim();
    const errorEl = overlay.querySelector('#qty-error');

    let totalUnits = qty;
    let maxAvailable = totalAvailableUnits;

    if (packagingType === 'strip') {
      totalUnits = qty * unitsPerStrip;
      maxAvailable = Math.floor(totalAvailableUnits / unitsPerStrip);
    } else if (packagingType === 'box') {
      totalUnits = qty * unitsPerBox;
      maxAvailable = Math.floor(totalAvailableUnits / unitsPerBox);
    }

    // Validation
    if (qty < 1) {
      errorEl.textContent = 'Quantity must be at least 1';
      errorEl.style.display = 'block';
      return;
    }

    if (qty > maxAvailable) {
      errorEl.textContent = `Only ${maxAvailable} ${packagingType}(s) available`;
      errorEl.style.display = 'block';
      return;
    }

    if (newUnitPrice < 0) {
      errorEl.textContent = 'Price cannot be negative';
      errorEl.style.display = 'block';
      return;
    }

    // Update item with correct unit_price based on packaging
    item.quantity = qty;
    item.packaging_type = packagingType;
    item.notes = notes;

    // Adjust unit_price based on packaging type
    // newUnitPrice is per individual unit, multiply by packaging multiplier
    if (packagingType === 'strip') {
      item.unit_price = newUnitPrice * unitsPerStrip;
    } else if (packagingType === 'box') {
      item.unit_price = newUnitPrice * unitsPerBox;
    } else {
      // unit packaging - price stays per unit
      item.unit_price = newUnitPrice;
    }
    
    renderCart();
    updateCartTotals();
    closeModal();
  });

  // Initial display update
  updateDisplay();
};
