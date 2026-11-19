'use strict';
// Export JSON manuel avant chaque journée : `railway run npm run export > sauvegarde.json`
const { createPool } = require('../src/db');
const { exportAll } = require('../src/services');
(async () => { const pool = createPool(); console.log(JSON.stringify(await exportAll(pool), null, 1)); await pool.end(); })().catch((e) => { console.error(e.message); process.exit(1); });
