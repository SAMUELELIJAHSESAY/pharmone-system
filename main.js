import { getCurrentUser, onAuthStateChange } from './src/auth.js';
import { renderLogin } from './src/views/login.js';
import { renderApp } from './src/views/app.js';

async function init() {
  const user = await getCurrentUser();
  if (user) {
    renderApp(user);
  } else {
    renderLogin();
  }

  onAuthStateChange((event, session) => {
    (async () => {
      if (event === 'SIGNED_IN') {
        const user = await getCurrentUser();
        if (user) renderApp(user);
      } else if (event === 'SIGNED_OUT') {
        renderLogin();
      }
    })();
  });
}

init();
