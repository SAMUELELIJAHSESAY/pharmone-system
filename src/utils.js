// Global currency storage
window.pharmacySettings = window.pharmacySettings || { 
  currency_symbol: 'Le', 
  currency_code: 'NLE' 
};

export function formatCurrency(amount) {
  const symbol = window.pharmacySettings?.currency_symbol || 'Le';
  const formatted = new Intl.NumberFormat('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }).format(amount || 0);
  return `${symbol}${formatted}`;
}

export function formatCurrencyWithSettings(amount, currencyCode = 'USD', currencySymbol = '$') {
  const formatted = new Intl.NumberFormat('en-US', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
  return `${currencySymbol}${formatted}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  // Parse as UTC and display without timezone conversion
  const date = new Date(dateStr);
  return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD in UTC
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  // Parse as UTC and display without timezone conversion
  // This ensures all users see the same time regardless of browser timezone
  const date = new Date(dateStr);
  const isoString = date.toISOString(); // Already in UTC
  const [datePart, timePart] = isoString.split('T');
  const [year, month, day] = datePart.split('-');
  const [hours, minutes] = timePart.split(':');
  
  // Format as: Apr 21, 10:30 (UTC)
  const monthName = new Date(isoString).toLocaleDateString('en-US', { month: 'short' });
  return `${monthName} ${parseInt(day)}, ${hours}:${minutes}`;
}

/**
 * Format date/time consistently in UTC for all users
 * Use this instead of new Date().toLocaleString() to ensure consistency
 */
export function formatUTCDateTime(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  const iso = date.toISOString();
  const [datePart, timePart] = iso.split('T');
  const [year, month, day] = datePart.split('-');
  const [hours, minutes, seconds] = timePart.split(':');
  const monthNum = parseInt(month);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[monthNum - 1]} ${parseInt(day)}, ${hours}:${minutes}:${seconds.split('.')[0]}`;
}

/**
 * Format just time in UTC
 * Use this instead of new Date().toLocaleTimeString()
 */
export function formatUTCTime(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  const iso = date.toISOString();
  const timePart = iso.split('T')[1];
  const [hours, minutes, seconds] = timePart.split(':');
  return `${hours}:${minutes}:${seconds.split('.')[0]}`;
}

/**
 * Format just date in UTC
 * Use this instead of new Date().toLocaleDateString()
 */
export function formatUTCDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  const iso = date.toISOString();
  const [datePart] = iso.split('T');
  const [year, month, day] = datePart.split('-');
  const monthNum = parseInt(month);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[monthNum - 1]} ${parseInt(day)}, ${year}`;
}

export function showToast(message, type = 'success') {
  const existing = document.getElementById('toast-container');
  if (!existing) {
    const container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span>${message}</span>
  `;
  document.getElementById('toast-container').appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

export function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <p>${message}</p>
        <div class="confirm-actions">
          <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
          <button class="btn btn-danger" id="confirm-ok">Confirm</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('show'), 10);
    overlay.querySelector('#confirm-ok').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#confirm-cancel').onclick = () => { overlay.remove(); resolve(false); };
  });
}

export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

export function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

export function isExpiringSoon(dateStr, days = 30) {
  if (!dateStr) return false;
  const expiry = new Date(dateStr);
  const now = new Date();
  const diff = (expiry - now) / (1000 * 60 * 60 * 24);
  return diff <= days && diff >= 0;
}

export function isExpired(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}
