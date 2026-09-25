const STATUS_LABELS = {
  connecting: 'Conectando...',
  waiting_qr: 'Aguardando QR code',
  connected: 'Conectado',
  disconnected: 'Desconectado',
};

const statusEl = document.getElementById('status');
const qrSection = document.getElementById('qr-section');
const qrImage = document.getElementById('qr-image');
const listEl = document.getElementById('transcriptions-list');
const emptyStateEl = document.getElementById('empty-state');

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString('pt-BR');
}

function render(data) {
  statusEl.textContent = STATUS_LABELS[data.connection] || data.connection;
  statusEl.className = `status status--${data.connection}`;

  const showQr = data.connection === 'waiting_qr' && data.qrDataUrl;
  qrSection.hidden = !showQr;
  if (showQr) qrImage.src = data.qrDataUrl;

  listEl.innerHTML = '';
  emptyStateEl.hidden = data.transcriptions.length > 0;

  for (const item of data.transcriptions) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="transcription-meta">
        <span>${item.chatName}</span>
        <span>${formatTimestamp(item.timestamp)}</span>
      </div>
      <div class="transcription-text"></div>
    `;
    li.querySelector('.transcription-text').textContent = item.text;
    listEl.appendChild(li);
  }
}

async function poll() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) render(await res.json());
  } catch (err) {
    statusEl.textContent = 'Erro ao consultar status';
  } finally {
    setTimeout(poll, 3000);
  }
}

poll();
