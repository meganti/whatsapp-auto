# Transcritor de Áudios do WhatsApp

Bot que conecta ao seu WhatsApp (via [Baileys](https://github.com/WhiskeySockets/Baileys), a mesma tecnologia do WhatsApp Web) e transcreve automaticamente todo áudio/mensagem de voz recebido, respondendo a transcrição em texto na própria conversa.

A transcrição é feita pela API de Whisper da OpenAI.

## Como funciona

1. O bot se conecta ao seu número de WhatsApp através de um QR code ou pairing code, exatamente como o WhatsApp Web — o pareamento é feito pelo **painel admin web** (veja abaixo), não mais pelo terminal.
2. Sempre que chegar um áudio (mensagem de voz ou arquivo de áudio) em qualquer conversa ou grupo, o bot baixa o áudio, envia para a API da OpenAI e recebe o texto transcrito.
3. O bot responde no mesmo chat, citando a mensagem original, com o texto:

   ```
   🎤 Transcrição:
   <texto transcrito>
   ```

   Se o contato for de outro país (detectado pelo código do número), o bot também traduz (via gpt-4o-mini) e manda os dois:
   - Áudio que você manda pra um contato estrangeiro → transcrição original + tradução no idioma dele.
   - Áudio que o contato estrangeiro manda pra você → transcrição original + tradução em português.

   Isso depende do WhatsApp expor o número de telefone do contato (`remoteJidAlt`) mesmo quando o chat usa um identificador `@lid` — quando não expõe, o bot só manda a transcrição original, sem tradução.

## Painel admin

O bot sobe um servidor web (Express) autenticado, com:

- **Status da conexão** com o WhatsApp e QR code para reparear quando necessário.
- **Configurações** editáveis em tempo real (sem restart): modelo de transcrição, idioma, e se só transcreve os próprios áudios.
- **Atividade recente**: log das últimas transcrições e erros.
- **Segurança**: troca de senha e opção de apagar a sessão do WhatsApp (força novo pareamento).

No primeiro start, um usuário/senha de admin são gerados automaticamente e impressos **uma única vez** no log do processo/container — troque a senha pelo próprio painel assim que logar. Veja `.env.example` para as variáveis `ADMIN_PORT`/`TRUST_PROXY`; por padrão o painel escuta em `http://localhost:3000` (ou a porta de `ADMIN_PORT`). Em produção, exponha atrás de um reverse proxy HTTPS (veja [`DEPLOY.md`](./DEPLOY.md)) — não publique a porta direto na internet sem TLS.

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

O log mostra a URL do painel admin (`http://localhost:3000` por padrão) e a senha gerada automaticamente. Abra o painel, faça login e escaneie o QR code exibido lá (ou use o botão de reconectar). Abra o WhatsApp no celular em **Configurações > Aparelhos conectados > Conectar um aparelho**.

Após conectar, o bot ficará rodando e transcrevendo automaticamente os áudios recebidos. A sessão é salva na pasta `auth_info/` (ignorada pelo git), então não é necessário parear novamente nas próximas execuções, a menos que a sessão seja desconectada.

## Configuração (`.env`)

| Variável | Descrição | Padrão |
|---|---|---|
| `OPENAI_API_KEY` | Chave da API da OpenAI (obrigatória) | — |
| `TRANSCRIPTION_MODEL` | Modelo de transcrição — default inicial, depois editável pelo painel admin | `whisper-1` |
| `TRANSCRIPTION_LANGUAGE` | Idioma dos áudios em ISO-639-1 (ex: `pt`) — default inicial, depois editável pelo painel admin | `pt` |
| `ONLY_TRANSCRIBE_OWN_AUDIOS` | Se `true`, só transcreve áudios enviados por você mesmo — default inicial, depois editável pelo painel admin | `false` |
| `ADMIN_PORT` | Porta em que o painel admin web escuta | `3000` |
| `TRUST_PROXY` | `true` quando atrás de um reverse proxy HTTPS (cookies `secure`) | `false` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` | Gerados automaticamente no primeiro start e gravados neste arquivo — não defina manualmente | — |

As três primeiras (modelo, idioma, só-próprios-áudios) só valem como valor inicial: depois do primeiro start, viram estado editável no painel, persistido em `data/settings.json`.

## Rodando com PM2 (processo persistente em servidor)

[PM2](https://pm2.keymetrics.io/) mantém o bot rodando em segundo plano, reiniciando automaticamente em caso de crash ou reboot do servidor.

```bash
npm install
npm install -g pm2   # se ainda não tiver o PM2 instalado globalmente
cp .env.example .env # edite com sua OPENAI_API_KEY
```

Primeira execução (para parear pelo painel admin, rode em primeiro plano uma vez):

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

O `Dockerfile` empacota o bot; as pastas `auth_info/` (sessão do WhatsApp) e `data/` (configurações do painel) precisam ser montadas como volume para persistir entre restarts do container.

Com Docker Compose (mais simples, já configurado em `docker-compose.yml`):

```bash
cp .env.example .env   # edite com sua OPENAI_API_KEY
docker compose up -d --build
docker compose logs -f   # mostra a URL e a senha gerada do painel admin
```

Pareie pelo painel admin (veja a seção acima). O `docker-compose.yml` já não publica nenhuma porta no host por padrão — para acessar localmente, publique `ADMIN_PORT` manualmente ou use o exemplo de deploy com reverse proxy em [`DEPLOY.md`](./DEPLOY.md).

Sem Docker Compose:

```bash
docker build -t whatsapp-transcriber .
docker run -it --name whatsapp-transcriber \
  --env-file .env \
  -v "$(pwd)/auth_info:/app/auth_info" \
  whatsapp-transcriber
```

## Deploy em VPS

Para publicar em uma VPS (ex: junto com outros apps já rodando via Docker), veja o passo a passo em [`DEPLOY.md`](./DEPLOY.md).

## Avisos importantes

- Baileys usa um protocolo não-oficial do WhatsApp Web. Existe risco (baixo, mas real) de o número ser temporariamente restringido pelo WhatsApp caso o uso seja excessivo ou pareça automação em massa. Use com moderação e apenas para o próprio número.
- Os áudios são enviados para a API da OpenAI para transcrição — não é um processo 100% local. Se isso for um problema, é possível trocar a implementação por um modelo local (ex: `whisper.cpp`/`faster-whisper`).
- Este projeto é destinado a uso pessoal.
