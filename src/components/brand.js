export const BRAND = Object.freeze({
  name: 'SamMia Pharm',
  shortName: 'SamMia Pharm',
  tagline: 'Simpler Pharmacy. Brighter Health.',
  domain: 'sammia-pharm.vercel.app'
});

export function renderBrandLogo({ inverse = false, compact = false, className = '' } = {}) {
  const textClass = inverse ? ' brand-logo--inverse' : '';
  return `
    <span class="brand-logo${textClass}${compact ? ' brand-logo--compact' : ''}${className ? ` ${className}` : ''}">
      <img class="brand-logo-mark" src="/brand/sammia-mark.png" alt="" aria-hidden="true" />
      <span class="brand-logo-wordmark"><strong>SamMia</strong><strong>Pharm</strong></span>
    </span>
  `;
}
