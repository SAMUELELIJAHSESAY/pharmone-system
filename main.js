import { getCurrentUser, getSession, onAuthStateChange } from './src/auth.js';
import { renderLanding } from './src/views/landing.js';
import { renderLogin } from './src/views/login.js';
import { renderApp, clearStoredNavigationState } from './src/views/app.js';
import { initTheme } from './src/theme.js';
import { initPWA } from './src/pwa.js';
import { cleanupActiveView } from './src/view-lifecycle.js';
import { resetPharmacyBranding } from './src/branding.js';
import { initOfflineSync, configureOfflineSyncUser } from './src/offline-sync.js';

let renderedMode = null;
let renderedUserId = null;
let authResolutionGeneration = 0;
let currentUser = null;

function isLoginRoute() {
  return window.location.hash.toLowerCase() === '#login';
}

function showPublicEntry({ force = false } = {}) {
  // Public SamMia Pharm pages always use the platform brand. Clear any tenant
  // CSS variables before rendering (and before any early return) so a pharmacy
  // color can never persist onto Landing/Login after logout or workspace exit.
  resetPharmacyBranding();
  window.pharmacySettings = null;

  if (currentUser) {
    showAuthenticatedApp(currentUser);
    return;
  }

  const nextMode = isLoginRoute() ? 'login' : 'landing';
  if (!force && renderedMode === nextMode) return;

  cleanupActiveView();
  renderedMode = nextMode;
  renderedUserId = null;

  if (nextMode === 'login') {
    renderLogin();
  } else {
    renderLanding();
  }
}

function showAuthenticatedApp(user) {
  if (!user?.id) {
    currentUser = null;
    showPublicEntry({ force: true });
    return;
  }

  currentUser = user;
  configureOfflineSyncUser(user);

  // Remove the public login hash once an account is authenticated. This keeps
  // the app URL clean and returns signed-out users to the public landing page.
  if (isLoginRoute()) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }

  if (renderedMode === 'app' && renderedUserId === user.id) return;

  cleanupActiveView();
  renderedMode = 'app';
  renderedUserId = user.id;
  renderApp(user);
}

function resolveSignedInSession(session) {
  const sessionUserId = session?.user?.id;

  if (sessionUserId && renderedMode === 'app' && renderedUserId === sessionUserId) {
    return;
  }

  const generation = ++authResolutionGeneration;

  window.setTimeout(async () => {
    try {
      const user = await getCurrentUser();
      if (generation !== authResolutionGeneration) return;

      if (user) {
        showAuthenticatedApp(user);
      } else {
        currentUser = null;
        showPublicEntry({ force: true });
      }
    } catch (error) {
      if (generation !== authResolutionGeneration) return;
      console.error('Failed to resolve authenticated user:', error);
      currentUser = null;
      configureOfflineSyncUser(null);
      showPublicEntry({ force: true });
    }
  }, 0);
}

async function init() {
  initTheme();
  initPWA();
  initOfflineSync();

  try {
    const user = await getCurrentUser();
    if (user) {
      showAuthenticatedApp(user);
    } else {
      currentUser = null;
      configureOfflineSyncUser(null);
      showPublicEntry({ force: true });
    }
  } catch (error) {
    console.error('Failed to initialize application session:', error);
    currentUser = null;
    showPublicEntry({ force: true });
  }

  onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
      resolveSignedInSession(session);
      return;
    }

    if (event === 'SIGNED_OUT') {
      authResolutionGeneration += 1;
      clearStoredNavigationState();
      currentUser = null;
      configureOfflineSyncUser(null);
      showPublicEntry({ force: true });
    }
  });

  window.addEventListener('hashchange', () => {
    if (currentUser) return;

    const wantsLogin = isLoginRoute();
    if ((wantsLogin && renderedMode !== 'login') || (!wantsLogin && renderedMode === 'login')) {
      showPublicEntry({ force: true });
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || renderedMode !== 'app') return;

    window.setTimeout(async () => {
      try {
        const session = await getSession();
        const sessionUserId = session?.user?.id || null;

        if (!sessionUserId) {
          authResolutionGeneration += 1;
          currentUser = null;
          showPublicEntry({ force: true });
          return;
        }

        if (renderedUserId && sessionUserId !== renderedUserId) {
          resolveSignedInSession(session);
        }
      } catch (error) {
        console.error('Failed to validate restored session:', error);
      }
    }, 0);
  });
}

init();
