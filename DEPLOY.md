# Deploy na VPS

Checklist para publicar o bot na mesma VPS onde o Meganti Pad já roda. O bot tem um painel admin web (autenticado) servido em `ADMIN_PORT` (padrão 3000) dentro do container — nenhuma porta é publicada no host; quem expõe pra internet é o Caddy compartilhado do Meganti Pad, via rede Docker interna (`megantipad_default`) e um domínio próprio (`wpp.meganti.com.br`, HTTPS automático via Let's Encrypt). O bot roda isolado, na sua própria pasta (`~/apps/whatsapp-auto`), sem tocar no código do Meganti Pad — só compartilha a rede Docker e uma entrada a mais no `Caddyfile`.

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

## 4. Conectar a rede do Caddy compartilhado

O `docker-compose.yml` referencia a rede externa `megantipad_default` (criada pelo Compose do Meganti Pad) para o Caddy alcançar este container. Ela só existe se o Meganti Pad já estiver no ar; confirme com:

```bash
docker network ls | grep megantipad_default
```

## 5. Build e subida

```bash
docker compose up -d --build
docker compose logs -f    # Ctrl+C só sai do log, não para o container
```

Na primeira vez sem `auth_info/` preenchido, o log mostra `Novo QR code disponível no painel admin.` — o pareamento (QR code ou pairing code) é feito **pelo painel admin web**, não pelo terminal. Veja a seção "Painel admin" abaixo.

Logo no primeiro start também aparecem no log as credenciais geradas automaticamente do painel:

```
Usuário: admin
Senha:   <gerada aleatoriamente>
```

Anote a senha — ela só aparece essa vez no log; troque-a pelo próprio painel depois de logar.

O `docker-compose.yml` já está com `restart: unless-stopped`, então o bot volta a subir automaticamente após reboot da VPS ou crash do processo, contanto que o serviço do Docker esteja habilitado no boot (já deve estar, já que o Meganti Pad depende disso). A sessão do WhatsApp fica em `./auth_info/` e as configurações editáveis pelo painel em `./data/` — ambas persistidas via volume, sobrevivem a rebuilds.

## 6. Expor o painel admin (Caddy + HTTPS)

Adicione um bloco ao `Caddyfile` do Meganti Pad (`/root/megantipad/Caddyfile`) apontando para o container pelo nome (mesma rede Docker):

```
wpp.meganti.com.br {
	reverse_proxy whatsapp-transcriber:3000
}
```

O domínio precisa ter um registro DNS **A** apontando para o IP da VPS antes do reload, senão a emissão do certificado Let's Encrypt falha (ele fica tentando de novo sozinho depois que o DNS propagar). Recarregue o Caddy sem downtime:

```bash
docker exec megantipad-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Acesse `https://wpp.meganti.com.br` com o usuário/senha gerados no passo 5.

## 7. Atualizar depois de mudanças no código

```bash
cd ~/apps/whatsapp-auto
git pull
docker compose up -d --build
```

## Checklist rápido

- [ ] `docker --version` / `docker compose version` funcionam
- [ ] Repositório clonado em `~/apps/whatsapp-auto`
- [ ] `.env` preenchido com `OPENAI_API_KEY`
- [ ] Rede `megantipad_default` existe (`docker network ls`)
- [ ] `docker compose up -d --build` rodando, `docker compose logs -f` mostra "Aguardando áudios..."
- [ ] Pareamento feito pelo painel admin (QR code / pairing code)
- [ ] Bloco `wpp.meganti.com.br` adicionado ao `Caddyfile` e recarregado
- [ ] Login no painel com a senha gerada no log, senha trocada em seguida

## Segurança

- **Troque a senha de root da VPS.** Se ela foi compartilhada em texto puro em algum chat/ferramenta, considere-a comprometida e troque por uma nova (ou, melhor, migre para autenticação por chave SSH e desative login por senha em `/etc/ssh/sshd_config`).
- O container não publica nenhuma porta no host — só é alcançável pelo Caddy via rede Docker interna, então não é necessário liberar nada além de 80/443 no firewall (já liberado, pois o Meganti Pad depende disso).
- O painel admin usa sessão com cookie `httpOnly` + `secure` (via `TRUST_PROXY=true`) e rate limit de 5 tentativas de login por IP a cada 5 min. Ainda assim, troque a senha gerada automaticamente assim que logar pela primeira vez.
