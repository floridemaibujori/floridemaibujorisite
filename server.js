const dns = require('node:dns');
const app = require('./src/app');
const { initDb } = require('./src/config/db');
const { verifyEmailTransport } = require('./src/services/emailService');

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
let server;

async function start() {
  await initDb();
  server = app.listen(PORT, HOST, () => {
    console.log(`Server pornit pe http://${HOST}:${PORT}`);

    setImmediate(async () => {
      const smtpCheck = await verifyEmailTransport();
      if (smtpCheck.ok) {
        console.log('Email transport OK:', smtpCheck.details);
      } else {
        console.warn(`Email transport indisponibil: ${smtpCheck.reason}`, smtpCheck.details || {});
        if (process.env.NODE_ENV === 'production') {
          console.error('Configuratia de email lipseste in productie. Oprire server pentru a evita comenzi fara email.');
          shutdown('EMAIL_CONFIG_MISSING');
        }
      }
    });
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
