const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const connectionsList = document.getElementById('connections-list');
const connectionsEmpty = document.getElementById('connections-empty');

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
const renderedConnectionIds = new Set();
let connectionLabels = {}; // id -> { label, phoneNumber } — pra render do breakdown de custo

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function renderEventList(container, events) {
  if (!events || events.length === 0) {
    container.innerHTML = '<p class="empty">Nenhuma atividade ainda.</p>';
    return;
  }

  container.innerHTML = events
    .slice(0, 20)
    .map((ev) => {
      const badge = EVENT_LABELS[ev.type] || ev.type;
      const text = escapeHtml(ev.message);
      const translation = ev.meta?.translation;
      const translationHtml = translation
        ? `<div class="event-translation">🌐 ${escapeHtml(ev.meta.targetLanguage || 'Tradução')}: ${escapeHtml(translation)}</div>`
        : '';
      return `<div class="event-item">
        <span class="event-badge ${ev.type}">${badge}</span>
        <div class="event-text">${text}${translationHtml}<div class="event-time">${formatTime(ev.timestamp)}</div></div>
      </div>`;
    })
    .join('');
}

function connectionCardHtml(conn) {
  const s = conn.settings;
  return `
    <div class="card connection-card" data-id="${conn.id}">
      <div class="card-header-row">
        <div>
          <div class="status-label">${escapeHtml(conn.label)}</div>
          <div class="status-sub" data-role="number"></div>
        </div>
        <span class="status-dot" data-role="dot"></span>
      </div>
      <div class="status-sub" data-role="sub"></div>

      <div class="qr-box" data-role="qr-box" hidden>
        <img data-role="qr-img" alt="QR code para conectar o WhatsApp" />
        <p>Escaneie em Configurações &gt; Aparelhos conectados &gt; Conectar um aparelho.</p>
      </div>

      <div class="stat-grid">
        <div class="stat-tile"><div class="value" data-role="stat-transcriptions">0</div><div class="label">Transcrições</div></div>
        <div class="stat-tile"><div class="value" data-role="stat-errors">0</div><div class="label">Erros</div></div>
      </div>

      <hr />

      <form class="conn-settings-form">
        <div class="field">
          <label>Modelo</label>
          <select name="transcriptionModel">
            <option value="whisper-1" ${s.transcriptionModel === 'whisper-1' ? 'selected' : ''}>whisper-1</option>
            <option value="gpt-4o-transcribe" ${s.transcriptionModel === 'gpt-4o-transcribe' ? 'selected' : ''}>gpt-4o-transcribe</option>
            <option value="gpt-4o-mini-transcribe" ${s.transcriptionModel === 'gpt-4o-mini-transcribe' ? 'selected' : ''}>gpt-4o-mini-transcribe</option>
          </select>
        </div>
        <div class="field">
          <label>Idioma (ISO-639-1, ex: pt) — deixe em branco para detecção automática</label>
          <input type="text" name="transcriptionLanguage" maxlength="2" placeholder="pt" value="${escapeHtml(s.transcriptionLanguage)}" />
        </div>
        <div class="field toggle-row">
          <div>
            <label style="margin-bottom:0">Restringir aos meus próprios áudios</label>
            <div class="desc">Desativado (padrão): transcreve áudio de qualquer conversa, seu ou de quem te mandar. Ativado: ignora áudios enviados por outras pessoas, só transcreve os que você mesmo envia.</div>
          </div>
          <label class="switch">
            <input type="checkbox" name="onlyTranscribeOwnAudios" ${s.onlyTranscribeOwnAudios ? 'checked' : ''} />
            <span class="track"></span>
          </label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Salvar configurações</button>
        </div>
        <p class="msg" data-role="settings-msg" hidden></p>
      </form>

      <div class="form-actions" style="margin-top:12px">
        <button type="button" class="btn conn-reset-btn">Resetar sessão</button>
        <button type="button" class="btn btn-danger conn-remove-btn">Remover número</button>
      </div>
      <p class="msg" data-role="action-msg" hidden></p>

      <div class="event-list" data-role="events" style="margin-top:14px">
        <p class="empty">Nenhuma atividade ainda.</p>
      </div>
    </div>
  `;
}

function updateConnectionCard(card, conn) {
  const [label, cls] = STATUS_LABELS[conn.connection] || STATUS_LABELS.connecting;
  card.querySelector('[data-role="dot"]').className = `status-dot ${cls}`;
  card.querySelector('[data-role="number"]').textContent = conn.phoneNumber || 'Aguardando pareamento…';

  const sub = card.querySelector('[data-role="sub"]');
  sub.textContent = [label, conn.lastConnectedAt ? `desde ${formatTime(conn.lastConnectedAt)}` : null]
    .filter(Boolean)
    .join(' · ');

  const qrBox = card.querySelector('[data-role="qr-box"]');
  const qrImg = card.querySelector('[data-role="qr-img"]');
  if (conn.connection === 'qr' && conn.qrDataUrl) {
    qrImg.src = conn.qrDataUrl;
    qrBox.hidden = false;
  } else {
    qrBox.hidden = true;
  }

  card.querySelector('[data-role="stat-transcriptions"]').textContent = conn.stats.transcriptions;
  card.querySelector('[data-role="stat-errors"]').textContent = conn.stats.errors;

  renderEventList(card.querySelector('[data-role="events"]'), conn.events);
}

