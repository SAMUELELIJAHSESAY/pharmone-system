import { getSalesReturns, getSales, getCustomers, createSalesReturn } from '../../database.js';
import { showToast, formatCurrency } from '../../utils.js';

export async function renderReturns(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`;
    return;
  }

  try {
    const [returnsData, salesData, customersData] = await Promise.all([
      getSalesReturns(pharmacyId),
      getSales(pharmacyId, 500),
      getCustomers(pharmacyId)
    ]);

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">Sales Returns</div>
            <div class="page-subtitle">Manage product returns and refunds</div>
          </div>
          <button class="btn btn-primary" onclick="window.createReturnHandler()">
            <span style="font-size:1.25rem">+</span> New Return
          </button>
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
        <div class="modal-content" style="max-width:700px">
          <div class="modal-header">
            <h2 class="modal-title">New Return</h2>
            <button class="modal-close" onclick="window.closeReturnModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Invoice (Optional)</label>
              <select id="returnInvoice" class="form-control">
                <option value="">Select invoice...</option>
                ${(salesData || []).map(s => `<option value="${s.id}">${s.invoice_number}</option>`).join('')}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Customer</label>
              <select id="returnCustomer" class="form-control">
                <option value="">Select or add customer...</option>
                ${(customersData || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Return Reason *</label>
              <select id="returnReason" class="form-control">
                <option value="">Select reason...</option>
                <option value="Defective">Defective Product</option>
                <option value="Expired">Expired</option>
                <option value="Wrong Item">Wrong Item</option>
                <option value="Customer Request">Customer Request</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Total Refund Amount *</label>
              <input type="number" id="returnAmount" class="form-control" placeholder="0.00" min="0" step="0.01">
            </div>

            <div class="form-group">
              <label class="form-label">Notes</label>
              <textarea id="returnNotes" class="form-control" placeholder="Additional details about the return" rows="3"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="window.closeReturnModal()">Cancel</button>
            <button class="btn btn-primary" onclick="window.saveReturnHandler()">Process Return</button>
          </div>
        </div>
      </div>
    `;

    window.createReturnHandler = () => {
      document.getElementById('returnInvoice').value = '';
      document.getElementById('returnCustomer').value = '';
      document.getElementById('returnReason').value = '';
      document.getElementById('returnAmount').value = '';
      document.getElementById('returnNotes').value = '';
      document.getElementById('returnModal').style.display = 'flex';
    };

    window.saveReturnHandler = async () => {
      const reason = document.getElementById('returnReason').value;
      const amount = parseFloat(document.getElementById('returnAmount').value);

      if (!reason) {
        showToast('Please select a return reason', 'error');
        return;
      }
      if (!amount || amount <= 0) {
        showToast('Please enter a valid refund amount', 'error');
        return;
      }

      try {
        await createSalesReturn(
          {
            sale_id: document.getElementById('returnInvoice').value || null,
            customer_id: document.getElementById('returnCustomer').value || null,
            reason,
            total_refund: amount,
            notes: document.getElementById('returnNotes').value || '',
            pharmacy_id: pharmacyId,
            created_by: user.id
          },
          [] // No individual items in this simple version
        );

        showToast('Return processed successfully', 'success');
        window.closeReturnModal();
        renderReturns(container, user);
      } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
      }
    };

    window.closeReturnModal = () => {
      document.getElementById('returnModal').style.display = 'none';
    };

    window.viewReturnHandler = (returnId) => {
      const ret = returnsData.find(r => r.id === returnId);
      if (!ret) return;

      const itemsList = (ret.return_items || []).map(item => `
        <tr>
          <td>${item.product_name}</td>
          <td>${item.quantity}</td>
          <td>${formatCurrency(item.unit_price)}</td>
          <td>${formatCurrency(item.total_price)}</td>
        </tr>
      `).join('');

      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.style.display = 'flex';
      modal.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">${ret.return_number}</h2>
            <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
          </div>
          <div class="modal-body">
            <div class="grid-2" style="margin-bottom:1rem">
              <div>
                <div class="text-sm text-muted">Customer</div>
                <div class="font-semibold">${ret.customers?.name || 'Walk-in'}</div>
              </div>
              <div>
                <div class="text-sm text-muted">Reason</div>
                <div class="font-semibold">${ret.reason}</div>
              </div>
            </div>
            <div style="border-top:1px solid var(--gray-200);padding-top:1rem">
              <table class="table" style="font-size:0.9rem">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>${itemsList || '<tr><td colspan="4" class="text-muted">No items</td></tr>'}</tbody>
              </table>
            </div>
            <div style="text-align:right;padding-top:1rem;border-top:1px solid var(--gray-200)">
              <strong>Refund: ${formatCurrency(ret.total_refund)}</strong>
            </div>
            ${ret.notes ? `<div style="margin-top:1rem;padding:0.75rem;background:var(--gray-50);border-radius:var(--radius-sm)"><strong>Notes:</strong><br>${ret.notes}</div>` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="this.closest('.modal').remove()">Close</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    };

  } catch (error) {
    showToast(`Error loading returns: ${error.message}`, 'error');
    container.innerHTML = `<div class="alert alert-danger">Error loading returns: ${error.message}</div>`;
  }
}
