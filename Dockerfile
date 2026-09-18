FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# auth_info/ é a sessão do WhatsApp; deve ser montada como volume para persistir
# entre restarts do container (ver docker-compose.yml ou README.md).
VOLUME ["/app/auth_info"]

CMD ["node", "src/index.js"]
