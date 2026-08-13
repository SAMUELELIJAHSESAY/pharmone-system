/**
 * Centralized lifecycle management for SPA views.
 *
 * Views can register timers/subscriptions against the token created by
 * `beginViewLifecycle()`. When navigation starts, cleanup from the previous
 * view is guaranteed to run exactly once. Registrations from stale async
 * renders are cleaned up immediately instead of leaking into the active view.
 */
let viewGeneration = 0;
let activeViewToken = null;
const cleanupTasksByToken = new Map();

function runCleanup(token) {
  const tasks = cleanupTasksByToken.get(token);
  if (!tasks) return;

  for (const cleanup of tasks) {
    try {
      cleanup();
    } catch (error) {
      console.error('View cleanup failed:', error);
    }
  }

  cleanupTasksByToken.delete(token);
}

export function beginViewLifecycle() {
  if (activeViewToken) {
    runCleanup(activeViewToken);
  }

  viewGeneration += 1;
  activeViewToken = viewGeneration;
  cleanupTasksByToken.set(activeViewToken, new Set());
  return activeViewToken;
}

export function isViewLifecycleActive(token) {
  return Boolean(token) && token === activeViewToken;
}

export function registerViewCleanup(token, cleanup) {
  if (typeof cleanup !== 'function') {
    throw new TypeError('registerViewCleanup requires a cleanup function');
  }

  if (!isViewLifecycleActive(token)) {
    cleanup();
    return () => {};
  }

  const tasks = cleanupTasksByToken.get(token);
  tasks.add(cleanup);

  return () => {
    tasks.delete(cleanup);
  };
}

export function registerViewInterval(token, callback, intervalMs) {
  if (!isViewLifecycleActive(token)) return null;

  const intervalId = window.setInterval(callback, intervalMs);
  registerViewCleanup(token, () => window.clearInterval(intervalId));
  return intervalId;
}

export function cleanupActiveView() {
  if (!activeViewToken) return;
  runCleanup(activeViewToken);
  activeViewToken = null;
}
