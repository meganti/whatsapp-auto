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

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULTS, null, 2));
    return { ...DEFAULTS };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();

function get() {
  return { ...current };
}

function update(patch) {
  const next = { ...current };

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

  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  current = next;
  return get();
}

module.exports = { get, update, ALLOWED_MODELS };
