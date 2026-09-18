const DB_NAME = 'sammia-pharm-offline';
const DB_VERSION = 2;

let dbPromise = null;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
  });
}

function openDatabase() {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('This browser does not support offline storage.'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('pos_bootstrap')) {
        const store = db.createObjectStore('pos_bootstrap', { keyPath: 'scope' });
        store.createIndex('user_pharmacy_key', 'user_pharmacy_key', { unique: false });
      }

      if (!db.objectStoreNames.contains('pos_products')) {
        const store = db.createObjectStore('pos_products', { keyPath: 'key' });
        store.createIndex('scope', 'scope', { unique: false });
      }

      if (!db.objectStoreNames.contains('pos_customers')) {
        const store = db.createObjectStore('pos_customers', { keyPath: 'key' });
        store.createIndex('scope', 'scope', { unique: false });
      }

      if (!db.objectStoreNames.contains('pending_pos_sales')) {
        const store = db.createObjectStore('pending_pos_sales', { keyPath: 'client_transaction_id' });
        store.createIndex('scope', 'scope', { unique: false });
        store.createIndex('user_id', 'user_id', { unique: false });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }

      if (!db.objectStoreNames.contains('sync_meta')) {
        db.createObjectStore('sync_meta', { keyPath: 'scope' });
      }


      if (!db.objectStoreNames.contains('inventory_bootstrap')) {
        db.createObjectStore('inventory_bootstrap', { keyPath: 'user_pharmacy_key' });
      }

      if (!db.objectStoreNames.contains('pending_inventory_ops')) {
        const store = db.createObjectStore('pending_inventory_ops', { keyPath: 'operation_id' });
        store.createIndex('scope', 'scope', { unique: false });
        store.createIndex('user_id', 'user_id', { unique: false });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }

      if (!db.objectStoreNames.contains('inventory_conflicts')) {
        const store = db.createObjectStore('inventory_conflicts', { keyPath: 'local_conflict_id' });
        store.createIndex('scope', 'scope', { unique: false });
        store.createIndex('user_id', 'user_id', { unique: false });
        store.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('Could not open offline database.'));
    };
  });

  return dbPromise;
}

export function makeOfflineScope(userId, pharmacyId, branchId) {
  return [userId || 'user', pharmacyId || 'pharmacy', branchId || 'branch'].join('|');
}

export function makeUserPharmacyKey(userId, pharmacyId) {
  return [userId || 'user', pharmacyId || 'pharmacy'].join('|');
}

function productKey(scope, productId) {
  return `${scope}|${productId}`;
}

function customerKey(scope, customerId) {
  return `${scope}|${customerId}`;
}

function normalizeProductForCache(scope, product, existing = null) {
  const unitsPerBox = Math.max(1, Number(product.units_per_box || existing?.units_per_box || 1));
  const serverBoxes = Number(product.server_stock_boxes ?? product.stock_boxes ?? existing?.server_stock_boxes ?? 0);
  const serverUnits = Number(product.server_stock_units ?? product.stock_units ?? existing?.server_stock_units ?? 0);
  const pendingPatch = { ...(existing?.pending_metadata_patch || {}) };
  const delta = Number(existing?.pending_delta_units || product.pending_delta_units || 0);
  const serverTotal = Math.max(0, (serverBoxes * unitsPerBox) + serverUnits);
  const adjustedTotal = Math.max(0, serverTotal + delta);
  const merged = { ...product, ...pendingPatch };

  return {
    ...merged,
    key: productKey(scope, product.id),
    scope,
    server_stock_boxes: serverBoxes,
    server_stock_units: serverUnits,
    pending_delta_units: delta,
    pending_metadata_patch: pendingPatch,
    offline_created: Boolean(existing?.offline_created),
    offline_status: existing?.offline_status || '',
    stock_boxes: Math.floor(adjustedTotal / unitsPerBox),
    stock_units: adjustedTotal % unitsPerBox,
    cached_at: new Date().toISOString()
  };
}

