const path = require('path');
const express = require('express');
const session = require('express-session');

const state = require('../state');
const settings = require('../settings');
const auth = require('../auth');
const bot = require('../bot');

function createServer() {
  const app = express();
  app.disable('x-powered-by');

  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  app.use(express.json());

  app.use(
    session({
      name: 'wa_admin_sid',
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.TRUST_PROXY === 'true',
        maxAge: 12 * 60 * 60 * 1000,
      },
    })
  );

  function requireAuth(req, res, next) {
    if (req.session?.authenticated) return next();
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  app.post('/api/login', (req, res) => {
    const ip = req.ip;
    if (!auth.checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
    }

    const { username, password } = req.body || {};
    const validUser = username === process.env.ADMIN_USERNAME;
    const validPass = auth.verifyPassword(password);

    if (!validUser || !validPass) {
      auth.registerFailedAttempt(ip);
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }

    auth.clearAttempts(ip);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Erro interno.' });
      req.session.authenticated = true;
      req.session.username = username;
      res.json({ ok: true });
    });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/api/session', (req, res) => {
    res.json({
      authenticated: !!req.session?.authenticated,
      username: req.session?.username || null,
    });
  });

  app.get('/api/status', requireAuth, (req, res) => {
    res.json(state.toJSON());
  });

  app.get('/api/settings', requireAuth, (req, res) => {
    res.json(settings.get());
  });

  app.post('/api/settings', requireAuth, (req, res) => {
    try {
      const updated = settings.update(req.body || {});
      state.pushEvent('settings', 'Configurações atualizadas pelo painel admin.');
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!auth.verifyPassword(currentPassword)) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 10) {
      return res.status(400).json({ error: 'A nova senha deve ter pelo menos 10 caracteres.' });
    }
    auth.setPassword(newPassword);
    state.pushEvent('settings', 'Senha do painel admin foi alterada.');
    res.json({ ok: true });
  });

  app.post('/api/reset-session', requireAuth, (req, res) => {
    res.json({ ok: true });
    bot.resetSession().catch((err) => console.error('Erro ao resetar sessão:', err));
  });

  app.use(express.static(path.join(__dirname, 'public')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

function startWebServer() {
  const app = createServer();
  const port = Number(process.env.ADMIN_PORT) || 3000;
  // Bind em todas as interfaces do container; a exposição real é restrita pelo
  // mapeamento de porta no docker-compose.yml (publicado só em 127.0.0.1 do host).
  const host = '0.0.0.0';

  app.listen(port, host, () => {
    console.log(`Painel admin disponível em http://${host}:${port}`);
  });
}

module.exports = { startWebServer };
