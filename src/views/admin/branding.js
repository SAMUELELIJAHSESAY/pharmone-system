import {
  getPharmacySettings,
  getBranches,
  updateAdminPharmacyBranding,
  uploadPharmacyLogo,
  removePharmacyLogo
} from '../../database.js';
import { showToast } from '../../utils.js';
import { applyPharmacyBranding, getPharmacyLogoUrl, resolveReceiptFooter } from '../../branding.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeBranchFooters(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

export async function renderBranding(container, user) {
  const pharmacyId = user?.profile?.pharmacy_id;
  if (user?.profile?.role !== 'admin' || !pharmacyId) {
    container.innerHTML = '<div class="alert alert-danger">Only Pharmacy Admins can manage pharmacy branding.</div>';
    return;
  }

  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const [settings, branches] = await Promise.all([
      getPharmacySettings(pharmacyId),
      getBranches(pharmacyId)
    ]);
    renderBrandingView(container, user, settings, branches || []);
  } catch (error) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load branding: ${esc(error.message)}</div>`;
  }
}

function renderBrandingView(container, user, settings, branches) {
  const operational = settings.operational_settings || {};
  const branchFooters = normalizeBranchFooters(operational.branch_receipt_footers);
  const currentLogo = getPharmacyLogoUrl(settings);
  let pendingLogoFile = null;
  let removeLogo = false;
  let previewObjectUrl = '';

  container.innerHTML = `
    <div class="animate-in pharmacy-branding-page">
      <div class="page-header">
        <div>
          <div class="page-title">Branding</div>
          <div class="page-subtitle">Manage the pharmacy color, logo and branch-aware receipt footer.</div>
        </div>
      </div>

      <div class="branding-layout">
        <section class="card branding-settings-card">
          <div class="card-header"><div><div class="card-title">Pharmacy Identity</div><div class="text-sm text-muted">Changes apply to this pharmacy workspace after saving.</div></div></div>
          <div class="branding-section">
            <label class="form-label">Pharmacy Logo</label>
            <div class="branding-logo-row">
              <div class="branding-logo-preview" id="branding-logo-preview">
                ${currentLogo ? `<img src="${esc(currentLogo)}" alt="${esc(settings.name)} logo" />` : '<span>No logo</span>'}
              </div>
              <div class="branding-logo-actions">
                <div class="branding-dropzone" id="branding-logo-dropzone" tabindex="0" role="button" aria-label="Upload pharmacy logo">
                  <strong>Drop logo here</strong>
                  <span>or click to choose PNG, JPG or WebP · max 2 MB</span>
                  <input type="file" id="branding-logo-input" accept="image/png,image/jpeg,image/webp" hidden />
                </div>
                <button type="button" class="btn btn-ghost btn-sm" id="branding-remove-logo" ${currentLogo ? '' : 'disabled'}>Remove Logo</button>
              </div>
            </div>
          </div>

          <div class="branding-section">
            <label class="form-label" for="branding-color">Branding Color</label>
            <div class="settings-color-row branding-color-row">
              <input type="color" class="form-input settings-color-input" id="branding-color" value="${esc(settings.branding_color || '#2563eb')}" />
              <input type="text" class="form-input" id="branding-color-text" maxlength="7" value="${esc(settings.branding_color || '#2563eb')}" />
            </div>
            <small class="text-muted">This color is used for active navigation, buttons, tabs, highlights and other pharmacy workspace accents.</small>
          </div>

          <div class="branding-section">
            <label class="form-label" for="branding-receipt-footer">Default Receipt Footer</label>
            <textarea class="form-input" id="branding-receipt-footer" rows="3" maxlength="300">${esc(operational.receipt_footer || 'Thank you for choosing {branch_name}.')}</textarea>
            <div class="branding-token-row">
              <button type="button" class="btn btn-ghost btn-sm" data-footer-token="{branch_name}">{branch_name}</button>
              <button type="button" class="btn btn-ghost btn-sm" data-footer-token="{pharmacy_name}">{pharmacy_name}</button>
            </div>
            <small class="text-muted">Use <strong>{branch_name}</strong> to automatically print the correct branch name on each receipt. Use <strong>{pharmacy_name}</strong> for the pharmacy name.</small>
          </div>

          <div class="branding-section">
            <div class="branding-section-heading"><div><div class="form-label">Branch Footer Overrides</div><small class="text-muted">Optional. Leave blank to use the default template above.</small></div></div>
            <div class="branding-branch-footers">
              ${branches.length ? branches.map(branch => `
                <label class="branding-branch-footer-card">
                  <span><strong>${esc(branch.name)}</strong><small>${esc(branch.address || 'No address')}</small></span>
                  <textarea class="form-input" rows="2" maxlength="300" data-branch-footer="${branch.id}" placeholder="Use default footer">${esc(branchFooters[branch.id] || '')}</textarea>
                </label>
              `).join('') : '<div class="empty-state compact"><div class="empty-state-desc">No branches have been created yet.</div></div>'}
            </div>
          </div>

          <div class="branding-save-row">
            <label class="form-group branding-note-field"><span class="form-label">Change Note <span class="text-muted">(optional)</span></span><input class="form-input" id="branding-note" maxlength="180" placeholder="e.g. Updated pharmacy logo and receipt branding" /></label>
            <button type="button" class="btn btn-primary" id="branding-save">Save Branding</button>
          </div>
        </section>

        <aside class="card branding-preview-card">
          <div class="card-header"><div class="card-title">Live Preview</div></div>
          <div class="branding-preview-shell" id="branding-live-preview">
            <div class="branding-preview-sidebar"><div class="branding-preview-logo">${currentLogo ? `<img src="${esc(currentLogo)}" alt="" />` : '<img src="/brand/sammia-mark.png" alt="" />'}</div><div><strong>${esc(settings.name)}</strong><span>Admin workspace</span></div></div>
            <button type="button" class="btn btn-primary branding-preview-button">Primary Action</button>
            <div class="branding-preview-receipt">
              <strong>Receipt footer preview</strong>
              <span id="branding-footer-preview"></span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;

  const color = container.querySelector('#branding-color');
  const colorText = container.querySelector('#branding-color-text');
  const footer = container.querySelector('#branding-receipt-footer');
  const dropzone = container.querySelector('#branding-logo-dropzone');
  const input = container.querySelector('#branding-logo-input');
  const logoPreview = container.querySelector('#branding-logo-preview');
  const livePreview = container.querySelector('#branding-live-preview');
  const previewLogo = livePreview?.querySelector('.branding-preview-logo');
  const footerPreview = container.querySelector('#branding-footer-preview');

  function updatePreview() {
    const chosenBranch = branches[0] || { id: '', name: settings.name };
    const previewSettings = {
      ...settings,
      branding_color: colorText.value,
      operational_settings: {
        ...operational,
        receipt_footer: footer.value,
        branch_receipt_footers: collectBranchFooters(container)
      }
    };
    const resolved = resolveReceiptFooter(previewSettings, {
      branchId: chosenBranch.id,
      branchName: chosenBranch.name,
      pharmacyName: settings.name
    });
    if (footerPreview) footerPreview.textContent = resolved;
    if (livePreview && /^#[0-9a-f]{6}$/i.test(colorText.value)) livePreview.style.setProperty('--preview-brand', colorText.value);
  }

  function setFile(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return showToast('Logo must be PNG, JPG or WebP.', 'warning');
    if (file.size > 2 * 1024 * 1024) return showToast('Logo must be 2 MB or smaller.', 'warning');
    pendingLogoFile = file;
    removeLogo = false;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);
    logoPreview.innerHTML = `<img src="${previewObjectUrl}" alt="New pharmacy logo preview" />`;
    if (previewLogo) previewLogo.innerHTML = `<img src="${previewObjectUrl}" alt="" />`;
    container.querySelector('#branding-remove-logo').disabled = false;
  }

  dropzone?.addEventListener('click', () => input?.click());
  dropzone?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input?.click(); } });
  ['dragenter', 'dragover'].forEach(type => dropzone?.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(type => dropzone?.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
  dropzone?.addEventListener('drop', event => setFile(event.dataTransfer?.files?.[0]));
  input?.addEventListener('change', () => setFile(input.files?.[0]));

  container.querySelector('#branding-remove-logo')?.addEventListener('click', event => {
    pendingLogoFile = null;
    removeLogo = true;
    if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = ''; }
    logoPreview.innerHTML = '<span>No logo</span>';
    if (previewLogo) previewLogo.innerHTML = '<img src="/brand/sammia-mark.png" alt="" />';
    event.currentTarget.disabled = true;
  });

  color?.addEventListener('input', () => { colorText.value = color.value; updatePreview(); });
  colorText?.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(colorText.value)) color.value = colorText.value; updatePreview(); });
  footer?.addEventListener('input', updatePreview);
  container.querySelectorAll('[data-branch-footer]').forEach(field => field.addEventListener('input', updatePreview));
  container.querySelectorAll('[data-footer-token]').forEach(button => button.addEventListener('click', () => {
    const token = button.dataset.footerToken;
    const start = footer.selectionStart ?? footer.value.length;
    const end = footer.selectionEnd ?? start;
    footer.value = `${footer.value.slice(0, start)}${token}${footer.value.slice(end)}`;
    footer.focus();
    footer.setSelectionRange(start + token.length, start + token.length);
    updatePreview();
  }));

  updatePreview();

  container.querySelector('#branding-save')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const brandColor = colorText.value.trim();
    if (!/^#[0-9a-f]{6}$/i.test(brandColor)) return showToast('Branding color must be a six-digit hex color.', 'warning');
    if (footer.value.length > 300) return showToast('Receipt footer must be 300 characters or fewer.', 'warning');

    button.disabled = true;
    button.textContent = 'Saving…';
    let uploaded = null;
    const oldLogo = currentLogo;
    try {
      if (pendingLogoFile) uploaded = await uploadPharmacyLogo(settings.id, pendingLogoFile);
      const logoUrl = removeLogo ? '' : (uploaded?.url || currentLogo || '');
      await updateAdminPharmacyBranding(settings.id, {
        branding_color: brandColor,
        logo_url: logoUrl,
        operational_settings: {
          receipt_footer: footer.value.trim(),
          branch_receipt_footers: collectBranchFooters(container)
        }
      }, container.querySelector('#branding-note')?.value || '');

      if ((uploaded || removeLogo) && oldLogo && oldLogo !== logoUrl) removePharmacyLogo(oldLogo).catch(() => {});
      const refreshed = await getPharmacySettings(settings.id);
      window.pharmacySettings = refreshed;
      applyPharmacyBranding(refreshed);
      window.dispatchEvent(new CustomEvent('pharmacy-branding-updated', { detail: { settings: refreshed } }));
      showToast('Pharmacy branding updated', 'success');
      renderBrandingView(container, user, refreshed, branches);
    } catch (error) {
      if (uploaded?.url) removePharmacyLogo(uploaded.url).catch(() => {});
      showToast(error.message || 'Failed to save branding', 'error');
      button.disabled = false;
      button.textContent = 'Save Branding';
    }
  });
}

function collectBranchFooters(container) {
  const result = {};
  container.querySelectorAll('[data-branch-footer]').forEach(field => {
    const value = String(field.value || '').trim();
    if (value) result[field.dataset.branchFooter] = value;
  });
  return result;
}
