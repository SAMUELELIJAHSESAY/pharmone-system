import { getPurchases, getSuppliers, createPurchase, createPurchaseItem, deletePurchaseItem, processPurchase, getProducts } from '../../database.js';
import { showToast } from '../../utils.js';

let purchasesData = [];
let suppliersData = [];
let productsData = [];

export async function renderPurchases(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`;
    return;
  }

  try {
    [purchasesData, suppliersData, productsData] = await Promise.all([
      getPurchases(pharmacyId),
      getSuppliers(pharmacyId),
      getProducts(pharmacyId)
    ]);

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">Purchase Orders</div>
            <div class="page-subtitle">Manage stock purchases from suppliers</div>
          </div>
          <button class="btn btn-primary" onclick="window.createPurchaseHandler()">
            <span style="font-size:1.25rem">+</span> New Purchase
          </button>
        </div>

        ${purchasesData.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">📦</div>
            <div class="empty-state-title">No purchases yet</div>
            <div class="empty-state-text">Create your first purchase order to stock up</div>
            <button class="btn btn-primary" onclick="window.createPurchaseHandler()">New Purchase</button>
          </div>
        ` : `
          <div class="card">
            <div class="table-responsive">
              <table class="table">
                <thead>
                  <tr>
                    <th>Purchase #</th>
                    <th>Supplier</th>
                    <th>Total Cost</th>
                    <th>Items</th>
                    <th>Payment Status</th>
                    <th>Date</th>
                    <th style="text-align:center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${purchasesData.map(purchase => {
                    const itemCount = (purchase.purchase_items || []).length;
                    return `
                      <tr>
                        <td><strong>${purchase.purchase_number}</strong></td>
                        <td>${purchase.suppliers?.name || 'No Supplier'}</td>
                        <td><strong>$${parseFloat(purchase.total_cost).toFixed(2)}</strong></td>
                        <td>${itemCount} item${itemCount !== 1 ? 's' : ''}</td>
                        <td>
                          <span class="badge ${purchase.payment_status === 'paid' ? 'bg-success' : purchase.payment_status === 'partial' ? 'bg-warning' : 'bg-secondary'}">
                            ${purchase.payment_status}
                          </span>
                        </td>
                        <td>${new Date(purchase.created_at).toLocaleDateString()}</td>
                        <td style="text-align:center;display:flex;gap:0.5rem;justify-content:center">
                          <button class="btn btn-sm btn-ghost" onclick="window.viewPurchaseHandler('${purchase.id}')">
                            👁️ View
                          </button>
                          <button class="btn btn-sm btn-success" onclick="window.processPurchaseHandler('${purchase.id}')">
                            ✓ Process
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `}
      </div>

      <div id="purchaseModal" class="modal" style="display:none">
        <div class="modal-content" style="max-width:900px">
          <div class="modal-header">
            <h2 class="modal-title">New Purchase Order</h2>
            <button class="modal-close" onclick="window.closePurchaseModal()">✕</button>
          </div>
          <div class="modal-body" style="max-height:70vh;overflow-y:auto">
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Supplier *</label>
                <select id="purchaseSupplier" class="form-control">
                  <option value="">Select a supplier...</option>
                  ${suppliersData.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Payment Terms</label>
                <select id="purchasePaymentTerms" class="form-control" disabled>
                  <option>Select supplier first</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Notes</label>
              <textarea id="purchaseNotes" class="form-control" placeholder="Any additional notes" rows="2"></textarea>
            </div>

            <div style="border-top:1px solid var(--gray-200);padding-top:1rem;margin-top:1rem">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
                <h3 style="margin:0">Items</h3>
                <button class="btn btn-sm btn-primary" onclick="window.addPurchaseItemHandler()">Add Item</button>
              </div>

              <div id="purchaseItemsList"></div>
            </div>

            <div style="border-top:1px solid var(--gray-200);padding-top:1rem;margin-top:1rem">
              <div style="display:flex;justify-content:flex-end;gap:1rem">
                <div style="font-size:1.1rem"><strong>Total Cost: $<span id="purchaseTotalCost">0.00</span></strong></div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="window.closePurchaseModal()">Cancel</button>
            <button class="btn btn-primary" onclick="window.savePurchaseHandler()">Create Purchase</button>
          </div>
        </div>
      </div>
    `;

    // Initialize handlers
    let purchaseItems = [];

    document.getElementById('purchaseSupplier')?.addEventListener('change', (e) => {
      const supplier = suppliersData.find(s => s.id === e.target.value);
      if (supplier) {
        document.getElementById('purchasePaymentTerms').textContent = supplier.payment_terms;
        document.getElementById('purchasePaymentTerms').disabled = true;
      }
    });

    window.createPurchaseHandler = () => {
      purchaseItems = [];
      document.getElementById('purchaseSupplier').value = '';
      document.getElementById('purchaseNotes').value = '';
      document.getElementById('purchaseItemsList').innerHTML = '<div class="text-muted text-sm">No items added yet</div>';
      document.getElementById('purchaseTotalCost').textContent = '0.00';
      document.getElementById('purchaseModal').style.display = 'flex';
    };

    window.addPurchaseItemHandler = () => {
      const itemId = `item-${Date.now()}`;
      purchaseItems.push({
        id: itemId,
        productId: '',
        batchNumber: '',
        quantityBoxes: 0,
        quantityUnits: 0,
        costPrice: 0,
        expiryDate: ''
      });
      renderPurchaseItems();
    };

    const renderPurchaseItems = () => {
      const itemsContainer = document.getElementById('purchaseItemsList');
      if (purchaseItems.length === 0) {
        itemsContainer.innerHTML = '<div class="text-muted text-sm">No items added yet</div>';
        return;
      }

      itemsContainer.innerHTML = purchaseItems.map((item, idx) => `
        <div class="card" style="margin-bottom:0.75rem;padding:1rem">
          <div class="grid-3" style="gap:1rem;margin-bottom:0.75rem">
            <div class="form-group">
              <label class="form-label">Product *</label>
              <select class="form-control" onchange="window.updatePurchaseItem(${idx}, 'productId', this.value)">
                <option value="">Select product...</option>
                ${productsData.map(p => `<option value="${p.id}" ${item.productId === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Batch Number</label>
              <input type="text" class="form-control" value="${item.batchNumber}" onchange="window.updatePurchaseItem(${idx}, 'batchNumber', this.value)" placeholder="e.g., BATCH001">
            </div>
            <div class="form-group">
              <label class="form-label">Expiry Date</label>
              <input type="date" class="form-control" value="${item.expiryDate}" onchange="window.updatePurchaseItem(${idx}, 'expiryDate', this.value)">
            </div>
          </div>
          <div class="grid-4" style="gap:1rem;margin-bottom:0.75rem">
            <div class="form-group">
              <label class="form-label">Boxes</label>
              <input type="number" class="form-control" value="${item.quantityBoxes}" onchange="window.updatePurchaseItem(${idx}, 'quantityBoxes', parseInt(this.value))" min="0">
            </div>
            <div class="form-group">
              <label class="form-label">Units</label>
              <input type="number" class="form-control" value="${item.quantityUnits}" onchange="window.updatePurchaseItem(${idx}, 'quantityUnits', parseInt(this.value))" min="0">
            </div>
            <div class="form-group">
              <label class="form-label">Cost Price</label>
              <input type="number" class="form-control" value="${item.costPrice}" onchange="window.updatePurchaseItem(${idx}, 'costPrice', parseFloat(this.value))" min="0" step="0.01" placeholder="0.00">
            </div>
            <div class="form-group">
              <label class="form-label" style="color:transparent">Remove</label>
              <button class="btn btn-sm btn-danger" onclick="window.removePurchaseItem(${idx})">Remove</button>
            </div>
          </div>
        </div>
      `).join('');

      updatePurchaseTotals();
    };

    window.updatePurchaseItem = (idx, field, value) => {
      if (purchaseItems[idx]) {
        purchaseItems[idx][field] = value;
        renderPurchaseItems();
      }
    };

    window.removePurchaseItem = (idx) => {
      purchaseItems.splice(idx, 1);
      renderPurchaseItems();
    };

    const updatePurchaseTotals = () => {
      const total = purchaseItems.reduce((sum, item) => sum + (item.costPrice || 0), 0);
      document.getElementById('purchaseTotalCost').textContent = total.toFixed(2);
    };

    window.savePurchaseHandler = async () => {
      const supplierId = document.getElementById('purchaseSupplier').value;
      if (!supplierId) {
        showToast('Please select a supplier', 'error');
        return;
      }
      if (purchaseItems.length === 0) {
        showToast('Please add at least one item', 'error');
        return;
      }

      try {
        const purchase = await createPurchase({
          supplier_id: supplierId,
          total_cost: purchaseItems.reduce((sum, item) => sum + (item.costPrice || 0), 0),
          notes: document.getElementById('purchaseNotes').value || '',
          pharmacy_id: pharmacyId,
          created_by: user.id
        });

        for (const item of purchaseItems) {
          if (item.productId) {
            await createPurchaseItem({
              purchase_id: purchase.id,
              product_id: item.productId,
              product_name: productsData.find(p => p.id === item.productId)?.name || '',
              quantity_boxes: item.quantityBoxes,
              quantity_units: item.quantityUnits,
              units_per_box: productsData.find(p => p.id === item.productId)?.units_per_box || 1,
              cost_price: item.costPrice,
              batch_number: item.batchNumber,
              expiry_date: item.expiryDate || null,
              total_cost: (item.quantityBoxes + (item.quantityUnits / (productsData.find(p => p.id === item.productId)?.units_per_box || 1))) * item.costPrice
            });
          }
        }

        showToast('Purchase order created successfully', 'success');
        window.closePurchaseModal();
        renderPurchases(container, user);
      } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
      }
    };

    window.processPurchaseHandler = async (purchaseId) => {
      try {
        await processPurchase(purchaseId);
        showToast('Purchase processed and stock updated', 'success');
        renderPurchases(container, user);
      } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
      }
    };

    window.closePurchaseModal = () => {
      document.getElementById('purchaseModal').style.display = 'none';
    };

    // View Purchase Details Handler
    window.viewPurchaseHandler = async (purchaseId) => {
      try {
        const purchase = purchasesData.find(p => p.id === purchaseId);
        if (!purchase) {
          showToast('Purchase not found', 'error');
          return;
        }

        const detailsModal = document.createElement('div');
        detailsModal.id = 'purchaseDetailsModal';
        detailsModal.className = 'modal';
        detailsModal.style.display = 'flex';

        const supplier = suppliersData.find(s => s.id === purchase.supplier_id) || { name: 'Unknown' };
        const items = purchase.purchase_items || [];

        detailsModal.innerHTML = `
          <div class="modal-content" style="max-width:800px">
            <div class="modal-header">
              <h2 class="modal-title">Purchase Details - ${purchase.purchase_number}</h2>
              <button class="modal-close" onclick="document.getElementById('purchaseDetailsModal').remove()">✕</button>
            </div>
            <div class="modal-body" style="max-height:70vh;overflow-y:auto">
              <div class="info-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">
                <div>
                  <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Purchase Number</h4>
                  <p style="margin:0;font-size:1.1rem;font-weight:600">${purchase.purchase_number}</p>
                </div>
                <div>
                  <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Supplier</h4>
                  <p style="margin:0;font-size:1.1rem;font-weight:600">${supplier.name}</p>
                </div>
                <div>
                  <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Date</h4>
                  <p style="margin:0">${new Date(purchase.created_at).toLocaleDateString()}</p>
                </div>
                <div>
                  <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Payment Status</h4>
                  <p style="margin:0">
                    <span class="badge ${purchase.payment_status === 'paid' ? 'bg-success' : purchase.payment_status === 'partial' ? 'bg-warning' : 'bg-secondary'}">
                      ${purchase.payment_status}
                    </span>
                  </p>
                </div>
                <div>
                  <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Total Cost</h4>
                  <p style="margin:0;font-size:1.1rem;font-weight:600">$${parseFloat(purchase.total_cost).toFixed(2)}</p>
                </div>
                <div>
                  <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Status</h4>
                  <p style="margin:0">
                    <span class="badge ${purchase.status === 'received' ? 'bg-success' : purchase.status === 'pending' ? 'bg-warning' : 'bg-secondary'}">
                      ${purchase.status || 'Pending'}
                    </span>
                  </p>
                </div>
              </div>

              <div style="border-top:1px solid var(--gray-200);padding-top:1.5rem">
                <h3 style="margin:0 0 1rem 0">Purchase Items (${items.length})</h3>
                <div class="table-responsive">
                  <table class="table" style="width:100%">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Cost Price</th>
                        <th>Batch Number</th>
                        <th>Expiry Date</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${items.map(item => {
                        const qty = item.quantity_boxes + (item.quantity_units || 0);
                        const total = qty * (item.cost_price || 0);
                        return `
                          <tr>
                            <td>${item.product_name || 'Unknown Product'}</td>
                            <td>${item.quantity_boxes} box${item.quantity_boxes !== 1 ? 'es' : ''} + ${item.quantity_units || 0} unit${item.quantity_units !== 1 ? 's' : ''}</td>
                            <td>$${parseFloat(item.cost_price || 0).toFixed(2)}</td>
                            <td>${item.batch_number || '-'}</td>
                            <td>${item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : '-'}</td>
                            <td>$${total.toFixed(2)}</td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>

              ${purchase.notes ? `
                <div style="border-top:1px solid var(--gray-200);padding-top:1.5rem;margin-top:1.5rem">
                  <h4 style="margin:0 0 0.5rem 0">Notes</h4>
                  <p style="margin:0;white-space:pre-wrap">${purchase.notes}</p>
                </div>
              ` : ''}
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" onclick="document.getElementById('purchaseDetailsModal').remove()">Close</button>
            </div>
          </div>
        `;

        container.appendChild(detailsModal);
      } catch (error) {
        showToast(`Error loading purchase details: ${error.message}`, 'error');
      }
    };

  } catch (error) {
    showToast(`Error loading purchases: ${error.message}`, 'error');
    container.innerHTML = `<div class="alert alert-danger">Error loading purchases: ${error.message}</div>`;
  }
}
