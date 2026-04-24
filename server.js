const app = require('./src/app');
const { initDb } = require('./src/config/db');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
let server;

async function start() {
  await initDb();
  server = app.listen(PORT, HOST, () => {
    console.log(`Server pornit pe http://${HOST}:${PORT}`);
  });
}

function shutdown(signal) {
  console.log(`Semnal primit (${signal}). Oprire server...`);
  if (!server) {
    process.exit(0);
    return;
  }

  server.close(() => {
    console.log('Server oprit curat.');
    process.exit(0);
  });

  setTimeout(() => {
    console.warn('Forta inchidere dupa timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((error) => {
  console.error('Eroare la pornirea serverului:', error);
  process.exit(1);
});
