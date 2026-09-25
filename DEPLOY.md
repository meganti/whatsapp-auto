# Deploy na VPS

Checklist para publicar o bot na mesma VPS onde o Meganti Pad já roda. O bot tem uma interface web própria (porta `3000`) mas não precisa entrar no `docker-compose.yml` do Meganti Pad — roda isolado, na sua própria pasta, com seu próprio `docker-compose.yml`, sem risco de interferir no que já está no ar.

Rode os comandos abaixo direto na VPS (via SSH).

## 1. Confirmar que o Docker está disponível

```bash
docker --version
docker compose version
```

Se algum desses falhar, o Docker (ou o plugin Compose) precisa ser instalado antes de continuar — mas como o Meganti Pad já roda em Docker Compose nessa VPS, o esperado é que já esteja tudo pronto.

## 2. Baixar o código

```bash
mkdir -p ~/apps && cd ~/apps
git clone -b claude/whatsapp-audio-transcriber-dg5hix https://github.com/meganti/whatsapp-auto.git
cd whatsapp-auto
```

> Se o `git clone` pedir usuário/senha (repositório privado), use um Personal Access Token do GitHub no lugar da senha, ou clone via SSH (`git clone -b claude/whatsapp-audio-transcriber-dg5hix git@github.com:meganti/whatsapp-auto.git`) se a VPS já tiver uma chave SSH cadastrada no GitHub.

## 3. Configurar as variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

Preencha pelo menos:

```
OPENAI_API_KEY=sk-...
```

Como a porta `3000` (interface web) vai ficar acessível na VPS, defina também usuário e senha para proteger a página:

```
WEB_USERNAME=escolha-um-usuario
WEB_PASSWORD=escolha-uma-senha-forte
```

## 4. Primeira execução (escanear o QR code)

Precisa ser em primeiro plano na primeira vez, para você ver o QR code no terminal:

```bash
docker compose up --build
```

Abra o WhatsApp no celular em **Configurações > Aparelhos conectados > Conectar um aparelho** e escaneie o QR code que aparece no terminal da VPS.

Depois que aparecer `Conectado ao WhatsApp com sucesso.` no log, pare com `Ctrl+C`. A sessão fica salva em `./auth_info/` (persistida via volume no `docker-compose.yml`), então isso só precisa ser feito uma vez.

## 5. Subir em segundo plano

```bash
docker compose up -d
docker compose logs -f    # Ctrl+C só sai do log, não para o container
```

O `docker-compose.yml` já está com `restart: unless-stopped`, então o bot volta a subir automaticamente após reboot da VPS ou crash do processo, contanto que o serviço do Docker esteja habilitado no boot (já deve estar, já que o Meganti Pad depende disso).

## 6. Acessar a interface web

Por padrão o container expõe a porta `3000`. Sem reverse proxy, acesse direto por `http://<ip-da-vps>:3000` — mas primeiro confirme que o firewall libera a porta:

```bash
ufw allow 3000/tcp   # se a VPS usar ufw
```

### Opcional: domínio próprio com HTTPS (recomendado)

Se você tiver um subdomínio disponível (ex: algo como `wpp.meganti.com.br` — **confirme antes que esse domínio específico está livre e realmente aponta pra essa VPS**, e não para outro serviço já em uso), o ideal é colocar a interface atrás do reverse proxy que o Meganti Pad já usa (Nginx/Traefik/Caddy) em vez de expor a porta `3000` direto:

1. Aponte o DNS do subdomínio (registro `A`) para o IP da VPS.
2. Configure o reverse proxy existente para encaminhar esse domínio para `localhost:3000` (ou para o container `whatsapp-transcriber`, se estiver na mesma rede Docker do proxy) com certificado HTTPS (Let's Encrypt/Certbot, ou automático se for Traefik/Caddy).
3. Depois disso, remova a publicação direta da porta `3000` no `docker-compose.yml` deste projeto (tire o bloco `ports:`) e reinicie com `docker compose up -d`, para que a única forma de acesso seja via HTTPS pelo domínio.

Como não sei como o reverse proxy do Meganti Pad está configurado nessa VPS, não tenho como gerar o bloco de config exato — me mande o `docker-compose.yml`/config do proxy que já roda lá (ou me diga qual é: Nginx, Traefik, Caddy...) que eu preparo o trecho certo.

## 7. Atualizar depois de mudanças no código

```bash
cd ~/apps/whatsapp-auto
git pull
docker compose up -d --build
```

## Checklist rápido

- [ ] `docker --version` / `docker compose version` funcionam
- [ ] Repositório clonado em `~/apps/whatsapp-auto`
- [ ] `.env` preenchido com `OPENAI_API_KEY`, `WEB_USERNAME` e `WEB_PASSWORD`
- [ ] QR code escaneado na primeira execução em foreground
- [ ] `docker compose up -d` rodando, `docker compose logs -f` mostra "Aguardando áudios..."
- [ ] Interface web acessível e pedindo usuário/senha (`http://<ip-da-vps>:3000`)

## Segurança

- **Troque a senha de root da VPS.** Se ela foi compartilhada em texto puro em algum chat/ferramenta, considere-a comprometida e troque por uma nova (ou, melhor, migre para autenticação por chave SSH e desative login por senha em `/etc/ssh/sshd_config`).
- **Não deixe a interface web sem `WEB_USERNAME`/`WEB_PASSWORD`** se a porta `3000` estiver acessível de fora — ela mostra o QR code de pareamento (quem escanear "rouba" a sessão) e o histórico de transcrições.
- Prefira colocar a interface atrás de HTTPS (domínio + reverse proxy) em vez de expor a porta `3000` direto pela internet.
