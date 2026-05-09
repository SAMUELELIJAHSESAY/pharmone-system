/**
 * Theme Management System
 * Handles light, dark, and pharmacy-specific themes
 */

const THEME_KEY = 'pharmacy-theme';
const THEMES = {
  light: 'light',
  dark: 'dark',
  pharmacy: 'pharmacy' // Custom pharmacy-themed (teal/green)
};

/**
 * Initialize theme system on page load
 */
export function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || THEMES.light;
  applyTheme(savedTheme);
  return savedTheme;
}

/**
 * Apply theme to the document
 */
export function applyTheme(theme) {
  // Remove all theme classes
  document.documentElement.classList.remove('theme-light', 'theme-dark', 'theme-pharmacy');
  
  // Apply new theme class
  document.documentElement.classList.add(`theme-${theme}`);
  
  // Save preference
  localStorage.setItem(THEME_KEY, theme);
}

/**
 * Get current theme
 */
export function getCurrentTheme() {
  return localStorage.getItem(THEME_KEY) || THEMES.light;
}

/**
 * Toggle between themes
 */
export function toggleTheme() {
  const current = getCurrentTheme();
  const themeList = Object.values(THEMES);
  const currentIndex = themeList.indexOf(current);
  const nextTheme = themeList[(currentIndex + 1) % themeList.length];
  
  applyTheme(nextTheme);
  return nextTheme;
}

/**
 * Get all available themes
 */
export function getAvailableThemes() {
  return Object.values(THEMES);
}

/**
 * Get theme display name
 */
export function getThemeDisplayName(theme) {
  const names = {
    [THEMES.light]: '☀️ Light',
    [THEMES.dark]: '🌙 Dark',
    [THEMES.pharmacy]: '🏥 Pharmacy'
  };
  return names[theme] || theme;
}

/**
 * Set specific theme
 */
export function setTheme(theme) {
  if (Object.values(THEMES).includes(theme)) {
    applyTheme(theme);
  }
}

export { THEMES };
