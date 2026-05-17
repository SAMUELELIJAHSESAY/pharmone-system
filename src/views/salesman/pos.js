import { getProducts, getCustomers, createCustomer, createSale, getStaffBranch, getPharmacySettings, getBranchDetails } from '../../database.js';
import { formatCurrency, showToast, debounce, formatUTCDateTime } from '../../utils.js';
import { createModal } from '../../components/modal.js';

let cart = [];
let allProducts = [];
let allCustomers = [];
let selectedCustomer = null;
let currentUser = null;
let staffBranchId = null;

export async function renderPOS(container, user) {
  currentUser = user;
  cart = [];
  selectedCustomer = null;

  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) { container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`; return; }

  try {
    // Load pharmacy settings globally so all formatCurrency calls use correct currency
    const settings = await getPharmacySettings(pharmacyId);
    window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    
    // Get the salesman's assigned branch
    staffBranchId = await getStaffBranch(user.id);
    if (!staffBranchId) {
      container.innerHTML = `<div class="alert alert-warning">You are not assigned to any branch. Contact your administrator.</div>`;
      return;
    }

    [allProducts, allCustomers] = await Promise.all([
      getProducts(pharmacyId, staffBranchId),
      getCustomers(pharmacyId)
    ]);

    if (allProducts.length === 0) {
      container.innerHTML = `<div class="alert alert-warning">No products available in your assigned branch.</div>`;
      return;
    }

    renderPOSView(container);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load POS: ${err.message}</div>`;
  }
}

function renderPOSView(container) {
  container.innerHTML = `
    <div style="margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem">
      <div>
        <div class="page-title">Point of Sale</div>
        <div class="page-subtitle">Select products to create a sale</div>
      </div>
      <div class="flex gap-2">
        <select class="form-select" id="customer-select" style="min-width:200px">
          <option value="">Walk-in Customer</option>
          ${allCustomers.map(c => `<option value="${c.id}">${c.name} ${c.phone ? '('+c.phone+')' : ''}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" id="add-customer-quick">+ New Customer</button>
      </div>
    </div>

    <div class="pos-layout">
      <div class="pos-products">
        <div style="margin-bottom:0.875rem;display:flex;gap:0.75rem;flex-wrap:wrap">
          <div class="search-box" style="flex:1;min-width:200px">
            <span style="color:var(--gray-400)">&#128269;</span>
            <input type="text" id="pos-search" placeholder="Search products..." />
          </div>
          <select class="form-select" id="pos-cat-filter" style="width:auto">
            <option value="">All Categories</option>
            ${[...new Set(allProducts.map(p => p.category))].map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div class="pos-product-grid" id="pos-product-grid">
          ${renderProductCards(allProducts)}
        </div>
      </div>

      <div class="pos-cart">
        <div class="pos-cart-header">
          <span>&#128179; Cart</span>
          <span id="cart-count" class="badge badge-gray">0 items</span>
        </div>
        <div class="pos-cart-items" id="cart-items">
          <div class="empty-state" style="padding:1.5rem">
            <div class="empty-state-icon" style="font-size:2rem">&#128179;</div>
            <div class="empty-state-title">Cart is empty</div>
            <div class="empty-state-desc">Click products to add them</div>
          </div>
        </div>
        <div class="pos-cart-footer">
          <div class="cart-summary-row">
            <span>Subtotal</span>
            <span id="cart-subtotal">Le0.00</span>
          </div>
          <div class="cart-summary-row">
            <span>Discount</span>
            <input type="number" id="discount-input" value="0" min="0" step="0.01"
              style="width:70px;padding:0.25rem 0.5rem;border:1px solid var(--gray-200);border-radius:4px;text-align:right;font-size:0.875rem;font-family:inherit" />
          </div>
          <div class="cart-summary-total">
            <span>Total</span>
            <span id="cart-total" style="color:var(--primary)">Le0.00</span>
          </div>
          <div class="form-group" style="margin-bottom:0.75rem">
            <label class="form-label" style="margin-bottom:0.25rem">Payment Method</label>
            <select class="form-select" id="payment-method">
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="card">Card</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0.875rem">
            <label class="form-label" style="margin-bottom:0.25rem">Notes (optional)</label>
            <input type="text" class="form-input" id="sale-notes" placeholder="Any notes..." />
          </div>
          <button class="btn btn-primary btn-full btn-lg" id="checkout-btn" disabled>
            Complete Sale
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('pos-search').addEventListener('input', debounce((e) => filterProducts()));
  document.getElementById('pos-cat-filter').addEventListener('change', () => filterProducts());
  document.getElementById('customer-select').addEventListener('change', (e) => {
    selectedCustomer = e.target.value || null;
  });
  document.getElementById('add-customer-quick').addEventListener('click', showQuickAddCustomer);
  document.getElementById('discount-input').addEventListener('input', updateCartTotals);
  document.getElementById('checkout-btn').addEventListener('click', processCheckout);

  // Add keyboard listener for receipt preview (Ctrl+Shift+P)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      showReceiptPreview();
    }
  });

  bindProductClicks();
}

