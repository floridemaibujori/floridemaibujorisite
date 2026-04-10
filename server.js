const app = require('./src/app');
const { initDb } = require('./src/config/db');

const PORT = process.env.PORT || 3000;

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Server pornit pe http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Eroare la pornirea serverului:', error);
  process.exit(1);
});
