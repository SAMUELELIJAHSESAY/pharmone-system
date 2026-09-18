import { syncQueuedPOSSale } from './database.js';
import { getPendingPOSSales, markPendingPOSSaleRetry, completePendingPOSSale, getSyncMeta } from './offline-db.js';

let currentUser = null;
let initialized = false;
let syncing = false;
let intervalId = null;

function emitStatus(detail = {}) {
  window.dispatchEvent(new CustomEvent('sammia:offline-sync-status', { detail }));
}

function isMigrationMissing(error) {
  const message = String(error?.message || '');
  return ['PGRST202', '42883'].includes(error?.code) || /sync_offline_pos_sale/i.test(message);
}

export function configureOfflineSyncUser(user) {
  currentUser = user?.id ? user : null;
  emitStatus({ type: 'user_changed', userId: currentUser?.id || null });
  if (currentUser && navigator.onLine) requestOfflineSync({ reason: 'user_configured' }).catch(() => {});
}

export async function getOfflineSyncSnapshot({ scope = null } = {}) {
  const pending = await getPendingPOSSales({ userId: currentUser?.id || null, scope }).catch(() => []);
  const meta = scope ? await getSyncMeta(scope).catch(() => null) : null;
  return {
    online: navigator.onLine,
    syncing,
    pendingCount: pending.length,
    pending,
    lastSyncAt: meta?.last_sync_at || null,
    lastConflictCount: Number(meta?.last_conflict_count || 0),
    lastError: meta?.last_error || ''
  };
}

export async function requestOfflineSync({ reason = 'manual' } = {}) {
  if (syncing || !navigator.onLine || !currentUser?.id) return { synced: 0, pending: 0 };
  syncing = true;
  emitStatus({ type: 'sync_started', reason, userId: currentUser.id });

  let synced = 0;
  let conflictCount = 0;
  let migrationRequired = false;

  try {
    const pending = await getPendingPOSSales({ userId: currentUser.id });
    for (const record of pending) {
      if (!navigator.onLine || !currentUser?.id || record.user_id !== currentUser.id) break;
      try {
        const result = await syncQueuedPOSSale(record);
        conflictCount += Number(result?.conflict_count || 0);
        await completePendingPOSSale(record.client_transaction_id, result || {});
        synced += 1;
      } catch (error) {
        if (isMigrationMissing(error)) migrationRequired = true;
        await markPendingPOSSaleRetry(record.client_transaction_id, error?.message || 'Sync failed');
        // A migration/security/business error will repeat for later rows too; avoid
        // hammering Supabase. A transient network failure should also wait for the
        // next reconnect cycle.
        break;
      }
    }

    const remaining = await getPendingPOSSales({ userId: currentUser.id });
    emitStatus({
      type: 'sync_finished',
      reason,
      synced,
      pendingCount: remaining.length,
      conflictCount,
      migrationRequired
    });
    return { synced, pending: remaining.length, conflictCount, migrationRequired };
  } finally {
    syncing = false;
  }
}

async function registerBackgroundSync() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.ready) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (registration?.sync?.register) await registration.sync.register('sammia-pos-sync');
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
  window.addEventListener('sammia:offline-queue-changed', () => { emitStatus({ type: 'queue_changed' }); registerBackgroundSync(); });
  navigator.serviceWorker?.addEventListener?.('message', (event) => {
    if (event.data?.type === 'SAMMIA_POS_SYNC_REQUESTED') requestOfflineSync({ reason: 'background_sync' }).catch(() => {});
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
