import { signIn } from '../auth.js';
import { renderBrandLogo, BRAND } from '../components/brand.js';

export function renderLogin() {
  document.title = `Sign In | ${BRAND.name}`;
  document.getElementById('app').innerHTML = `
    <div class="auth-page sammia-auth-page">
      <a class="auth-back-link" href="#" aria-label="Back to SamMia Pharm website">← Back to website</a>
      <div class="sammia-auth-shell">
        <section class="auth-brand-panel" aria-label="SamMia Pharm">
          ${renderBrandLogo({ inverse: true })}
          <div class="auth-brand-copy">
            <span>Pharmacy Management Platform</span>
            <h1>Smarter pharmacy management for your whole team.</h1>
            <p>Run sales, stock, branches, patients and reporting from one secure workspace.</p>
          </div>
          <div class="auth-brand-points">
            <span><i>✓</i> Secure role-based access</span>
            <span><i>✓</i> Multi-branch ready</span>
            <span><i>✓</i> Responsive on every device</span>
          </div>
        </section>

        <section class="auth-card sammia-auth-card">
          <div class="auth-mobile-brand">${renderBrandLogo()}</div>
          <div class="auth-form-heading">
            <span class="auth-eyebrow">Welcome back</span>
            <h2>Sign in to ${BRAND.name}</h2>
            <p>Enter your account details to continue to your pharmacy workspace.</p>
          </div>

          <div id="auth-error" class="alert alert-danger hidden"></div>

          <form id="login-form">
            <div class="form-group">
              <label class="form-label" for="email">Email address</label>
              <input type="email" class="form-input" id="email" placeholder="you@pharmacy.com" required autocomplete="email" />
            </div>
            <div class="form-group">
              <label class="form-label" for="password">Password</label>
              <input type="password" class="form-input" id="password" placeholder="Enter your password" required autocomplete="current-password" />
            </div>
            <button type="submit" class="btn btn-primary btn-full btn-lg" id="login-btn">
              Sign In
            </button>
          </form>

          <details class="demo-access">
            <summary>Demo access</summary>
            <div class="demo-access-grid">
              <button class="btn btn-ghost btn-sm" type="button" data-demo-email="super@pharma.com" data-demo-password="demo123456">Super Admin</button>
              <button class="btn btn-ghost btn-sm" type="button" data-demo-email="admin@pharma.com" data-demo-password="demo123456">Admin</button>
              <button class="btn btn-ghost btn-sm" type="button" data-demo-email="salesman@pharma.com" data-demo-password="demo123456">Salesperson</button>
            </div>
          </details>

          <p class="auth-security-note">Secure access · SamMia Pharm</p>
        </section>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-demo-email]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById('email').value = button.dataset.demoEmail || '';
      document.getElementById('password').value = button.dataset.demoPassword || '';
    });
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const errEl = document.getElementById('auth-error');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      await signIn(email, password);
    } catch (err) {
      errEl.textContent = err.message || 'Invalid credentials. Please try again.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}
