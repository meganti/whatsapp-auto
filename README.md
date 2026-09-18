# Transcritor de Áudios do WhatsApp

Bot que conecta ao seu WhatsApp (via [Baileys](https://github.com/WhiskeySockets/Baileys), a mesma tecnologia do WhatsApp Web) e transcreve automaticamente todo áudio/mensagem de voz recebido, respondendo a transcrição em texto na própria conversa.

A transcrição é feita pela API de Whisper da OpenAI.

## Como funciona

1. O bot se conecta ao seu número de WhatsApp através de um QR code, exatamente como o WhatsApp Web.
2. Sempre que chegar um áudio (mensagem de voz ou arquivo de áudio) em qualquer conversa ou grupo, o bot baixa o áudio, envia para a API da OpenAI e recebe o texto transcrito.
3. O bot responde no mesmo chat, citando a mensagem original, com o texto:

   ```
   🎤 Transcrição:
   <texto transcrito>
   ```

## Pré-requisitos

- Node.js 18 ou superior
- Uma chave de API da OpenAI ([platform.openai.com/api-keys](https://platform.openai.com/api-keys))

## Instalação

```bash
npm install
cp .env.example .env
```

Edite o arquivo `.env` e coloque sua chave:

```
OPENAI_API_KEY=sk-...
```

## Uso

```bash
npm start
```

Um QR code vai aparecer no terminal. Abra o WhatsApp no seu celular em **Configurações > Aparelhos conectados > Conectar um aparelho** e escaneie o código.

Após conectar, o bot ficará rodando e transcrevendo automaticamente os áudios recebidos. A sessão é salva na pasta `auth_info/` (ignorada pelo git), então não é necessário escanear o QR code novamente nas próximas execuções, a menos que a sessão seja desconectada.

## Configuração (`.env`)

| Variável | Descrição | Padrão |
|---|---|---|
| `OPENAI_API_KEY` | Chave da API da OpenAI (obrigatória) | — |
| `TRANSCRIPTION_MODEL` | Modelo de transcrição (`whisper-1` ou `gpt-4o-transcribe`) | `whisper-1` |
| `TRANSCRIPTION_LANGUAGE` | Idioma dos áudios em ISO-639-1 (ex: `pt`). Deixe vazio para detecção automática | `pt` |
| `ONLY_TRANSCRIBE_OWN_AUDIOS` | Se `true`, só transcreve áudios enviados por você mesmo (`fromMe`). Se `false`, transcreve de qualquer conversa | `false` |

## Avisos importantes

- Baileys usa um protocolo não-oficial do WhatsApp Web. Existe risco (baixo, mas real) de o número ser temporariamente restringido pelo WhatsApp caso o uso seja excessivo ou pareça automação em massa. Use com moderação e apenas para o próprio número.
- Os áudios são enviados para a API da OpenAI para transcrição — não é um processo 100% local. Se isso for um problema, é possível trocar a implementação por um modelo local (ex: `whisper.cpp`/`faster-whisper`).
- Este projeto é destinado a uso pessoal.
