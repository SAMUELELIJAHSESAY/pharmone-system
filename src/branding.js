const DEFAULT_BRAND_COLOR = '#2563eb';
const DEFAULT_RECEIPT_TEMPLATE = 'Thank you for choosing {branch_name}.';

function normalizeHex(value, fallback = DEFAULT_BRAND_COLOR) {
  const candidate = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toLowerCase() : fallback;
}

function hexToRgb(hex) {
  const value = normalizeHex(hex).slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const part = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function mix(hex, targetHex, amount) {
  const source = hexToRgb(hex);
  const target = hexToRgb(targetHex);
  const ratio = Math.max(0, Math.min(1, Number(amount) || 0));
  return rgbToHex({
    r: source.r + (target.r - source.r) * ratio,
    g: source.g + (target.g - source.g) * ratio,
    b: source.b + (target.b - source.b) * ratio
  });
}

export function setPharmacyBrandingScope(pharmacyId = '') {
  const root = document.documentElement;
  root.dataset.brandingScope = 'pharmacy';
  root.dataset.pharmacyBrandTarget = String(pharmacyId || '');
}

export function applyPharmacyBranding(settings = {}) {
  const root = document.documentElement;
  const settingsId = String(settings?.id || '');
  const targetId = String(root.dataset.pharmacyBrandTarget || '');

  // Tenant colors are allowed only while an authenticated pharmacy workspace
  // explicitly owns the branding scope. This prevents delayed async settings
  // responses from recoloring the public website after logout/navigation.
  if (root.dataset.brandingScope !== 'pharmacy') return null;
  if (targetId && settingsId && targetId !== settingsId) return null;
  if (!document.querySelector('.app-shell')) return null;
  const color = normalizeHex(settings?.branding_color);
  const hover = mix(color, '#000000', 0.18);
  const soft = mix(color, '#ffffff', 0.92);
  const light = mix(color, '#ffffff', 0.35);
  const level100 = mix(color, '#ffffff', 0.84);

  root.style.setProperty('--sammia-blue', color);
  root.style.setProperty('--sammia-blue-hover', hover);
  root.style.setProperty('--sammia-blue-soft', soft);
  root.style.setProperty('--primary', color);
  root.style.setProperty('--primary-dark', hover);
  root.style.setProperty('--primary-light', light);
  root.style.setProperty('--primary-50', soft);
  root.style.setProperty('--primary-100', level100);
  root.style.setProperty('--blue-50', soft);
  root.style.setProperty('--blue-300', mix(color, '#ffffff', 0.55));
  root.style.setProperty('--blue-700', mix(color, '#000000', 0.28));
  root.dataset.pharmacyBrand = settings?.id || '';
  root.dataset.pharmacyBrandColor = color;
  return color;
}

export function resetPharmacyBranding() {
  const root = document.documentElement;
  [
    '--sammia-blue', '--sammia-blue-hover', '--sammia-blue-soft',
    '--primary', '--primary-dark', '--primary-light', '--primary-50', '--primary-100',
    '--blue-50', '--blue-300', '--blue-700'
  ].forEach((name) => root.style.removeProperty(name));
  delete root.dataset.pharmacyBrand;
  delete root.dataset.pharmacyBrandColor;
  delete root.dataset.pharmacyBrandTarget;
  root.dataset.brandingScope = 'platform';
}

export function getPharmacyLogoUrl(settings = {}) {
  const url = String(settings?.logo_url || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
  return '';
}

export function resolveReceiptFooter(settings = {}, {
  branchId = null,
  branchName = '',
  pharmacyName = ''
} = {}) {
  const operational = settings?.operational_settings || {};
  const branchOverrides = operational?.branch_receipt_footers || {};
  const override = branchId ? branchOverrides?.[branchId] : '';
  const raw = String(override || operational?.receipt_footer || DEFAULT_RECEIPT_TEMPLATE).trim() || DEFAULT_RECEIPT_TEMPLATE;
  const safeBranchName = String(branchName || pharmacyName || settings?.name || 'Pharmacy').trim() || 'Pharmacy';
  const safePharmacyName = String(pharmacyName || settings?.name || safeBranchName).trim() || 'Pharmacy';

  return raw
    .replace(/\{branch_name\}/gi, safeBranchName)
    .replace(/\{pharmacy_name\}/gi, safePharmacyName);
}

export function receiptTemplatePreview(template, branchName, pharmacyName) {
  return resolveReceiptFooter({
    name: pharmacyName,
    operational_settings: { receipt_footer: template }
  }, { branchName, pharmacyName });
}

export { DEFAULT_BRAND_COLOR, DEFAULT_RECEIPT_TEMPLATE };
