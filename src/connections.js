const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ConnectionState = require('./state');
const settings = require('./settings');
const usage = require('./usage');

const AUTH_INFO_ROOT = path.join(__dirname, '..', 'auth_info');
const DATA_DIR = path.join(__dirname, '..', 'data');
const REGISTRY_FILE = path.join(DATA_DIR, 'connections.json');
const LEGACY_CREDS_FILE = path.join(AUTH_INFO_ROOT, 'creds.json');

const records = new Map(); // id -> { id, label, createdAt, state, sock, isResetting }

function getAuthDir(id) {
  return id === 'default' ? AUTH_INFO_ROOT : path.join(AUTH_INFO_ROOT, id);
}

function loadRegistryFile() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveRegistryFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const list = [...records.values()].map(({ id, label, createdAt }) => ({ id, label, createdAt }));
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(list, null, 2));
}

function registerRecord({ id, label, createdAt }) {
  const record = { id, label, createdAt, state: new ConnectionState(), sock: null, isResetting: false };
  records.set(id, record);
  return record;
}

/**
 * Roda uma única vez no boot. Se `data/connections.json` já existe, só
 * carrega. Senão, verifica se há uma sessão pré-existente (deploy anterior,
 * antes do suporte a múltiplos números) em `auth_info/creds.json` na raiz —
 * se houver, migra as configurações/custos daquele único número pra dentro
 * do novo formato (sem mover nenhum arquivo do Baileys, pra não invalidar a
 * sessão já pareada). Se não houver nada, começa com o registro vazio.
 */
function initRegistry() {
  const existing = loadRegistryFile();
  if (existing) {
    for (const entry of existing) registerRecord(entry);
    return listConnections();
  }

  if (fs.existsSync(LEGACY_CREDS_FILE)) {
    const createdAt = fs.statSync(LEGACY_CREDS_FILE).mtime.toISOString();
    settings.migrateLegacyToId('default');
    usage.migrateLegacyToId('default');
    registerRecord({ id: 'default', label: 'Uhura', createdAt });
  }

  saveRegistryFile();
  return listConnections();
}

function addConnection(label) {
  const id = crypto.randomUUID().slice(0, 8);
  const record = registerRecord({
    id,
    label: label?.trim() || `Número ${records.size}`,
    createdAt: new Date().toISOString(),
  });
  saveRegistryFile();
  return record;
}

function removeConnection(id) {
  records.delete(id);
  saveRegistryFile();
}

function getConnection(id) {
  return records.get(id) || null;
}

function listConnections() {
  return [...records.values()];
}

module.exports = {
  getAuthDir,
  initRegistry,
  addConnection,
  removeConnection,
  getConnection,
  listConnections,
};