export async function cachePOSBootstrap({ userId, pharmacyId, branchId, settings, branchDetails, categories = [], customers = [], heldSales = [], recentSales = [] }) {
  const db = await openDatabase();
  const scope = makeOfflineScope(userId, pharmacyId, branchId);

  // Read keys first, then open a fresh write transaction. This avoids keeping an
  // IndexedDB read/write transaction idle across awaited requests on Safari.
  const readTx = db.transaction('pos_customers', 'readonly');
  const existingCustomerKeys = await requestToPromise(readTx.objectStore('pos_customers').index('scope').getAllKeys(scope));
  await transactionDone(readTx);

  const transaction = db.transaction(['pos_bootstrap', 'pos_customers'], 'readwrite');
  const bootstrapStore = transaction.objectStore('pos_bootstrap');
  const customerStore = transaction.objectStore('pos_customers');

  bootstrapStore.put({
    scope,
    user_pharmacy_key: makeUserPharmacyKey(userId, pharmacyId),
    user_id: userId,
    pharmacy_id: pharmacyId,
    branch_id: branchId,
    settings: settings || null,
    branch_details: branchDetails || null,
    categories: Array.isArray(categories) ? categories : [],
    held_sales: Array.isArray(heldSales) ? heldSales : [],
    recent_sales: Array.isArray(recentSales) ? recentSales : [],
    cached_at: new Date().toISOString()
  });
  existingCustomerKeys.forEach((key) => customerStore.delete(key));
  (customers || []).forEach((customer) => {
    if (!customer?.id) return;
    customerStore.put({ ...customer, key: customerKey(scope, customer.id), scope, cached_at: new Date().toISOString() });
  });

  await transactionDone(transaction);
  return scope;
}

export async function getCachedPOSBootstrap(userId, pharmacyId) {
  const db = await openDatabase();
  const bootstrapTx = db.transaction('pos_bootstrap', 'readonly');
  const userPharmacyKey = makeUserPharmacyKey(userId, pharmacyId);
  const rows = await requestToPromise(bootstrapTx.objectStore('pos_bootstrap').index('user_pharmacy_key').getAll(userPharmacyKey));
  await transactionDone(bootstrapTx);
  const bootstrap = (rows || []).sort((a, b) => String(b.cached_at || '').localeCompare(String(a.cached_at || '')))[0] || null;
  if (!bootstrap) return null;

  const customerTx = db.transaction('pos_customers', 'readonly');
  const customers = await requestToPromise(customerTx.objectStore('pos_customers').index('scope').getAll(bootstrap.scope));
  await transactionDone(customerTx);
  return { ...bootstrap, customers: (customers || []).map(({ key, scope, cached_at, ...customer }) => customer) };
}

export async function mergeCachedPOSProducts(scope, products = []) {
  if (!scope || !products.length) return;
  const db = await openDatabase();
  const readTx = db.transaction('pos_products', 'readonly');
  const readStore = readTx.objectStore('pos_products');
  const existing = await Promise.all(products.map((product) => requestToPromise(readStore.get(productKey(scope, product.id)))));
  await transactionDone(readTx);

  const transaction = db.transaction('pos_products', 'readwrite');
  const store = transaction.objectStore('pos_products');
  products.forEach((product, index) => {
    if (!product?.id) return;
    store.put(normalizeProductForCache(scope, product, existing[index] || null));
  });
  await transactionDone(transaction);
}

export async function replaceCachedPOSProducts(scope, products = []) {
  if (!scope) return;
  const db = await openDatabase();
  const readTx = db.transaction('pos_products', 'readonly');
  const existingRows = await requestToPromise(readTx.objectStore('pos_products').index('scope').getAll(scope));
  await transactionDone(readTx);

  const existingById = new Map((existingRows || []).map((row) => [row.id, row]));
  const nextIds = new Set((products || []).map((row) => row?.id).filter(Boolean));
  const transaction = db.transaction('pos_products', 'readwrite');
  const store = transaction.objectStore('pos_products');
  for (const row of existingRows || []) {
    const hasLocalWork = Boolean(row.offline_created)
      || Number(row.pending_delta_units || 0) !== 0
      || Object.keys(row.pending_metadata_patch || {}).length > 0
      || row.offline_status === 'conflict';
    if (!nextIds.has(row.id) && !hasLocalWork) store.delete(row.key);
  }
  for (const product of products || []) {
    if (!product?.id) continue;
    store.put(normalizeProductForCache(scope, product, existingById.get(product.id) || null));
  }
  await transactionDone(transaction);
}

