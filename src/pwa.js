import { showToast } from './utils.js';

const INSTALL_DISMISS_KEY = 'pharmacare.pwa.installDismissedAt';
const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const UPDATE_BANNER_ID = 'pwa-update-banner';
const INSTALL_BANNER_ID = 'pwa-install-banner';
const NETWORK_BANNER_ID = 'pwa-network-banner';

let initialized = false;
let deferredInstallPrompt = null;
let serviceWorkerRegistration = null;
let waitingServiceWorker = null;
let reloadRequestedByUser = false;
let wasOffline = !navigator.onLine;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  const userAgent = window.navigator.userAgent || '';
  const platform = window.navigator.platform || '';
  const isAppleMobile = /iPad|iPhone|iPod/.test(userAgent);
  const isIPadOS = platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  return isAppleMobile || isIPadOS;
}

function installWasRecentlyDismissed() {
  const dismissedAt = Number(localStorage.getItem(INSTALL_DISMISS_KEY) || 0);
  return dismissedAt > 0 && Date.now() - dismissedAt < INSTALL_DISMISS_MS;
}

function removeElement(id) {
  document.getElementById(id)?.remove();
}

function dismissInstallBanner() {
  localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  removeElement(INSTALL_BANNER_ID);
}

function createBanner({ id, icon, title, message, primaryLabel, onPrimary, secondaryLabel, onSecondary }) {
  removeElement(id);

  const banner = document.createElement('section');
  banner.id = id;
  banner.className = 'pwa-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');

  const iconEl = document.createElement('div');
  iconEl.className = 'pwa-banner-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;

  const content = document.createElement('div');
  content.className = 'pwa-banner-content';
  const titleEl = document.createElement('strong');
  titleEl.textContent = title;
  const messageEl = document.createElement('span');
  messageEl.textContent = message;
  content.append(titleEl, messageEl);

  const actions = document.createElement('div');
  actions.className = 'pwa-banner-actions';

  if (secondaryLabel) {
    const secondary = document.createElement('button');
    secondary.type = 'button';
    secondary.className = 'btn btn-ghost btn-sm';
    secondary.textContent = secondaryLabel;
    secondary.addEventListener('click', onSecondary);
    actions.appendChild(secondary);
  }

  if (primaryLabel) {
    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'btn btn-primary btn-sm';
    primary.textContent = primaryLabel;
    primary.addEventListener('click', onPrimary);
    actions.appendChild(primary);
  }

  banner.append(iconEl, content, actions);
  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('show'));
  return banner;
}

function showIOSInstallInstructions() {
  document.getElementById('pwa-install-help')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pwa-install-help';
  overlay.className = 'pwa-help-overlay';
  overlay.innerHTML = `
    <div class="pwa-help-dialog" role="dialog" aria-modal="true" aria-labelledby="pwa-help-title">
      <button class="pwa-help-close" type="button" aria-label="Close install instructions">×</button>
      <div class="pwa-help-icon" aria-hidden="true">⚕</div>
      <h2 id="pwa-help-title">Install PharmaCare</h2>
      <p>On iPhone or iPad, install PharmaCare from Safari:</p>
      <ol>
        <li>Tap the <strong>Share</strong> button in Safari.</li>
        <li>Scroll and tap <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong> to confirm.</li>
      </ol>
      <p class="pwa-help-note">After installation, open PharmaCare from the Home Screen like a normal app.</p>
      <button class="btn btn-primary btn-full" type="button" data-pwa-help-done>Got it</button>
    </div>
  `;

  const close = () => overlay.remove();
  overlay.querySelector('.pwa-help-close')?.addEventListener('click', close);
  overlay.querySelector('[data-pwa-help-done]')?.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.body.appendChild(overlay);
  overlay.querySelector('.pwa-help-close')?.focus();
}

async function promptInstall() {
  if (isStandalone()) {
    showToast('PharmaCare is already installed on this device.', 'success');
    removeElement(INSTALL_BANNER_ID);
    return;
  }

  if (deferredInstallPrompt) {
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;

    if (choice?.outcome === 'accepted') {
      removeElement(INSTALL_BANNER_ID);
      localStorage.removeItem(INSTALL_DISMISS_KEY);
    } else {
      dismissInstallBanner();
    }
    return;
  }

  if (isIOS()) {
    showIOSInstallInstructions();
    return;
  }

  showToast('Use your browser menu and choose “Install app” or “Add to Home screen”.', 'info');
}

