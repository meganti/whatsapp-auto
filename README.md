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

4. Uma interface web (porta `3000` por padrão) mostra o status da conexão, o QR code (quando precisar parear) e o histórico das últimas transcrições — ver [Interface web](#interface-web) abaixo.

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

Um QR code vai aparecer no terminal (e também na interface web, em `http://localhost:3000`). Abra o WhatsApp no seu celular em **Configurações > Aparelhos conectados > Conectar um aparelho** e escaneie o código.

Após conectar, o bot ficará rodando e transcrevendo automaticamente os áudios recebidos. A sessão é salva na pasta `auth_info/` (ignorada pelo git), então não é necessário escanear o QR code novamente nas próximas execuções, a menos que a sessão seja desconectada.

## Interface web

Ao iniciar, o bot sobe um pequeno servidor web (porta `3000` por padrão, configurável via `WEB_PORT`) com uma única página mostrando:

- Status da conexão (conectando / aguardando QR / conectado / desconectado)
- O QR code para parear, renderizado como imagem (sem precisar olhar o terminal)
- As últimas transcrições feitas (contato, horário e texto)

Acesse em `http://<host>:3000` (`http://localhost:3000` local, ou o IP/domínio da VPS em produção).

Se a porta ficar acessível publicamente (ex: exposta numa VPS), configure `WEB_USERNAME` e `WEB_PASSWORD` no `.env` para proteger a página com HTTP Basic Auth — sem isso, qualquer pessoa que acesse a URL vê o QR code (podendo sequestrar o pareamento) e o histórico de transcrições.

## Configuração (`.env`)

| Variável | Descrição | Padrão |
|---|---|---|
| `OPENAI_API_KEY` | Chave da API da OpenAI (obrigatória) | — |
| `TRANSCRIPTION_MODEL` | Modelo de transcrição (`whisper-1` ou `gpt-4o-transcribe`) | `whisper-1` |
| `TRANSCRIPTION_LANGUAGE` | Idioma dos áudios em ISO-639-1 (ex: `pt`). Deixe vazio para detecção automática | `pt` |
| `ONLY_TRANSCRIBE_OWN_AUDIOS` | Se `true`, só transcreve áudios enviados por você mesmo (`fromMe`). Se `false`, transcreve de qualquer conversa | `false` |
| `WEB_PORT` | Porta da interface web | `3000` |
| `WEB_USERNAME` / `WEB_PASSWORD` | Credenciais de HTTP Basic Auth da interface web. Deixe em branco para desativar (não recomendado em produção) | — |

## Rodando com PM2 (processo persistente em servidor)

[PM2](https://pm2.keymetrics.io/) mantém o bot rodando em segundo plano, reiniciando automaticamente em caso de crash ou reboot do servidor.

```bash
npm install
npm install -g pm2   # se ainda não tiver o PM2 instalado globalmente
cp .env.example .env # edite com sua OPENAI_API_KEY
```

Primeira execução (para escanear o QR code, rode em primeiro plano uma vez):

```bash
npm start
```

Depois de conectado (sessão salva em `auth_info/`), pare com `Ctrl+C` e suba via PM2:

```bash
npm run pm2:start     # inicia via ecosystem.config.js
npm run pm2:logs      # acompanha os logs
npm run pm2:restart   # reinicia o processo
npm run pm2:stop      # para o processo
```

Para o PM2 sobreviver a um reboot do servidor, gere o script de startup uma vez:

```bash
pm2 startup
pm2 save
```

Os logs ficam em `logs/out.log` e `logs/error.log` (pasta ignorada pelo git).

## Rodando com Docker

O `Dockerfile` empacota o bot; a pasta `auth_info/` (sessão do WhatsApp) precisa ser montada como volume para persistir entre restarts do container.

Com Docker Compose (mais simples, já configurado em `docker-compose.yml`):

```bash
cp .env.example .env   # edite com sua OPENAI_API_KEY
docker compose up      # primeira vez: sem -d, para ver o QR code no terminal
```

Escaneie o QR code exibido no terminal. Depois de conectado, pode rodar em segundo plano:

```bash
docker compose up -d
docker compose logs -f   # acompanhar logs / novo QR code se a sessão cair
```

Sem Docker Compose:

```bash
docker build -t whatsapp-transcriber .
docker run -it --name whatsapp-transcriber \
  --env-file .env \
  -p 3000:3000 \
  -v "$(pwd)/auth_info:/app/auth_info" \
  whatsapp-transcriber
```

## Deploy em VPS

Para publicar em uma VPS (ex: junto com outros apps já rodando via Docker), veja o passo a passo em [`DEPLOY.md`](./DEPLOY.md).

## Avisos importantes

- Baileys usa um protocolo não-oficial do WhatsApp Web. Existe risco (baixo, mas real) de o número ser temporariamente restringido pelo WhatsApp caso o uso seja excessivo ou pareça automação em massa. Use com moderação e apenas para o próprio número.
- Os áudios são enviados para a API da OpenAI para transcrição — não é um processo 100% local. Se isso for um problema, é possível trocar a implementação por um modelo local (ex: `whisper.cpp`/`faster-whisper`).
- Este projeto é destinado a uso pessoal.
