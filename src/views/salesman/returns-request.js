// Salesman Returns Request - Request returns with admin approval workflow
import { getSales, enrichSalesWithItems, getCustomers, getPharmacySettings, supabase } from '../../database.js';
import { formatCurrency, showToast, formatUTCDate } from '../../utils.js';

export async function renderSalesmanReturnsRequest(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;
  const branchId = user?.profile?.branch_id;
  const userId = user?.id;

  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked to your account.</div>`;
    return;
  }

  try {
    // Get pharmacy settings for currency
    const settings = await getPharmacySettings(pharmacyId);
    const currency = settings?.currency_symbol || 'Le';

    // Get sales for this salesman in their branch
    const salesData = await getSales(pharmacyId, 500);
    const allSales = await enrichSalesWithItems(salesData);
    const salesmanSales = allSales.filter(s =>
      s.created_by === userId && s.branch_id === branchId
    );

    // Get all return requests for this salesman
    const { data: returnRequests } = await supabase
      .from('return_requests')
      .select('*')
      .eq('pharmacy_id', pharmacyId)
      .eq('requested_by', userId)
      .order('created_at', { ascending: false });

    renderReturnsRequestView(container, salesmanSales, returnRequests || [], user, pharmacyId, branchId, currency);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load returns: ${err.message}</div>`;
  }
}