function filterProducts() {
  const q = document.getElementById('pos-search').value.toLowerCase();
  const cat = document.getElementById('pos-cat-filter').value;
  const filtered = allProducts.filter(p =>
    (p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) &&
    (!cat || p.category === cat)
  );
  document.getElementById('pos-product-grid').innerHTML = renderProductCards(filtered);
  bindProductClicks();
}

function renderProductCards(products) {
  if (!products.length) return `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">&#128230;</div><div class="empty-state-title">No products found</div></div>`;

  return products.map(p => {
    const totalUnits = (p.stock_boxes * p.units_per_box) + p.stock_units;
    const inCart = cart.find(c => c.product_id === p.id);
    const outOfStock = totalUnits <= 0;
    const unitType = (p.unit_type || 'box').charAt(0).toUpperCase() + (p.unit_type || 'box').slice(1);
    return `
      <div class="pos-product-card ${outOfStock ? 'out-of-stock' : ''}" data-id="${p.id}" data-stock="${totalUnits}">
        <div class="pos-product-category">${p.category}</div>
        <div class="pos-product-name">${p.name}</div>
        <div style="font-size:0.75rem;color:var(--primary);font-weight:600;margin-top:0.25rem">Sold by: ${unitType}</div>
        <div class="pos-product-price">${formatCurrency(p.price)} per ${unitType.toLowerCase()}</div>
        <div class="pos-product-stock">${outOfStock ? 'Out of stock' : totalUnits + ' units'}</div>
        ${inCart ? `<div style="margin-top:0.375rem"><span class="badge badge-primary">${inCart.quantity} ${unitType.toLowerCase()}s in cart</span></div>` : ''}
      </div>
    `;
  }).join('');
}

function bindProductClicks() {
  document.querySelectorAll('.pos-product-card:not(.out-of-stock)').forEach(card => {
    card.addEventListener('click', () => {
      const productId = card.dataset.id;
      const stock = parseInt(card.dataset.stock);
      const product = allProducts.find(p => p.id === productId);
      if (!product) return;

      const existing = cart.find(c => c.product_id === productId);
      if (existing) {
        if (existing.quantity < stock) {
          existing.quantity++;
        } else {
          showToast('Not enough stock available', 'error');
          return;
        }
      } else {
        const unitType = product.unit_type || 'box';
        const minSell = product.min_sell_quantity || 1;
        const unitsPerBox = product.units_per_box || 10; // Ensure consistent default
        cart.push({
          product_id: productId,
          product_name: product.name,
          unit_type: unitType,
          unit_price: product.price,
          quantity: minSell,
          maxStock: stock,
          priceSet: product.price > 0,
          packaging_type: 'unit',
          units_per_box: unitsPerBox,
          min_sell_quantity: minSell,
          notes: ''
        });
      }

      renderCart();
      filterProducts();
    });
  });
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
    if (countBadge) countBadge.textContent = '0 items';
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
  if (checkoutBtn) checkoutBtn.disabled = false;

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
  const subtotal = cart.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
  const discount = parseFloat(document.getElementById('discount-input')?.value || 0) || 0;
  const total = Math.max(0, subtotal - discount);

  const subtotalEl = document.getElementById('cart-subtotal');
  const totalEl = document.getElementById('cart-total');
  if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
  if (totalEl) totalEl.textContent = formatCurrency(total);
}

