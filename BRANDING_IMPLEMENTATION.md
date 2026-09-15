# SamMia Pharm Branding Implementation

## Implemented

- New public landing/hero page shown before authentication.
- New SamMia Pharm visual identity using Inter and the approved brand tokens:
  - SamMia Blue: `#2563eb`
  - SamMia Navy: `#0f2d5b`
  - Background: `#f8fafc`
  - Neutral: `#e5e7eb`
- New SamMia Pharm logo mark, horizontal logo assets, favicon, Apple touch icon and PWA icons.
- Branded login page with a desktop split layout and compact mobile layout.
- Existing authenticated application changed from the old teal identity to the SamMia blue/navy system.
- Sidebar branding changed to SamMia Pharm while preserving the active pharmacy/role as secondary context.
- Browser page titles changed to `... | SamMia Pharm`.
- PWA manifest, install copy, offline page, service-worker cache naming and application metadata rebranded.
- Social/Open Graph metadata added for the target production domain.
- Package/project slug changed to `sammia-pharm`.

## Public flow

- `/` renders the public SamMia Pharm landing page for signed-out visitors.
- `#login` renders the sign-in experience without requiring server-side route rewrites.
- Signed-in users continue directly into their authorized workspace.

## Logo assets

- `public/brand/sammia-mark.svg`
- `public/brand/sammia-logo.svg`
- `public/brand/sammia-logo-white.svg`
- `public/favicon.svg`
- `public/favicon.ico`
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/icon-maskable-512.png`
- `public/icons/apple-touch-icon.png`

## Vercel target

Target project/domain: `sammia-pharm.vercel.app`.

The repository metadata and canonical/social URLs now use that target. The Vercel project itself must still be renamed in Vercel after deployment because the project name is an account-level setting, not a repository file setting. If the name is available, set the Vercel project name to `sammia-pharm`.
