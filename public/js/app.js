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
    if (!confirm(el.dataset.confirm)) e.preventDefault();
  });
});

/* ── Dashboard refresh completo (métricas + pipeline) ──────────────── */
let _lastDashboardHtml = null;

async function refreshDashboard(showToastOnChange) {
  const isDashboard = window.location.pathname === '/dashboard' || window.location.pathname === '/';
  if (!isDashboard) return;
  try {
    const res = await fetch('/dashboard/content', { credentials: 'same-origin' });
    if (!res.ok) return;
    const html = await res.text();

    if (_lastDashboardHtml !== null && html !== _lastDashboardHtml) {
      const contentEl = document.getElementById('dashboard-content');
      if (contentEl) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        const newContent = temp.querySelector('#dashboard-content');
        if (newContent) {
          contentEl.replaceWith(newContent);
          if (showToastOnChange) showToast('Dashboard atualizado.', 'info');
        }
      }
    }

    _lastDashboardHtml = html;
  } catch (e) { /* silencioso */ }
}

/* ── AJAX helper ───────────────────────────────────────────────────── */
async function apiRequest(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  return res.json();
}

/* ── Toast ──────────────────────────────────────────────────────────── */
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer') || createToastContainer();
  const id = 'toast-' + Date.now();
  const bsType = type === 'error' ? 'danger' : type;
  const icon = type === 'success' ? 'check-circle-fill' : type === 'error' ? 'x-circle-fill' : 'info-circle-fill';

  container.insertAdjacentHTML('beforeend',
    `<div id="${id}" class="toast align-items-center text-bg-${bsType} border-0" role="alert">
      <div class="d-flex">
        <div class="toast-body d-flex align-items-center gap-2">
          <i class="bi bi-${icon}"></i>${message}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);

  const toastEl = document.getElementById(id);
  new bootstrap.Toast(toastEl, { delay: 5000 }).show();
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

/* ── Banner de novo contrato ────────────────────────────────────────── */
function showNewContractBanner(customerName, trackingId) {
  const existing = document.getElementById('newContractBanner');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'newContractBanner';
  div.className = 'new-contract-banner';
  div.innerHTML =
    '<div class="d-flex align-items-center gap-3">' +
    '<div class="new-contract-icon"><i class="bi bi-star-fill"></i></div>' +
    '<div><div class="fw-semibold">Nova proposta aceita!</div>' +
    '<div class="small opacity-75">' + (customerName || '') + '</div></div>' +
    '<div class="ms-auto d-flex gap-2">' +
    (trackingId ? '<a href="/contracts/' + trackingId + '" class="btn btn-sm btn-light">Ver contrato</a>' : '') +
    '<button class="btn btn-sm btn-close btn-close-white" onclick="this.closest(\'.new-contract-banner\').remove()"></button>' +
    '</div></div>';

  document.body.appendChild(div);
  setTimeout(() => { if (div.parentNode) div.remove(); }, 12000);
}

/* ═══════════════════════════════════════════════════════════════════
   TEMPO REAL — Polling + SSE híbrido
   ═══════════════════════════════════════════════════════════════════ */

const POLL_INTERVAL_DASHBOARD = 5000;   // 5s
const POLL_INTERVAL_WEBHOOKS  = 5000;   // 5s

/* ── Dashboard: polling do pipeline ────────────────────────────────── */
(function initDashboardPolling() {
  if (window.location.pathname !== '/dashboard' && window.location.pathname !== '/') return;

  // Inicializa HTML de referência após 2s (DOM pronto), depois polling contínuo
  setTimeout(() => refreshDashboard(false), 2000);
  setInterval(() => refreshDashboard(false), POLL_INTERVAL_DASHBOARD);
})();

/* ── Webhook page: polling de novos eventos ─────────────────────────── */
(function initWebhookPolling() {
  const isWebhookPage = window.location.pathname.includes('/webhook') ||
                        window.location.pathname.includes('/settings/webhooks');
  if (!isWebhookPage) return;

  // Pega o total atual da página
  const totalEl = document.querySelector('.page-title ~ span, .page-header .text-muted');
  let lastTotal = totalEl ? parseInt(totalEl.textContent) : -1;

  async function pollWebhooks() {
    try {
      const res = await fetch('/webhook-events?_poll=1', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;

      const data = await res.json();
      if (data.total === undefined) return;

      if (lastTotal !== -1 && data.total > lastTotal) {
        // Novos eventos chegaram — recarrega a tabela
        showWebhookUpdateBanner(data.total - lastTotal);
        lastTotal = data.total;
      } else {
        lastTotal = data.total;
      }
    } catch (e) { /* silencioso */ }
  }

  setTimeout(pollWebhooks, 3000);
  setInterval(pollWebhooks, POLL_INTERVAL_WEBHOOKS);
})();

function showWebhookUpdateBanner(count) {
  // Remove banner anterior se existir
  const old = document.getElementById('webhookUpdateBanner');
  if (old) old.remove();

  const div = document.createElement('div');
  div.id = 'webhookUpdateBanner';
  div.className = 'alert alert-info alert-dismissible d-flex align-items-center gap-2 mb-3 fade show';
  div.style.cssText = 'position:sticky;top:64px;z-index:100;';
  div.innerHTML =
    '<i class="bi bi-arrow-repeat"></i>' +
    '<span>' + count + ' novo(s) evento(s) de webhook recebido(s).</span>' +
    '<button type="button" class="btn btn-sm btn-info ms-2" onclick="location.reload()">Atualizar agora</button>' +
    '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>';

  const content = document.querySelector('.content-area');
  if (content) content.prepend(div);
  else document.body.prepend(div);
}

/* ── SSE (bonus — funciona quando nginx não bloqueia) ───────────────── */
(function initSSE() {
  if (typeof EventSource === 'undefined') return;

  let retryDelay = 5000;

  function connect() {
    const evtSource = new EventSource('/events');

    evtSource.onopen = function () {
      retryDelay = 5000;
    };

    evtSource.addEventListener('new-contract', function (e) {
      try {
        const data = JSON.parse(e.data);
        showNewContractBanner(data.customerName, data.trackingId);
        refreshDashboard(false);
      } catch (err) { /* ignore */ }
    });

    evtSource.addEventListener('pipeline-updated', function () {
      refreshDashboard(true);
    });

    evtSource.onerror = function () {
      evtSource.close();
      retryDelay = Math.min(retryDelay * 2, 60000);
      setTimeout(connect, retryDelay);
    };
  }

  connect();
})();
