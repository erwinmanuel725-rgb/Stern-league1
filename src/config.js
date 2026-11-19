'use strict';
const fs = require('fs');
const path = require('path');

const prod = process.env.NODE_ENV === 'production';
const ROOT = path.join(__dirname, '..');
// dist/ existe après `npm run build` (JS/CSS minifiés) ; sinon on sert les sources web/
const STATIC_DIR = fs.existsSync(path.join(ROOT, 'dist', 'index.html')) ? path.join(ROOT, 'dist') : path.join(ROOT, 'web');

module.exports = {
  prod,
  ROOT,
  STATIC_DIR,
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || process.env.TEST_DATABASE_URL,
  databaseSsl: process.env.DATABASE_SSL === 'true',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  adminSessionHours: parseFloat(process.env.ADMIN_SESSION_HOURS || '12'),
  betCloseMinutes: parseInt(process.env.BET_CLOSE_MINUTES || '0', 10),
  maxStakePerMatch: 1000,
  defaultStart: '2026-11-19', // date du 1er jour de la J4 (modifiable depuis /admin)
};
