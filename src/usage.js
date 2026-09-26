const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

// https://platform.openai.com/docs/pricing — tarifa "por minuto" divulgada
// pela OpenAI para os modelos de transcrição (setembro/2026).
const PRICE_PER_MINUTE_USD = {
  'whisper-1': 0.006,
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
};

// Tarifa por token do gpt-4o-mini (usado para traduzir a transcrição quando
// o contato é de outro país), em USD por 1M de tokens.
const TRANSLATION_PRICE_PER_1M_TOKENS = { input: 0.15, output: 0.6 };

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeFile(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

// Formato antigo (pré multi-número) era { "<YYYY-MM-DD>": {...} } direto na
// raiz. Formato novo é { [connectionId]: { "<YYYY-MM-DD>": {...} } }.
function isLegacyShape(raw) {
  return raw && typeof raw === 'object' && Object.keys(raw).some((k) => DAY_KEY_RE.test(k));
}

let store = readFile();
if (isLegacyShape(store)) {
  store = { __legacy__: store };
}

function migrateLegacyToId(id) {
  if (!store.__legacy__) return;
  const legacy = store.__legacy__;
  store = { [id]: legacy };
  writeFile(store);
}

function dayKey(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function estimateCostUsd(model, durationSeconds) {
  const rate = PRICE_PER_MINUTE_USD[model];
  if (!rate || !durationSeconds) return 0;
  return (durationSeconds / 60) * rate;
}

function addToToday(id, { costUsd, seconds = 0, count = 0 }) {
  const usage = store[id] || {};
  const key = dayKey(new Date());
  const day = usage[key] || { costUsd: 0, seconds: 0, count: 0 };
  day.costUsd += costUsd;
  day.seconds += seconds;
  day.count += count;
  usage[key] = day;
  store[id] = usage;
  writeFile(store);
}

function recordTranscription(id, { model, durationSeconds }) {
  const costUsd = estimateCostUsd(model, durationSeconds);
  addToToday(id, { costUsd, seconds: durationSeconds || 0, count: 1 });
  return costUsd;
}

// Custo da chamada de chat completion (gpt-4o-mini) usada para traduzir a
// transcrição — somado ao mesmo total diário, mas sem contar como uma
// "transcrição" (não incrementa seconds/count).
function recordTranslation(id, { inputTokens = 0, outputTokens = 0 }) {
  const costUsd =
    (inputTokens / 1_000_000) * TRANSLATION_PRICE_PER_1M_TOKENS.input +
    (outputTokens / 1_000_000) * TRANSLATION_PRICE_PER_1M_TOKENS.output;
  addToToday(id, { costUsd });
  return costUsd;
}

function summarize(usage) {
  const now = new Date();
  const todayK = dayKey(now);
  const monthPrefix = todayK.slice(0, 7); // YYYY-MM

  const today = usage[todayK] || { costUsd: 0, seconds: 0, count: 0 };
  const month = { costUsd: 0, seconds: 0, count: 0 };
  const days = [];

  for (const [key, entry] of Object.entries(usage)) {
    if (key.startsWith(monthPrefix)) {
      month.costUsd += entry.costUsd;
      month.seconds += entry.seconds;
      month.count += entry.count;
      days.push({ date: key, ...entry });
    }
  }
  days.sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    today: { date: todayK, ...today },
    month: { month: monthPrefix, ...month },
    days,
  };
}

function getSummary(id) {
  return summarize(store[id] || {});
}

// Soma o uso de todas as conexões, dia a dia, pro card de custo combinado.
function getAggregateSummary() {
  const combined = {};
  for (const usage of Object.values(store)) {
    for (const [key, entry] of Object.entries(usage)) {
      const day = combined[key] || { costUsd: 0, seconds: 0, count: 0 };
      day.costUsd += entry.costUsd;
      day.seconds += entry.seconds;
      day.count += entry.count;
      combined[key] = day;
    }
  }
  return summarize(combined);
}

module.exports = {
  recordTranscription,
  recordTranslation,
  getSummary,
  getAggregateSummary,
  migrateLegacyToId,
  PRICE_PER_MINUTE_USD,
};