async function processCheckout() {
  if (cart.length === 0) { showToast('Cart is empty', 'error'); return; }

  const checkoutBtn = document.getElementById('checkout-btn');
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = 'Processing...';

  const subtotal = cart.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
  const discount = parseFloat(document.getElementById('discount-input')?.value || 0) || 0;
  const total = Math.max(0, subtotal - discount);
  const paymentMethod = document.getElementById('payment-method').value;
  const notes = document.getElementById('sale-notes').value;

  if (!staffBranchId) {
    showToast('Error: Your branch assignment could not be determined', 'error');
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = 'Complete Sale';
    return;
  }

  // Validate calculations
  if (isNaN(subtotal) || isNaN(discount) || isNaN(total)) {
    showToast('Error: Invalid cart calculations. Please refresh and try again.', 'error');
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = 'Complete Sale';
    return;
  }

  // Calculate actual units to deduct based on packaging type
  const cartItemsForSale = cart.map(item => {
    const product = allProducts.find(p => p.id === item.product_id);
    const packagingInfo = getPackagingInfo(item.packaging_type, product?.units_per_box || 10);
    const actualUnits = item.quantity * packagingInfo.units_per_unit;
    
    return {
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: actualUnits,  // Send actual units to be deducted from stock
      unit_price: item.unit_price,
      packaging_type: item.packaging_type,
      packaging_quantity: item.quantity
    };
  });

  const salePayload = {
    customer_id: selectedCustomer || null,
    payment_method: paymentMethod,
    total_amount: parseFloat(total.toFixed(2)),  // Ensure proper decimal format
    discount: parseFloat(discount.toFixed(2)),   // Ensure proper decimal format
    notes: notes || '',                           // Ensure string
    created_by: currentUser.id,
    pharmacy_id: currentUser.profile.pharmacy_id,
    branch_id: staffBranchId,
    status: 'completed',
    created_at: new Date().toISOString()  // Use client's current timestamp with timezone
  };

  try {
    const sale = await createSale(salePayload, cartItemsForSale);
    showToast(`Sale completed! Invoice: ${sale.invoice_number}`);
    // Fetch branch details for receipt header
    const branchDetails = await getBranchDetails(staffBranchId);
    showReceiptModal(sale, cart.slice(), total, discount, paymentMethod, branchDetails);
    cart = [];
    selectedCustomer = null;
    renderPOS(document.getElementById('page-content'), currentUser);
  } catch (err) {
    let errorMsg = err.message || 'Unknown error occurred';
    
    // Parse PostgreSQL/Supabase errors for better user messages
    if (errorMsg.includes('branch_id')) {
      errorMsg = 'Branch information missing. Please contact administrator.';
    } else if (errorMsg.includes('expired')) {
      errorMsg = 'Cannot sell expired products. Remove them and try again.';
    } else if (errorMsg.includes('stock')) {
      errorMsg = 'Insufficient stock for some items. Refresh and try again.';
    } else if (errorMsg.includes('record')) {
      errorMsg = 'Database constraint error. Please try again.';
    } else if (errorMsg.includes('pharmacy_id') || err.code === 'PGRST204') {
      errorMsg = 'Please ensure you are logged in and assigned to a pharmacy.';
    } else if (err.code === '42703') {
      errorMsg = 'Database schema mismatch. Please contact support.';
    } else if (err.code) {
      errorMsg = `Database error (${err.code}). Please try again.`;
    }
    
    showToast('Failed to complete sale: ' + errorMsg, 'error');
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = 'Complete Sale';
  }
}

