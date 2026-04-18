export function createModal({ id = 'modal', title, body, footer, size = '' }) {
  const existing = document.getElementById(id + '-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = id + '-overlay';
  overlay.innerHTML = `
    <div class="modal ${size}">
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        <button class="modal-close" id="${id}-close">&#10005;</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>
  `;

  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('show'), 10);

  const closeModal = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  };

  overlay.querySelector(`#${id}-close`).addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  return { overlay, closeModal };
}