function renderConnections(list) {
  connectionsEmpty.hidden = list.length > 0;
  connectionLabels = {};

  const seenIds = new Set();
  for (const conn of list) {
    seenIds.add(conn.id);
    connectionLabels[conn.id] = { label: conn.label, phoneNumber: conn.phoneNumber };

    let card = connectionsList.querySelector(`.connection-card[data-id="${conn.id}"]`);
    if (!card) {
      connectionsList.insertAdjacentHTML('beforeend', connectionCardHtml(conn));
      card = connectionsList.querySelector(`.connection-card[data-id="${conn.id}"]`);
      renderedConnectionIds.add(conn.id);
    }
    updateConnectionCard(card, conn);
  }

  for (const id of [...renderedConnectionIds]) {
    if (!seenIds.has(id)) {
      connectionsList.querySelector(`.connection-card[data-id="${id}"]`)?.remove();
      renderedConnectionIds.delete(id);
    }
  }
}

function renderUsage(usageData) {
  if (!usageData) return;
  const { total, byConnection } = usageData;

  document.getElementById('cost-today').textContent = formatUsd(total.today?.costUsd);
  document.getElementById('cost-month').textContent = formatUsd(total.month?.costUsd);
  document.getElementById('cost-month-label').textContent = formatMonthLabel(total.month?.month);

  const list = document.getElementById('cost-days');
  if (!total.days || total.days.length === 0) {
    list.innerHTML = '<p class="empty">Nenhuma transcrição neste mês ainda.</p>';
  } else {
    list.innerHTML = total.days
      .map((d) => {
        const minutes = ((d.seconds || 0) / 60).toFixed(1);
        return `<div class="event-item">
          <span class="event-badge settings">${formatDayLabel(d.date)}</span>
          <div class="event-text">${formatUsd(d.costUsd)}<div class="event-time">${d.count} transcrição(ões) · ${minutes} min de áudio</div></div>
        </div>`;
      })
      .join('');
  }

  const breakdown = document.getElementById('cost-breakdown');
  const ids = Object.keys(byConnection || {});
  if (ids.length <= 1) {
    breakdown.innerHTML = '';
    return;
  }

  breakdown.innerHTML =
    '<div class="status-sub" style="margin-bottom:8px">Por número</div>' +
    ids
      .map((id) => {
        const info = connectionLabels[id] || { label: id };
        const monthCost = byConnection[id].month?.costUsd || 0;
        return `<div class="event-item">
          <span class="event-badge connection">${escapeHtml(info.label)}</span>
          <div class="event-text">${info.phoneNumber || ''}<div class="event-time">${formatUsd(monthCost)} no mês</div></div>
        </div>`;
      })
      .join('');
}

async function refreshAll() {
  try {
    const [connectionsData, usageData] = await Promise.all([api('/api/connections'), api('/api/usage')]);
    renderConnections(connectionsData);
    renderUsage(usageData);
  } catch (err) {
    if (err.message.includes('autenticado')) {
      stopPolling();
      showDashboard(false);
    }
  }
}

function startPolling() {
  stopPolling();
  refreshAll();
  pollTimer = setInterval(refreshAll, 3000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function showDashboard(show) {
  loginView.hidden = show;
  dashboardView.hidden = !show;
  if (show) {
    startPolling();
  } else {
    stopPolling();
    renderedConnectionIds.clear();
    connectionsList.innerHTML = '';
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

document.getElementById('add-connection-btn').addEventListener('click', async () => {
  const label = window.prompt('Nome pra identificar esse número (ex: Vendas, Pessoal):', '');
  if (label === null) return;
  try {
    await api('/api/connections', { method: 'POST', body: JSON.stringify({ label }) });
    refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

connectionsList.addEventListener('submit', async (e) => {
  const form = e.target.closest('.conn-settings-form');
  if (!form) return;
  e.preventDefault();

  const card = form.closest('.connection-card');
  const id = card.dataset.id;
  const msg = form.querySelector('[data-role="settings-msg"]');
  showMsg(msg, '', '');

  try {
    await api(`/api/connections/${id}/settings`, {
      method: 'POST',
      body: JSON.stringify({
        transcriptionModel: form.transcriptionModel.value,
        transcriptionLanguage: form.transcriptionLanguage.value,
        onlyTranscribeOwnAudios: form.onlyTranscribeOwnAudios.checked,
      }),
    });
    showMsg(msg, 'Configurações salvas.', 'success');
  } catch (err) {
    showMsg(msg, err.message, 'error');
  }
});

connectionsList.addEventListener('click', async (e) => {
  const card = e.target.closest('.connection-card');
  if (!card) return;
  const id = card.dataset.id;
  const msg = card.querySelector('[data-role="action-msg"]');

  if (e.target.closest('.conn-reset-btn')) {
    if (!confirm('Tem certeza? Isso desconecta o WhatsApp e exige um novo pareamento.')) return;
    showMsg(msg, '', '');
    try {
      await api(`/api/connections/${id}/reset`, { method: 'POST' });
      showMsg(msg, 'Sessão apagada. Aguardando novo QR code…', 'success');
    } catch (err) {
      showMsg(msg, err.message, 'error');
    }
  }

  if (e.target.closest('.conn-remove-btn')) {
    if (!confirm('Remover este número da Uhura? A sessão do WhatsApp será desconectada.')) return;
    try {
      await api(`/api/connections/${id}`, { method: 'DELETE' });
      refreshAll();
    } catch (err) {
      alert(err.message);
    }
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
