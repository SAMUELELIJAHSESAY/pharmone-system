import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, getSupplierPurchaseHistory } from '../../database.js';
import { showToast, showConfirm } from '../../utils.js';

let suppliersData = [];

export async function renderSuppliers(container, user) {
  const pharmacyId = user.profile?.pharmacy_id;
  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked.</div>`;
    return;
  }

  try {
    suppliersData = await getSuppliers(pharmacyId);

    container.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">Suppliers</div>
            <div class="page-subtitle">Manage your pharmacy suppliers</div>
          </div>
          <button class="btn btn-primary" onclick="window.addSupplierHandler()">
            <span style="font-size:1.25rem">+</span> Add Supplier
          </button>
        </div>

        ${suppliersData.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">📦</div>
            <div class="empty-state-title">No suppliers yet</div>
            <div class="empty-state-text">Create your first supplier to start receiving stock</div>
            <button class="btn btn-primary" onclick="window.addSupplierHandler()">Add Supplier</button>
          </div>
        ` : `
          <div class="card">
            <div class="table-responsive">
              <table class="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Contact Person</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Payment Terms</th>
                    <th style="text-align:center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${suppliersData.map(supplier => `
                    <tr>
                      <td>
                        <div class="font-semibold">${supplier.name}</div>
                        <div class="text-sm text-muted">${supplier.address || 'No address'}</div>
                      </td>
                      <td>${supplier.contact_person || '-'}</td>
                      <td>${supplier.phone || '-'}</td>
                      <td>${supplier.email || '-'}</td>
                      <td>
                        <span class="badge">${supplier.payment_terms}</span>
                      </td>
                      <td style="text-align:center;display:flex;gap:0.5rem;justify-content:center">
                        <button class="btn btn-sm btn-ghost" onclick="window.editSupplierHandler('${supplier.id}')">
                          ✏️ Edit
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="window.deleteSupplierHandler('${supplier.id}')">
                          🗑️ Delete
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `}
      </div>

      <div id="supplierModal" class="modal" style="display:none">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title" id="supplierModalTitle">Add Supplier</h2>
            <button class="modal-close" onclick="window.closeSupplierModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Supplier Name *</label>
              <input type="text" id="supplierName" class="form-control" placeholder="e.g., ABC Pharmaceuticals">
            </div>
            <div class="form-group">
              <label class="form-label">Contact Person</label>
              <input type="text" id="supplierContact" class="form-control" placeholder="Contact person name">
            </div>
            <div class="form-group">
              <label class="form-label">Phone</label>
              <input type="tel" id="supplierPhone" class="form-control" placeholder="+1 (555) 000-0000">
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" id="supplierEmail" class="form-control" placeholder="supplier@example.com">
            </div>
            <div class="form-group">
              <label class="form-label">Address</label>
              <textarea id="supplierAddress" class="form-control" placeholder="123 Pharmacy St, City, Country" rows="2"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Payment Terms</label>
              <select id="supplierPaymentTerms" class="form-control">
                <option value="COD">Cash on Delivery (COD)</option>
                <option value="NET 7">Net 7 days</option>
                <option value="NET 14">Net 14 days</option>
                <option value="NET 30">Net 30 days</option>
                <option value="NET 60">Net 60 days</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Notes</label>
              <textarea id="supplierNotes" class="form-control" placeholder="Any additional notes" rows="2"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="window.closeSupplierModal()">Cancel</button>
            <button class="btn btn-primary" id="supplierSaveBtn" onclick="window.saveSupplierHandler()">Save Supplier</button>
          </div>
        </div>
      </div>
    `;

    // Attach handlers
    window.addSupplierHandler = () => {
      document.getElementById('supplierName').value = '';
      document.getElementById('supplierContact').value = '';
      document.getElementById('supplierPhone').value = '';
      document.getElementById('supplierEmail').value = '';
      document.getElementById('supplierAddress').value = '';
      document.getElementById('supplierPaymentTerms').value = 'COD';
      document.getElementById('supplierNotes').value = '';
      document.getElementById('supplierModalTitle').textContent = 'Add Supplier';
      document.getElementById('supplierSaveBtn').textContent = 'Add Supplier';
      document.getElementById('supplierSaveBtn').onclick = () => window.saveSupplierHandler(pharmacyId);
      document.getElementById('supplierModal').style.display = 'flex';
    };

    window.editSupplierHandler = (supplierId) => {
      const supplier = suppliersData.find(s => s.id === supplierId);
      if (!supplier) return;
      
      document.getElementById('supplierName').value = supplier.name;
      document.getElementById('supplierContact').value = supplier.contact_person || '';
      document.getElementById('supplierPhone').value = supplier.phone || '';
      document.getElementById('supplierEmail').value = supplier.email || '';
      document.getElementById('supplierAddress').value = supplier.address || '';
      document.getElementById('supplierPaymentTerms').value = supplier.payment_terms;
      document.getElementById('supplierNotes').value = supplier.notes || '';
      document.getElementById('supplierModalTitle').textContent = 'Edit Supplier';
      document.getElementById('supplierSaveBtn').textContent = 'Update Supplier';
      document.getElementById('supplierSaveBtn').onclick = () => window.updateSupplierHandler(supplierId, pharmacyId);
      document.getElementById('supplierModal').style.display = 'flex';
    };

    window.saveSupplierHandler = async (pharmacyId) => {
      const name = document.getElementById('supplierName').value.trim();
      if (!name) {
        showToast('Supplier name is required', 'error');
        return;
      }

      try {
        await createSupplier({
          name,
          contact_person: document.getElementById('supplierContact').value || '',
          phone: document.getElementById('supplierPhone').value || '',
          email: document.getElementById('supplierEmail').value || '',
          address: document.getElementById('supplierAddress').value || '',
          payment_terms: document.getElementById('supplierPaymentTerms').value,
          notes: document.getElementById('supplierNotes').value || '',
          pharmacy_id: pharmacyId
        });
        showToast('Supplier added successfully', 'success');
        window.closeSupplierModal();
        renderSuppliers(container, user);
      } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
      }
    };

    window.updateSupplierHandler = async (supplierId, pharmacyId) => {
      const name = document.getElementById('supplierName').value.trim();
      if (!name) {
        showToast('Supplier name is required', 'error');
        return;
      }

      try {
        await updateSupplier(supplierId, {
          name,
          contact_person: document.getElementById('supplierContact').value || '',
          phone: document.getElementById('supplierPhone').value || '',
          email: document.getElementById('supplierEmail').value || '',
          address: document.getElementById('supplierAddress').value || '',
          payment_terms: document.getElementById('supplierPaymentTerms').value,
          notes: document.getElementById('supplierNotes').value || ''
        });
        showToast('Supplier updated successfully', 'success');
        window.closeSupplierModal();
        renderSuppliers(container, user);
      } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
      }
    };

    window.deleteSupplierHandler = async (supplierId) => {
      if (!(await showConfirm('Are you sure you want to delete this supplier?', 'Delete Supplier'))) return;
      try {
        await deleteSupplier(supplierId);
        showToast('Supplier deleted successfully', 'success');
        renderSuppliers(container, user);
      } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
      }
    };

    window.closeSupplierModal = () => {
      document.getElementById('supplierModal').style.display = 'none';
    };

  } catch (error) {
    showToast(`Error loading suppliers: ${error.message}`, 'error');
    container.innerHTML = `<div class="alert alert-danger">Error loading suppliers: ${error.message}</div>`;
  }
}
