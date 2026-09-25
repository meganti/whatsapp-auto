require('dotenv').config();

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
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const OpenAI = require('openai');

const state = require('./state');
const { startWebServer } = require('./web');

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');
const TRANSCRIPTION_MODEL = process.env.TRANSCRIPTION_MODEL || 'whisper-1';
const TRANSCRIPTION_LANGUAGE = process.env.TRANSCRIPTION_LANGUAGE || undefined;
const ONLY_TRANSCRIBE_OWN_AUDIOS = process.env.ONLY_TRANSCRIBE_OWN_AUDIOS === 'true';

if (!process.env.OPENAI_API_KEY) {
  console.error('Erro: defina OPENAI_API_KEY no arquivo .env antes de iniciar o bot.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

function extractAudioMessage(message) {
  if (!message?.message) return null;

  // Áudios podem vir diretamente ou dentro de mensagens efêmeras/encaminhadas.
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
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: TRANSCRIPTION_MODEL,
      language: TRANSCRIPTION_LANGUAGE,
    });
    return response.text.trim();
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nEscaneie o QR code abaixo com o WhatsApp (Aparelhos conectados > Conectar aparelho):\n');
      qrcode.generate(qr, { small: true });
      state.setWaitingQr(qr);
    }

    if (connection === 'open') {
      console.log('Conectado ao WhatsApp com sucesso. Aguardando áudios...');
      state.setConnected();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`Conexão encerrada (código ${statusCode}). Reconectando: ${shouldReconnect}`);
      state.setDisconnected();
      if (shouldReconnect) {
        startBot();
      } else {
        console.log('Sessão desconectada. Apague a pasta auth_info/ e rode novamente para gerar um novo QR code.');
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
      }
    }
  });
}

async function handleMessage(sock, msg) {
  if (!msg.message) return;

  const audioMessage = extractAudioMessage(msg);
  if (!audioMessage) return;

  if (ONLY_TRANSCRIBE_OWN_AUDIOS && !msg.key.fromMe) return;

  const chatId = msg.key.remoteJid;
  console.log(`Áudio recebido em ${chatId}. Transcrevendo...`);

  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  const transcription = await transcribeAudioBuffer(buffer, audioMessage.mimetype);

  if (!transcription) {
    console.log('Transcrição vazia, nada a enviar.');
    return;
  }

  await sock.sendMessage(
    chatId,
    { text: `🎤 *Transcrição:*\n${transcription}` },
    { quoted: msg }
  );

  state.addTranscription({ chatId, chatName: msg.pushName, text: transcription });
  console.log(`Transcrição enviada para ${chatId}: ${transcription}`);
}

startWebServer();

startBot().catch((err) => {
  console.error('Falha ao iniciar o bot:', err);
  process.exit(1);
});
