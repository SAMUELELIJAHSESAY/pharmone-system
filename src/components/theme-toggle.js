import { toggleTheme, getCurrentTheme, getAvailableThemes, getThemeDisplayName, setTheme } from '../theme.js';
import { createModal } from './modal.js';

export function createThemeToggle() {
  const currentTheme = getCurrentTheme();
  const themes = getAvailableThemes();
  
  return `
    <button 
      class="theme-toggle-btn" 
      title="Toggle theme (${getThemeDisplayName(currentTheme)})"
      id="theme-toggle-btn"
      style="
        background: none;
        border: 1.5px solid var(--gray-300);
        border-radius: var(--radius-sm);
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 1.1rem;
        transition: all var(--transition);
        color: var(--gray-700);
      "
    >
      ${getThemeIcon(currentTheme)}
    </button>
  `;
}

function getThemeIcon(theme) {
  const icons = {
    light: '☀️',
    dark: '🌙',
    pharmacy: '🏥'
  };
  return icons[theme] || '☀️';
}

export function initThemeToggle() {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const nextTheme = toggleTheme();
    btn.innerHTML = getThemeIcon(nextTheme);
    btn.title = `Toggle theme (${getThemeDisplayName(nextTheme)})`;
  });

  // Show theme menu on right-click or long press
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showThemeMenu();
  });
}

function showThemeMenu() {
  const themes = getAvailableThemes();
  const current = getCurrentTheme();
  
  createModal({
    id: 'theme-selector',
    title: '🎨 Select Theme',
    body: `
      <div style="display: grid; gap: 0.75rem">
        ${themes.map(theme => `
          <button
            class="theme-option-btn ${theme === current ? 'active' : ''}"
            data-theme="${theme}"
            style="
              padding: 0.75rem 1rem;
              border: 2px solid ${theme === current ? 'var(--primary)' : 'var(--gray-200)'};
              background: ${theme === current ? 'var(--primary-50)' : 'white'};
              border-radius: var(--radius-sm);
              cursor: pointer;
              transition: all var(--transition);
              font-weight: ${theme === current ? '600' : '500'};
              color: var(--gray-900);
              font-size: 0.95rem;
              text-align: left;
            "
          >
            ${getThemeIcon(theme)} ${getThemeDisplayName(theme)}
            ${theme === current ? ' ✓' : ''}
          </button>
        `).join('')}
      </div>
    `,
    footer: ''
  });

  // Add event listeners
  document.querySelectorAll('.theme-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      setTheme(theme);
      const toggleBtn = document.getElementById('theme-toggle-btn');
      if (toggleBtn) {
        toggleBtn.innerHTML = getThemeIcon(theme);
        toggleBtn.title = `Toggle theme (${getThemeDisplayName(theme)})`;
      }
      // Close modal
      const modal = document.querySelector('.modal-overlay');
      if (modal) modal.remove();
    });
  });
}
