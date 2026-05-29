
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

/* ── SSE — notificações em tempo real ──────────────────────────────── */
(function initSSE() {
  if (typeof EventSource === 'undefined') return;

  let retryDelay = 3000;
  let reloadTimer = null;

  function connect() {
    const evtSource = new EventSource('/events');

    evtSource.addEventListener('new-contract', function (e) {
      try {
        const data = JSON.parse(e.data);
        const name = data.customerName || data.dealTitle || 'Novo lead';

        // Banner de notificação persistente com botão de atualizar
        showNewContractBanner(name, data.trackingId);

        // Se estiver no dashboard, atualiza o pipeline automaticamente após 4s
        if (window.location.pathname === '/dashboard' || window.location.pathname === '/') {
          if (reloadTimer) clearTimeout(reloadTimer);
          reloadTimer = setTimeout(function () {
            reloadPipelineSection();
          }, 4000);
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    });

    evtSource.onerror = function () {
      evtSource.close();
      // Reconecta com backoff exponencial (máx 30s)
      retryDelay = Math.min(retryDelay * 2, 30000);
      setTimeout(connect, retryDelay);
    };

    evtSource.onopen = function () {
      retryDelay = 3000; // reseta delay ao reconectar
    };
  }

  connect();
})();

/* Banner de novo contrato */
function showNewContractBanner(customerName, trackingId) {
  const existing = document.getElementById('newContractBanner');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'newContractBanner';
  div.className = 'new-contract-banner';
  div.innerHTML =
    '<div class="d-flex align-items-center gap-3">' +
    '<div class="new-contract-icon"><i class="bi bi-star-fill"></i></div>' +
    '<div>' +
    '<div class="fw-semibold">Nova proposta aceita!</div>' +
    '<div class="small opacity-75">' + customerName + '</div>' +
    '</div>' +
    '<div class="ms-auto d-flex gap-2">' +
    (trackingId ? '<a href="/contracts/' + trackingId + '" class="btn btn-sm btn-light">Ver contrato</a>' : '') +
    '<button class="btn btn-sm btn-outline-light" onclick="reloadPipelineSection()">Atualizar</button>' +
    '<button class="btn btn-sm btn-close btn-close-white" onclick="this.closest(\'.new-contract-banner\').remove()"></button>' +
    '</div></div>';

  document.body.appendChild(div);

  // Remove automaticamente após 15s
  setTimeout(function () { div.remove(); }, 15000);
}

/* Recarrega apenas a seção do pipeline sem refresh total */
async function reloadPipelineSection() {
  const banner = document.getElementById('newContractBanner');
  if (banner) banner.remove();

  try {
    const res = await fetch('/dashboard/pipeline', { headers: { Accept: 'application/json' } });
    if (!res.ok) { window.location.reload(); return; }

    const html = await res.text();
    const pipelineCard = document.querySelector('.pipeline-grid')?.closest('.card');
    if (pipelineCard) {
      // Substitui o card do pipeline com a versão atualizada
      const temp = document.createElement('div');
      temp.innerHTML = html;
      const newCard = temp.querySelector('.card');
      if (newCard) {
        pipelineCard.replaceWith(newCard);
        showToast('Pipeline atualizado.', 'info');
        return;
      }
    }
    // Fallback: reload completo
    window.location.reload();
  } catch {
    window.location.reload();
  }
}
