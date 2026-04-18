// Branch Stock Transfer Management View
import { getBranches, getProducts, getBranchTransfers, createStockTransfer, addTransferItem, getTransferDetails, processStockTransfer } from '../../database.js';
import { supabase } from '../../config.js';

export async function renderStockTransfers(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;
  
  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked to your account.</div>`;
    return;
  }
  
  // Store pharmacyId globally for use in form handlers
  window.currentPharmacyId = pharmacyId;
  window.currentUserId = user?.id;
  
  try {
    const transfers = await getBranchTransfers(pharmacyId);
    renderStockTransferView(container, transfers, user, pharmacyId);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load transfers: ${err.message}</div>`;
  }
}

function renderStockTransferView(container, transfers, user, pharmacyId) {
  const mainContent = container;
  
  mainContent.innerHTML = `
    <div class="stock-transfer-container">
      <div class="page-header">
        <h1>📦 Stock Transfers Between Branches</h1>
        <button class="btn btn-primary" onclick="openCreateTransferModal()">+ New Transfer</button>
      </div>
      
      <!-- Active Transfers -->
      <div class="section">
        <h3>Active Transfers</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Transfer #</th>
              <th>From Branch</th>
              <th>To Branch</th>
              <th>Items</th>
              <th>Status</th>
              <th>Initiated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="active-transfers-table">
            <tr><td colspan="7">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      
      <!-- Transfer History -->
      <div class="section">
        <h3>Transfer History</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Transfer #</th>
              <th>From Branch</th>
              <th>To Branch</th>
              <th>Items</th>
              <th>Status</th>
              <th>Initiated</th>
              <th>Received</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="history-transfers-table">
            <tr><td colspan="8">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    
    <!-- Create Transfer Modal -->
    <div id="create-transfer-modal" class="modal" style="display: none;">
      <div class="modal-content large">
        <div class="modal-close" onclick="closeModal('create-transfer-modal')">×</div>
        <h2>Create Stock Transfer</h2>
        
        <form onsubmit="saveStockTransfer(event)">
          <div class="form-row">
            <div class="form-group">
              <label>From Branch</label>
              <select id="from-branch" class="form-control" required onchange="loadFromBranchProducts()">
                <option value="">-- Select Source Branch --</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>To Branch</label>
              <select id="to-branch" class="form-control" required>
                <option value="">-- Select Destination Branch --</option>
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label>Notes</label>
            <textarea id="transfer-notes" class="form-control" rows="2"></textarea>
          </div>
          
          <!-- Transfer Items Section -->
          <div class="section-divider"><h4>Transfer Items</h4></div>
          
          <div class="transfer-items-section">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Available Stock</th>
                  <th>Boxes</th>
                  <th>Units</th>
                  <th>Batch #</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="transfer-items-tbody">
                <tr><td colspan="6"><button type="button" class="btn btn-secondary" onclick="addTransferItemRow()">+ Add Item</button></td></tr>
              </tbody>
            </table>
          </div>
          
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Create Transfer</button>
            <button type="button" class="btn btn-secondary" onclick="closeModal('create-transfer-modal')">Cancel</button>
          </div>
        </form>
      </div>
    </div>
    
    <!-- Transfer Details Modal -->
    <div id="transfer-details-modal" class="modal" style="display: none;">
      <div class="modal-content large">
        <div class="modal-close" onclick="closeModal('transfer-details-modal')">×</div>
        <h2>Transfer Details</h2>
        
        <div class="transfer-info">
          <div class="info-grid">
            <div class="info-item">
              <label>Transfer Number:</label>
              <span id="detail-transfer-number">-</span>
            </div>
            <div class="info-item">
              <label>From Branch:</label>
              <span id="detail-from-branch">-</span>
            </div>
            <div class="info-item">
              <label>To Branch:</label>
              <span id="detail-to-branch">-</span>
            </div>
            <div class="info-item">
              <label>Status:</label>
              <span id="detail-status">-</span>
            </div>
            <div class="info-item">
              <label>Initiated:</label>
              <span id="detail-initiated">-</span>
            </div>
            <div class="info-item">
              <label>Received:</label>
              <span id="detail-received">-</span>
            </div>
          </div>
        </div>
        
        <div class="section">
          <h3>Items in Transfer</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Boxes</th>
                <th>Units</th>
                <th>Batch Number</th>
              </tr>
            </thead>
            <tbody id="transfer-items-detail-tbody">
              <tr><td colspan="4">Loading...</td></tr>
            </tbody>
          </table>
        </div>
        
        <div class="form-actions">
          <button id="process-transfer-btn" class="btn btn-success" onclick="processTransferAction()" style="display: none;">
            Mark as Received
          </button>
          <button class="btn btn-secondary" onclick="closeModal('transfer-details-modal')">Close</button>
        </div>
      </div>
    </div>
  `;
  
  loadTransferData(pharmacyId);
}

