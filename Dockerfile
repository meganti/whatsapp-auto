FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# auth_info/ é a sessão do WhatsApp; data/ guarda as configurações editadas pelo
# painel admin. Ambas devem ser montadas como volume (ver docker-compose.yml).
VOLUME ["/app/auth_info", "/app/data"]

EXPOSE 3000

CMD ["node", "src/index.js"]
