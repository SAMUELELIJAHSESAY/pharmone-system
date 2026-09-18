const DB_NAME = 'sammia-pharm-offline';
const DB_VERSION = 1;

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

function normalizeProductForCache(scope, product, pendingDeltaUnits = 0) {
  const unitsPerBox = Math.max(1, Number(product.units_per_box || 1));
  const serverBoxes = Number(product.server_stock_boxes ?? product.stock_boxes ?? 0);
  const serverUnits = Number(product.server_stock_units ?? product.stock_units ?? 0);
  const serverTotal = Math.max(0, (serverBoxes * unitsPerBox) + serverUnits);
  const delta = Number(pendingDeltaUnits || product.pending_delta_units || 0);
  const adjustedTotal = Math.max(0, serverTotal + delta);

  return {
    ...product,
    key: productKey(scope, product.id),
    scope,
    server_stock_boxes: serverBoxes,
    server_stock_units: serverUnits,
    pending_delta_units: delta,
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
    store.put(normalizeProductForCache(scope, product, existing[index]?.pending_delta_units || 0));
  });
  await transactionDone(transaction);
}

export async function replaceCachedPOSProducts(scope, products = []) {
  if (!scope) return;
  const db = await openDatabase();
  const readTx = db.transaction('pos_products', 'readonly');
  const existingRows = await requestToPromise(readTx.objectStore('pos_products').index('scope').getAll(scope));
  await transactionDone(readTx);

  const pendingDeltaById = new Map((existingRows || []).map((row) => [row.id, Number(row.pending_delta_units || 0)]));
  const nextIds = new Set((products || []).map((row) => row?.id).filter(Boolean));
  const transaction = db.transaction('pos_products', 'readwrite');
  const store = transaction.objectStore('pos_products');
  for (const row of existingRows || []) {
    if (!nextIds.has(row.id) && Number(row.pending_delta_units || 0) === 0) store.delete(row.key);
  }
  for (const product of products || []) {
    if (!product?.id) continue;
    store.put(normalizeProductForCache(scope, product, pendingDeltaById.get(product.id) || 0));
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
    .filter((row) => row.status === 'pending' || row.status === 'retry')
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
