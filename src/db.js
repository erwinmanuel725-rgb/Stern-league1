'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const cfg = require('./config');
const seed = require('./seed-data');

function createPool(url = cfg.databaseUrl) {
  if (!url) throw new Error('DATABASE_URL manquant');
  return new Pool({
    connectionString: url,
    ssl: cfg.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

/** Transaction : COMMIT si la fonction réussit, ROLLBACK sinon. */
async function tx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}

/** Crée le schéma et injecte les données initiales si la base est vide (verrou consultatif : sûr avec 2 instances). */
async function migrate(pool) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(727001)');
    await c.query(schema);

    // Initialiser la date des matchs si la colonne est vide
    const unpop = await c.query('SELECT count(*)::int AS n FROM matches WHERE date IS NULL');
    if (unpop.rows[0].n > 0) {
      const st = await c.query("SELECT value FROM settings WHERE key='start'");
      const start = st.rows[0] ? st.rows[0].value : cfg.defaultStart;
      const D = require('./domain');
      const missing = (await c.query('SELECT id, matchday, day_in_md, hour, minute FROM matches WHERE date IS NULL')).rows;
      for (const m of missing) {
        const d = D.isoDate(start, m);
        await c.query('UPDATE matches SET date=$1 WHERE id=$2', [d, m.id]);
      }
    }

    // S'assurer que le modérateur goruto existe
    const hasGoruto = await c.query("SELECT 1 FROM players WHERE name = 'goruto'");
    if (!hasGoruto.rowCount) {
      const maxIdRow = await c.query("SELECT coalesce(max(id), 39)::int AS m FROM players");
      const newId = maxIdRow.rows[0].m + 1;
      await c.query("INSERT INTO players(id, name, kind, balance) VALUES($1, 'goruto', 'mod', 0)", [newId]);
      await c.query("INSERT INTO wallet_transactions(player_id, delta, balance_after, reason, actor) VALUES($1, 0, 0, 'initial', 'system')", [newId]);
    }

    const { rows } = await c.query('SELECT count(*)::int AS n FROM players');
    if (rows[0].n > 0) return;

    const players = [];
    seed.LEAGUE.forEach((b, i) => players.push({ id: i, name: b[0], kind: 'league', b, bal: seed.LEAGUE_WALLET[i] }));
    seed.OTHERS.forEach((o, k) => players.push({ id: 18 + k, name: o[0], kind: seed.MODS.includes(o[0]) ? 'mod' : 'bettor', b: [0, 0, 0, 0, 0, 0, 0], bal: o[1] }));
    for (const p of players) {
      await c.query(
        `INSERT INTO players(id,name,kind,base_j,base_v,base_d,base_l,base_bp,base_bc,balance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [p.id, p.name, p.kind, p.kind === 'league' ? p.b[1] : 0, p.kind === 'league' ? p.b[2] : 0, p.kind === 'league' ? p.b[3] : 0, p.kind === 'league' ? p.b[4] : 0, p.kind === 'league' ? p.b[5] : 0, p.kind === 'league' ? p.b[6] : 0, p.bal],
      );
      await c.query(`INSERT INTO wallet_transactions(player_id,delta,balance_after,reason,actor) VALUES($1,$2,$2,'initial','system')`, [p.id, p.bal]);
    }
    for (const m of seed.buildFixtures()) {
      await c.query('INSERT INTO matches(id,matchday,home,away,day_in_md,hour,referee) VALUES($1,$2,$3,$4,$5,$6,$7)', [m.id, m.matchday, m.home, m.away, m.day_in_md, m.hour, m.referee]);
    }
    const nm = (x) => (typeof x === 'number' ? seed.LEAGUE[x][0] : x);
    for (const h of seed.HIST) {
      await c.query(
        'INSERT INTO history_matches(matchday,home_name,away_name,home_idx,away_idx,hs,"as",forfeit) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [h[0], nm(h[1]), nm(h[2]), typeof h[1] === 'number' ? h[1] : null, typeof h[2] === 'number' ? h[2] : null, h[3], h[4], h[5] || 0],
      );
    }
    await c.query(`INSERT INTO settings(key,value) VALUES('start',$1)`, [cfg.defaultStart]);
  });
}

module.exports = { createPool, tx, migrate };
