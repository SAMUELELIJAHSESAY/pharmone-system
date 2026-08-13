import { getCurrentUser, getSession, onAuthStateChange } from './src/auth.js';
import { renderLogin } from './src/views/login.js';
import { renderApp } from './src/views/app.js';
import { initTheme } from './src/theme.js';
import { cleanupActiveView } from './src/view-lifecycle.js';

let renderedMode = null;
let renderedUserId = null;
let authResolutionGeneration = 0;

function showLogin() {
  // Avoid rebuilding the login screen for duplicate auth events.
  if (renderedMode === 'login') return;

  cleanupActiveView();
  renderedMode = 'login';
  renderedUserId = null;
  renderLogin();
}

function showAuthenticatedApp(user) {
  if (!user?.id) {
    showLogin();
    return;
  }

  // Supabase may emit SIGNED_IN when an existing session is confirmed again
  // (for example after the browser/tab becomes active). Re-rendering the whole
  // application for the same user makes the SPA look as if the page refreshed
  // and also repeats its initial database reads. Keep the current DOM/view alive.
  if (renderedMode === 'app' && renderedUserId === user.id) return;

  cleanupActiveView();
  renderedMode = 'app';
  renderedUserId = user.id;
  renderApp(user);
}

function resolveSignedInSession(session) {
  const sessionUserId = session?.user?.id;

  // The currently rendered user is already authenticated. A repeated SIGNED_IN
  // event is session maintenance, not a reason to rebuild the application.
  if (sessionUserId && renderedMode === 'app' && renderedUserId === sessionUserId) {
    return;
  }

  const generation = ++authResolutionGeneration;

  // Resolve profile/access outside the auth callback so the callback remains
  // lightweight and duplicate auth events cannot race a newer transition.
  window.setTimeout(async () => {
    try {
      const user = await getCurrentUser();
      if (generation !== authResolutionGeneration) return;

      if (user) {
        showAuthenticatedApp(user);
      } else {
        showLogin();
      }
    } catch (error) {
      if (generation !== authResolutionGeneration) return;
      console.error('Failed to resolve authenticated user:', error);
      showLogin();
    }
  }, 0);
}

async function init() {
  // Initialize theme system on app load.
  initTheme();

  try {
    const user = await getCurrentUser();
    if (user) {
      showAuthenticatedApp(user);
    } else {
      showLogin();
    }
  } catch (error) {
    console.error('Failed to initialize application session:', error);
    showLogin();
  }

  // Register auth handling once. SIGNED_IN can occur for an already signed-in
  // user, so it must not be treated as a hard page/app refresh signal.
  onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
      resolveSignedInSession(session);
      return;
    }

    if (event === 'SIGNED_OUT') {
      // Invalidate any pending profile resolution before showing the login view.
      authResolutionGeneration += 1;
      showLogin();
    }

    // INITIAL_SESSION and TOKEN_REFRESHED intentionally do not rebuild the UI.
    // The initial user was resolved above, and token refresh is transparent.
  });

  // When the browser restores this page from its back/forward cache, keep the
  // existing SPA DOM/view intact. Only replace it if the local auth session was
  // actually removed or switched while the page was away.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || renderedMode !== 'app') return;

    window.setTimeout(async () => {
      try {
        const session = await getSession();
        const sessionUserId = session?.user?.id || null;

        if (!sessionUserId) {
          authResolutionGeneration += 1;
          showLogin();
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
