const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const pino = require('pino');
const OpenAI = require('openai');

const state = require('./state');
const settings = require('./settings');

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');

if (!process.env.OPENAI_API_KEY) {
  console.error('Erro: defina OPENAI_API_KEY no arquivo .env antes de iniciar o bot.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

let sockInstance = null;
let isResetting = false;

function extractAudioMessage(message) {
  if (!message?.message) return null;

  const container =
    message.message.ephemeralMessage?.message ||
    message.message.viewOnceMessage?.message ||
    message.message;

  if (container.audioMessage) {
    return container.audioMessage;
  }
  return null;
}

async function transcribeAudioBuffer(buffer, mimeType) {
  const ext = mimeType?.includes('ogg') ? 'ogg' : 'mp3';
  const tmpFile = path.join(os.tmpdir(), `wa-audio-${crypto.randomUUID()}.${ext}`);

  await fs.promises.writeFile(tmpFile, buffer);
  try {
    const current = settings.get();
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: current.transcriptionModel,
      language: current.transcriptionLanguage || undefined,
    });
    return response.text.trim();
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

async function startBot() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: authState,
    logger,
    printQRInTerminal: false,
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

  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  const transcription = await transcribeAudioBuffer(buffer, audioMessage.mimetype);

  if (!transcription) {
    console.log('Transcrição vazia, nada a enviar.');
    return;
  }

  await sock.sendMessage(chatId, { text: `🎤 *Transcrição:*\n${transcription}` }, { quoted: msg });

  console.log(`Transcrição enviada para ${chatId}: ${transcription}`);
  state.pushEvent('transcription', transcription, { chatId });
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
