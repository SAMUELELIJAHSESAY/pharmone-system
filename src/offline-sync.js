import { syncQueuedPOSSale, syncQueuedInventoryOperation } from './database.js';
import {
  getPendingPOSSales,
  markPendingPOSSaleRetry,
  completePendingPOSSale,
  getPendingInventoryOperations,
  markPendingInventoryOperationSyncing,
  markPendingInventoryOperationRetry,
  completePendingInventoryOperation,
  getInventoryConflicts,
  getSyncMeta
} from './offline-db.js';

let currentUser = null;
let initialized = false;
let syncing = false;
let intervalId = null;

function emitStatus(detail = {}) {
  window.dispatchEvent(new CustomEvent('sammia:offline-sync-status', { detail }));
}

function isMigrationMissing(error) {
  const message = String(error?.message || '');
  return ['PGRST202', '42883'].includes(error?.code)
    || /sync_offline_pos_sale|sync_offline_inventory_operation/i.test(message);
}

export function configureOfflineSyncUser(user) {
  currentUser = user?.id ? user : null;
  emitStatus({ type: 'user_changed', userId: currentUser?.id || null });
  if (currentUser && navigator.onLine) requestOfflineSync({ reason: 'user_configured' }).catch(() => {});
}

export async function getOfflineSyncSnapshot({ scope = null } = {}) {
  const [sales, inventory, conflicts, meta] = await Promise.all([
    getPendingPOSSales({ userId: currentUser?.id || null, scope }).catch(() => []),
    getPendingInventoryOperations({ userId: currentUser?.id || null, scope }).catch(() => []),
    getInventoryConflicts({ userId: currentUser?.id || null, scope }).catch(() => []),
    scope ? getSyncMeta(scope).catch(() => null) : Promise.resolve(null)
  ]);
  return {
    online: navigator.onLine,
    syncing,
    pendingCount: sales.length,
    pending: sales,
    pendingSalesCount: sales.length,
    inventoryPendingCount: inventory.length,
    pendingInventory: inventory,
    totalPendingCount: sales.length + inventory.length,
    inventoryConflictCount: conflicts.length,
    inventoryConflicts: conflicts,
    lastSyncAt: meta?.last_sync_at || null,
    lastConflictCount: Number(meta?.last_conflict_count || 0),
    lastError: meta?.last_error || ''
  };
}

export async function requestOfflineSync({ reason = 'manual' } = {}) {
  if (syncing || !navigator.onLine || !currentUser?.id) return { synced: 0, pending: 0, inventoryPending: 0 };
  syncing = true;
  emitStatus({ type: 'sync_started', reason, userId: currentUser.id });

  let synced = 0;
  let syncedSales = 0;
  let syncedInventory = 0;
  let conflictCount = 0;
  let migrationRequired = false;

  try {
    const [sales, inventory] = await Promise.all([
      getPendingPOSSales({ userId: currentUser.id }),
      getPendingInventoryOperations({ userId: currentUser.id })
    ]);

    const work = [
      ...sales.map((record) => ({ kind: 'sale', record, created_at: record.created_at || record.queued_at || '' })),
      ...inventory.map((record) => ({ kind: 'inventory', record, created_at: record.created_at || record.queued_at || '' }))
    ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

    for (const item of work) {
      if (!navigator.onLine || !currentUser?.id || item.record.user_id !== currentUser.id) break;
      try {
        if (item.kind === 'sale') {
          const result = await syncQueuedPOSSale(item.record);
          conflictCount += Number(result?.conflict_count || 0);
          await completePendingPOSSale(item.record.client_transaction_id, result || {});
          syncedSales += 1;
        } else {
          await markPendingInventoryOperationSyncing(item.record.operation_id);
          const result = await syncQueuedInventoryOperation(item.record);
          conflictCount += Number(result?.conflict_count || (result?.status === 'conflict' ? 1 : 0));
          await completePendingInventoryOperation(item.record.operation_id, result || {});
          syncedInventory += 1;
        }
        synced += 1;
      } catch (error) {
        if (isMigrationMissing(error)) migrationRequired = true;
        if (item.kind === 'sale') {
          await markPendingPOSSaleRetry(item.record.client_transaction_id, error?.message || 'Sync failed');
        } else {
          await markPendingInventoryOperationRetry(item.record.operation_id, error?.message || 'Sync failed');
        }
        break;
      }
    }

    const [remainingSales, remainingInventory, conflicts] = await Promise.all([
      getPendingPOSSales({ userId: currentUser.id }),
      getPendingInventoryOperations({ userId: currentUser.id }),
      getInventoryConflicts({ userId: currentUser.id })
    ]);

    emitStatus({
      type: 'sync_finished',
      reason,
      synced,
      syncedSales,
      syncedInventory,
      pendingCount: remainingSales.length,
      inventoryPendingCount: remainingInventory.length,
      totalPendingCount: remainingSales.length + remainingInventory.length,
      inventoryConflictCount: conflicts.length,
      conflictCount,
      migrationRequired
    });
    return {
      synced,
      syncedSales,
      syncedInventory,
      pending: remainingSales.length,
      inventoryPending: remainingInventory.length,
      conflicts: conflicts.length,
      conflictCount,
      migrationRequired
    };
  } finally {
    syncing = false;
  }
}

async function registerBackgroundSync() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.ready) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (registration?.sync?.register) await registration.sync.register('sammia-offline-sync');
  } catch (_) {
    // Background Sync is optional; foreground reconnect/app-open sync remains authoritative.
  }
}

export function initOfflineSync() {
  if (initialized) return;
  initialized = true;

  window.addEventListener('online', () => {
    emitStatus({ type: 'online' });
    requestOfflineSync({ reason: 'connection_restored' }).catch(() => {});
  });
  window.addEventListener('offline', () => emitStatus({ type: 'offline' }));
  window.addEventListener('sammia:offline-queue-changed', () => {
    emitStatus({ type: 'queue_changed' });
    registerBackgroundSync();
  });
  navigator.serviceWorker?.addEventListener?.('message', (event) => {
    if (['SAMMIA_POS_SYNC_REQUESTED', 'SAMMIA_OFFLINE_SYNC_REQUESTED'].includes(event.data?.type)) {
      requestOfflineSync({ reason: 'background_sync' }).catch(() => {});
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      requestOfflineSync({ reason: 'app_visible' }).catch(() => {});
    }
  });

  intervalId = window.setInterval(() => {
    if (navigator.onLine && currentUser?.id) requestOfflineSync({ reason: 'periodic' }).catch(() => {});
  }, 60_000);

  window.addEventListener('beforeunload', () => {
    if (intervalId) window.clearInterval(intervalId);
  }, { once: true });
}