export async function queryCachedPOSProducts(scope, { page = 1, pageSize = 24, search = '', category = '', inStockOnly = true } = {}) {
  const db = await openDatabase();
  const transaction = db.transaction('pos_products', 'readonly');
  const rows = await requestToPromise(transaction.objectStore('pos_products').index('scope').getAll(scope));
  await transactionDone(transaction);

  const term = String(search || '').trim().toLowerCase();
  const filtered = (rows || [])
    .filter((product) => !category || product.category === category)
    .filter((product) => {
      if (!term) return true;
      return [product.name, product.category, product.description]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .filter((product) => {
      if (!inStockOnly) return true;
      const unitsPerBox = Math.max(1, Number(product.units_per_box || 1));
      return (Number(product.stock_boxes || 0) * unitsPerBox) + Number(product.stock_units || 0) > 0;
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const safePageSize = Math.max(12, Math.min(60, Number(pageSize) || 24));
  const safePage = Math.max(1, Number(page) || 1);
  const start = (safePage - 1) * safePageSize;
  return {
    products: filtered.slice(start, start + safePageSize),
    count: filtered.length,
    page: safePage,
    pageSize: safePageSize,
    offline: true
  };
}

export async function getCachedPOSProductsByIds(scope, ids = []) {
  const cleanIds = [...new Set((ids || []).filter(Boolean))].slice(0, 30);
  if (!scope || !cleanIds.length) return [];
  const db = await openDatabase();
  const transaction = db.transaction('pos_products', 'readonly');
  const store = transaction.objectStore('pos_products');
  const rows = await Promise.all(cleanIds.map((id) => requestToPromise(store.get(productKey(scope, id)))));
  await transactionDone(transaction);
  return rows.filter(Boolean);
}

export async function queueOfflinePOSSale(record, stockItems = []) {
  const db = await openDatabase();
  const transaction = db.transaction(['pending_pos_sales', 'pos_products'], 'readwrite');
  const saleStore = transaction.objectStore('pending_pos_sales');
  const productStore = transaction.objectStore('pos_products');

  const existingRequest = saleStore.get(record.client_transaction_id);
  const productRequests = stockItems.map((item) => productStore.get(productKey(record.scope, item.product_id)));
  const [existingSale, products] = await Promise.all([
    requestToPromise(existingRequest),
    Promise.all(productRequests.map(requestToPromise))
  ]);

  if (existingSale) {
    transaction.abort();
    await transactionDone(transaction).catch(() => {});
    return existingSale;
  }

  for (let index = 0; index < stockItems.length; index += 1) {
    const item = stockItems[index];
    const product = products[index];
    if (!product) {
      transaction.abort();
      await transactionDone(transaction).catch(() => {});
      throw new Error(`Offline stock cache is missing ${item.product_name || 'a product'}. Reconnect and refresh the POS first.`);
    }

    const unitsPerBox = Math.max(1, Number(product.units_per_box || 1));
    const currentTotal = (Number(product.stock_boxes || 0) * unitsPerBox) + Number(product.stock_units || 0);
    const requested = Math.max(0, Number(item.quantity || 0));
    if (requested > currentTotal) {
      transaction.abort();
      await transactionDone(transaction).catch(() => {});
      throw new Error(`Not enough cached stock for ${item.product_name || product.name}.`);
    }

    const adjustedTotal = currentTotal - requested;
    productStore.put({
      ...product,
      pending_delta_units: Number(product.pending_delta_units || 0) - requested,
      stock_boxes: Math.floor(adjustedTotal / unitsPerBox),
      stock_units: adjustedTotal % unitsPerBox,
      offline_stock_adjusted_at: new Date().toISOString()
    });
  }

  saleStore.put({
    ...record,
    status: record.status || 'pending',
    attempts: Number(record.attempts || 0),
    last_error: record.last_error || '',
    queued_at: record.queued_at || new Date().toISOString()
  });

  await transactionDone(transaction);
  window.dispatchEvent(new CustomEvent('sammia:offline-queue-changed', { detail: { scope: record.scope } }));
  return record;
}

export async function getPendingPOSSales({ userId = null, scope = null } = {}) {
  const db = await openDatabase();
  const transaction = db.transaction('pending_pos_sales', 'readonly');
  const store = transaction.objectStore('pending_pos_sales');
  let rows;
  if (scope) rows = await requestToPromise(store.index('scope').getAll(scope));
  else if (userId) rows = await requestToPromise(store.index('user_id').getAll(userId));
  else rows = await requestToPromise(store.getAll());
  await transactionDone(transaction);
  return (rows || [])
    .filter((row) => ['pending', 'retry', 'syncing'].includes(row.status))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

export async function markPendingPOSSaleRetry(clientTransactionId, errorMessage) {
  const db = await openDatabase();
  const readTx = db.transaction('pending_pos_sales', 'readonly');
  const record = await requestToPromise(readTx.objectStore('pending_pos_sales').get(clientTransactionId));
  await transactionDone(readTx);
  if (!record) return;

  const transaction = db.transaction('pending_pos_sales', 'readwrite');
  transaction.objectStore('pending_pos_sales').put({
    ...record,
    status: 'retry',
    attempts: Number(record.attempts || 0) + 1,
    last_error: String(errorMessage || '').slice(0, 500),
    last_attempt_at: new Date().toISOString()
  });
  await transactionDone(transaction);
}

export async function completePendingPOSSale(clientTransactionId, syncResult = {}) {
  const db = await openDatabase();
  const saleReadTx = db.transaction('pending_pos_sales', 'readonly');
  const record = await requestToPromise(saleReadTx.objectStore('pending_pos_sales').get(clientTransactionId));
  await transactionDone(saleReadTx);
  if (!record) return;

  const productReadTx = db.transaction('pos_products', 'readonly');
  const productStoreRead = productReadTx.objectStore('pos_products');
  const productRequests = (record.sale_items || []).map((item) => productStoreRead.get(productKey(record.scope, item.product_id)));
  const products = await Promise.all(productRequests.map(requestToPromise));
  await transactionDone(productReadTx);

  const transaction = db.transaction(['pending_pos_sales', 'pos_products', 'sync_meta'], 'readwrite');
  const saleStore = transaction.objectStore('pending_pos_sales');
  const productStore = transaction.objectStore('pos_products');
  const metaStore = transaction.objectStore('sync_meta');

  (record.sale_items || []).forEach((item, index) => {
    const product = products[index];
    if (!product) return;
    const unitsPerBox = Math.max(1, Number(product.units_per_box || 1));
    const syncedUnits = Math.max(0, Number(item.quantity || 0));
    const serverTotalBefore = (Number(product.server_stock_boxes ?? product.stock_boxes ?? 0) * unitsPerBox)
      + Number(product.server_stock_units ?? product.stock_units ?? 0);
    const serverTotalAfter = Math.max(0, serverTotalBefore - syncedUnits);
    const releasedDelta = Math.min(0, Number(product.pending_delta_units || 0) + syncedUnits);
    const adjustedTotal = Math.max(0, serverTotalAfter + releasedDelta);
    productStore.put({
      ...product,
      server_stock_boxes: Math.floor(serverTotalAfter / unitsPerBox),
      server_stock_units: serverTotalAfter % unitsPerBox,
      pending_delta_units: releasedDelta,
      stock_boxes: Math.floor(adjustedTotal / unitsPerBox),
      stock_units: adjustedTotal % unitsPerBox,
      last_synced_at: new Date().toISOString()
    });
  });
  saleStore.delete(clientTransactionId);
  metaStore.put({
    scope: record.scope,
    last_sync_at: new Date().toISOString(),
    last_synced_invoice: syncResult?.sale?.invoice_number || record.invoice_number || null,
    last_conflict_count: Number(syncResult?.conflict_count || 0),
    last_error: ''
  });

  await transactionDone(transaction);
  window.dispatchEvent(new CustomEvent('sammia:offline-queue-changed', { detail: { scope: record.scope } }));
}

export async function getSyncMeta(scope) {
  const db = await openDatabase();
  const transaction = db.transaction('sync_meta', 'readonly');
  const value = await requestToPromise(transaction.objectStore('sync_meta').get(scope));
  await transactionDone(transaction);
  return value || null;
}

export async function countCachedProducts(scope) {
  const db = await openDatabase();
  const transaction = db.transaction('pos_products', 'readonly');
  const count = await requestToPromise(transaction.objectStore('pos_products').index('scope').count(scope));
  await transactionDone(transaction);
  return Number(count || 0);
}

// ===================== OFFLINE INVENTORY =====================
export async function cacheInventoryBootstrap({ userId, pharmacyId, branches = [], settings = null }) {
  const db = await openDatabase();
  const userPharmacyKey = makeUserPharmacyKey(userId, pharmacyId);
  const transaction = db.transaction('inventory_bootstrap', 'readwrite');
  transaction.objectStore('inventory_bootstrap').put({
    user_pharmacy_key: userPharmacyKey,
    user_id: userId,
    pharmacy_id: pharmacyId,
    branches: Array.isArray(branches) ? branches : [],
    settings: settings || null,
    cached_at: new Date().toISOString()
  });
  await transactionDone(transaction);
  return userPharmacyKey;
}

export async function getCachedInventoryBootstrap(userId, pharmacyId) {
  const db = await openDatabase();
  const transaction = db.transaction('inventory_bootstrap', 'readonly');
  const value = await requestToPromise(transaction.objectStore('inventory_bootstrap').get(makeUserPharmacyKey(userId, pharmacyId)));
  await transactionDone(transaction);
  return value || null;
}

function inventoryProductMatches(product, { search = '', category = '', filterType = '' } = {}) {
  if (product?.is_active === false) return false;
  if (category && product.category !== category) return false;
  const term = String(search || '').trim().toLowerCase();
  if (term && ![product.name, product.category, product.description]
    .some((value) => String(value || '').toLowerCase().includes(term))) return false;

  const type = String(filterType || '');
  if (!type) return true;
  const boxes = Number(product.stock_boxes || 0);
  const threshold = Number(product.low_stock_threshold || 0);
  const expiry = product.expiry_date ? new Date(`${product.expiry_date}T00:00:00`) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = expiry ? Math.ceil((expiry.getTime() - today.getTime()) / 86400000) : null;

  if (type === 'low-stock') return boxes <= threshold;
  if (type === 'expired') return daysUntil !== null && daysUntil < 0;
  if (type === 'expiring-30') return daysUntil !== null && daysUntil >= 0 && daysUntil <= 30;
  if (type === 'expiring-60') return daysUntil !== null && daysUntil >= 0 && daysUntil <= 60;
  if (type === 'expiring-90') return daysUntil !== null && daysUntil >= 0 && daysUntil <= 90;
  if (type === 'no-expiry') return !product.expiry_date;
  return true;
}

function sortInventoryProducts(rows, sortType = '') {
  const list = [...rows];
  const number = (value) => Number(value || 0);
  if (sortType === 'selling-asc') return list.sort((a, b) => number(a.price) - number(b.price));
  if (sortType === 'selling-desc') return list.sort((a, b) => number(b.price) - number(a.price));
  if (sortType === 'cost-asc') return list.sort((a, b) => number(a.cost_price) - number(b.cost_price));
  if (sortType === 'cost-desc') return list.sort((a, b) => number(b.cost_price) - number(a.cost_price));
  if (sortType === 'margin-asc') return list.sort((a, b) => (number(a.price) - number(a.cost_price)) - (number(b.price) - number(b.cost_price)));
  if (sortType === 'margin-desc') return list.sort((a, b) => (number(b.price) - number(b.cost_price)) - (number(a.price) - number(a.cost_price)));
  if (sortType === 'stock-asc') return list.sort((a, b) => number(a.stock_boxes) - number(b.stock_boxes));
  if (sortType === 'stock-desc') return list.sort((a, b) => number(b.stock_boxes) - number(a.stock_boxes));
  if (sortType === 'expiry-asc') return list.sort((a, b) => String(a.expiry_date || '9999-12-31').localeCompare(String(b.expiry_date || '9999-12-31')));
  return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export async function queryCachedInventoryProducts(scope, options = {}) {
  const db = await openDatabase();
  const transaction = db.transaction('pos_products', 'readonly');
  const rows = await requestToPromise(transaction.objectStore('pos_products').index('scope').getAll(scope));
  await transactionDone(transaction);

  const activeRows = (rows || []).filter((product) => product?.is_active !== false);
  let filtered = activeRows.filter((product) => inventoryProductMatches(product, options));
  if (options.filterType === 'duplicates') {
    const counts = new Map();
    filtered.forEach((product) => {
      const key = String(product.name || '').trim().toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    filtered = filtered.filter((product) => counts.get(String(product.name || '').trim().toLowerCase()) > 1);
  }
  filtered = sortInventoryProducts(filtered, options.sortType || '');

  const pageSize = Math.max(10, Math.min(100, Number(options.pageSize) || 30));
  const page = Math.max(1, Number(options.page) || 1);
  const start = (page - 1) * pageSize;
  const categories = [...new Set(activeRows.map((product) => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const summary = activeRows.reduce((acc, product) => {
    acc.totalProducts += 1;
    if (Number(product.stock_boxes || 0) <= Number(product.low_stock_threshold || 0)) acc.lowStockCount += 1;
    if (product.expiry_date) {
      const expiry = new Date(`${product.expiry_date}T00:00:00`);
      const days = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
      if (days < 0) acc.expiredCount += 1;
      else if (days <= 30) acc.expiringSoonCount += 1;
    }
    return acc;
  }, { totalProducts: 0, lowStockCount: 0, expiredCount: 0, expiringSoonCount: 0 });

  return {
    products: filtered.slice(start, start + pageSize),
    count: filtered.length,
    page,
    pageSize,
    categories,
    summary,
    offline: true
  };
}

export async function getCachedInventoryProduct(scope, productId) {
  if (!scope || !productId) return null;
  const db = await openDatabase();
  const transaction = db.transaction('pos_products', 'readonly');
  const product = await requestToPromise(transaction.objectStore('pos_products').get(productKey(scope, productId)));
  await transactionDone(transaction);
  return product || null;
}

export async function queueOfflineInventoryOperation(record) {
  if (!record?.operation_id || !record?.scope || !record?.product_id) throw new Error('Offline inventory operation is incomplete.');
  const db = await openDatabase();
  const readTx = db.transaction('pos_products', 'readonly');
  const product = await requestToPromise(readTx.objectStore('pos_products').get(productKey(record.scope, record.product_id)));
  await transactionDone(readTx);

  const now = new Date().toISOString();
  const operation = {
    ...record,
    status: record.status || 'pending',
    attempts: Number(record.attempts || 0),
    last_error: record.last_error || '',
    created_at: record.created_at || now,
    queued_at: record.queued_at || now
  };

  const transaction = db.transaction(['pos_products', 'pending_inventory_ops'], 'readwrite');
  const productStore = transaction.objectStore('pos_products');
  const operationStore = transaction.objectStore('pending_inventory_ops');
  let storedOperation = operation;

  if (operation.operation_type === 'create_product') {
    const payload = { ...(operation.payload || {}), id: operation.product_id };
    const unitsPerBox = Math.max(1, Number(payload.units_per_box || 1));
    productStore.put({
      ...payload,
      key: productKey(operation.scope, operation.product_id),
      scope: operation.scope,
      server_stock_boxes: Number(payload.stock_boxes || 0),
      server_stock_units: Number(payload.stock_units || 0),
      pending_delta_units: 0,
      pending_metadata_patch: {},
      offline_created: true,
      offline_status: 'pending',
      metadata_version: Number(payload.metadata_version || 1),
      stock_boxes: Math.max(0, Number(payload.stock_boxes || 0)),
      stock_units: Math.max(0, Number(payload.stock_units || 0)) % unitsPerBox,
      cached_at: now
    });
    operationStore.put(storedOperation);
  } else if (operation.operation_type === 'update_product') {
    if (!product) throw new Error('This product is not available in the offline inventory cache.');
    const patch = { ...(operation.payload || {}) };
    operationStore.put(storedOperation);
    productStore.put({
      ...product,
      ...patch,
      pending_metadata_patch: { ...(product.pending_metadata_patch || {}), ...patch },
      offline_status: 'pending',
      cached_at: now
    });
  } else if (operation.operation_type === 'stock_delta') {
    if (!product) throw new Error('This product is not available in the offline inventory cache.');
    const delta = Number(operation.stock_delta_units || 0);
    if (!Number.isFinite(delta) || delta === 0) throw new Error('Stock adjustment must change the quantity.');
    const unitsPerBox = Math.max(1, Number(product.units_per_box || 1));
    const currentTotal = (Number(product.stock_boxes || 0) * unitsPerBox) + Number(product.stock_units || 0);
    const nextTotal = currentTotal + delta;
    if (nextTotal < 0) throw new Error(`Cannot reduce ${product.name || 'product'} below zero stock on this device.`);
    operationStore.put(storedOperation);
    productStore.put({
      ...product,
      ...(operation.stock_unit_type ? { stock_unit_type: operation.stock_unit_type } : {}),
      pending_delta_units: Number(product.pending_delta_units || 0) + delta,
      stock_boxes: Math.floor(nextTotal / unitsPerBox),
      stock_units: nextTotal % unitsPerBox,
      offline_status: 'pending',
      offline_stock_adjusted_at: now
    });
  } else {
    transaction.abort();
    await transactionDone(transaction).catch(() => {});
    throw new Error(`Unsupported offline inventory operation: ${operation.operation_type}`);
  }

  await transactionDone(transaction);
  window.dispatchEvent(new CustomEvent('sammia:offline-queue-changed', { detail: { scope: record.scope, inventory: true } }));
  return storedOperation;
}

export async function getPendingInventoryOperations({ userId = null, scope = null } = {}) {
  const db = await openDatabase();
  const transaction = db.transaction('pending_inventory_ops', 'readonly');
  const store = transaction.objectStore('pending_inventory_ops');
  let rows;
  if (scope) rows = await requestToPromise(store.index('scope').getAll(scope));
  else if (userId) rows = await requestToPromise(store.index('user_id').getAll(userId));
  else rows = await requestToPromise(store.getAll());
  await transactionDone(transaction);
  return (rows || [])
    .filter((row) => ['pending', 'retry', 'syncing'].includes(row.status))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

export async function markPendingInventoryOperationSyncing(operationId) {
  const db = await openDatabase();
  const readTx = db.transaction('pending_inventory_ops', 'readonly');
  const record = await requestToPromise(readTx.objectStore('pending_inventory_ops').get(operationId));
  await transactionDone(readTx);
  if (!record) return;
  const transaction = db.transaction('pending_inventory_ops', 'readwrite');
  transaction.objectStore('pending_inventory_ops').put({
    ...record,
    status: 'syncing',
    last_attempt_at: new Date().toISOString()
  });
  await transactionDone(transaction);
}

export async function markPendingInventoryOperationRetry(operationId, errorMessage) {
  const db = await openDatabase();
  const readTx = db.transaction('pending_inventory_ops', 'readonly');
  const record = await requestToPromise(readTx.objectStore('pending_inventory_ops').get(operationId));
  await transactionDone(readTx);
  if (!record) return;
  const transaction = db.transaction('pending_inventory_ops', 'readwrite');
  transaction.objectStore('pending_inventory_ops').put({
    ...record,
    status: 'retry',
    attempts: Number(record.attempts || 0) + 1,
    last_error: String(errorMessage || '').slice(0, 500),
    last_attempt_at: new Date().toISOString()
  });
  await transactionDone(transaction);
}

function stripLocalProductFields(product = {}) {
  const { key, scope, pending_delta_units, pending_metadata_patch, offline_created, offline_status, cached_at, server_stock_boxes, server_stock_units, ...rest } = product;
  return rest;
}

export async function completePendingInventoryOperation(operationId, result = {}) {
  const db = await openDatabase();
  const readTx = db.transaction(['pending_inventory_ops', 'pos_products'], 'readonly');
  const operationStoreRead = readTx.objectStore('pending_inventory_ops');
  const operation = await requestToPromise(operationStoreRead.get(operationId));
  if (!operation) {
    await transactionDone(readTx);
    return;
  }
  const product = await requestToPromise(readTx.objectStore('pos_products').get(productKey(operation.scope, operation.product_id)));
  const pendingRows = await requestToPromise(operationStoreRead.index('scope').getAll(operation.scope));
  await transactionDone(readTx);

  const transaction = db.transaction(['pending_inventory_ops', 'pos_products', 'inventory_conflicts', 'sync_meta'], 'readwrite');
  const operationStore = transaction.objectStore('pending_inventory_ops');
  const productStore = transaction.objectStore('pos_products');
  const conflictStore = transaction.objectStore('inventory_conflicts');
  const metaStore = transaction.objectStore('sync_meta');
  const now = new Date().toISOString();

  if (result?.status === 'conflict') {
    const localConflictId = result.conflict_id || `inventory-${operation.operation_id}`;
    conflictStore.put({
      local_conflict_id: localConflictId,
      server_conflict_id: result.conflict_id || null,
      scope: operation.scope,
      user_id: operation.user_id,
      pharmacy_id: operation.pharmacy_id,
      branch_id: operation.branch_id,
      product_id: operation.product_id,
      product_name: product?.name || operation.payload?.name || 'Product',
      conflict_type: result.conflict_type || 'metadata',
      message: result.message || 'This product changed on the server while your device was offline.',
      server_product: result.server_product || null,
      operation,
      status: 'open',
      created_at: now
    });
    if (product) productStore.put({ ...product, offline_status: 'conflict', cached_at: now });
    operationStore.delete(operationId);
  } else {
    const serverProduct = result?.product || null;
    if (product && serverProduct) {
      const unitsPerBox = Math.max(1, Number(serverProduct.units_per_box || product.units_per_box || 1));
      const opDelta = operation.operation_type === 'stock_delta' ? Number(operation.stock_delta_units || 0) : 0;
      const remainingDelta = Number(product.pending_delta_units || 0) - opDelta;
      const pendingPatch = { ...(product.pending_metadata_patch || {}) };
      const laterPatch = (pendingRows || [])
        .filter((pendingOperation) => pendingOperation.operation_id !== operationId)
        .filter((pendingOperation) => pendingOperation.product_id === operation.product_id)
        .filter((pendingOperation) => pendingOperation.operation_type === 'update_product')
        .filter((pendingOperation) => ['pending', 'retry', 'syncing'].includes(pendingOperation.status))
        .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
        .reduce((patch, pendingOperation) => ({ ...patch, ...(pendingOperation.payload || {}) }), {});
      if (operation.operation_type === 'update_product') {
        Object.keys(operation.payload || {}).forEach((key) => delete pendingPatch[key]);
      }
      if (operation.operation_type === 'create_product') {
        Object.keys(pendingPatch).forEach((key) => delete pendingPatch[key]);
      }
      Object.assign(pendingPatch, laterPatch);
      const serverBoxes = Number(serverProduct.stock_boxes || 0);
      const serverUnits = Number(serverProduct.stock_units || 0);
      const adjustedTotal = Math.max(0, (serverBoxes * unitsPerBox) + serverUnits + remainingDelta);
      productStore.put({
        ...stripLocalProductFields(serverProduct),
        ...pendingPatch,
        key: productKey(operation.scope, operation.product_id),
        scope: operation.scope,
        server_stock_boxes: serverBoxes,
        server_stock_units: serverUnits,
        pending_delta_units: remainingDelta,
        pending_metadata_patch: pendingPatch,
        offline_created: false,
        offline_status: result?.conflict ? 'conflict' : (remainingDelta !== 0 || Object.keys(pendingPatch).length ? 'pending' : ''),
        stock_boxes: Math.floor(adjustedTotal / unitsPerBox),
        stock_units: adjustedTotal % unitsPerBox,
        cached_at: now,
        last_synced_at: now
      });
    }
    if (result?.conflict) {
      const conflict = result.conflict;
      conflictStore.put({
        local_conflict_id: conflict.id || `inventory-stock-${operation.operation_id}`,
        server_conflict_id: conflict.id || null,
        scope: operation.scope,
        user_id: operation.user_id,
        pharmacy_id: operation.pharmacy_id,
        branch_id: operation.branch_id,
        product_id: operation.product_id,
        product_name: conflict.product_name || product?.name || 'Product',
        conflict_type: 'stock',
        message: conflict.message || 'The server had less stock than this offline adjustment expected.',
        server_product: serverProduct,
        operation,
        status: 'open',
        created_at: now
      });
    }
    const syncedVersion = Number(serverProduct?.metadata_version || 0);
    if (syncedVersion > 0 && ['create_product', 'update_product'].includes(operation.operation_type)) {
      (pendingRows || []).forEach((pendingOperation) => {
        if (pendingOperation.operation_id === operationId) return;
        if (pendingOperation.product_id !== operation.product_id) return;
        if (pendingOperation.operation_type !== 'update_product') return;
        if (!['pending', 'retry'].includes(pendingOperation.status)) return;
        operationStore.put({
          ...pendingOperation,
          base_metadata_version: syncedVersion,
          rebased_at: now
        });
      });
    }
    operationStore.delete(operationId);
  }

  metaStore.put({
    scope: operation.scope,
    last_sync_at: now,
    last_synced_inventory_operation: operation.operation_id,
    last_conflict_count: Number(result?.conflict_count || (result?.status === 'conflict' ? 1 : 0)),
    last_error: ''
  });

  await transactionDone(transaction);
  window.dispatchEvent(new CustomEvent('sammia:offline-queue-changed', { detail: { scope: operation.scope, inventory: true } }));
}

export async function getInventoryConflicts({ userId = null, scope = null } = {}) {
  const db = await openDatabase();
  const transaction = db.transaction('inventory_conflicts', 'readonly');
  const store = transaction.objectStore('inventory_conflicts');
  let rows;
  if (scope) rows = await requestToPromise(store.index('scope').getAll(scope));
  else if (userId) rows = await requestToPromise(store.index('user_id').getAll(userId));
  else rows = await requestToPromise(store.getAll());
  await transactionDone(transaction);
  return (rows || []).filter((row) => row.status === 'open').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export async function acceptServerInventoryConflict(localConflictId) {
  const db = await openDatabase();
  const readTx = db.transaction('inventory_conflicts', 'readonly');
  const conflict = await requestToPromise(readTx.objectStore('inventory_conflicts').get(localConflictId));
  await transactionDone(readTx);
  if (!conflict) return null;

  const productReadTx = db.transaction('pos_products', 'readonly');
  const current = await requestToPromise(productReadTx.objectStore('pos_products').get(productKey(conflict.scope, conflict.product_id)));
  await transactionDone(productReadTx);

  const transaction = db.transaction(['inventory_conflicts', 'pos_products'], 'readwrite');
  transaction.objectStore('inventory_conflicts').delete(localConflictId);
  if (conflict.conflict_type === 'stock') {
    if (current) {
      const stillPending = Number(current.pending_delta_units || 0) !== 0 || Object.keys(current.pending_metadata_patch || {}).length > 0;
      transaction.objectStore('pos_products').put({ ...current, offline_status: stillPending ? 'pending' : '' });
    }
  } else if (conflict.server_product) {
    const normalized = normalizeProductForCache(conflict.scope, conflict.server_product, {
      ...(current || {}),
      pending_metadata_patch: {},
      offline_status: '',
      offline_created: false
    });
    transaction.objectStore('pos_products').put({ ...normalized, pending_metadata_patch: {}, offline_status: '' });
  } else if (current) {
    transaction.objectStore('pos_products').put({ ...current, pending_metadata_patch: {}, offline_status: '' });
  }
  await transactionDone(transaction);
  window.dispatchEvent(new CustomEvent('sammia:offline-queue-changed', { detail: { scope: conflict.scope, inventory: true } }));
  return conflict;
}

export async function retryInventoryConflictWithLocalChanges(localConflictId) {
  const db = await openDatabase();
  const transaction = db.transaction('inventory_conflicts', 'readonly');
  const conflict = await requestToPromise(transaction.objectStore('inventory_conflicts').get(localConflictId));
  await transactionDone(transaction);
  if (!conflict?.operation || conflict.conflict_type !== 'metadata') throw new Error('This conflict cannot be reapplied automatically.');

  const retry = {
    ...conflict.operation,
    operation_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    queued_at: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    force: true,
    base_metadata_version: Number(conflict.server_product?.metadata_version || 1),
    server_conflict_id: conflict.server_conflict_id || null,
    last_error: ''
  };
  await queueOfflineInventoryOperation(retry);
  const deleteTx = db.transaction('inventory_conflicts', 'readwrite');
  deleteTx.objectStore('inventory_conflicts').delete(localConflictId);
  await transactionDone(deleteTx);
  return { conflict, retry };
}
