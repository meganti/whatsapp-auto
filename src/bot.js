const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const qrcode = require('qrcode');
const pino = require('pino');
const OpenAI = require('openai');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

const connections = require('./connections');
const settings = require('./settings');
const usage = require('./usage');
const { resolveContactLanguage, extractPhoneNumberJid } = require('./country-language');
const { translateText } = require('./translate');

if (!process.env.OPENAI_API_KEY) {
  console.error('Erro: defina OPENAI_API_KEY no arquivo .env antes de iniciar o bot.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

// Números (dígitos, sem @s.whatsapp.net) atualmente conectados na Uhura,
// mapeados pro id da conexão dona — usado pra evitar transcrição duplicada
// quando dois números conectados conversam entre si (veja handleMessage).
const connectedNumbers = new Map();

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

function jidDigits(jid) {
  return jid ? jid.split('@')[0].split(':')[0] : null;
}

function isIndividualChat(chatId) {
  return typeof chatId === 'string' && (chatId.endsWith('@s.whatsapp.net') || chatId.endsWith('@lid'));
}

function formatConnectedNumber(sock) {
  const digits = jidDigits(sock?.user?.id);
  if (!digits) return null;
  const parsed = parsePhoneNumberFromString(`+${digits}`);
  return parsed ? parsed.formatInternational() : `+${digits}`;
}

function extractAudioMessage(message) {
  if (!message?.message) return null;

  const content = normalizeMessageContent(message.message);
  if (getContentType(content) === 'audioMessage') {
    return content.audioMessage;
  }
  return null;
}

async function transcribeAudioBuffer(buffer, mimeType, model, languageHint) {
  const ext = mimeType?.includes('ogg') ? 'ogg' : 'mp3';
  const tmpFile = path.join(os.tmpdir(), `wa-audio-${crypto.randomUUID()}.${ext}`);

  await fs.promises.writeFile(tmpFile, buffer);
  try {
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model,
      language: languageHint,
    });
    return response.text.trim();
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

// `auth_info/` (a raiz) é um mount point (volume do Docker) — remover o
// diretório em si falha com EBUSY, então pra conexão "default" só limpamos o
// conteúdo. Pra qualquer outra conexão, o diretório é uma subpasta comum e
// pode ser removido inteiro.
async function wipeAuthDir(id) {
  const dir = connections.getAuthDir(id);
  if (id === 'default') {
    const entries = await fs.promises.readdir(dir).catch(() => []);
    await Promise.all(entries.map((entry) => fs.promises.rm(path.join(dir, entry), { recursive: true, force: true })));
  } else {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

async function startBot(id) {
  const record = connections.getConnection(id);
  if (!record) throw new Error(`Conexão desconhecida: ${id}`);
  const { state } = record;

  state.setUsageSummary(usage.getSummary(id));

  await loadBaileys();

  const authDir = connections.getAuthDir(id);
  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: authState,
    logger,
  });
  record.sock = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`[${record.label}] Novo QR code disponível no painel admin.`);
      try {
        const dataUrl = await qrcode.toDataURL(qr, { margin: 1, scale: 6 });
        state.setQr(dataUrl);
      } catch (err) {
        console.error(`[${record.label}] Erro ao gerar imagem do QR code:`, err);
      }
    }

    if (connection === 'open') {
      console.log(`[${record.label}] Conectado ao WhatsApp com sucesso. Aguardando áudios...`);
      state.setConnection('open');
      state.setPhoneNumber(formatConnectedNumber(sock));
      const digits = jidDigits(sock.user?.id);
      if (digits) connectedNumbers.set(digits, id);
      state.pushEvent('connection', 'Conectado ao WhatsApp.');
    }

    if (connection === 'close') {
      for (const [digits, ownerId] of connectedNumbers) {
        if (ownerId === id) connectedNumbers.delete(digits);
      }

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[${record.label}] Conexão encerrada (código ${statusCode}). Reconectando: ${shouldReconnect}`);
      state.setConnection('close');
      state.pushEvent('connection', `Conexão encerrada (código ${statusCode}).`);
      if (shouldReconnect && !record.isResetting) {
        startBot(id);
      } else if (!record.isResetting) {
        state.pushEvent(
          'connection',
          'Sessão desconectada. Use "Resetar sessão" no painel admin para gerar um novo QR code.'
        );
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        await handleMessage(sock, msg, id);
      } catch (err) {
        console.error(`[${record.label}] Erro ao processar mensagem:`, err);
        state.pushEvent('error', `Erro ao processar mensagem: ${err.message}`);
      }
    }
  });
}

async function handleMessage(sock, msg, id) {
  if (!msg.message) return;

  const chatId = msg.key.remoteJid;
  if (!isIndividualChat(chatId)) return;

  const audioMessage = extractAudioMessage(msg);
  if (!audioMessage) return;

  // Se este número mandou o áudio (fromMe) e quem recebeu também é um
  // número conectado na Uhura, deixa a transcrição a cargo do lado que
  // RECEBEU — senão as duas conexões responderiam na mesma conversa com
  // duas transcrições do mesmo áudio. Só se aplica a conversas 1:1
  // (extractPhoneNumberJid retorna null pra grupos).
  if (msg.key.fromMe) {
    const counterpartyJid = extractPhoneNumberJid(msg.key);
    const digits = jidDigits(counterpartyJid);
    const ownerId = digits && connectedNumbers.get(digits);
    if (ownerId && ownerId !== id) return;
  }

  const record = connections.getConnection(id);
  const { state } = record;

  const current = settings.get(id);
  if (current.onlyTranscribeOwnAudios && !msg.key.fromMe) return;

  console.log(`[${record.label}] Áudio recebido em ${chatId}. Transcrevendo...`);

  // O contato pode ser de outro país (número fora do Brasil) — nesse caso,
  // além da transcrição no idioma original, mandamos também uma tradução:
  // pro idioma dele quando quem falou fui eu, pro português quando foi ele.
  const contact = resolveContactLanguage(msg.key);
  const isForeignContact = contact && contact.country !== 'BR';
  const whisperLanguageHint =
    !msg.key.fromMe && isForeignContact ? contact.language.code : current.transcriptionLanguage || undefined;

  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  const transcription = await transcribeAudioBuffer(
    buffer,
    audioMessage.mimetype,
    current.transcriptionModel,
    whisperLanguageHint
  );

  // A OpenAI cobra pela duração do áudio enviado, não pelo texto retornado —
  // então registra o custo mesmo se a transcrição vier vazia.
  const costUsd = usage.recordTranscription(id, {
    model: current.transcriptionModel,
    durationSeconds: audioMessage.seconds,
  });

  if (!transcription) {
    state.setUsageSummary(usage.getSummary(id));
    console.log(`[${record.label}] Transcrição vazia, nada a enviar.`);
    return;
  }

  let translation = null;
  let targetLanguage = null;
  if (isForeignContact) {
    targetLanguage = msg.key.fromMe ? contact.language : { code: 'pt', name: 'Português' };
    try {
      translation = await translateText(openai, transcription, targetLanguage, id);
    } catch (err) {
      console.error(`[${record.label}] Erro ao traduzir transcrição:`, err);
      state.pushEvent('error', `Erro ao traduzir transcrição: ${err.message}`);
    }
  }

  state.setUsageSummary(usage.getSummary(id));

  let text = `🎤 *Transcrição:*\n${transcription}`;
  if (translation) {
    text += `\n\n🌐 *Tradução (${targetLanguage.name}):*\n${translation}`;
  }

  await sock.sendMessage(chatId, { text }, { quoted: msg });

  console.log(`[${record.label}] Transcrição enviada para ${chatId}: ${transcription}`);
  state.pushEvent('transcription', transcription, {
    chatId,
    costUsd,
    translation,
    targetLanguage: targetLanguage?.name,
  });
}

async function resetSession(id) {
  const record = connections.getConnection(id);
  if (!record) throw new Error(`Conexão desconhecida: ${id}`);

  record.isResetting = true;
  try {
    if (record.sock) {
      try {
        record.sock.ev.removeAllListeners();
        record.sock.end(undefined);
      } catch {
        // ignore
      }
    }

    await wipeAuthDir(id);
    record.state.pushEvent('connection', 'Sessão apagada pelo painel admin. Gerando novo QR code...');
  } finally {
    record.isResetting = false;
  }
  await startBot(id);
}

async function removeConnection(id) {
  const record = connections.getConnection(id);
  if (!record) return;

  record.isResetting = true;
  if (record.sock) {
    try {
      record.sock.ev.removeAllListeners();
      record.sock.end(undefined);
    } catch {
      // ignore
    }
  }

  for (const [digits, ownerId] of connectedNumbers) {
    if (ownerId === id) connectedNumbers.delete(digits);
  }

  await wipeAuthDir(id);
  settings.remove(id);
  connections.removeConnection(id);
}

module.exports = { startBot, resetSession, removeConnection };
