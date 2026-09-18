const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ENV_PATH = path.join(__dirname, '..', '.env');

function upsertEnvFile(key, value) {
  let content = '';
  try {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  } catch {
    content = '';
  }

  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.length && !content.endsWith('\n') ? `${content}\n` : content;
    content += `${key}=${value}\n`;
  }

  try {
    fs.writeFileSync(ENV_PATH, content);
  } catch (err) {
    console.error(`Não foi possível gravar ${key} em .env automaticamente:`, err.message);
  }
}

function bootstrapAdminCredentials() {
  let username = process.env.ADMIN_USERNAME;
  if (!username) {
    username = 'admin';
    process.env.ADMIN_USERNAME = username;
    upsertEnvFile('ADMIN_USERNAME', username);
  }

  let generatedPassword = null;
  if (!process.env.ADMIN_PASSWORD_HASH) {
    generatedPassword = crypto.randomBytes(12).toString('base64url');
    const hash = bcrypt.hashSync(generatedPassword, 10);
    process.env.ADMIN_PASSWORD_HASH = hash;
    upsertEnvFile('ADMIN_PASSWORD_HASH', hash);
  }

  if (!process.env.SESSION_SECRET) {
    const secret = crypto.randomBytes(32).toString('hex');
    process.env.SESSION_SECRET = secret;
    upsertEnvFile('SESSION_SECRET', secret);
  }

  if (generatedPassword) {
    console.log('========================================================');
    console.log('Credenciais do painel admin geradas automaticamente:');
    console.log(`  Usuário: ${username}`);
    console.log(`  Senha:   ${generatedPassword}`);
    console.log('Troque a senha em Configurações após o primeiro login.');
    console.log('Ela não será exibida novamente nos logs.');
    console.log('========================================================');
  }

  return { username };
}

function verifyPassword(password) {
  if (typeof password !== 'string' || !password) return false;
  return bcrypt.compareSync(password, process.env.ADMIN_PASSWORD_HASH || '');
}

function setPassword(newPassword) {
  const hash = bcrypt.hashSync(newPassword, 10);
  process.env.ADMIN_PASSWORD_HASH = hash;
  upsertEnvFile('ADMIN_PASSWORD_HASH', hash);
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
