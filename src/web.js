const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const state = require('./state');

const WEB_PORT = parseInt(process.env.WEB_PORT || '3000', 10);
const WEB_USERNAME = process.env.WEB_USERNAME;
const WEB_PASSWORD = process.env.WEB_PASSWORD;

function basicAuth(req, res, next) {
  if (!WEB_USERNAME || !WEB_PASSWORD) return next();

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user === WEB_USERNAME && pass === WEB_PASSWORD) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="whatsapp-transcriber"');
  return res.status(401).send('Autenticação necessária.');
}

function startWebServer() {
  const app = express();

  app.use(basicAuth);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/status', async (req, res) => {
    const snapshot = state.getSnapshot();
    const qrDataUrl = snapshot.qr ? await QRCode.toDataURL(snapshot.qr) : null;

    res.json({
      connection: snapshot.connection,
      qrDataUrl,
      connectedAt: snapshot.connectedAt,
      transcriptions: snapshot.transcriptions,
    });
  });

  app.listen(WEB_PORT, () => {
    console.log(`Interface web disponível em http://localhost:${WEB_PORT}`);
    if (!WEB_USERNAME || !WEB_PASSWORD) {
      console.log('Aviso: WEB_USERNAME/WEB_PASSWORD não configurados — a interface web está sem autenticação.');
    }
  });
}

module.exports = { startWebServer };
