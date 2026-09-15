import { renderBrandLogo, BRAND } from '../components/brand.js';

const featureCards = [
  ['Point of Sale', 'Fast checkout, receipts and sales tracking built for busy pharmacy counters.', '▣'],
  ['Inventory', 'Monitor stock levels, expiry dates and low-stock items with less manual work.', '◇'],
  ['Branch Management', 'Run multiple pharmacy locations from one secure management platform.', '⌂'],
  ['Patients', 'Keep organized customer and patient records with purchasing history.', '◎'],
  ['Reports & Analytics', 'Understand sales, stock movement and pharmacy performance at a glance.', '↗'],
  ['Staff & Permissions', 'Give each team member the right workspace and level of access.', '✓']
];

const roleCards = [
  ['Administrator', 'Full pharmacy oversight, reporting and team management.'],
  ['Inventory Manager', 'Stock control, transfers, purchasing and branch inventory.'],
  ['Salesperson', 'Fast point of sale, customer service and sales history.'],
  ['Super Administrator', 'Platform-wide pharmacy, account and configuration control.']
];

export function renderLanding() {
  document.title = `${BRAND.name} | Smarter Pharmacy Management`;
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <div class="public-site">
      <header class="public-header" id="home">
        <div class="public-nav shell-container">
          <a class="public-brand" href="#home" aria-label="${BRAND.name} home">
            ${renderBrandLogo()}
          </a>
          <button class="public-menu-btn" id="public-menu-btn" type="button" aria-controls="public-nav-links" aria-expanded="false" aria-label="Open menu">
            <span></span><span></span><span></span>
          </button>
          <nav class="public-nav-links" id="public-nav-links" aria-label="Public navigation">
            <a href="#home">Home</a>
            <a href="#features">Features</a>
            <a href="#solutions">Solutions</a>
            <a href="#roles">Roles</a>
            <a href="#support">Support</a>
            <a class="public-mobile-auth" href="#login" data-auth-link>Sign In</a>
            <a class="public-mobile-auth public-mobile-auth-primary" href="#login" data-auth-link>Get Started</a>
          </nav>
          <div class="public-nav-actions">
            <a class="btn btn-ghost" href="#login" data-auth-link>Sign In</a>
            <a class="btn btn-primary" href="#login" data-auth-link>Get Started</a>
          </div>
        </div>
      </header>

      <main>
        <section class="hero-section shell-container" aria-labelledby="hero-title">
          <div class="hero-copy">
            <span class="hero-kicker">Pharmacy Management Platform</span>
            <h1 id="hero-title">Smarter Pharmacy Management. <span>Built for Modern Pharmacies.</span></h1>
            <p>Manage sales, inventory, branches, staff, patients and pharmacy operations from one secure and easy-to-use platform.</p>
            <div class="hero-actions">
              <a class="btn btn-primary btn-lg" href="#login" data-auth-link>Get Started <span aria-hidden="true">→</span></a>
              <a class="btn btn-outline btn-lg" href="#login" data-auth-link>Sign In</a>
            </div>
            <div class="hero-trust" aria-label="Platform highlights">
              <span><i>✓</i> Secure role access</span>
              <span><i>✓</i> Multi-branch ready</span>
              <span><i>✓</i> Mobile friendly</span>
            </div>
          </div>

          <div class="hero-product" aria-label="SamMia Pharm dashboard preview">
            <div class="hero-window">
              <div class="hero-window-bar">
                <span class="window-dots"><i></i><i></i><i></i></span>
                <span class="window-label">${BRAND.domain}</span>
              </div>
              <div class="hero-dashboard">
                <aside class="hero-dashboard-side">
                  ${renderBrandLogo({ inverse: true, compact: true })}
                  <span class="hero-side-item active">Overview</span>
                  <span class="hero-side-item">POS</span>
                  <span class="hero-side-item">Inventory</span>
                  <span class="hero-side-item">Patients</span>
                  <span class="hero-side-item">Reports</span>
                </aside>
                <div class="hero-dashboard-main">
                  <div class="hero-dashboard-head">
                    <div><small>Welcome back</small><strong>Dashboard</strong></div>
                    <span class="hero-avatar">SM</span>
                  </div>
                  <div class="hero-stat-grid">
                    <div><small>Total Sales</small><strong>Le 12,450</strong><em>+12%</em></div>
                    <div><small>Products</small><strong>1,248</strong><em>+5%</em></div>
                    <div><small>Low Stock</small><strong>8</strong><em class="warn">Needs action</em></div>
                  </div>
                  <div class="hero-analytics-grid">
                    <div class="hero-chart-card">
                      <span>Sales overview</span>
                      <svg viewBox="0 0 280 100" aria-hidden="true"><path d="M4 82 C30 78 36 60 58 64 S90 36 112 50 S145 64 166 38 S205 48 226 24 S258 30 276 12" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M4 82 C30 78 36 60 58 64 S90 36 112 50 S145 64 166 38 S205 48 226 24 S258 30 276 12 L276 98 L4 98 Z" fill="currentColor" opacity=".08"/></svg>
                    </div>
                    <div class="hero-list-card">
                      <span>Recent sales</span>
                      <p><b>Paracetamol 500mg</b><em>Le 250</em></p>
                      <p><b>Amoxicillin 250mg</b><em>Le 300</em></p>
                      <p><b>Vitamin C</b><em>Le 120</em></p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="hero-phone" aria-hidden="true">
              <div class="hero-phone-notch"></div>
              <div class="hero-phone-brand"><img src="/brand/sammia-mark.png" alt="" /> SamMia Pharm</div>
              <small>Today</small>
              <strong>Le 2,450</strong>
              <div class="hero-mini-chart"></div>
              <div class="hero-phone-nav"><span>⌂</span><span>▣</span><span>◇</span></div>
            </div>
          </div>
        </section>

        <section class="public-strip" aria-label="Core capabilities">
          <div class="shell-container capability-grid">
            <div><span>▣</span><strong>Fast Point of Sale</strong><small>Checkout and receipts</small></div>
            <div><span>◇</span><strong>Real-time Inventory</strong><small>Stock and expiry visibility</small></div>
            <div><span>⌂</span><strong>Multi-Branch</strong><small>Centralized management</small></div>
            <div><span>✓</span><strong>Secure Roles</strong><small>Controlled team access</small></div>
          </div>
        </section>

        <section class="public-section shell-container" id="features">
          <div class="section-heading centered">
            <span class="section-kicker">Everything you need</span>
            <h2>Powerful tools for everyday pharmacy operations</h2>
            <p>One consistent workspace for the front counter, stock room and management team.</p>
          </div>
          <div class="feature-grid">
            ${featureCards.map(([title, copy, icon]) => `
              <article class="feature-card">
                <span class="feature-icon" aria-hidden="true">${icon}</span>
                <h3>${title}</h3>
                <p>${copy}</p>
              </article>
            `).join('')}
          </div>
        </section>

        <section class="public-section public-section-soft" id="solutions">
          <div class="shell-container solution-layout">
            <div class="solution-copy">
              <span class="section-kicker">One connected platform</span>
              <h2>See the information you need without losing the bigger picture.</h2>
              <p>SamMia Pharm brings sales, stock, customers and branches together so teams can work faster and managers can make informed decisions.</p>
              <div class="solution-points">
                <span><i>✓</i><b>Clear dashboards</b><small>Quick visibility into the metrics that matter.</small></span>
                <span><i>✓</i><b>Responsive everywhere</b><small>Built for desktops, laptops, tablets and phones.</small></span>
                <span><i>✓</i><b>Designed to scale</b><small>Support one pharmacy today and more branches tomorrow.</small></span>
              </div>
            </div>
            <div class="solution-preview">
              <div class="solution-preview-top"><span>Inventory overview</span><strong>Live status</strong></div>
              <div class="solution-metrics"><div><small>Total Products</small><strong>1,248</strong></div><div><small>In Stock</small><strong>1,196</strong></div><div><small>Low Stock</small><strong>8</strong></div></div>
              <div class="solution-table">
                <div class="solution-row head"><span>Product</span><span>Stock</span><span>Status</span></div>
                <div class="solution-row"><span>Paracetamol 500mg</span><span>240</span><span class="pill success">Healthy</span></div>
                <div class="solution-row"><span>Amoxicillin 250mg</span><span>86</span><span class="pill success">Healthy</span></div>
                <div class="solution-row"><span>Vitamin C 1000mg</span><span>12</span><span class="pill warning">Low</span></div>
                <div class="solution-row"><span>ORS Sachets</span><span>118</span><span class="pill success">Healthy</span></div>
              </div>
            </div>
          </div>
        </section>

        <section class="public-section shell-container" id="roles">
          <div class="section-heading centered">
            <span class="section-kicker">Built for every role</span>
            <h2>Each team member sees the tools they need.</h2>
          </div>
          <div class="role-grid">
            ${roleCards.map(([title, copy], index) => `
              <article class="role-card">
                <span class="role-number">0${index + 1}</span>
                <h3>${title}</h3>
                <p>${copy}</p>
              </article>
            `).join('')}
          </div>
        </section>

        <section class="public-cta shell-container" id="support">
          <div>
            <span class="section-kicker light">Ready when your pharmacy is.</span>
            <h2>Simplify daily operations with SamMia Pharm.</h2>
            <p>Sign in to your workspace and keep your pharmacy moving from one modern platform.</p>
          </div>
          <a class="btn btn-light btn-lg" href="#login" data-auth-link>Sign In to SamMia Pharm <span aria-hidden="true">→</span></a>
        </section>
      </main>

      <footer class="public-footer">
        <div class="shell-container public-footer-grid">
          <div class="public-footer-brand">
            ${renderBrandLogo({ inverse: true })}
            <p>Smarter pharmacy management for modern teams and growing businesses.</p>
          </div>
          <div><strong>Product</strong><a href="#features">Features</a><a href="#solutions">Solutions</a><a href="#roles">Roles</a></div>
          <div><strong>Access</strong><a href="#login" data-auth-link>Sign In</a><a href="#support">Support</a></div>
          <div><strong>Brand</strong><span>SamMia Blue · #2563eb</span><span>SamMia Navy · #0f2d5b</span></div>
        </div>
        <div class="shell-container public-footer-bottom"><span>© 2026 SamMia Pharm. All rights reserved.</span><span>${BRAND.domain}</span></div>
      </footer>
    </div>
  `;

  const menuButton = document.getElementById('public-menu-btn');
  const menu = document.getElementById('public-nav-links');
  const closeMenu = () => {
    menu?.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  };

  menuButton?.addEventListener('click', () => {
    const nextOpen = !menu?.classList.contains('open');
    menu?.classList.toggle('open', nextOpen);
    menuButton.setAttribute('aria-expanded', String(nextOpen));
  });

  menu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

  const targetId = window.location.hash.slice(1);
  if (targetId && targetId !== 'login') {
    requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: 'start' }));
  }
}
