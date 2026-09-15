# UI Links, Buttons, Titles & Overflow Audit

This pass uses the previously mobile-optimized project as the base.

## Horizontal overflow fixes

- Removed app-wide horizontal page scrolling.
- Replaced mobile table horizontal scrolling with responsive labelled card rows.
- Made dynamically inserted table rows inherit responsive labels automatically.
- Wrapped tabs on small screens instead of allowing sideways tab scrolling.
- Constrained legacy fixed-width inline elements, forms, modals, cards, media, and controls to the viewport.
- Allowed long table/content values to wrap rather than widen the page.

## Broken links/navigation fixed

- Fixed the account/password-change redirect from the nonexistent `/login.html` to the actual SPA root `/`.
- Replaced access-denied buttons that imported the wrong `./app.js` path with the existing global SPA navigator.
- Replaced the Admin Dashboard dummy `href="#"` inventory link with a real SPA navigation button.
- Confirmed every sidebar/navigation target maps to an existing route in `src/views/app.js`.
- Confirmed all relative JavaScript module imports resolve to files in the project.

## Page title fixes

- Added a single title map covering every SPA route.
- Topbar titles and browser-tab titles now update together during navigation.
- Added a dedicated `Sign In | PharmaCare` browser title.
- Branch Details updates the browser title with the loaded branch name.
- Search Results, Access Denied, and Page Not Found now set correct browser/topbar titles.

## Broken/unwired buttons and controls fixed

- Branch Details `Save Changes` handler is now correctly exposed for its inline form submit.
- Branch Details sales date filter now performs a real filter instead of showing a placeholder alert.
- Branch Details inventory search, low-stock filter, and out-of-stock filter now work.
- Patient `Edit` / `Edit Information` buttons now open a working edit form and save through `updatePatient`.
- Patient detail tabs now use the clicked tab safely instead of relying on an implicit global `event`.
- Stock Transfer `Mark as Received` is now exposed to the inline button and its visibility uses `style.display` correctly.
- Sales History `Export PDF` now opens a printable report suitable for Save as PDF instead of showing “coming soon”.
- Legacy staff-management inline handlers are explicitly exposed and its branch/search filtering is implemented.

## Validation

- 45 JavaScript files passed `node --check` syntax validation.
- CSS parsed with 0 syntax errors.
- 0 missing relative module imports found.
- 0 unresolved inline-handler function references found in active JavaScript files.
- 0 sidebar/navigation targets without matching SPA route cases.
- Every SPA route has a configured page title.

A full Vite production build was not run because npm dependencies are not included in the ZIP and the execution environment did not have the required packages cached for offline installation.
