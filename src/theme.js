/**
 * SamMia Pharm uses one consistent light brand theme across public pages and
 * authenticated workspaces. The API is kept stable for older components.
 */
const THEME_KEY = 'sammia-pharm-theme';
const THEMES = Object.freeze({ light: 'light' });

export function initTheme() {
  localStorage.removeItem('pharmacy-theme');
  applyTheme(THEMES.light);
  return THEMES.light;
}

export function applyTheme() {
  document.documentElement.classList.remove('theme-dark', 'theme-pharmacy');
  document.documentElement.classList.add('theme-light');
  document.documentElement.style.colorScheme = 'light';
  localStorage.setItem(THEME_KEY, THEMES.light);
}

export function getCurrentTheme() {
  return THEMES.light;
}

export function toggleTheme() {
  applyTheme();
  return THEMES.light;
}

export function getAvailableThemes() {
  return [THEMES.light];
}

export function getThemeDisplayName() {
  return '☀️ SamMia Light';
}

export function setTheme() {
  applyTheme();
}

export { THEMES };
