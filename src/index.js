require('dotenv').config();

const auth = require('./auth');
const bot = require('./bot');
const connections = require('./connections');
const { startWebServer } = require('./web/server');

auth.bootstrapAdminCredentials();
startWebServer();

for (const { id, label } of connections.initRegistry()) {
  bot.startBot(id).catch((err) => {
    console.error(`Falha ao iniciar a conexão "${label}" (${id}):`, err);
  });
}
