// Expense Management View - Admin & Salesman
import { 
  getExpenses, 
  getExpenseCategories, 
  getAllExpenseCategories,
  createExpense, 
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  updateExpense, 
  approveExpense, 
  getMonthlyExpenseReport 
} from '../../database.js';
import { supabase } from '../../config.js';

let currentPharmacyId = null;
let currentBranchId = null;
let currentUserRole = null;

export async function renderExpenseManagement(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;
  const branchId = user?.profile?.branch_id;
  const role = user?.profile?.role || 'salesman';
  
  currentPharmacyId = pharmacyId;
  currentBranchId = branchId;
  currentUserRole = role;
  
  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked to your account.</div>`;
    return;
  }
  
  try {
    const expenses = await getExpenses(pharmacyId, branchId);
    const categories = role === 'admin' 
      ? await getAllExpenseCategories(pharmacyId)
      : await getExpenseCategories(pharmacyId);
    
    if (role === 'admin') {
      renderAdminExpenseView(container, expenses, categories);
    } else {
      renderSalesmanExpenseView(container, expenses, categories);
    }
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load expenses: ${err.message}</div>`;
  }
}

// ===================== ADMIN VIEW (FULL MANAGEMENT) =====================
function renderAdminExpenseView(container, expenses, categories) {
  container.innerHTML = `
    <div class="expense-management-container">
      <div class="page-header">
        <div>
          <h1>💸 Expense Management</h1>
          <p class="text-muted">Manage expenses and configure expense categories</p>
        </div>
        <button class="btn btn-primary" onclick="adminOpenExpenseModal()">+ Record Expense</button>
      </div>
      
      <!-- Tabs for Admin -->
      <div class="tabs">
        <button class="tab-btn active" onclick="adminSwitchTab('expenses')">📋 Expenses</button>
        <button class="tab-btn" onclick="adminSwitchTab('categories')">🏷️ Categories</button>
      </div>
      
      <!-- Expenses Tab -->
      <div id="expenses-tab" class="tab-content">
        <div class="section">
          <h3>All Expenses</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Payment Method</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="expenses-table-body">
              ${expenses.length === 0 
                ? '<tr><td colspan="7" class="text-center">No expenses recorded</td></tr>'
                : expenses.map(exp => `
                  <tr>
                    <td>${new Date(exp.expense_date).toLocaleDateString()}</td>
                    <td>${exp.expense_categories?.category_name || 'Uncategorized'}</td>
                    <td>${exp.description}</td>
                    <td>₦${parseFloat(exp.amount).toFixed(2)}</td>
                    <td>${exp.payment_method.replace('_', ' ').toUpperCase()}</td>
                    <td>
                      <span class="badge ${exp.is_approved ? 'badge-success' : 'badge-secondary'}">
                        ${exp.is_approved ? '✓ Approved' : 'Pending'}
                      </span>
                    </td>
                    <td>
                      ${!exp.is_approved ? `<button class="btn btn-small btn-success" onclick="adminApproveExpense('${exp.id}')">Approve</button>` : ''}
                      <button class="btn btn-small btn-danger" onclick="adminDeleteExpense('${exp.id}')">Delete</button>
                    </td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- Categories Tab -->
      <div id="categories-tab" class="tab-content" style="display: none;">
        <div class="section">
          <div class="flex justify-between items-center mb-4">
            <h3>Expense Categories</h3>
            <button class="btn btn-primary btn-sm" onclick="adminOpenCategoryModal()">+ Add Category</button>
          </div>
          
          <div class="category-grid">
            ${categories.map(cat => `
              <div class="category-card">
                <div class="category-header">
                  <h4>${cat.category_name}</h4>
                  <span class="badge ${cat.is_active ? 'badge-success' : 'badge-secondary'}">
                    ${cat.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p class="text-muted text-sm">${cat.description || 'No description'}</p>
                <div class="category-actions">
                  <button class="btn btn-small btn-secondary" onclick="adminEditCategory('${cat.id}', '${cat.category_name}', '${cat.description || ''}')">Edit</button>
                  <button class="btn btn-small btn-danger" onclick="adminDeleteCategory('${cat.id}')">Delete</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
    
    <!-- Add/Edit Expense Modal -->
    <div id="admin-expense-modal" class="modal" style="display: none;">
      <div class="modal-content">
        <div class="modal-close" onclick="closeModal('admin-expense-modal')">×</div>
        <h2>Record Expense</h2>
        
        <form onsubmit="adminSaveExpense(event)">
          <div class="form-row">
            <div class="form-group">
              <label>Date</label>
              <input type="date" id="admin-expense-date" class="form-control" required>
            </div>
            <div class="form-group">
              <label>Category</label>
              <select id="admin-expense-category" class="form-control" required>
                <option value="">-- Select Category --</option>
                ${categories.map(cat => `<option value="${cat.id}">${cat.category_name}</option>`).join('')}
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label>Description</label>
            <input type="text" id="admin-expense-description" class="form-control" placeholder="e.g., Monthly rent payment" required>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label>Amount (₦)</label>
              <input type="number" id="admin-expense-amount" class="form-control" step="0.01" min="0" required>
            </div>
            <div class="form-group">
              <label>Payment Method</label>
              <select id="admin-expense-method" class="form-control" required>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="credit_card">Credit Card</option>
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label>Receipt Number (Optional)</label>
            <input type="text" id="admin-expense-receipt" class="form-control" placeholder="Receipt #">
          </div>
          
          <div class="form-group">
            <label>Notes</label>
            <textarea id="admin-expense-notes" class="form-control" rows="2" placeholder="Additional notes..."></textarea>
          </div>
          
          <button type="submit" class="btn btn-primary">Save Expense</button>
        </form>
      </div>
    </div>
    
    <!-- Add/Edit Category Modal -->
    <div id="admin-category-modal" class="modal" style="display: none;">
      <div class="modal-content">
        <div class="modal-close" onclick="closeModal('admin-category-modal')">×</div>
        <h2 id="category-modal-title">Add Expense Category</h2>
        
        <form onsubmit="adminSaveCategory(event)">
          <input type="hidden" id="category-id">
          
          <div class="form-group">
            <label>Category Name</label>
            <input type="text" id="category-name" class="form-control" placeholder="e.g., Office Supplies" required>
          </div>
          
          <div class="form-group">
            <label>Description</label>
            <textarea id="category-description" class="form-control" rows="3" placeholder="Describe what expenses belong in this category..."></textarea>
          </div>
          
          <div class="form-group">
            <label>
              <input type="checkbox" id="category-active" checked>
              Active
            </label>
          </div>
          
          <button type="submit" class="btn btn-primary">Save Category</button>
        </form>
      </div>
    </div>
  `;
  
  // Set default date to today
  document.getElementById('admin-expense-date').valueAsDate = new Date();
}

// ===================== SALESMAN VIEW (LIMITED ACCESS) =====================
function renderSalesmanExpenseView(container, expenses, categories) {
  container.innerHTML = `
    <div class="expense-container">
      <div class="page-header">
        <div>
          <h1>💸 Record Expenses</h1>
          <p class="text-muted">Record your daily operational expenses</p>
        </div>
        <button class="btn btn-primary" onclick="salesmanOpenExpenseModal()">+ Record Expense</button>
      </div>
      
      <!-- My Expenses -->
      <div class="section">
        <h3>My Recorded Expenses</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${expenses.filter(exp => true).length === 0 
              ? '<tr><td colspan="5" class="text-center">No expenses recorded</td></tr>'
              : expenses.map(exp => `
                <tr>
                  <td>${new Date(exp.expense_date).toLocaleDateString()}</td>
                  <td>${exp.expense_categories?.category_name || 'Uncategorized'}</td>
                  <td>${exp.description}</td>
                  <td>₦${parseFloat(exp.amount).toFixed(2)}</td>
                  <td>
                    <span class="badge ${exp.is_approved ? 'badge-success' : 'badge-secondary'}">
                      ${exp.is_approved ? '✓ Approved' : 'Pending'}
                    </span>
                  </td>
                </tr>
              `).join('')
            }
          </tbody>
        </table>
      </div>
    </div>
    
    <!-- Record Expense Modal -->
    <div id="salesman-expense-modal" class="modal" style="display: none;">
      <div class="modal-content">
        <div class="modal-close" onclick="closeModal('salesman-expense-modal')">×</div>
        <h2>Record Expense</h2>
        
        <form onsubmit="salesmanSaveExpense(event)">
          <div class="form-row">
            <div class="form-group">
              <label>Date</label>
              <input type="date" id="salesman-expense-date" class="form-control" required>
            </div>
            <div class="form-group">
              <label>Category</label>
              <select id="salesman-expense-category" class="form-control" required>
                <option value="">-- Select Category --</option>
                ${categories.map(cat => `<option value="${cat.id}">${cat.category_name}</option>`).join('')}
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label>Description</label>
            <input type="text" id="salesman-expense-description" class="form-control" placeholder="What is this expense for?" required>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label>Amount (₦)</label>
              <input type="number" id="salesman-expense-amount" class="form-control" step="0.01" min="0" required>
            </div>
            <div class="form-group">
              <label>Payment Method</label>
              <select id="salesman-expense-method" class="form-control" required>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="check">Check</option>
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label>Receipt Number (Optional)</label>
            <input type="text" id="salesman-expense-receipt" class="form-control" placeholder="Receipt #">
          </div>
          
          <button type="submit" class="btn btn-primary">Submit Expense</button>
        </form>
      </div>
    </div>
  `;
  
  // Set default date to today
  document.getElementById('salesman-expense-date').valueAsDate = new Date();
}

// ===================== ADMIN FUNCTIONS =====================
window.adminSwitchTab = function(tab) {
  document.querySelectorAll('[id$="-tab"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(tab + '-tab').style.display = 'block';
  event.target.classList.add('active');
};

window.adminOpenExpenseModal = function() {
  document.getElementById('admin-expense-date').valueAsDate = new Date();
  document.getElementById('admin-expense-modal').style.display = 'block';
};

window.adminOpenCategoryModal = function() {
  document.getElementById('category-id').value = '';
  document.getElementById('category-modal-title').textContent = 'Add Expense Category';
  document.getElementById('category-name').value = '';
  document.getElementById('category-description').value = '';
  document.getElementById('category-active').checked = true;
  document.getElementById('admin-category-modal').style.display = 'block';
};

window.adminEditCategory = function(catId, catName, catDesc) {
  document.getElementById('category-id').value = catId;
  document.getElementById('category-modal-title').textContent = 'Edit Expense Category';
  document.getElementById('category-name').value = catName;
  document.getElementById('category-description').value = catDesc;
  document.getElementById('category-active').checked = true;
  document.getElementById('admin-category-modal').style.display = 'block';
};

window.adminSaveExpense = async function(event) {
  event.preventDefault();
  try {
    const { data: userData } = await supabase.auth.getUser();
    
    const expense = {
      expense_date: document.getElementById('admin-expense-date').value,
      category_id: document.getElementById('admin-expense-category').value,
      description: document.getElementById('admin-expense-description').value,
      amount: parseFloat(document.getElementById('admin-expense-amount').value),
      payment_method: document.getElementById('admin-expense-method').value,
      receipt_number: document.getElementById('admin-expense-receipt').value || null,
      notes: document.getElementById('admin-expense-notes').value || null,
      pharmacy_id: currentPharmacyId,
      branch_id: currentBranchId,
      created_by: userData.user.id
    };
    
    await createExpense(expense);
    alert('Expense recorded successfully!');
    closeModal('admin-expense-modal');
    location.reload();
  } catch (error) {
    console.error('Error saving expense:', error);
    alert('Error: ' + error.message);
  }
};

window.adminSaveCategory = async function(event) {
  event.preventDefault();
  try {
    const categoryId = document.getElementById('category-id').value;
    const categoryName = document.getElementById('category-name').value;
    const categoryDesc = document.getElementById('category-description').value;
    const isActive = document.getElementById('category-active').checked;
    
    if (categoryId) {
      // Update existing
      await updateExpenseCategory(categoryId, {
        category_name: categoryName,
        description: categoryDesc,
        is_active: isActive
      });
      alert('Category updated successfully!');
    } else {
      // Create new
      await createExpenseCategory({
        pharmacy_id: currentPharmacyId,
        category_name: categoryName,
        description: categoryDesc,
        is_active: isActive
      });
      alert('Category created successfully!');
    }
    closeModal('admin-category-modal');
    location.reload();
  } catch (error) {
    console.error('Error saving category:', error);
    alert('Error: ' + error.message);
  }
};

window.adminDeleteCategory = async function(catId) {
  if (!confirm('Are you sure you want to delete this category?')) return;
  try {
    await deleteExpenseCategory(catId);
    alert('Category deleted successfully!');
    location.reload();
  } catch (error) {
    console.error('Error deleting category:', error);
    alert('Error: ' + error.message);
  }
};

window.adminApproveExpense = async function(expenseId) {
  try {
    const { data: userData } = await supabase.auth.getUser();
    await approveExpense(expenseId, userData.user.id);
    alert('Expense approved!');
    location.reload();
  } catch (error) {
    console.error('Error approving expense:', error);
    alert('Error: ' + error.message);
  }
};

window.adminDeleteExpense = async function(expenseId) {
  if (!confirm('Are you sure you want to delete this expense?')) return;
  try {
    await updateExpense(expenseId, { is_approved: false });
    alert('Expense deleted!');
    location.reload();
  } catch (error) {
    console.error('Error deleting expense:', error);
    alert('Error: ' + error.message);
  }
};

// ===================== SALESMAN FUNCTIONS =====================
window.salesmanOpenExpenseModal = function() {
  document.getElementById('salesman-expense-date').valueAsDate = new Date();
  document.getElementById('salesman-expense-modal').style.display = 'block';
};

window.salesmanSaveExpense = async function(event) {
  event.preventDefault();
  try {
    const { data: userData } = await supabase.auth.getUser();
    
    const expense = {
      expense_date: document.getElementById('salesman-expense-date').value,
      category_id: document.getElementById('salesman-expense-category').value,
      description: document.getElementById('salesman-expense-description').value,
      amount: parseFloat(document.getElementById('salesman-expense-amount').value),
      payment_method: document.getElementById('salesman-expense-method').value,
      receipt_number: document.getElementById('salesman-expense-receipt').value || null,
      pharmacy_id: currentPharmacyId,
      branch_id: currentBranchId,
      created_by: userData.user.id
    };
    
    await createExpense(expense);
    alert('Expense submitted for approval!');
    closeModal('salesman-expense-modal');
    location.reload();
  } catch (error) {
    console.error('Error saving expense:', error);
    alert('Error: ' + error.message);
  }
};

// ===================== COMMON FUNCTIONS =====================
window.closeModal = function(modalId) {
  document.getElementById(modalId).style.display = 'none';
};
