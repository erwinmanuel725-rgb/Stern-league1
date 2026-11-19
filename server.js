'use strict';
const cfg = require('./src/config');
const { createPool, migrate } = require('./src/db');
const { createApp } = require('./src/app');

(async () => {
  const pool = createPool();
  await migrate(pool);
  if (!cfg.adminPasswordHash) console.warn('⚠️  ADMIN_PASSWORD_HASH non défini : la page /admin est désactivée. Génère-le avec `npm run hash-password`.');
  // nettoyage des sessions admin expirées
  setInterval(() => pool.query('DELETE FROM admin_sessions WHERE expires_at < now()').catch(() => {}), 3600 * 1000).unref();
  const server = createApp(pool).listen(cfg.port, () => console.log(JSON.stringify({ level: 'info', msg: 'listening', port: cfg.port, static: cfg.STATIC_DIR })));
  const stop = () => { server.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch((e) => { console.error('Démarrage impossible :', e.message); process.exit(1); });