function renderReturnsRequestView(container, sales, returnRequests, user, pharmacyId, branchId, currency) {
  const mainContent = container;

  mainContent.innerHTML = `
    <div class="animate-in">
      <div class="page-header">
        <div>
          <div class="page-title">📋 My Return Requests</div>
          <div class="page-subtitle">Request returns for sold items (pending admin approval)</div>
        </div>
        <button class="btn btn-primary" onclick="window.openReturnRequestModal()">+ New Return Request</button>
      </div>

      <!-- Status Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-bottom:1.5rem">
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-label">Total Requests</span>
            <div class="stat-card-icon blue">📊</div>
          </div>
          <div class="stat-card-value">${returnRequests.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-label">Pending</span>
            <div class="stat-card-icon amber">⏳</div>
          </div>
          <div class="stat-card-value">${returnRequests.filter(r => r.status === 'pending').length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-label">Approved</span>
            <div class="stat-card-icon emerald">✓</div>
          </div>
          <div class="stat-card-value">${returnRequests.filter(r => r.status === 'approved').length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-label">Rejected</span>
            <div class="stat-card-icon red">✕</div>
          </div>
          <div class="stat-card-value">${returnRequests.filter(r => r.status === 'rejected').length}</div>
        </div>
      </div>

      <!-- Return Requests Table -->
      <div class="card">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Request #</th>
                <th>Invoice</th>
                <th>Items</th>
                <th>Requested Amount</th>
                <th>Status</th>
                <th>Requested Date</th>
                <th style="text-align:center">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${returnRequests.length === 0 ? `
                <tr>
                  <td colspan="7" style="text-align:center;padding:2rem">
                    <div style="color:var(--gray-500)">No return requests yet</div>
                  </td>
                </tr>
              ` : returnRequests.map(request => {
                const statusColor = request.status === 'pending' ? 'bg-amber' : 
                                   request.status === 'approved' ? 'bg-success' : 
                                   request.status === 'rejected' ? 'bg-danger' : 'bg-gray';
                
                return `
                  <tr>
                    <td><strong>${request.request_number || 'REQ-' + request.id.substring(0, 8)}</strong></td>
                    <td>${request.invoice_number || '-'}</td>
                    <td><span class="badge bg-blue">${request.items_count || '-'} item(s)</span></td>
                    <td>${request.requested_amount ? currency + parseFloat(request.requested_amount).toFixed(2) : '-'}</td>
                    <td>
                      <span class="badge ${statusColor}">${request.status?.toUpperCase()}</span>
                    </td>
                    <td style="font-size:0.9rem">${formatUTCDate(request.created_at)}</td>
                    <td style="text-align:center">
                      <button class="btn btn-sm btn-ghost" onclick="window.viewRequestDetails('${request.id}')" title="View Details">👁️ View</button>
                      ${request.status === 'pending' ? `
                        <button class="btn btn-sm btn-danger" onclick="window.cancelRequest('${request.id}')" title="Cancel Request">Cancel</button>
                      ` : ''}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Modal Overlay -->
    <div id="returnRequestModalOverlay" class="modal-overlay" style="display:none" onclick="if(event.target === this) window.closeReturnRequestModal()"></div>

    <!-- New Return Request Modal -->
    <div id="returnRequestModal" class="modal" style="display:none">
      <div style="max-width:700px;width:100%">
        <div class="modal-header">
          <h2 class="modal-title">New Return Request</h2>
          <button class="modal-close" onclick="window.closeReturnRequestModal()">✕</button>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow-y:auto">
          <form onsubmit="window.saveReturnRequest(event)">
            <div class="form-group">
              <label class="form-label">Select Invoice *</label>
              <select id="request-invoice" class="form-select" required onchange="window.loadInvoiceDetails()">
                <option value="">-- Select an invoice from your sales --</option>
                ${sales.map(s => `
                  <option value="${s.id}" data-invoice="${s.invoice_number}" data-total="${s.total_amount}">
                    ${s.invoice_number} - ${currency}${parseFloat(s.total_amount).toFixed(2)} (${formatUTCDate(s.created_at)})
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Invoice Items</label>
              <div id="invoice-items" style="padding:1rem;background:var(--gray-50);border-radius:var(--radius-sm);margin-bottom:0.5rem">
                <div style="color:var(--gray-500);text-align:center">Select an invoice to see items</div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Select Items to Return</label>
              <div id="items-to-return" style="padding:1rem;background:var(--blue-50);border-radius:var(--radius-sm)">
                <div style="color:var(--gray-500);text-align:center;font-size:0.9rem">Item selection will appear after invoice selection</div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Reason for Return *</label>
              <select id="return-reason" class="form-select" required>
                <option value="">-- Select reason --</option>
                <option value="Defective">Defective Product</option>
                <option value="Expired">Expired</option>
                <option value="Wrong Item">Wrong Item</option>
                <option value="Customer Complaint">Customer Complaint</option>
                <option value="Damaged">Damaged</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Requested Refund Amount *</label>
              <input type="number" id="return-amount" class="form-input" step="0.01" min="0" placeholder="0.00" required>
              <div style="font-size:0.85rem;color:var(--gray-600);margin-top:0.25rem">
                Total invoice amount: <span id="invoice-total">${currency}0.00</span>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Additional Notes</label>
              <textarea id="return-notes" class="form-input" rows="3" placeholder="Explain the reason for the return..."></textarea>
            </div>

            <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1.5rem">
              <button type="button" class="btn btn-ghost" onclick="window.closeReturnRequestModal()">Cancel</button>
              <button type="submit" class="btn btn-primary">Submit Request</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Modal Overlay for Details -->
    <div id="requestDetailsModalOverlay" class="modal-overlay" style="display:none" onclick="if(event.target === this) window.closeRequestDetailsModal()"></div>

    <!-- Request Details Modal -->
    <div id="requestDetailsModal" class="modal" style="display:none">
      <div style="max-width:600px;width:100%">
        <div class="modal-header">
          <h2 class="modal-title">Return Request Details</h2>
          <button class="modal-close" onclick="window.closeRequestDetailsModal()">✕</button>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow-y:auto">
          <div id="request-details-content">Loading...</div>
        </div>
      </div>
    </div>
  `;

  // Global functions
  window.openReturnRequestModal = () => {
    document.getElementById('returnRequestModalOverlay').style.display = 'block';
    document.getElementById('returnRequestModal').style.display = 'flex';
  };

  window.closeReturnRequestModal = () => {
    document.getElementById('returnRequestModalOverlay').style.display = 'none';
    document.getElementById('returnRequestModal').style.display = 'none';
    document.getElementById('request-invoice').value = '';
    document.getElementById('return-amount').value = '';
    document.getElementById('return-reason').value = '';
    document.getElementById('return-notes').value = '';
  };

  window.loadInvoiceDetails = () => {
    const select = document.getElementById('request-invoice');
    const selectedId = select.value;

    if (!selectedId) {
      document.getElementById('invoice-items').innerHTML = '<div style="color:var(--gray-500);text-align:center">Select an invoice to see items</div>';
      document.getElementById('items-to-return').innerHTML = '<div style="color:var(--gray-500);text-align:center;font-size:0.9rem">Item selection will appear after invoice selection</div>';
      document.getElementById('invoice-total').textContent = currency + '0.00';
      return;
    }

    const invoice = sales.find(s => s.id === selectedId);
    if (!invoice) return;

    const items = invoice.sale_items || [];
    const totalAmount = parseFloat(invoice.total_amount);

    // Display invoice items
    document.getElementById('invoice-items').innerHTML = `
      <div style="font-size:0.9rem">
        <div style="margin-bottom:0.5rem"><strong>Invoice: ${invoice.invoice_number}</strong></div>
        <div>
          ${items.map(item => `
            <div style="padding:0.5rem;border-bottom:1px solid var(--gray-200);display:flex;justify-content:space-between">
              <span>${item.product_name}</span>
              <span>${currency}${parseFloat(item.total_price).toFixed(2)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Display item selection
    document.getElementById('items-to-return').innerHTML = `
      <div style="font-size:0.9rem">
        ${items.length === 0 ? `
          <div style="color:var(--gray-500);text-align:center">No items in invoice</div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:0.5rem">
            ${items.map((item, idx) => `
              <label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem;cursor:pointer;border-radius:var(--radius-sm);transition:background 0.2s">
                <input type="checkbox" class="return-item-checkbox" value="${idx}" data-amount="${item.total_price}">
                <span>${item.product_name} - ${currency}${parseFloat(item.total_price).toFixed(2)}</span>
              </label>
            `).join('')}
          </div>
          <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--blue-200)">
            <button type="button" class="btn btn-sm btn-secondary" onclick="window.calculateSelectedAmount()">Calculate Selected Amount</button>
          </div>
        `}
      </div>
    `;

    document.getElementById('invoice-total').textContent = currency + totalAmount.toFixed(2);
    document.getElementById('return-amount').value = totalAmount;
  };

  window.calculateSelectedAmount = () => {
    const checkboxes = document.querySelectorAll('.return-item-checkbox:checked');
    let total = 0;
    checkboxes.forEach(cb => {
      total += parseFloat(cb.dataset.amount);
    });
    document.getElementById('return-amount').value = total.toFixed(2);
  };

  window.saveReturnRequest = async (event) => {
    event.preventDefault();

    try {
      const invoiceId = document.getElementById('request-invoice').value;
      const reason = document.getElementById('return-reason').value;
      const amount = parseFloat(document.getElementById('return-amount').value);
      const notes = document.getElementById('return-notes').value;

      if (!invoiceId || !reason || !amount || amount <= 0) {
        showToast('Please fill in all required fields', 'error');
        return;
      }

      const invoice = sales.find(s => s.id === invoiceId);
      if (!invoice) {
        showToast('Invoice not found', 'error');
        return;
      }

      // Get items to return
      const selectedItems = [];
      const checkboxes = document.querySelectorAll('.return-item-checkbox:checked');
      checkboxes.forEach(cb => {
        const idx = parseInt(cb.value);
        const item = (invoice.sale_items || [])[idx];
        if (item) selectedItems.push(item);
      });

      const itemCount = selectedItems.length > 0 ? selectedItems.length : (invoice.sale_items || []).length;

      // Create return request
      const { data: request, error } = await supabase
        .from('return_requests')
        .insert({
          pharmacy_id: pharmacyId,
          branch_id: branchId,
          invoice_id: invoiceId,
          invoice_number: invoice.invoice_number,
          requested_by: userId,
          request_number: `REQ-${Date.now().toString().slice(-8)}`,
          items_count: itemCount,
          requested_amount: amount,
          reason: reason,
          notes: notes,
          status: 'pending',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      showToast('Return request submitted successfully! Awaiting admin approval.', 'success');
      window.closeReturnRequestModal();
      location.reload();
    } catch (error) {
      console.error('Error saving return request:', error);
      showToast(`Error: ${error.message}`, 'error');
    }
  };

  window.viewRequestDetails = (requestId) => {
    const request = returnRequests.find(r => r.id === requestId);
    if (!request) return;

    const statusColor = request.status === 'pending' ? 'amber' : 
                       request.status === 'approved' ? 'emerald' : 
                       request.status === 'rejected' ? 'red' : 'gray';

    let detailsHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Request Number</h4>
          <p style="margin:0;font-weight:600">${request.request_number || 'REQ-' + request.id.substring(0, 8)}</p>
        </div>
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Invoice</h4>
          <p style="margin:0;font-weight:600">${request.invoice_number || '-'}</p>
        </div>
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Status</h4>
          <p style="margin:0"><span class="badge bg-${statusColor}">${request.status?.toUpperCase()}</span></p>
        </div>
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Requested Date</h4>
          <p style="margin:0">${formatUTCDate(request.created_at)}</p>
        </div>
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Items</h4>
          <p style="margin:0">${request.items_count || '-'} item(s)</p>
        </div>
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Refund Amount</h4>
          <p style="margin:0;font-weight:600;color:var(--success)">${currency}${parseFloat(request.requested_amount || 0).toFixed(2)}</p>
        </div>
      </div>

      <div style="border-top:1px solid var(--gray-200);padding-top:1rem;margin-bottom:1rem">
        <h4 style="margin:0 0 0.5rem 0">Reason</h4>
        <p style="margin:0">${request.reason || '-'}</p>
      </div>

      ${request.notes ? `
        <div style="border-top:1px solid var(--gray-200);padding-top:1rem;margin-bottom:1rem">
          <h4 style="margin:0 0 0.5rem 0">Notes</h4>
          <p style="margin:0;white-space:pre-wrap">${request.notes}</p>
        </div>
      ` : ''}

      ${request.admin_notes ? `
        <div style="border-top:1px solid var(--gray-200);padding-top:1rem;margin-bottom:1rem;background:var(--blue-50);padding:1rem;border-radius:var(--radius-sm)">
          <h4 style="margin:0 0 0.5rem 0;color:var(--blue-700)">Admin Response</h4>
          <p style="margin:0;color:var(--blue-900)">${request.admin_notes}</p>
        </div>
      ` : ''}
    `;

    document.getElementById('request-details-content').innerHTML = detailsHTML;
    document.getElementById('requestDetailsModalOverlay').style.display = 'block';
    document.getElementById('requestDetailsModal').style.display = 'flex';
  };

  window.closeRequestDetailsModal = () => {
    document.getElementById('requestDetailsModalOverlay').style.display = 'none';
    document.getElementById('requestDetailsModal').style.display = 'none';
  };

  window.closeRequestDetailsModal = () => {
    document.getElementById('requestDetailsModal').style.display = 'none';
  };

  window.cancelRequest = async (requestId) => {
    if (!confirm('Are you sure you want to cancel this return request?')) return;

    try {
      const { error } = await supabase
        .from('return_requests')
        .update({ status: 'cancelled' })
        .eq('id', requestId);

      if (error) throw error;

      showToast('Return request cancelled', 'success');
      location.reload();
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
    }
  };
}
