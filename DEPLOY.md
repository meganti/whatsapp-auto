# Deploy na VPS

Checklist para publicar o bot na mesma VPS onde o Meganti Pad já roda. Como este bot **não expõe nenhuma porta HTTP** (ele só conecta para fora, ao WhatsApp e à OpenAI), ele não precisa entrar no `docker-compose.yml` do Meganti Pad nem no reverse proxy — roda isolado, na sua própria pasta, sem risco de interferir no que já está no ar.

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

## 6. Atualizar depois de mudanças no código

```bash
cd ~/apps/whatsapp-auto
git pull
docker compose up -d --build
```

## Checklist rápido

- [ ] `docker --version` / `docker compose version` funcionam
- [ ] Repositório clonado em `~/apps/whatsapp-auto`
- [ ] `.env` preenchido com `OPENAI_API_KEY`
- [ ] QR code escaneado na primeira execução em foreground
- [ ] `docker compose up -d` rodando, `docker compose logs -f` mostra "Aguardando áudios..."

## Segurança

- **Troque a senha de root da VPS.** Se ela foi compartilhada em texto puro em algum chat/ferramenta, considere-a comprometida e troque por uma nova (ou, melhor, migre para autenticação por chave SSH e desative login por senha em `/etc/ssh/sshd_config`).
- O container não expõe portas — não é necessário liberar nada no firewall para ele.
