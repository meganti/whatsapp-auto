const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');

const STATUS_LABELS = {
  open: ['Conectado', 'open'],
  qr: ['Aguardando pareamento', 'qr'],
  close: ['Desconectado', 'close'],
  connecting: ['Conectando…', 'connecting'],
};

const EVENT_LABELS = {
  transcription: 'Transcrição',
  error: 'Erro',
  connection: 'Conexão',
  settings: 'Config',
};

let pollTimer = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Erro inesperado.');
  }
  return data;
}

function showMsg(el, text, type) {
  el.textContent = text;
  el.className = `msg ${type}`;
  el.hidden = !text;
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function formatUsd(value) {
  const n = Number(value) || 0;
  const decimals = n >= 1 ? 2 : 4;
  return 'US$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatMonthLabel(monthStr) {
  if (!monthStr) return 'Acumulado no mês';
  const [y, m] = monthStr.split('-').map(Number);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `Acumulado em ${label}`;
}

function formatDayLabel(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

function renderUsage(usage) {
  if (!usage) return;

  document.getElementById('cost-today').textContent = formatUsd(usage.today?.costUsd);
  document.getElementById('cost-month').textContent = formatUsd(usage.month?.costUsd);
  document.getElementById('cost-month-label').textContent = formatMonthLabel(usage.month?.month);

  const list = document.getElementById('cost-days');
  if (!usage.days || usage.days.length === 0) {
    list.innerHTML = '<p class="empty">Nenhuma transcrição neste mês ainda.</p>';
    return;
  }

  list.innerHTML = usage.days
    .map((d) => {
      const minutes = ((d.seconds || 0) / 60).toFixed(1);
      return `<div class="event-item">
        <span class="event-badge settings">${formatDayLabel(d.date)}</span>
        <div class="event-text">${formatUsd(d.costUsd)}<div class="event-time">${d.count} transcrição(ões) · ${minutes} min de áudio</div></div>
      </div>`;
    })
    .join('');
}

function renderStatus(data) {
  const [label, cls] = STATUS_LABELS[data.connection] || STATUS_LABELS.connecting;
  document.getElementById('status-dot').className = `status-dot ${cls}`;
  document.getElementById('status-label').textContent = label;

  const sub = document.getElementById('status-sub');
  sub.textContent = data.lastConnectedAt ? `Conectado desde ${formatTime(data.lastConnectedAt)}` : '';

  const qrBox = document.getElementById('qr-box');
  const qrImage = document.getElementById('qr-image');
  if (data.connection === 'qr' && data.qrDataUrl) {
    qrImage.src = data.qrDataUrl;
    qrBox.hidden = false;
  } else {
    qrBox.hidden = true;
  }

  document.getElementById('stat-transcriptions').textContent = data.stats.transcriptions;
  document.getElementById('stat-errors').textContent = data.stats.errors;

  renderUsage(data.usage);
  renderEvents(data.events);
}

function renderEvents(events) {
  const list = document.getElementById('event-list');
  if (!events || events.length === 0) {
    list.innerHTML = '<p class="empty">Nenhuma atividade ainda.</p>';
    return;
  }

  list.innerHTML = events
    .slice(0, 30)
    .map((ev) => {
      const badge = EVENT_LABELS[ev.type] || ev.type;
      const text = escapeHtml(ev.message);
      return `<div class="event-item">
        <span class="event-badge ${ev.type}">${badge}</span>
        <div class="event-text">${text}<div class="event-time">${formatTime(ev.timestamp)}</div></div>
      </div>`;
    })
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function refreshStatus() {
  try {
    const data = await api('/api/status');
    renderStatus(data);
  } catch (err) {
    // sessão pode ter expirado
    if (err.message.includes('autenticado')) {
      stopPolling();
      showDashboard(false);
    }
  }
}

function startPolling() {
  stopPolling();
  refreshStatus();
  pollTimer = setInterval(refreshStatus, 3000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function loadSettings() {
  const data = await api('/api/settings');
  document.getElementById('setting-model').value = data.transcriptionModel;
  document.getElementById('setting-language').value = data.transcriptionLanguage;
  document.getElementById('setting-only-own').checked = data.onlyTranscribeOwnAudios;
}

function showDashboard(show) {
  loginView.hidden = show;
  dashboardView.hidden = !show;
  if (show) {
    loadSettings().catch(() => {});
    startPolling();
  } else {
    stopPolling();
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('login-msg');
  showMsg(msg, '', '');
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('login-username').value,
        password: document.getElementById('login-password').value,
      }),
    });
    document.getElementById('login-password').value = '';
    showDashboard(true);
  } catch (err) {
    showMsg(msg, err.message, 'error');
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  showDashboard(false);
});

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('settings-msg');
  showMsg(msg, '', '');
  try {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        transcriptionModel: document.getElementById('setting-model').value,
        transcriptionLanguage: document.getElementById('setting-language').value,
        onlyTranscribeOwnAudios: document.getElementById('setting-only-own').checked,
      }),
    });
    showMsg(msg, 'Configurações salvas.', 'success');
  } catch (err) {
    showMsg(msg, err.message, 'error');
  }
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('password-msg');
  showMsg(msg, '', '');
  try {
    await api('/api/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: document.getElementById('pw-current').value,
        newPassword: document.getElementById('pw-new').value,
      }),
    });
    document.getElementById('password-form').reset();
    showMsg(msg, 'Senha alterada com sucesso.', 'success');
  } catch (err) {
    showMsg(msg, err.message, 'error');
  }
});

document.getElementById('reset-session-btn').addEventListener('click', async () => {
  const msg = document.getElementById('reset-msg');
  if (!confirm('Tem certeza? Isso desconecta o WhatsApp e exige um novo pareamento.')) return;
  showMsg(msg, '', '');
  try {
    await api('/api/reset-session', { method: 'POST' });
    showMsg(msg, 'Sessão apagada. Aguardando novo QR code…', 'success');
  } catch (err) {
    showMsg(msg, err.message, 'error');
  }
});

(async function init() {
  try {
    const session = await api('/api/session');
    showDashboard(!!session.authenticated);
  } catch {
    showDashboard(false);
  }
})();
