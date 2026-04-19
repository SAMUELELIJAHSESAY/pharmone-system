// Admin Returns Management - Approve/Reject salesman return requests
import { supabase } from '../../database.js';
import { formatCurrency, showToast } from '../../utils.js';

export async function renderAdminReturnsManagement(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;

  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked to your account.</div>`;
    return;
  }

  try {
    // Get all return requests for this pharmacy
    const { data: returnRequests, error } = await supabase
      .from('return_requests')
      .select('*, profiles!requested_by(full_name, email)')
      .eq('pharmacy_id', pharmacyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    renderReturnsManagementView(container, returnRequests || [], user, pharmacyId);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load return requests: ${err.message}</div>`;
  }
}

function renderReturnsManagementView(container, returnRequests, user, pharmacyId) {
  // Separate by status
  const pending = returnRequests.filter(r => r.status === 'pending');
  const approved = returnRequests.filter(r => r.status === 'approved');
  const rejected = returnRequests.filter(r => r.status === 'rejected');

  const mainContent = container;

  mainContent.innerHTML = `
    <div class="animate-in">
      <div class="page-header">
        <div>
          <div class="page-title">📋 Return Request Management</div>
          <div class="page-subtitle">Review and approve/reject salesman return requests</div>
        </div>
      </div>

      <!-- Status Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-bottom:1.5rem">
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-label">Pending Review</span>
            <div class="stat-card-icon amber">⏳</div>
          </div>
          <div class="stat-card-value">${pending.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-label">Approved</span>
            <div class="stat-card-icon emerald">✓</div>
          </div>
          <div class="stat-card-value">${approved.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-label">Rejected</span>
            <div class="stat-card-icon red">✕</div>
          </div>
          <div class="stat-card-value">${rejected.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-label">Total Refunds</span>
            <div class="stat-card-icon blue">💰</div>
          </div>
          <div class="stat-card-value">₦${returnRequests.reduce((sum, r) => sum + parseFloat(r.requested_amount || 0), 0).toFixed(2)}</div>
        </div>
      </div>

      <!-- Pending Requests Tab -->
      <div class="card" style="margin-bottom:2rem">
        <div class="card-header">
          <h3 style="margin:0">⏳ Pending Review (${pending.length})</h3>
        </div>
        ${pending.length === 0 ? `
          <div class="card-body">
            <div style="text-align:center;color:var(--gray-500);padding:2rem">No pending requests</div>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Request #</th>
                  <th>Invoice</th>
                  <th>Requested By</th>
                  <th>Items</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th style="text-align:center">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${pending.map(request => `
                  <tr>
                    <td><strong>${request.request_number}</strong></td>
                    <td>${request.invoice_number}</td>
                    <td>
                      <div style="font-size:0.9rem">
                        <div>${request.profiles?.full_name || 'Unknown'}</div>
                        <div style="color:var(--gray-500);font-size:0.85rem">${request.profiles?.email || '-'}</div>
                      </div>
                    </td>
                    <td><span class="badge bg-blue">${request.items_count}</span></td>
                    <td><strong>₦${parseFloat(request.requested_amount).toFixed(2)}</strong></td>
                    <td style="font-size:0.9rem">${request.reason}</td>
                    <td style="text-align:center">
                      <button class="btn btn-sm btn-success" onclick="window.approveReturnRequest('${request.id}')" title="Approve">✓ Approve</button>
                      <button class="btn btn-sm btn-danger" onclick="window.rejectReturnRequest('${request.id}')" title="Reject">✕ Reject</button>
                      <button class="btn btn-sm btn-ghost" onclick="window.viewReturnRequestDetails('${request.id}')" title="Details">👁️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <!-- Approved Requests Tab -->
      <div class="card" style="margin-bottom:2rem">
        <div class="card-header">
          <h3 style="margin:0">✓ Approved (${approved.length})</h3>
        </div>
        ${approved.length === 0 ? `
          <div class="card-body">
            <div style="text-align:center;color:var(--gray-500);padding:2rem">No approved requests</div>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Request #</th>
                  <th>Invoice</th>
                  <th>Requested By</th>
                  <th>Amount</th>
                  <th>Approved Date</th>
                  <th style="text-align:center">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${approved.map(request => `
                  <tr>
                    <td><strong>${request.request_number}</strong></td>
                    <td>${request.invoice_number}</td>
                    <td>${request.profiles?.full_name || 'Unknown'}</td>
                    <td><strong>₦${parseFloat(request.requested_amount).toFixed(2)}</strong></td>
                    <td>${new Date(request.approved_at).toLocaleDateString()}</td>
                    <td style="text-align:center">
                      <button class="btn btn-sm btn-ghost" onclick="window.viewReturnRequestDetails('${request.id}')" title="Details">👁️ View</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <!-- Rejected Requests Tab -->
      <div class="card">
        <div class="card-header">
          <h3 style="margin:0">✕ Rejected (${rejected.length})</h3>
        </div>
        ${rejected.length === 0 ? `
          <div class="card-body">
            <div style="text-align:center;color:var(--gray-500);padding:2rem">No rejected requests</div>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Request #</th>
                  <th>Invoice</th>
                  <th>Requested By</th>
                  <th>Amount</th>
                  <th>Rejected Date</th>
                  <th style="text-align:center">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rejected.map(request => `
                  <tr>
                    <td><strong>${request.request_number}</strong></td>
                    <td>${request.invoice_number}</td>
                    <td>${request.profiles?.full_name || 'Unknown'}</td>
                    <td><strong>₦${parseFloat(request.requested_amount).toFixed(2)}</strong></td>
                    <td>${request.updated_at ? new Date(request.updated_at).toLocaleDateString() : '-'}</td>
                    <td style="text-align:center">
                      <button class="btn btn-sm btn-ghost" onclick="window.viewReturnRequestDetails('${request.id}')" title="Details">👁️ View</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>

    <!-- Approval Modal -->
    <div id="approvalModal" class="modal" style="display:none">
      <div class="modal-content" style="max-width:500px">
        <div class="modal-header">
          <h2 class="modal-title">Approve Return Request</h2>
          <button class="modal-close" onclick="window.closeApprovalModal()">✕</button>
        </div>
        <div class="modal-body">
          <form onsubmit="window.submitApproval(event)">
            <div class="form-group">
              <label class="form-label">Admin Notes (Optional)</label>
              <textarea id="approval-notes" class="form-control" rows="3" placeholder="Add any notes or comments..."></textarea>
            </div>

            <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1.5rem">
              <button type="button" class="btn btn-ghost" onclick="window.closeApprovalModal()">Cancel</button>
              <button type="submit" class="btn btn-success">Approve Request</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Rejection Modal -->
    <div id="rejectionModal" class="modal" style="display:none">
      <div class="modal-content" style="max-width:500px">
        <div class="modal-header">
          <h2 class="modal-title">Reject Return Request</h2>
          <button class="modal-close" onclick="window.closeRejectionModal()">✕</button>
        </div>
        <div class="modal-body">
          <form onsubmit="window.submitRejection(event)">
            <div class="form-group">
              <label class="form-label">Reason for Rejection *</label>
              <select id="rejection-reason" class="form-control" required>
                <option value="">-- Select reason --</option>
                <option value="Invalid Invoice">Invalid Invoice</option>
                <option value="Items Still Valid">Items Still Valid</option>
                <option value="Incomplete Documentation">Incomplete Documentation</option>
                <option value="Policy Violation">Policy Violation</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Rejection Notes</label>
              <textarea id="rejection-notes" class="form-control" rows="3" placeholder="Explain why this request was rejected..."></textarea>
            </div>

            <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1.5rem">
              <button type="button" class="btn btn-ghost" onclick="window.closeRejectionModal()">Cancel</button>
              <button type="submit" class="btn btn-danger">Reject Request</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Details Modal -->
    <div id="detailsModal" class="modal" style="display:none">
      <div class="modal-content" style="max-width:600px">
        <div class="modal-header">
          <h2 class="modal-title">Return Request Details</h2>
          <button class="modal-close" onclick="window.closeDetailsModal()">✕</button>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow-y:auto">
          <div id="details-content">Loading...</div>
        </div>
      </div>
    </div>
  `;

  // Global functions
  let currentRequestId = null;
  let allRequests = returnRequests;

  window.approveReturnRequest = (requestId) => {
    currentRequestId = requestId;
    document.getElementById('approvalModal').style.display = 'flex';
  };

  window.rejectReturnRequest = (requestId) => {
    currentRequestId = requestId;
    document.getElementById('rejectionModal').style.display = 'flex';
  };

  window.closeApprovalModal = () => {
    document.getElementById('approvalModal').style.display = 'none';
    document.getElementById('approval-notes').value = '';
  };

  window.closeRejectionModal = () => {
    document.getElementById('rejectionModal').style.display = 'none';
    document.getElementById('rejection-reason').value = '';
    document.getElementById('rejection-notes').value = '';
  };

  window.submitApproval = async (event) => {
    event.preventDefault();

    try {
      const { data: userData } = await supabase.auth.getUser();
      const notes = document.getElementById('approval-notes').value;

      const { error } = await supabase
        .from('return_requests')
        .update({
          status: 'approved',
          approved_by: userData.user.id,
          approved_at: new Date().toISOString(),
          admin_notes: notes || null
        })
        .eq('id', currentRequestId);

      if (error) throw error;

      showToast('Return request approved successfully!', 'success');
      window.closeApprovalModal();
      location.reload();
    } catch (error) {
      console.error('Error approving request:', error);
      showToast(`Error: ${error.message}`, 'error');
    }
  };

  window.submitRejection = async (event) => {
    event.preventDefault();

    try {
      const { data: userData } = await supabase.auth.getUser();
      const reason = document.getElementById('rejection-reason').value;
      const notes = document.getElementById('rejection-notes').value;

      const adminNotes = `Reason: ${reason}. ${notes ? 'Notes: ' + notes : ''}`;

      const { error } = await supabase
        .from('return_requests')
        .update({
          status: 'rejected',
          approved_by: userData.user.id,
          approved_at: new Date().toISOString(),
          admin_notes: adminNotes
        })
        .eq('id', currentRequestId);

      if (error) throw error;

      showToast('Return request rejected', 'success');
      window.closeRejectionModal();
      location.reload();
    } catch (error) {
      console.error('Error rejecting request:', error);
      showToast(`Error: ${error.message}`, 'error');
    }
  };

  window.viewReturnRequestDetails = (requestId) => {
    const request = allRequests.find(r => r.id === requestId);
    if (!request) return;

    const statusColor = request.status === 'pending' ? 'amber' : 
                       request.status === 'approved' ? 'emerald' : 
                       request.status === 'rejected' ? 'red' : 'gray';

    let detailsHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Request Number</h4>
          <p style="margin:0;font-weight:600;font-size:1.1rem">${request.request_number}</p>
        </div>
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Status</h4>
          <p style="margin:0"><span class="badge bg-${statusColor}">${request.status?.toUpperCase()}</span></p>
        </div>
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Invoice Number</h4>
          <p style="margin:0;font-weight:600">${request.invoice_number}</p>
        </div>
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Requested By</h4>
          <p style="margin:0">${request.profiles?.full_name || 'Unknown'}</p>
        </div>
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Items Count</h4>
          <p style="margin:0">${request.items_count}</p>
        </div>
        <div>
          <h4 style="margin:0 0 0.5rem 0;color:var(--gray-600)">Requested Amount</h4>
          <p style="margin:0;font-weight:600;color:var(--success)">₦${parseFloat(request.requested_amount).toFixed(2)}</p>
        </div>
      </div>

      <div style="border-top:1px solid var(--gray-200);padding-top:1rem;margin-bottom:1rem">
        <h4 style="margin:0 0 0.5rem 0">Reason</h4>
        <p style="margin:0">${request.reason}</p>
      </div>

      ${request.notes ? `
        <div style="border-top:1px solid var(--gray-200);padding-top:1rem;margin-bottom:1rem">
          <h4 style="margin:0 0 0.5rem 0">Salesman Notes</h4>
          <p style="margin:0;white-space:pre-wrap">${request.notes}</p>
        </div>
      ` : ''}

      ${request.admin_notes ? `
        <div style="border-top:1px solid var(--gray-200);padding-top:1rem;margin-bottom:1rem;background:var(--blue-50);padding:1rem;border-radius:var(--radius-sm)">
          <h4 style="margin:0 0 0.5rem 0;color:var(--blue-700)">Admin Response</h4>
          <p style="margin:0;color:var(--blue-900);white-space:pre-wrap">${request.admin_notes}</p>
        </div>
      ` : ''}

      ${request.approved_at ? `
        <div style="border-top:1px solid var(--gray-200);padding-top:1rem;font-size:0.9rem;color:var(--gray-600)">
          <strong>Approved:</strong> ${new Date(request.approved_at).toLocaleString()}
        </div>
      ` : ''}
    `;

    document.getElementById('details-content').innerHTML = detailsHTML;
    document.getElementById('detailsModal').style.display = 'flex';
  };

  window.closeDetailsModal = () => {
    document.getElementById('detailsModal').style.display = 'none';
  };
}
