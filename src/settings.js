const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const ALLOWED_MODELS = ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'];

const DEFAULTS = {
  transcriptionModel: ALLOWED_MODELS.includes(process.env.TRANSCRIPTION_MODEL)
    ? process.env.TRANSCRIPTION_MODEL
    : 'whisper-1',
  transcriptionLanguage: process.env.TRANSCRIPTION_LANGUAGE || '',
  onlyTranscribeOwnAudios: process.env.ONLY_TRANSCRIBE_OWN_AUDIOS === 'true',
};

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeFile(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

// Formato antigo (pré multi-número) era um objeto plano só com as três
// chaves de configuração. Formato novo é { [connectionId]: { ...chaves } }.
function isLegacyShape(raw) {
  return raw && typeof raw === 'object' && 'transcriptionModel' in raw;
}

let store = readFile();
if (isLegacyShape(store)) {
  // Arquivo de uma versão anterior à migração; será envolvido no id correto
  // assim que `migrateLegacyToId` for chamado no boot (connections.js).
  store = { __legacy__: store };
}

function migrateLegacyToId(id) {
  if (!store.__legacy__) return;
  const legacy = store.__legacy__;
  store = { [id]: legacy };
  writeFile(store);
}

function get(id) {
  return { ...DEFAULTS, ...(store[id] || {}) };
}

function update(id, patch) {
  const next = get(id);

  if (patch.transcriptionModel !== undefined) {
    if (!ALLOWED_MODELS.includes(patch.transcriptionModel)) {
      throw new Error('Modelo de transcrição inválido.');
    }
    next.transcriptionModel = patch.transcriptionModel;
  }

  if (patch.transcriptionLanguage !== undefined) {
    const lang = String(patch.transcriptionLanguage).trim();
    if (lang && !/^[a-z]{2}$/i.test(lang)) {
      throw new Error('Idioma deve ser um código ISO-639-1 de 2 letras (ex: pt) ou vazio.');
    }
    next.transcriptionLanguage = lang;
  }

  if (patch.onlyTranscribeOwnAudios !== undefined) {
    next.onlyTranscribeOwnAudios = Boolean(patch.onlyTranscribeOwnAudios);
  }

  store[id] = next;
  writeFile(store);
  return get(id);
}

function remove(id) {
  delete store[id];
  writeFile(store);
}

module.exports = { get, update, remove, migrateLegacyToId, ALLOWED_MODELS };