async function loadTransferData(pharmacyId) {
  try {
    // Load branches
    const branches = await getBranches(pharmacyId);
    
    const fromBranchSelect = document.getElementById('from-branch');
    const toBranchSelect = document.getElementById('to-branch');
    
    const branchOptions = branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    fromBranchSelect.innerHTML = '<option value="">-- Select Source Branch --</option>' + branchOptions;
    toBranchSelect.innerHTML = '<option value="">-- Select Destination Branch --</option>' + branchOptions;
    
    // Load transfers
    const transfers = await getBranchTransfers(pharmacyId);
    displayTransfers(transfers, branches);
    
  } catch (error) {
    // Handle error silently in production
  }
}

function displayTransfers(transfers, branches) {
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
  
  // Active transfers (pending, in_transit)
  const activeTransfers = transfers.filter(t => ['pending', 'in_transit'].includes(t.status));
  const activeTbody = document.getElementById('active-transfers-table');
  
  if (activeTransfers.length === 0) {
    activeTbody.innerHTML = '<tr><td colspan="7">No active transfers</td></tr>';
  } else {
    activeTbody.innerHTML = activeTransfers.map(t => `
      <tr>
        <td>${t.transfer_number}</td>
        <td>${branchMap[t.from_branch_id] || 'Unknown'}</td>
        <td>${branchMap[t.to_branch_id] || 'Unknown'}</td>
        <td>${t.total_items}</td>
        <td><span class="badge badge-${t.status}">${t.status}</span></td>
        <td>${new Date(t.initiated_date).toLocaleDateString()}</td>
        <td>
          <button class="btn btn-small btn-info" onclick="viewTransferDetails('${t.id}')">View</button>
          ${t.status === 'pending' ? `<button class="btn btn-small btn-warning" onclick="changeTransferStatus('${t.id}', 'in_transit')">In Transit</button>` : ''}
        </td>
      </tr>
    `).join('');
  }
  
  // History (received, cancelled)
  const historyTransfers = transfers.filter(t => ['received', 'cancelled'].includes(t.status));
  const historyTbody = document.getElementById('history-transfers-table');
  
  if (historyTransfers.length === 0) {
    historyTbody.innerHTML = '<tr><td colspan="8">No transfer history</td></tr>';
  } else {
    historyTbody.innerHTML = historyTransfers.map(t => `
      <tr>
        <td>${t.transfer_number}</td>
        <td>${branchMap[t.from_branch_id] || 'Unknown'}</td>
        <td>${branchMap[t.to_branch_id] || 'Unknown'}</td>
        <td>${t.total_items}</td>
        <td><span class="badge badge-${t.status}">${t.status}</span></td>
        <td>${new Date(t.initiated_date).toLocaleDateString()}</td>
        <td>${t.received_date ? new Date(t.received_date).toLocaleDateString() : '-'}</td>
        <td>
          <button class="btn btn-small btn-info" onclick="viewTransferDetails('${t.id}')">View</button>
        </td>
      </tr>
    `).join('');
  }
}

