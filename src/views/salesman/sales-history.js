// Salesman Sales History View - View receipts printed and detailed sales information
import { getSales, enrichSalesWithItems, getPharmacySettings, getBranchDetails } from '../../database.js';
import { formatCurrency, formatDate, showToast, formatUTCDate, formatUTCTime, formatUTCDateTime } from '../../utils.js';

export async function renderSalesHistory(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;
  const branchId = user?.profile?.branch_id;
  const userId = user?.id;

  if (!pharmacyId) {
    container.innerHTML = `<div class="alert alert-warning">No pharmacy linked to your account.</div>`;
    return;
  }

  try {
    // Ensure pharmacy settings are loaded
    if (!window.pharmacySettings?.currency_symbol) {
      const settings = await getPharmacySettings(pharmacyId);
      window.pharmacySettings = settings || { currency_symbol: 'Le', currency_code: 'NLE' };
    }

    // Get all sales for this salesman (only sales they created)
    const allSalesData = await getSales(pharmacyId, 1000);
    const salesmanSalesData = allSalesData.filter(s => 
      s.created_by === userId
    );
    
    // Enrich with sale items
    const salesmanSales = await enrichSalesWithItems(salesmanSalesData);

    renderSalesHistoryView(container, salesmanSales, user, pharmacyId, branchId);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load sales history: ${err.message}</div>`;
  }
}

function renderSalesHistoryView(container, sales, user, pharmacyId, branchId) {
  let searchTerm = '';
  let filterStatus = 'all'; // all, printed, saved
  let sortBy = 'date'; // date, amount

  const mainContent = container;

  function renderView() {
    let filteredSales = [...sales];

    // Search filter
    if (searchTerm) {
      filteredSales = filteredSales.filter(s =>
        s.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.customers?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.total_amount.toString().includes(searchTerm)
      );
    }

    // Status filter
    if (filterStatus === 'printed') {
      filteredSales = filteredSales.filter(s => s.receipt_printed_at);
    } else if (filterStatus === 'saved') {
      filteredSales = filteredSales.filter(s => s.receipt_saved_at);
    }

    // Sorting
    if (sortBy === 'date') {
      filteredSales.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sortBy === 'amount') {
      filteredSales.sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount));
    }

    const currencySymbol = window.pharmacySettings?.currency_symbol || 'Le';

    mainContent.innerHTML = `
      <div class="animate-in">
        <div class="page-header">
          <div>
            <div class="page-title">📋 My Sales History</div>
            <div class="page-subtitle">View receipts you printed and detailed sales information</div>
          </div>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-ghost" id="export-csv-btn" onclick="window.exportSalesAsCSV()">📥 Export CSV</button>
            <button class="btn btn-ghost" id="export-pdf-btn" onclick="window.exportSalesAsPDF()">📄 Export PDF</button>
          </div>
        </div>

        <!-- Statistics Cards -->
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Sales</span>
              <div class="stat-card-icon teal">📊</div>
            </div>
            <div class="stat-card-value">${filteredSales.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Total Revenue</span>
              <div class="stat-card-icon emerald">💰</div>
            </div>
            <div class="stat-card-value">${currencySymbol}${filteredSales.reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0).toFixed(2)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Printed</span>
              <div class="stat-card-icon blue">🖨️</div>
            </div>
            <div class="stat-card-value">${filteredSales.filter(s => s.receipt_printed_at).length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">Saved Only</span>
              <div class="stat-card-icon purple">💾</div>
            </div>
            <div class="stat-card-value">${filteredSales.filter(s => s.receipt_saved_at && !s.receipt_printed_at).length}</div>
          </div>
        </div>

        <!-- Filters & Search -->
        <div class="card" style="margin-bottom:1.5rem">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem">
            <div class="form-group" style="margin:0">
              <label class="form-label">Search</label>
              <input type="text" class="form-control" id="search-input" placeholder="Invoice #, customer, amount..." onkeyup="window.updateSalesHistory()">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Filter by Status</label>
              <select class="form-control" id="filter-status" onchange="window.updateSalesHistory()">
                <option value="all">All Sales</option>
                <option value="printed">Printed Only</option>
                <option value="saved">Saved Only</option>
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Sort By</label>
              <select class="form-control" id="sort-by" onchange="window.updateSalesHistory()">
                <option value="date">Date (Newest First)</option>
                <option value="amount">Amount (Highest First)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Sales Table -->
        <div class="card">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Payment Method</th>
                  <th>Status</th>
                  <th>Date & Time</th>
                  <th style="text-align:center">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${filteredSales.length === 0 ? `
                  <tr>
                    <td colspan="8" style="text-align:center;padding:2rem">
                      <div style="color:var(--gray-500)">No sales found</div>
                    </td>
                  </tr>
                ` : filteredSales.map(sale => {
                  const itemCount = (sale.sale_items || []).length;
                  const isPrinted = sale.receipt_printed_at;
                  const isSaved = sale.receipt_saved_at;
                  
                  return `
                    <tr>
                      <td><strong>${sale.invoice_number}</strong></td>
                      <td>${sale.customers?.name || 'Walk-in'}</td>
                      <td><span class="badge bg-blue">${itemCount} item${itemCount !== 1 ? 's' : ''}</span></td>
                      <td><strong>${currencySymbol}${parseFloat(sale.total_amount).toFixed(2)}</strong></td>
                      <td>${sale.payment_method?.replace(/_/g, ' ').toUpperCase() || '-'}</td>
                      <td>
                        <div style="display:flex;gap:0.25rem">
                          ${isPrinted ? '<span class="badge bg-blue">🖨️ Printed</span>' : ''}
                          ${isSaved && !isPrinted ? '<span class="badge bg-success">💾 Saved</span>' : ''}
                          ${isPrinted && isSaved ? '<span class="badge bg-emerald">✓ Both</span>' : ''}
                        </div>
                      </td>
                      <td style="font-size:0.9rem">
                        <div>${formatUTCDate(sale.created_at)}</div>
                        <div style="color:var(--gray-500)">${formatUTCTime(sale.created_at)}</div>
                      </td>
                      <td style="text-align:center">
                        <button class="btn btn-sm btn-ghost" onclick="window.viewSaleReceipt('${sale.id}')" title="View Receipt Details">
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
      </div>

      <!-- Sale Receipt Modal -->
      <div id="receiptModal" class="modal" style="display:none">
        <div class="modal-content" style="max-width:600px">
          <div class="modal-header">
            <h2 class="modal-title">Receipt Details</h2>
            <button class="modal-close" onclick="window.closeReceiptModal()">✕</button>
          </div>
          <div class="modal-body" style="max-height:70vh;overflow-y:auto">
            <!-- Receipt will be rendered here -->
            <div id="receipt-content" style="background:white;padding:1.5rem;border-radius:var(--radius);font-family:monospace;font-size:0.9rem;line-height:1.6">
              Loading...
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="window.closeReceiptModal()">Close</button>
            <button class="btn btn-primary" onclick="window.printReceipt()">🖨️ Print</button>
          </div>
        </div>
      </div>
    `;

    // Setup event listeners
    document.getElementById('search-input').value = searchTerm;
    document.getElementById('filter-status').value = filterStatus;
    document.getElementById('sort-by').value = sortBy;

    // Make functions global for onclick handlers
    window.updateSalesHistory = () => {
      searchTerm = document.getElementById('search-input').value;
      filterStatus = document.getElementById('filter-status').value;
      sortBy = document.getElementById('sort-by').value;
      renderView();
    };

    window.viewSaleReceipt = async (saleId) => {
      const sale = sales.find(s => s.id === saleId);
      if (!sale) {
        showToast('Receipt not found', 'error');
        return;
      }

      const items = sale.sale_items || [];
      const currencySymbol = window.pharmacySettings?.currency_symbol || 'Le';
      
      if (!items.length) {
        showToast('No items found in this sale', 'warning');
      }

      // Fetch branch details for receipt header
      let branchDetails = {};
      if (sale.branch_id) {
        try {
          branchDetails = await getBranchDetails(sale.branch_id);
        } catch (err) {
          console.error('Failed to load branch details:', err);
        }
      }
      
      const branchName = branchDetails?.name || 'Pharmacy';
      const branchAddress = branchDetails?.address || '';
      const branchEmail = branchDetails?.email || '';

      let receiptHTML = `
        <div style="text-align:center;margin-bottom:1rem;border-bottom:1px dashed;padding-bottom:1rem">
          <div style="font-weight:bold;font-size:1rem">${branchName}</div>
          ${branchAddress ? `<div style="font-size:0.8rem;margin-bottom:0.25rem">${branchAddress}</div>` : ''}
          ${branchEmail ? `<div style="font-size:0.8rem;margin-bottom:0.5rem">${branchEmail}</div>` : ''}
          <div style="font-weight:bold;font-size:1.1rem;margin-top:0.5rem">RECEIPT</div>
          <div style="font-size:0.9rem;color:var(--gray-600)">${sale.invoice_number}</div>
        </div>

        <div style="margin-bottom:1rem;font-size:0.85rem">
          <div><strong>Date:</strong> ${formatUTCDate(sale.created_at)}</div>
          <div><strong>Time:</strong> ${formatUTCTime(sale.created_at)}</div>
          <div><strong>Cashier:</strong> ${user.profile?.full_name || 'N/A'}</div>
          <div><strong>Customer:</strong> ${sale.customers?.name || 'Walk-in'}</div>
        </div>

        <div style="border-top:1px dashed;border-bottom:1px dashed;padding:0.75rem 0;margin:1rem 0;font-size:0.85rem">
          <div style="display:flex;justify-content:space-between;font-weight:bold">
            <span>ITEM</span>
            <span>QTY</span>
            <span>PRICE</span>
            <span>TOTAL</span>
          </div>
          ${items.map(item => `
            <div style="display:flex;justify-content:space-between;margin-top:0.5rem">
              <span style="flex:1">${item.product_name}</span>
              <span style="width:50px;text-align:center">${item.quantity}</span>
              <span style="width:70px;text-align:right">${currencySymbol}${parseFloat(item.unit_price).toFixed(2)}</span>
              <span style="width:70px;text-align:right">${currencySymbol}${parseFloat(item.total_price).toFixed(2)}</span>
            </div>
          `).join('')}
        </div>

        <div style="font-size:0.85rem;margin:1rem 0">
          <div style="display:flex;justify-content:space-between;padding:0.25rem 0">
            <span>Subtotal:</span>
            <strong>${currencySymbol}${items.reduce((sum, i) => sum + parseFloat(i.total_price), 0).toFixed(2)}</strong>
          </div>
          ${sale.discount > 0 ? `
            <div style="display:flex;justify-content:space-between;padding:0.25rem 0;color:var(--green-600)">
              <span>Discount:</span>
              <strong>-${currencySymbol}${parseFloat(sale.discount).toFixed(2)}</strong>
            </div>
          ` : ''}
          <div style="display:flex;justify-content:space-between;padding:0.25rem 0;font-weight:bold;font-size:1rem;border-top:1px solid;margin-top:0.5rem;padding-top:0.5rem">
            <span>TOTAL:</span>
            <strong>${currencySymbol}${parseFloat(sale.total_amount).toFixed(2)}</strong>
          </div>
        </div>

        <div style="margin-top:1rem;padding:0.75rem;background:var(--blue-50);border-radius:var(--radius-sm);font-size:0.85rem">
          <strong>Payment Method:</strong> ${sale.payment_method?.replace(/_/g, ' ').toUpperCase()}<br>
          <strong>Status:</strong> ${sale.status?.toUpperCase()}
        </div>

        ${sale.receipt_printed_at ? `
          <div style="margin-top:0.75rem;padding:0.5rem;background:var(--blue-50);border-radius:var(--radius-sm);font-size:0.8rem;text-align:center;color:var(--blue-700)">
            🖨️ Printed: ${formatUTCDateTime(sale.receipt_printed_at)}
          </div>
        ` : ''}

        ${sale.receipt_saved_at ? `
          <div style="margin-top:0.5rem;padding:0.5rem;background:var(--green-50);border-radius:var(--radius-sm);font-size:0.8rem;text-align:center;color:var(--green-700)">
            💾 Saved: ${formatUTCDateTime(sale.receipt_saved_at)}
          </div>
        ` : ''}

        <div style="margin-top:1rem;text-align:center;border-top:1px dashed;padding-top:1rem;font-size:0.75rem;color:var(--gray-500)">
          Thank you for visiting, ${branchName}!
        </div>
      `;

      const modal = document.getElementById('receiptModal');
      if (!modal) {
        showToast('Receipt modal not found', 'error');
        return;
      }
      document.getElementById('receipt-content').innerHTML = receiptHTML;
      modal.style.display = 'flex';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.right = '0';
      modal.style.bottom = '0';
      modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
      modal.style.zIndex = '9999';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
    };

    window.closeReceiptModal = () => {
      const modal = document.getElementById('receiptModal');
      if (modal) {
        modal.style.display = 'none';
      }
    };
    
    // Close modal when clicking outside
    document.addEventListener('click', (e) => {
      const modal = document.getElementById('receiptModal');
      if (modal && e.target === modal) {
        window.closeReceiptModal();
      }
    });

    window.printReceipt = () => {
      const content = document.getElementById('receipt-content').innerHTML;
      const printWindow = window.open('', '', 'height=400,width=600');
      printWindow.document.write(`<html><head><title>Receipt</title><style>
        body { font-family: monospace; font-size: 12px; margin: 0; padding: 10px; }
        * { margin: 0; padding: 0; }
      </style></head><body>${content}</body></html>`);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 100);
    };

    window.exportSalesAsCSV = () => {
      const rows = [];
      rows.push(['Invoice #', 'Customer', 'Items', 'Total', 'Payment Method', 'Status', 'Date', 'Time'].join(','));
      
      filteredSales.forEach(sale => {
        const itemCount = (sale.sale_items || []).length;
        rows.push([
          sale.invoice_number,
          sale.customers?.name || 'Walk-in',
          itemCount,
          sale.total_amount,
          sale.payment_method || '-',
          sale.status,
          new Date(sale.created_at).toLocaleDateString(),
          new Date(sale.created_at).toLocaleTimeString()
        ].join(','));
      });

      const csv = rows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sales-history-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    };

    window.exportSalesAsPDF = () => {
      showToast('PDF export coming soon', 'info');
    };
  }

  renderView();
}
