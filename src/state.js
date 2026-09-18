const { EventEmitter } = require('events');

const MAX_EVENTS = 100;

class BotState extends EventEmitter {
  constructor() {
    super();
    this.connection = 'connecting'; // 'connecting' | 'open' | 'close' | 'qr'
    this.qrDataUrl = null;
    this.lastConnectedAt = null;
    this.events = [];
    this.stats = { transcriptions: 0, errors: 0 };
  }

  setConnection(status) {
    this.connection = status;
    if (status === 'open') {
      this.lastConnectedAt = new Date().toISOString();
      this.qrDataUrl = null;
    }
    this.emit('update');
  }

  setQr(dataUrl) {
    this.qrDataUrl = dataUrl;
    this.connection = 'qr';
    this.emit('update');
  }

  pushEvent(type, message, meta = {}) {
    const event = { type, message, meta, timestamp: new Date().toISOString() };
    this.events.unshift(event);
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
    if (type === 'transcription') this.stats.transcriptions += 1;
    if (type === 'error') this.stats.errors += 1;
    this.emit('update');
  }

  toJSON() {
    return {
      connection: this.connection,
      qrDataUrl: this.qrDataUrl,
      lastConnectedAt: this.lastConnectedAt,
      stats: this.stats,
      events: this.events,
    };
  }
}

module.exports = new BotState();
