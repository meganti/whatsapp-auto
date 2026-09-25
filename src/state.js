const MAX_TRANSCRIPTIONS = 50;

const state = {
  connection: 'connecting', // 'connecting' | 'waiting_qr' | 'connected' | 'disconnected'
  qr: null,
  connectedAt: null,
  transcriptions: [],
};

function setConnecting() {
  state.connection = 'connecting';
  state.qr = null;
}

function setWaitingQr(qr) {
  state.connection = 'waiting_qr';
  state.qr = qr;
}

function setConnected() {
  state.connection = 'connected';
  state.qr = null;
  state.connectedAt = new Date().toISOString();
}

function setDisconnected() {
  state.connection = 'disconnected';
  state.qr = null;
}

function addTranscription({ chatId, chatName, text }) {
  state.transcriptions.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chatId,
    chatName: chatName || chatId,
    text,
    timestamp: new Date().toISOString(),
  });
  state.transcriptions.length = Math.min(state.transcriptions.length, MAX_TRANSCRIPTIONS);
}

function getSnapshot() {
  return {
    connection: state.connection,
    qr: state.qr,
    connectedAt: state.connectedAt,
    transcriptions: state.transcriptions,
  };
}

module.exports = {
  setConnecting,
  setWaitingQr,
  setConnected,
  setDisconnected,
  addTranscription,
  getSnapshot,
};