function openCreateTransferModal() {
  document.getElementById('create-transfer-modal').style.display = 'block';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

// Expose to window for onclick handlers
window.openCreateTransferModal = openCreateTransferModal;
window.closeModal = closeModal;
window.loadFromBranchProducts = loadFromBranchProducts;
window.addTransferItemRow = addTransferItemRow;
window.updateProductStock = updateProductStock;
window.updateTotals = updateTotals;
window.removeTransferItemRow = removeTransferItemRow;
window.viewTransferDetails = viewTransferDetails;
window.saveStockTransfer = saveStockTransfer;
window.changeTransferStatus = changeTransferStatus;

async function loadFromBranchProducts() {
  try {
    const fromBranchId = document.getElementById('from-branch').value;
    if (!fromBranchId) return;
    
    // Load products for this branch
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('branch_id', fromBranchId)
      .eq('is_active', true);
    
    if (error) throw error;
    
    // Store products for use in transfer items
    window.branchProducts = data;
    
  } catch (error) {
    // Handle error silently in production
  }
}

function addTransferItemRow() {
  const tbody = document.getElementById('transfer-items-tbody');
  const rowCount = tbody.querySelectorAll('.transfer-item-row').length;
  
  const row = document.createElement('tr');
  row.className = 'transfer-item-row';
  row.innerHTML = `
    <td>
      <select class="form-control product-select" onchange="updateProductStock(this, ${rowCount})" required>
        <option value="">-- Select Product --</option>
        ${(window.branchProducts || []).map(p => 
          `<option value="${p.id}" data-stock="${p.stock_boxes}" data-units="${p.stock_units}">${p.name}</option>`
        ).join('')}
      </select>
    </td>
    <td><span class="available-stock">-</span></td>
    <td><input type="number" class="form-control" min="0" value="0" onchange="updateTotals()"></td>
    <td><input type="number" class="form-control" min="0" value="0" onchange="updateTotals()"></td>
    <td><input type="text" class="form-control" placeholder="Batch #"></td>
    <td><button type="button" class="btn btn-small btn-danger" onclick="removeTransferItemRow(this)">Remove</button></td>
  `;
  
  // Insert before the button row
  const buttonRow = tbody.querySelector('tr:last-child');
  tbody.insertBefore(row, buttonRow);
}

function updateProductStock(select, rowIndex) {
  const stock = select.options[select.selectedIndex].dataset.stock;
  const units = select.options[select.selectedIndex].dataset.units;
  const row = select.closest('tr');
  row.querySelector('.available-stock').textContent = `${stock} boxes, ${units} units`;
}

function removeTransferItemRow(btn) {
  btn.closest('tr').remove();
  updateTotals();
}

function updateTotals() {
  const rows = document.querySelectorAll('.transfer-item-row');
  let totalItems = 0;
  
  rows.forEach(row => {
    const boxes = parseInt(row.querySelector('input[type="number"]').value) || 0;
    totalItems += boxes;
  });
  
  // Update total display if exists
  console.log('Total items to transfer:', totalItems);
}

async function saveStockTransfer(event) {
  event.preventDefault();
  
  try {
    const fromBranchId = document.getElementById('from-branch').value;
    const toBranchId = document.getElementById('to-branch').value;
    const notes = document.getElementById('transfer-notes').value;
    
    if (!fromBranchId || !toBranchId) {
      alert('Please select both source and destination branches');
      return;
    }
    
    if (fromBranchId === toBranchId) {
      alert('Source and destination branches must be different');
      return;
    }
    
    const { data: userData } = await supabase.auth.getUser();
    const pharmacyId = getCurrentPharmacyId();
    
    if (!pharmacyId) {
      throw new Error('Pharmacy ID not found. Please refresh and try again.');
    }
    
    // Create transfer
    const transfer = await createStockTransfer({
      from_branch_id: fromBranchId,
      to_branch_id: toBranchId,
      pharmacy_id: pharmacyId,
      initiated_by: userData.user.id,
      notes: notes,
      status: 'pending'
    });
    
    // Add transfer items
    const rows = document.querySelectorAll('.transfer-item-row');
    let totalItems = 0;
    
    for (const row of rows) {
      const productSelect = row.querySelector('.product-select');
      const boxes = parseInt(row.querySelector('input[type="number"]').value) || 0;
      
      if (productSelect.value && boxes > 0) {
        await addTransferItem({
          transfer_id: transfer.id,
          product_id: productSelect.value,
          product_name: productSelect.options[productSelect.selectedIndex].text,
          quantity_boxes: boxes,
          quantity_units: 0,
          units_per_box: 1,
          batch_number: row.querySelector('input[placeholder="Batch #"]').value
        });
        
        totalItems += boxes;
      }
    }
    
    // Update transfer with total items
    await supabase
      .from('branch_stock_transfers')
      .update({ total_items: totalItems })
      .eq('id', transfer.id);
    
    alert('Transfer created successfully!');
    closeModal('create-transfer-modal');
    location.reload();
    
  } catch (error) {
    console.error('Error saving transfer:', error);
    alert('Error: ' + error.message);
  }
}

async function viewTransferDetails(transferId) {
  try {
    const transfer = await getTransferDetails(transferId);
    
    document.getElementById('detail-transfer-number').textContent = transfer.transfer_number;
    document.getElementById('detail-from-branch').textContent = transfer['branches!from_branch_id']?.name || 'Unknown';
    document.getElementById('detail-to-branch').textContent = transfer['branches!to_branch_id']?.name || 'Unknown';
    document.getElementById('detail-status').textContent = transfer.status;
    document.getElementById('detail-initiated').textContent = new Date(transfer.initiated_date).toLocaleDateString();
    document.getElementById('detail-received').textContent = transfer.received_date ? new Date(transfer.received_date).toLocaleDateString() : '-';
    
    // Show items
    const itemsTbody = document.getElementById('transfer-items-detail-tbody');
    if (transfer.branch_transfer_items.length === 0) {
      itemsTbody.innerHTML = '<tr><td colspan="4">No items in transfer</td></tr>';
    } else {
      itemsTbody.innerHTML = transfer.branch_transfer_items.map(item => `
        <tr>
          <td>${item.product_name}</td>
          <td>${item.quantity_boxes}</td>
          <td>${item.quantity_units}</td>
          <td>${item.batch_number || '-'}</td>
        </tr>
      `).join('');
    }
    
    // Show process button if in_transit
    const processBtn = document.getElementById('process-transfer-btn');
    processBtn.display = transfer.status === 'in_transit' ? 'block' : 'none';
    processBtn.dataset.transferId = transferId;
    
    document.getElementById('transfer-details-modal').style.display = 'block';
    document.getElementById('transfer-details-modal').dataset.transferId = transferId;
    
  } catch (error) {
    console.error('Error loading transfer details:', error);
    alert('Error: ' + error.message);
  }
}

async function processTransferAction() {
  const transferId = document.getElementById('transfer-details-modal').dataset.transferId;
  
  if (!confirm('Mark this transfer as received? This will update stock levels.')) return;
  
  try {
    await processStockTransfer(transferId);
    alert('Transfer completed successfully!');
    location.reload();
  } catch (error) {
    console.error('Error processing transfer:', error);
    alert('Error: ' + error.message);
  }
}

async function changeTransferStatus(transferId, newStatus) {
  try {
    await supabase
      .from('branch_stock_transfers')
      .update({ status: newStatus })
      .eq('id', transferId);
    
    alert('Status updated successfully!');
    location.reload();
    
  } catch (error) {
    console.error('Error updating status:', error);
    alert('Error: ' + error.message);
  }
}

function getCurrentPharmacyId() {
  return window.currentPharmacyId || '';
}