function showReceiptModal(sale, items, total, discount, paymentMethod, branchDetails = {}) {
  const saleDate = formatUTCDateTime(sale.created_at);
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
          <div class="text-sm text-muted">${sale.invoice_number}</div>
          <div class="text-xs text-muted" style="margin-top:0.25rem">${saleDate}</div>
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
            <span class="font-semibold">${paymentMethod.replace('_', ' ')}</span>
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
              <div class="title" style="font-size: 14px; font-weight: bold; margin-bottom: 5px;">${branchName}</div>
              ${branchAddress ? `<div style="font-size: 10px; margin-bottom: 3px;">${branchAddress}</div>` : ''}
              ${branchEmail ? `<div style="font-size: 10px; margin-bottom: 3px;">${branchEmail}</div>` : ''}
            </div>
            <div class="title">Receipt</div>
            <div class="row"><span>Invoice:</span><span><strong>${sale.invoice_number}</strong></span></div>
            <div class="row"><span>Date:</span><span>${formatUTCDateTime(sale.created_at)}</span></div>
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
            <div class="divider"></div>
            <div style="text-align: center; font-size: 10px; margin-top: 10px;">Thank you for visiting, ${branchName}!</div>
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

  // Get branch details for receipt header
  getBranchDetails(staffBranchId).then(branchDetails => {
    const branchName = branchDetails?.name || 'Pharmacy';
    const branchAddress = branchDetails?.address || '';
    const branchEmail = branchDetails?.email || '';

    const { overlay, closeModal } = createModal({
      id: 'receipt-modal',
      title: 'Receipt Preview',
      body: `
        <div id="receipt-content" style="font-family:monospace;font-size:0.9rem">
          <div style="text-align:center;margin-bottom:1.25rem">
            <div style="font-size:3rem;margin-bottom:0.5rem">📋</div>
            <div style="font-size:1.25rem;font-weight:700;color:var(--primary)">${formatCurrency(total)}</div>
            <div class="text-xs text-muted" style="margin-top:0.25rem">${formatUTCDateTime(previewDate)}</div>
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
              <span class="font-semibold">${paymentMethod.replace('_', ' ')}</span>
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
            <title>Receipt</title>
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
                <div class="title" style="font-size: 14px; font-weight: bold; margin-bottom: 5px;">${branchName}</div>
                ${branchAddress ? `<div style="font-size: 10px; margin-bottom: 3px;">${branchAddress}</div>` : ''}
                ${branchEmail ? `<div style="font-size: 10px; margin-bottom: 3px;">${branchEmail}</div>` : ''}
              </div>
              <div class="title">Receipt</div>
              <div class="row"><span>Date:</span><span>${formatUTCDateTime(previewDate)}</span></div>
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
              <div style="text-align: center; font-size: 10px; margin-top: 10px;">Thank you for visiting, ${branchName}!</div>
            </div>
            <script>window.print(); window.close();</script>
          </body>
        </html>
      `);
      printWindow.document.close();
    });
  }).catch(err => {
    console.error('Failed to fetch branch details:', err);
    // Continue with basic receipt if branch details fail
    const { overlay, closeModal } = createModal({
      id: 'receipt-modal',
      title: 'Receipt Preview',
      body: `
        <div id="receipt-content" style="font-family:monospace;font-size:0.9rem">
          <div style="text-align:center;margin-bottom:1.25rem">
            <div style="font-size:3rem;margin-bottom:0.5rem">📋</div>
            <div style="font-size:1.25rem;font-weight:700;color:var(--primary)">${formatCurrency(total)}</div>
            <div class="text-xs text-muted" style="margin-top:0.25rem">${formatUTCDateTime(previewDate)}</div>
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
              <span class="font-semibold">${paymentMethod.replace('_', ' ')}</span>
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
            <title>Receipt</title>
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
                <div class="title" style="font-size: 14px; font-weight: bold; margin-bottom: 5px;">Pharmacy</div>
              </div>
              <div class="title">Receipt</div>
              <div class="row"><span>Date:</span><span>${formatUTCDateTime(previewDate)}</span></div>
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
              <div style="text-align: center; font-size: 10px; margin-top: 10px;">Thank you for visiting, Pharmacy!</div>
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