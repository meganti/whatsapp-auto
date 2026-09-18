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

function load() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

let usage = load();

function dayKey(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function estimateCostUsd(model, durationSeconds) {
  const rate = PRICE_PER_MINUTE_USD[model];
  if (!rate || !durationSeconds) return 0;
  return (durationSeconds / 60) * rate;
}

function recordTranscription({ model, durationSeconds }) {
  const costUsd = estimateCostUsd(model, durationSeconds);
  const key = dayKey(new Date());
  const day = usage[key] || { costUsd: 0, seconds: 0, count: 0 };
  day.costUsd += costUsd;
  day.seconds += durationSeconds || 0;
  day.count += 1;
  usage[key] = day;
  save(usage);
  return costUsd;
}

function getSummary() {
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

module.exports = { recordTranscription, getSummary, PRICE_PER_MINUTE_USD };