function showInstallBanner() {
  if (isStandalone() || installWasRecentlyDismissed() || document.getElementById(INSTALL_BANNER_ID)) return;

  createBanner({
    id: INSTALL_BANNER_ID,
    icon: '⬇',
    title: 'Install PharmaCare',
    message: isIOS()
      ? 'Add PharmaCare to your Home Screen for an app-like experience.'
      : 'Install this pharmacy system on your device for faster app-style access.',
    primaryLabel: 'Install',
    onPrimary: promptInstall,
    secondaryLabel: 'Not now',
    onSecondary: dismissInstallBanner
  });
}

function updateConnectivityUI() {
  const online = navigator.onLine;
  document.documentElement.classList.toggle('is-offline', !online);

  if (!online) {
    wasOffline = true;
    if (!document.getElementById(NETWORK_BANNER_ID)) {
      const banner = document.createElement('div');
      banner.id = NETWORK_BANNER_ID;
      banner.className = 'pwa-network-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'assertive');
      banner.innerHTML = '<span aria-hidden="true">●</span><strong>Offline</strong><span>Reconnect before saving or syncing pharmacy data.</span>';
      document.body.appendChild(banner);
      requestAnimationFrame(() => banner.classList.add('show'));
    }
    return;
  }

  removeElement(NETWORK_BANNER_ID);
  if (wasOffline) {
    wasOffline = false;
    showToast('Connection restored.', 'success');
  }
}

function showUpdateBanner(worker) {
  if (!worker || document.getElementById(UPDATE_BANNER_ID)) return;
  waitingServiceWorker = worker;

  createBanner({
    id: UPDATE_BANNER_ID,
    icon: '↻',
    title: 'Update available',
    message: 'A newer PharmaCare version is ready. It will only reload when you choose Update now.',
    primaryLabel: 'Update now',
    onPrimary: () => {
      const waiting = waitingServiceWorker || serviceWorkerRegistration?.waiting;
      if (!waiting) {
        removeElement(UPDATE_BANNER_ID);
        return;
      }
      reloadRequestedByUser = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
    },
    secondaryLabel: 'Later',
    onSecondary: () => removeElement(UPDATE_BANNER_ID)
  });
}

function cacheCurrentAppShell(registration) {
  const activeWorker = registration?.active || navigator.serviceWorker.controller;
  if (!activeWorker) return;

  const urls = new Set(['/']);
  document.querySelectorAll('script[src], link[href]').forEach((element) => {
    const value = element.getAttribute('src') || element.getAttribute('href');
    if (!value) return;

    try {
      const url = new URL(value, window.location.href);
      if (url.origin === window.location.origin) urls.add(url.pathname + url.search);
    } catch {
      // Ignore malformed or unsupported URLs.
    }
  });

  activeWorker.postMessage({ type: 'CACHE_URLS', urls: [...urls] });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none'
    });
    serviceWorkerRegistration = registration;

    if (registration.waiting && navigator.serviceWorker.controller) {
      showUpdateBanner(registration.waiting);
    }

    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;

      installingWorker.addEventListener('statechange', () => {
        if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(installingWorker);
        }
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloadRequestedByUser) return;
      reloadRequestedByUser = false;
      window.location.reload();
    });

    const readyRegistration = await navigator.serviceWorker.ready;
    cacheCurrentAppShell(readyRegistration);

    // Check once at startup. Updates are never applied or reloaded automatically.
    registration.update().catch(() => {});
  } catch (error) {
    console.error('PWA service worker registration failed:', error);
  }
}

function setupInstallExperience() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    localStorage.removeItem(INSTALL_DISMISS_KEY);
    removeElement(INSTALL_BANNER_ID);
    document.documentElement.classList.add('pwa-standalone');
    showToast('PharmaCare was installed successfully.', 'success');
  });

  // iOS does not emit beforeinstallprompt, so provide clear Home Screen guidance.
  if (isIOS() && !isStandalone() && !installWasRecentlyDismissed()) {
    window.setTimeout(showInstallBanner, 1200);
  }
}

export function initPWA() {
  if (initialized) return;
  initialized = true;

  document.documentElement.classList.toggle('pwa-standalone', isStandalone());
  updateConnectivityUI();
  window.addEventListener('online', updateConnectivityUI);
  window.addEventListener('offline', updateConnectivityUI);
  setupInstallExperience();
  registerServiceWorker();

  // Expose a small stable API so an explicit "Install App" action can be added later
  // without duplicating browser/PWA logic.
  window.PharmaCarePWA = Object.freeze({
    promptInstall,
    isStandalone,
    isOnline: () => navigator.onLine
  });
}
