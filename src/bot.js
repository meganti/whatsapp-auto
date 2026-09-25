const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const qrcode = require('qrcode');
const pino = require('pino');
const OpenAI = require('openai');

const state = require('./state');
const settings = require('./settings');
const usage = require('./usage');
const { resolveContactLanguage } = require('./country-language');
const { translateText } = require('./translate');
const { summarizeText, SUMMARY_MIN_DURATION_SECONDS } = require('./summarize');

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');

if (!process.env.OPENAI_API_KEY) {
  console.error('Erro: defina OPENAI_API_KEY no arquivo .env antes de iniciar o bot.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

let sockInstance = null;
let isResetting = false;

// Baileys 7.x é publicado como ESM-only; o resto do app continua CommonJS,
// então carregamos a lib via import() dinâmico uma única vez e guardamos os
// símbolos em variáveis de módulo.
let makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason;
let normalizeMessageContent, getContentType;

async function loadBaileys() {
  if (makeWASocket) return;
  const baileys = await import('@whiskeysockets/baileys');
  makeWASocket = baileys.default;
  ({ useMultiFileAuthState, downloadMediaMessage, DisconnectReason, normalizeMessageContent, getContentType } =
    baileys);
}

function extractAudioMessage(message) {
  if (!message?.message) return null;

  const content = normalizeMessageContent(message.message);
  if (getContentType(content) === 'audioMessage') {
    return content.audioMessage;
  }
  return null;
}

async function transcribeAudioBuffer(buffer, mimeType, languageHint) {
  const ext = mimeType?.includes('ogg') ? 'ogg' : 'mp3';
  const tmpFile = path.join(os.tmpdir(), `wa-audio-${crypto.randomUUID()}.${ext}`);

  await fs.promises.writeFile(tmpFile, buffer);
  try {
    const current = settings.get();
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: current.transcriptionModel,
      language: languageHint,
    });
    return response.text.trim();
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

async function startBot() {
  state.setUsageSummary(usage.getSummary());

  await loadBaileys();

  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: authState,
    logger,
  });
  sockInstance = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('Novo QR code disponível no painel admin.');
      try {
        const dataUrl = await qrcode.toDataURL(qr, { margin: 1, scale: 6 });
        state.setQr(dataUrl);
      } catch (err) {
        console.error('Erro ao gerar imagem do QR code:', err);
      }
    }

    if (connection === 'open') {
      console.log('Conectado ao WhatsApp com sucesso. Aguardando áudios...');
      state.setConnection('open');
      state.pushEvent('connection', 'Conectado ao WhatsApp.');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`Conexão encerrada (código ${statusCode}). Reconectando: ${shouldReconnect}`);
      state.setConnection('close');
      state.pushEvent('connection', `Conexão encerrada (código ${statusCode}).`);
      if (shouldReconnect && !isResetting) {
        startBot();
      } else if (!isResetting) {
        state.pushEvent(
          'connection',
          'Sessão desconectada. Use "Reconectar" no painel admin para gerar um novo QR code.'
        );
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        console.error('Erro ao processar mensagem:', err);
        state.pushEvent('error', `Erro ao processar mensagem: ${err.message}`);
      }
    }
  });
}

async function handleMessage(sock, msg) {
  if (!msg.message) return;

  const audioMessage = extractAudioMessage(msg);
  if (!audioMessage) return;

  const current = settings.get();
  if (current.onlyTranscribeOwnAudios && !msg.key.fromMe) return;

  const chatId = msg.key.remoteJid;
  console.log(`Áudio recebido em ${chatId}. Transcrevendo...`);

  // O contato pode ser de outro país (número fora do Brasil) — nesse caso,
  // além da transcrição no idioma original, mandamos também uma tradução:
  // pro idioma dele quando quem falou fui eu, pro português quando foi ele.
  const contact = resolveContactLanguage(msg.key);
  const isForeignContact = contact && contact.country !== 'BR';
  const whisperLanguageHint =
    !msg.key.fromMe && isForeignContact ? contact.language.code : current.transcriptionLanguage || undefined;

  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  const transcription = await transcribeAudioBuffer(buffer, audioMessage.mimetype, whisperLanguageHint);

  // A OpenAI cobra pela duração do áudio enviado, não pelo texto retornado —
  // então registra o custo mesmo se a transcrição vier vazia.
  const costUsd = usage.recordTranscription({
    model: current.transcriptionModel,
    durationSeconds: audioMessage.seconds,
  });

  if (!transcription) {
    state.setUsageSummary(usage.getSummary());
    console.log('Transcrição vazia, nada a enviar.');
    return;
  }

  // Áudios longos ganham um resumo em tópicos no topo da mensagem.
  let summary = null;
  if ((audioMessage.seconds || 0) > SUMMARY_MIN_DURATION_SECONDS) {
    try {
      summary = await summarizeText(openai, transcription);
    } catch (err) {
      console.error('Erro ao resumir transcrição:', err);
      state.pushEvent('error', `Erro ao resumir transcrição: ${err.message}`);
    }
  }

  let translation = null;
  let targetLanguage = null;
  if (isForeignContact) {
    targetLanguage = msg.key.fromMe ? contact.language : { code: 'pt', name: 'Português' };
    try {
      translation = await translateText(openai, transcription, targetLanguage);
    } catch (err) {
      console.error('Erro ao traduzir transcrição:', err);
      state.pushEvent('error', `Erro ao traduzir transcrição: ${err.message}`);
    }
  }

  state.setUsageSummary(usage.getSummary());

  let text = '';
  if (summary) {
    text += `📝 *Resumo:*\n${summary}\n\n`;
  }
  text += `🎤 *Transcrição:*\n${transcription}`;
  if (translation) {
    text += `\n\n🌐 *Tradução (${targetLanguage.name}):*\n${translation}`;
  }

  await sock.sendMessage(chatId, { text }, { quoted: msg });

  console.log(`Transcrição enviada para ${chatId}: ${transcription}`);
  state.pushEvent('transcription', transcription, {
    chatId,
    costUsd,
    summary,
    translation,
    targetLanguage: targetLanguage?.name,
  });
}

async function resetSession() {
  isResetting = true;
  try {
    if (sockInstance) {
      try {
        sockInstance.ev.removeAllListeners();
        sockInstance.end(undefined);
      } catch {
        // ignore
      }
    }

    // AUTH_DIR é um mount point (volume do Docker) — remover o diretório em
    // si falha com EBUSY, então só limpamos o conteúdo.
    const entries = await fs.promises.readdir(AUTH_DIR).catch(() => []);
    await Promise.all(
      entries.map((entry) =>
        fs.promises.rm(path.join(AUTH_DIR, entry), { recursive: true, force: true })
      )
    );

    state.pushEvent('connection', 'Sessão apagada pelo painel admin. Gerando novo QR code...');
  } finally {
    isResetting = false;
  }
  await startBot();
}

module.exports = { startBot, resetSession };
