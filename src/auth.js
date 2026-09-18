const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Fica em data/ (mesmo volume de settings.json), NUNCA em .env — o Docker
// Compose interpola "$" ao carregar env_file, o que corrompe hashes bcrypt
// (formato $2a$10$...). Ver histórico do commit que introduziu este arquivo.
const DATA_DIR = path.join(__dirname, '..', 'data');
const CREDS_FILE = path.join(DATA_DIR, 'admin-credentials.json');

function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveCreds(creds) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));
}

let cachedCreds = null;

function bootstrapAdminCredentials() {
  let creds = loadCreds();
  let generatedPassword = null;

  if (!creds) {
    generatedPassword = crypto.randomBytes(12).toString('base64url');
    creds = {
      username: 'admin',
      passwordHash: bcrypt.hashSync(generatedPassword, 10),
      sessionSecret: crypto.randomBytes(32).toString('hex'),
    };
    saveCreds(creds);
  }

  cachedCreds = creds;
  process.env.ADMIN_USERNAME = creds.username;
  process.env.SESSION_SECRET = creds.sessionSecret;

  if (generatedPassword) {
    console.log('========================================================');
    console.log('Credenciais do painel admin geradas automaticamente:');
    console.log(`  Usuário: ${creds.username}`);
    console.log(`  Senha:   ${generatedPassword}`);
    console.log('Troque a senha em Configurações após o primeiro login.');
    console.log('Ela não será exibida novamente nos logs.');
    console.log('========================================================');
  }

  return { username: creds.username };
}

function verifyPassword(password) {
  if (typeof password !== 'string' || !password || !cachedCreds) return false;
  return bcrypt.compareSync(password, cachedCreds.passwordHash);
}

function setPassword(newPassword) {
  cachedCreds.passwordHash = bcrypt.hashSync(newPassword, 10);
  saveCreds(cachedCreds);
}

// Rate limiting simples em memória para tentativas de login por IP.
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

function checkRateLimit(ip) {
  const entry = attempts.get(ip);
  return !(entry && entry.lockedUntil && entry.lockedUntil > Date.now());
}

function registerFailedAttempt(ip) {
  const entry = attempts.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCK_MS;
    entry.count = 0;
  }
  attempts.set(ip, entry);
}

function clearAttempts(ip) {
  attempts.delete(ip);
}

module.exports = {
  bootstrapAdminCredentials,
  verifyPassword,
  setPassword,
  checkRateLimit,
  registerFailedAttempt,
  clearAttempts,
};
