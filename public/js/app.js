/* ── Sidebar toggle ─────────────────────────────────────────────────── */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;
  sidebar.classList.toggle('open');
  overlay?.classList.toggle('show');
}

/* ── Auto-dismiss flash messages ───────────────────────────────────── */
(function () {
  const alerts = document.querySelectorAll('.flash-alert');
  alerts.forEach((el) => {
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 5000);
  });
})();

/* ── Confirmação em formulários destrutivos ────────────────────────── */
document.querySelectorAll('[data-confirm]').forEach((el) => {
  el.addEventListener('click', (e) => {
    if (!confirm(el.dataset.confirm)) {
      e.preventDefault();
    }
  });
});

/* ── AJAX helper ───────────────────────────────────────────────────── */
async function apiRequest(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  return res.json();
}

/* ── Toast simples ─────────────────────────────────────────────────── */
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer') || createToastContainer();
  const id = 'toast-' + Date.now();
  const bsType = type === 'error' ? 'danger' : type;
  const icon =
    type === 'success'
      ? 'check-circle-fill'
      : type === 'error'
      ? 'x-circle-fill'
      : 'info-circle-fill';

  container.insertAdjacentHTML(
    'beforeend',
    `<div id="${id}" class="toast align-items-center text-bg-${bsType} border-0" role="alert">
      <div class="d-flex">
        <div class="toast-body d-flex align-items-center gap-2">
          <i class="bi bi-${icon}"></i>${message}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`,
  );

  const toastEl = document.getElementById(id);
  const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
  toast.show();
  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

function createToastContainer() {
  const div = document.createElement('div');
  div.id = 'toastContainer';
  div.className = 'toast-container position-fixed bottom-0 end-0 p-3';
  div.style.zIndex = '9999';
  document.body.appendChild(div);
  return div;
}
