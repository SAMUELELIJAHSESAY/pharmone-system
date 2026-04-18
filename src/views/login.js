import { signIn } from '../auth.js';
import { showToast } from '../utils.js';

export function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-logo">
          <div class="auth-logo-icon">&#x2695;</div>
          <div class="auth-logo-text">
            <h1>PharmaCare</h1>
            <p>Pharmacy Management System</p>
          </div>
        </div>
        <h2 class="auth-title">Welcome back</h2>
        <p class="auth-subtitle">Sign in to your account to continue</p>

        <div id="auth-error" class="alert alert-danger hidden"></div>

        <form id="login-form">
          <div class="form-group">
            <label class="form-label">Email address</label>
            <input type="email" class="form-input" id="email" placeholder="you@pharmacy.com" required autocomplete="email" />
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" class="form-input" id="password" placeholder="Enter your password" required autocomplete="current-password" />
          </div>
          <button type="submit" class="btn btn-primary btn-full btn-lg" id="login-btn" style="margin-top:0.5rem">
            Sign in
          </button>
        </form>

        <div style="margin-top:1.5rem; padding-top:1.5rem; border-top:1px solid var(--gray-200)">
          <p class="text-xs text-muted text-center" style="margin-bottom:0.75rem">Demo accounts:</p>
          <div style="display:grid;gap:0.5rem">
            <button class="btn btn-ghost btn-sm" onclick="fillDemo('super@pharma.com','demo123456')">
              &#x1F451; Super Admin Demo
            </button>
            <button class="btn btn-ghost btn-sm" onclick="fillDemo('admin@pharma.com','demo123456')">
              &#x1F3EA; Admin Demo
            </button>
            <button class="btn btn-ghost btn-sm" onclick="fillDemo('salesman@pharma.com','demo123456')">
              &#x1F464; Salesman Demo
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  window.fillDemo = (email, password) => {
    document.getElementById('email').value = email;
    document.getElementById('password').value = password;
  };

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const errEl = document.getElementById('auth-error');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      await signIn(email, password);
    } catch (err) {
      errEl.textContent = err.message || 'Invalid credentials. Please try again.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}
