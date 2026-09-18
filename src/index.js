require('dotenv').config();

const auth = require('./auth');
const bot = require('./bot');
const { startWebServer } = require('./web/server');

auth.bootstrapAdminCredentials();
startWebServer();

bot.startBot().catch((err) => {
  console.error('Falha ao iniciar o bot:', err);
  process.exit(1);
});
