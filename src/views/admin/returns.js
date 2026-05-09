import { getSalesReturns, getSales, getCustomers, createSalesReturn, getBranches } from '../../database.js';
import { showToast, formatCurrency } from '../../utils.js';

export async function renderReturns(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  const branchId = user.profile?.branch_id;
  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`;
    return;
  }

  try {
    // Get all required data
    const [returnsData, salesData, customersData, branchesData] = await Promise.all([
      getSalesReturns(pharmacyId),
      getSales(pharmacyId, 500).then(sales => enrichSalesWithItems(sales)),
      getCustomers(pharmacyId),
      getBranches(pharmacyId)
    ]);

    // Filter sales by branch for invoice selection
    const branchSalesData = salesData.filter(s => s.branch_id === branchId);

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">💳 Sales Returns & Refunds</div>
            <div class="page-subtitle">Manage product returns, partial returns, and refunds</div>
          </div>
          <button class="btn btn-primary" onclick="window.createReturnHandler()">
            <span style="font-size:1.25rem">+</span> New Return
          </button>
        </div>

        <!-- Statistics -->
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:1.5rem">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Returns</span>
              <div class="stat-card-icon blue">📊</div>
            </div>
            <div class="stat-card-value">${returnsData.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Refunded</span>
              <div class="stat-card-icon emerald">💰</div>
            </div>
            <div class="stat-card-value">₦${returnsData.reduce((sum, r) => sum + parseFloat(r.total_refund || 0), 0).toFixed(2)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Completed</span>
              <div class="stat-card-icon emerald">✓</div>
            </div>
            <div class="stat-card-value">${returnsData.filter(r => r.status === 'completed').length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Pending</span>
              <div class="stat-card-icon amber">⏳</div>
            </div>
            <div class="stat-card-value">${returnsData.filter(r => r.status === 'pending').length}</div>
          </div>
        </div>

        ${returnsData.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">↩️</div>
            <div class="empty-state-title">No returns yet</div>
            <div class="empty-state-text">Process a product return when a customer brings back items</div>
            <button class="btn btn-primary" onclick="window.createReturnHandler()">New Return</button>
          </div>
        ` : `
          <div class="card">
            <div class="table-responsive">
              <table class="table">
                <thead>
                  <tr>
                    <th>Return #</th>
                    <th>Customer</th>
                    <th>Invoice</th>
                    <th>Items</th>
                    <th>Refund Amount</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th style="text-align:center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${returnsData.map(ret => {
                    const itemCount = (ret.return_items || []).length;
                    return `
                      <tr>
                        <td><strong>${ret.return_number}</strong></td>
                        <td>${ret.customers?.name || (ret.sales?.invoice_number ? 'Customer w/ invoice' : 'Walk-in')}</td>
                        <td>${ret.sales?.invoice_number || '-'}</td>
                        <td>${itemCount}</td>
                        <td><strong>${formatCurrency(ret.total_refund)}</strong></td>
                        <td>${ret.reason}</td>
                        <td>
                          <span class="badge ${ret.status === 'completed' ? 'bg-success' : 'bg-warning'}">
                            ${ret.status}
                          </span>
                        </td>
                        <td>${new Date(ret.created_at).toLocaleDateString()}</td>
                        <td style="text-align:center">
                          <button class="btn btn-sm btn-ghost" onclick="window.viewReturnHandler('${ret.id}')">
                            👁️ View
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

      <div id="returnModal" class="modal" style="display:none">
        <div class="modal-content" style="max-width:800px">
          <div class="modal-header">
            <h2 class="modal-title">📋 New Return / Refund</h2>
            <button class="modal-close" onclick="window.closeReturnModal()">✕</button>
          </div>
          <div class="modal-body" style="max-height:75vh;overflow-y:auto">
            <!-- Step 1: Invoice Selection -->
            <div class="form-group">
              <label class="form-label">📌 Select Invoice (or Walk-in Return)</label>
              <select id="returnInvoice" class="form-control" onchange="window.loadInvoiceItemsForReturn()">
                <option value="">-- No invoice (Walk-in return) --</option>
                ${branchSalesData.map(s => `
                  <option value="${s.id}" data-items='${JSON.stringify(s.sale_items || [])}' data-total="${s.total_amount}">
                    ${s.invoice_number} - ₦${parseFloat(s.total_amount).toFixed(2)} (${new Date(s.created_at).toLocaleDateString()})
                  </option>
                `).join('')}
              </select>
            </div>

            <!-- Step 2: Invoice Items (if selected) -->
            <div id="invoiceItemsSection" style="display:none;margin-bottom:1.5rem">
              <label class="form-label">📦 Original Invoice Items - Select Items to Return</label>
              <div id="invoiceItems" style="padding:1rem;background:var(--gray-50);border-radius:var(--radius-sm);max-height:200px;overflow-y:auto">
                Loading items...
              </div>
              <div style="margin-top:0.5rem;font-size:0.85rem;color:var(--gray-600)">
                💡 Select specific items for partial returns, or all items for full return
              </div>
            </div>

            <!-- Step 3: Customer -->
            <div class="form-group">
              <label class="form-label">👤 Customer Name</label>
              <select id="returnCustomer" class="form-control">
                <option value="">-- Walk-in Customer --</option>
                ${(customersData || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
              </select>
              <input type="text" id="returnCustomerName" class="form-control" style="margin-top:0.5rem" placeholder="Or enter customer name">
            </div>

            <!-- Step 4: Return Reason -->
            <div class="form-group">
              <label class="form-label">🔍 Return Reason *</label>
              <select id="returnReason" class="form-control" required>
                <option value="">-- Select reason --</option>
                <option value="Defective">Defective Product</option>
                <option value="Expired">Expired</option>
                <option value="Wrong Item">Wrong Item</option>
                <option value="Customer Request">Customer Request</option>
                <option value="Damage">Damage in Transit</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <!-- Step 5: Refund Amount -->
            <div class="form-group">
              <label class="form-label">💰 Refund Amount *</label>
              <div style="display:flex;gap:0.5rem">
                <input type="number" id="returnAmount" class="form-control" placeholder="0.00" min="0" step="0.01" required>
                <button type="button" class="btn btn-secondary" onclick="window.calculatePartialReturn()" style="flex:0">
                  Calculate
                </button>
              </div>
              <div id="refundInfo" style="margin-top:0.5rem;font-size:0.85rem;color:var(--gray-600)"></div>
            </div>

            <!-- Step 6: Notes -->
            <div class="form-group">
              <label class="form-label">📝 Notes / Details</label>
              <textarea id="returnNotes" class="form-control" placeholder="Enter any additional details about the return..." rows="3"></textarea>
            </div>

            <!-- Return Type Info -->
            <div id="returnTypeInfo" style="margin-top:1.5rem;padding:1rem;background:var(--blue-50);border-radius:var(--radius-sm);border-left:4px solid var(--blue-500);display:none">
              <div style="font-size:0.9rem;color:var(--blue-900)">
                <strong>ℹ️ Return Processing:</strong>
                <div style="margin-top:0.5rem">
                  <div id="returnTypeText">Return information will appear here...</div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="window.closeReturnModal()">Cancel</button>
            <button class="btn btn-primary" onclick="window.saveReturnHandler()">Process Return</button>
          </div>
        </div>
      </div>
    `;

    // Track selected items for partial returns
    let selectedReturnItems = [];
    let invoiceData = null;

    window.loadInvoiceItemsForReturn = () => {
      const select = document.getElementById('returnInvoice');
      const selectedOption = select.options[select.selectedIndex];
      
      if (!select.value) {
        document.getElementById('invoiceItemsSection').style.display = 'none';
        document.getElementById('returnTypeInfo').style.display = 'none';
        selectedReturnItems = [];
        return;
      }

      const items = JSON.parse(selectedOption.dataset.items || '[]');
      const total = parseFloat(selectedOption.dataset.total || 0);
      
      invoiceData = {
        id: select.value,
        items: items,
        total: total
      };

      let itemsHTML = items.length === 0 ? '<div style="color:var(--gray-500);text-align:center">No items in invoice</div>' : `
        ${items.map((item, idx) => `
          <label style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;cursor:pointer;border-bottom:1px solid var(--gray-200);transition:background 0.2s;hover:background:var(--gray-100)">
            <input type="checkbox" class="return-item-checkbox" value="${idx}" data-name="${item.product_name}" data-amount="${item.total_price}" onchange="window.updateReturnCalculation()">
            <div style="flex:1">
              <div style="font-weight:500">${item.product_name}</div>
              <div style="font-size:0.85rem;color:var(--gray-600)">Qty: ${item.quantity} × ₦${parseFloat(item.unit_price).toFixed(2)} = ₦${parseFloat(item.total_price).toFixed(2)}</div>
            </div>
          </label>
        `).join('')}
      `;

      document.getElementById('invoiceItems').innerHTML = itemsHTML;
      document.getElementById('invoiceItemsSection').style.display = 'block';
      document.getElementById('returnTypeInfo').style.display = 'block';
      document.getElementById('returnAmount').value = total;
      window.updateReturnCalculation();
    };

    window.updateReturnCalculation = () => {
      const checkboxes = document.querySelectorAll('.return-item-checkbox:checked');
      selectedReturnItems = Array.from(checkboxes).map(cb => ({
        index: parseInt(cb.value),
        name: cb.dataset.name,
        amount: parseFloat(cb.dataset.amount)
      }));

      const selectedAmount = selectedReturnItems.reduce((sum, item) => sum + item.amount, 0);
      
      if (selectedAmount > 0) {
        document.getElementById('returnAmount').value = selectedAmount.toFixed(2);
        const isFullReturn = selectedReturnItems.length === invoiceData.items.length;
        
        const info = isFullReturn 
          ? '<strong>Full Return:</strong> All items being returned. Receipt will be fully removed from records.'
          : `<strong>Partial Return:</strong> ${selectedReturnItems.length} of ${invoiceData.items.length} items. Receipt will be updated to reflect remaining items.`;
        
        document.getElementById('returnTypeText').innerHTML = info;
      }
    };

    window.calculatePartialReturn = () => {
      if (selectedReturnItems.length === 0 && invoiceData) {
        showToast('Please select at least one item to return', 'error');
        return;
      }
      window.updateReturnCalculation();
    };

    window.createReturnHandler = () => {
      document.getElementById('returnInvoice').value = '';
      document.getElementById('returnCustomer').value = '';
      document.getElementById('returnCustomerName').value = '';
      document.getElementById('returnReason').value = '';
      document.getElementById('returnAmount').value = '';
      document.getElementById('returnNotes').value = '';
      document.getElementById('invoiceItemsSection').style.display = 'none';
      document.getElementById('returnTypeInfo').style.display = 'none';
      selectedReturnItems = [];
      invoiceData = null;
      document.getElementById('returnModal').style.display = 'flex';
    };

    window.saveReturnHandler = async () => {
      const reason = document.getElementById('returnReason').value;
      const amount = parseFloat(document.getElementById('returnAmount').value);
      const customerId = document.getElementById('returnCustomer').value;
      const customerName = document.getElementById('returnCustomerName').value;

      if (!reason) {
        showToast('Please select a return reason', 'error');
        return;
      }
      if (!amount || amount <= 0) {
        showToast('Please enter a valid refund amount', 'error');
        return;
      }

      try {
        const isPartialReturn = selectedReturnItems.length > 0 && selectedReturnItems.length < invoiceData?.items.length;
        const invoiceId = document.getElementById('returnInvoice').value || null;

        // Create the return record
        const returnData = {
          sale_id: invoiceId,
          customer_id: customerId || null,
          customer_name: customerName || null,
          reason,
          total_refund: amount,
          notes: document.getElementById('returnNotes').value || '',
          pharmacy_id: pharmacyId,
          branch_id: branchId,
          created_by: user.id,
          return_type: isPartialReturn ? 'partial' : (invoiceId ? 'full' : 'walk_in'),
          returned_items: selectedReturnItems
        };

        const { data: newReturn, error } = await supabase
          .from('sales_returns')
          .insert(returnData)
          .select()
          .single();

        if (error) throw error;

        // Handle receipt updates based on return type
        if (invoiceId && invoiceData) {
          const sale = branchSalesData.find(s => s.id === invoiceId);
          
          if (isPartialReturn && sale) {
            // Update sale record to remove returned items
            const remainingItems = sale.sale_items.filter((item, idx) => 
              !selectedReturnItems.find(ri => ri.index === idx)
            );
            
            const newTotal = remainingItems.reduce((sum, item) => sum + parseFloat(item.total_price), 0);
            
            await supabase
              .from('sales')
              .update({
                total_amount: newTotal,
                sale_items: remainingItems,
                notes: (sale.notes || '') + `\n[PARTIAL RETURN: ₦${amount.toFixed(2)} refunded for ${selectedReturnItems.length} items]`
              })
              .eq('id', invoiceId);
              
          } else if (!isPartialReturn && invoiceId) {
            // Full return - mark receipt as voided
            await supabase
              .from('sales')
              .update({
                status: 'returned',
                notes: (sale.notes || '') + `\n[FULL RETURN: ₦${amount.toFixed(2)} refunded]`
              })
              .eq('id', invoiceId);
          }
        }

        showToast('✅ Return processed successfully!', 'success');
        window.closeReturnModal();
        renderReturns(container, user);
      } catch (error) {
        console.error('Error processing return:', error);
        showToast(`Error: ${error.message}`, 'error');
      }
    };

    window.closeReturnModal = () => {
      document.getElementById('returnModal').style.display = 'none';
    };

    window.viewReturnHandler = (returnId) => {
      const ret = returnsData.find(r => r.id === returnId);
      if (!ret) {
        showToast('Return not found', 'error');
        return;
      }

      const itemsList = (ret.returned_items || []).map(item => `
        <tr>
          <td>${item.name || 'Item'}</td>
          <td style="text-align:right">₦${parseFloat(item.amount).toFixed(2)}</td>
        </tr>
      `).join('');

      const modal = document.createElement('div');
      modal.id = 'returnDetailsModal';
      modal.className = 'modal';
      modal.style.display = 'flex';
      modal.innerHTML = `
        <div class="modal-content" style="max-width:700px">
          <div class="modal-header">
            <h2 class="modal-title">Return Details</h2>
            <button class="modal-close" onclick="document.getElementById('returnDetailsModal').remove()">✕</button>
          </div>
          <div class="modal-body" style="max-height:70vh;overflow-y:auto">
            <div class="info-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">
              <div>
                <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Return #</h4>
                <p style="margin:0;font-size:1.1rem;font-weight:600">${ret.return_number}</p>
              </div>
              <div>
                <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Invoice</h4>
                <p style="margin:0">${ret.sales?.invoice_number || 'Walk-in'}</p>
              </div>
              <div>
                <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Date</h4>
                <p style="margin:0">${new Date(ret.created_at).toLocaleDateString()}</p>
              </div>
              <div>
                <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Type</h4>
                <p style="margin:0"><span class="badge ${ret.return_type === 'partial' ? 'bg-amber' : 'bg-blue'}">${ret.return_type}</span></p>
              </div>
              <div>
                <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Reason</h4>
                <p style="margin:0">${ret.reason}</p>
              </div>
              <div>
                <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Status</h4>
                <p style="margin:0"><span class="badge bg-success">${ret.status}</span></p>
              </div>
            </div>

            ${itemsList ? `
              <div style="border-top:1px solid var(--gray-200);padding-top:1.5rem">
                <h3 style="margin:0 0 1rem 0">Returned Items</h3>
                <table class="table" style="font-size:0.9rem">
                  <thead>
                    <tr><th>Item</th><th style="text-align:right">Amount</th></tr>
                  </thead>
                  <tbody>${itemsList}</tbody>
                </table>
              </div>
            ` : ''}

            <div style="border-top:1px solid var(--gray-200);padding-top:1.5rem;margin-top:1.5rem">
              <div style="display:flex;justify-content:flex-end">
                <div style="text-align:right">
                  <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Total Refund</h4>
                  <p style="margin:0;font-size:1.3rem;font-weight:600;color:var(--success)">₦${parseFloat(ret.total_refund).toFixed(2)}</p>
                </div>
              </div>
            </div>

            ${ret.notes ? `
              <div style="margin-top:1.5rem;padding:1rem;background:var(--blue-50);border-left:4px solid var(--blue-500);border-radius:var(--radius-sm)">
                <h4 style="margin:0 0 0.5rem 0;color:var(--blue-700)">Notes</h4>
                <p style="margin:0;white-space:pre-wrap;color:var(--gray-700)">${ret.notes}</p>
              </div>
            ` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="document.getElementById('returnDetailsModal').remove()">Close</button>
          </div>
        </div>
      `;
      container.appendChild(modal);
    };

  } catch (error) {
    showToast(`Error loading returns: ${error.message}`, 'error');
    container.innerHTML = `<div class="alert alert-danger">Error loading returns: ${error.message}</div>`;
  }
}
