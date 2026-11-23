'use strict';
const cfg = require('./config');
const { tx } = require('./db');
const { HttpError } = require('./errors');
const D = require('./domain');

// ---------- lecture ----------
async function loadCore(db) {
  // requêtes en série : un client de transaction ne peut exécuter qu'une requête à la fois
  const pl = await db.query('SELECT * FROM players ORDER BY id');
  const ma = await db.query('SELECT * FROM matches ORDER BY id');
  const re = await db.query('SELECT * FROM results');
  const st = await db.query(`SELECT value FROM settings WHERE key='start'`);
  const results = new Map(re.rows.map((r) => [r.match_id, r]));
  const start = st.rows[0] ? st.rows[0].value : cfg.defaultStart;
  const rows = D.standings(pl.rows.filter((p) => p.kind === 'league'), ma.rows, results);
  return { players: pl.rows, matches: ma.rows, results, start, rows, cur: D.currentMatchday(ma.rows, results) };
}

const closeAt = (start, m) => new Date(D.kickoff(start, m).getTime() - cfg.betCloseMinutes * 60000);

/** État public : ne contient que la journée en cours (et les précédentes), jamais le calendrier futur. */
async function publicState(pool, playerId, imgs, now = new Date()) {
  const core = await loadCore(pool);
  const byId = new Map(core.players.map((p) => [p.id, p]));
  const visible = core.matches.filter((m) => m.matchday <= core.cur);
  const matches = visible.map((m) => {
    const r = core.results.get(m.id);
    const ko = D.kickoff(core.start, m);
    return {
      id: m.id, j: m.matchday, h: m.home, a: m.away, hour: m.hour, date: D.isoDate(core.start, m),
      kickoff: ko.toISOString(), referee: m.referee,
      result: r ? { h: r.home_goals, a: r.away_goals, ff: r.forfeit } : null,
      odds: r ? null : D.odds(core.rows, m.home, m.away),
      open: !r && now < closeAt(core.start, m),
    };
  });
  const hist = await pool.query('SELECT * FROM history_matches ORDER BY matchday, id');
  const out = {
    now: now.toISOString(), cur: core.cur,
    players: core.players.map((p) => ({ id: p.id, name: p.name, kind: p.kind, claimed: !!p.claim_hash, balance: p.balance, img: imgs[p.id] || null })),
    standings: D.sortStandings(core.rows).map(({ i, n, j, v, d, l, bp, bc, pts, db }) => ({ i, n, j, v, d, l, bp, bc, pts, db })),
    matches,
    history: hist.rows.map((h) => ({ j: h.matchday, h: h.home_name, a: h.away_name, hi: h.home_idx, ai: h.away_idx, hs: h.hs, as: h.as, ff: h.forfeit })),
    me: null, bets: [],
  };
  if (playerId != null && byId.has(playerId)) {
    const me = byId.get(playerId);
    const b = await pool.query(
      `SELECT b.id, b.match_id, b.outcome, b.stake, b.odd, b.status, b.delta, b.type, b.created_at
         FROM bets b WHERE b.player_id=$1 ORDER BY b.id DESC`, [playerId]);
    const pending = b.rows.filter((x) => x.status === 'p').reduce((a, x) => a + x.stake, 0);
    out.me = { id: me.id, name: me.name, balance: me.balance, pending, available: Math.max(0, me.balance - pending) };

    const betIds = b.rows.map((x) => x.id);
    const legsRes = betIds.length ? (await pool.query(
      `SELECT l.bet_id, l.match_id, l.outcome, l.odd, l.status
         FROM bet_legs l WHERE l.bet_id = ANY($1::bigint[]) ORDER BY l.id`, [betIds])).rows : [];
    const legsByBet = new Map();
    for (const l of legsRes) {
      if (!legsByBet.has(l.bet_id)) legsByBet.set(l.bet_id, []);
      legsByBet.get(l.bet_id).push({
        m: l.match_id,
        k: l.outcome,
        odd: l.odd,
        s: l.status,
      });
    }

    out.bets = b.rows.map((x) => ({
      id: Number(x.id),
      type: x.type || (legsByBet.get(x.id)?.length > 1 ? 'combo' : 'single'),
      m: x.match_id,
      k: x.outcome,
      st: x.stake,
      odd: x.odd,
      s: x.status,
      delta: x.delta,
      legs: legsByBet.get(x.id) || (x.match_id != null ? [{ m: x.match_id, k: x.outcome, odd: x.odd, s: x.status }] : []),
    }));
  }
  return out;
}

// ---------- portefeuille (journal de transactions) ----------
async function applyDelta(c, playerId, delta, { reason, betId = null, matchId = null, note = null, actor = 'system' }) {
  const { rows } = await c.query('UPDATE players SET balance = balance + $2 WHERE id=$1 RETURNING balance', [playerId, delta]);
  await c.query(
    `INSERT INTO wallet_transactions(player_id,delta,balance_after,reason,bet_id,match_id,note,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [playerId, delta, rows[0].balance, reason, betId, matchId, note, actor]);
  return rows[0].balance;
}
const lockPlayers = (c, ids) => c.query('SELECT id FROM players WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [[...new Set(ids)]]);

// ---------- paris ----------
async function placeBet(pool, { playerId, matchId, outcome, stake, oddSeen, selections, now = new Date() }) {
  if (!selections) {
    selections = [{ matchId, outcome, oddSeen }];
  }
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 8) {
    throw new HttpError(400, 'Un pari doit comporter entre 1 et 8 sélections.');
  }
  const matchIds = selections.map((s) => s.matchId);
  if (new Set(matchIds).size !== selections.length) {
    throw new HttpError(400, 'Impossible de combiner deux issues du même match.');
  }

  return tx(pool, async (c) => {
    // 1. Verrou sur le joueur
    const me = (await c.query('SELECT * FROM players WHERE id=$1 FOR UPDATE', [playerId])).rows[0];
    if (!me) throw new HttpError(401, 'Joueur inconnu.');

    // 2. Vérification solde & limite
    const sums = (await c.query(
      `SELECT coalesce(sum(stake) FILTER (WHERE status='p'),0)::int AS pending
         FROM bets WHERE player_id=$1`, [playerId])).rows[0];
    const available = me.balance - sums.pending;
    if (stake > available) {
      throw new HttpError(422, `Mise invalide : tu as ${Math.max(0, available)} pts disponibles.`);
    }
    if (stake > cfg.maxStakePerMatch) {
      throw new HttpError(422, `Limite : ${cfg.maxStakePerMatch} pts maximum par pari.`);
    }

    // 3. Verrous sur les matchs triés par ID (évite interblocages)
    const sortedIds = [...matchIds].sort((a, b) => a - b);
    const mRows = (await c.query('SELECT * FROM matches WHERE id = ANY($1::int[]) ORDER BY id FOR SHARE', [sortedIds])).rows;
    const byMid = new Map(mRows.map((m) => [m.id, m]));

    for (const mId of matchIds) {
      const m = byMid.get(mId);
      if (!m) throw new HttpError(404, 'Match introuvable.');
      if (playerId === m.home || playerId === m.away) {
        throw new HttpError(403, 'Tu joues ce match : pas de pari possible.');
      }
    }

    // 4. Aucun match ne doit déjà avoir un résultat
    const resRes = await c.query('SELECT match_id FROM results WHERE match_id = ANY($1::int[])', [matchIds]);
    if (resRes.rowCount > 0) {
      throw new HttpError(409, 'Un des matchs sélectionnés est déjà terminé ou commencé.');
    }

    // 5. Calendrier et coup d’envoi
    const core = await loadCore(c);
    for (const mId of matchIds) {
      const m = byMid.get(mId);
      if (m.matchday > core.cur) throw new HttpError(404, 'Match introuvable.');
      if (now >= closeAt(core.start, m)) {
        throw new HttpError(409, 'Les paris sont clos : au moins un match a commencé.');
      }
    }

    // 6. Recalcul des cotes côté serveur
    const legsData = [];
    const oddsList = [];
    for (const sel of selections) {
      const m = byMid.get(sel.matchId);
      const mOdds = D.odds(core.rows, m.home, m.away);
      const odd = mOdds[sel.outcome];
      if (sel.oddSeen != null && Math.abs(sel.oddSeen - odd) > 0.005) {
        throw new HttpError(409, `La cote a changé (${odd.toFixed(2)}). Vérifie et relance ton pari.`, { code: 'odds_changed', odd });
      }
      oddsList.push(odd);
      legsData.push({ matchId: sel.matchId, outcome: sel.outcome, odd });
    }

    const totalOdd = selections.length === 1 ? oddsList[0] : D.comboOdds(oddsList);
    const type = selections.length > 1 ? 'combo' : 'single';
    const singleMatchId = selections.length === 1 ? selections[0].matchId : null;
    const singleOutcome = selections.length === 1 ? selections[0].outcome : null;

    if (singleMatchId != null) {
      const onMatch = (await c.query(
        `SELECT coalesce(sum(stake) FILTER (WHERE match_id=$2),0)::int AS on_match
           FROM bets WHERE player_id=$1`, [playerId, singleMatchId])).rows[0].on_match;
      if (onMatch + stake > cfg.maxStakePerMatch) {
        throw new HttpError(422, `Limite : ${cfg.maxStakePerMatch} pts maximum par match (tu as déjà misé ${onMatch}).`);
      }
    }

    const ins = await c.query(
      `INSERT INTO bets(player_id, match_id, outcome, stake, odd, type) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [playerId, singleMatchId, singleOutcome, stake, totalOdd, type]
    );
    const betId = Number(ins.rows[0].id);

    for (const leg of legsData) {
      await c.query(
        `INSERT INTO bet_legs(bet_id, match_id, outcome, odd) VALUES($1,$2,$3,$4)`,
        [betId, leg.matchId, leg.outcome, leg.odd]
      );
    }

    return { id: betId, odd: totalOdd, stake, type, selections: legsData };
  });
}

// ---------- résultats & règlement (transaction côté serveur) ----------
async function reverseSettlement(c, matchId, actor) {
  const { rows } = await c.query(`
    SELECT DISTINCT b.*
      FROM bets b
      JOIN bet_legs l ON l.bet_id = b.id
     WHERE l.match_id=$1 AND b.status IN ('w','l')
     ORDER BY b.id FOR UPDATE
  `, [matchId]);

  if (!rows.length) return 0;
  await lockPlayers(c, rows.map((b) => b.player_id));

  for (const b of rows) {
    if (b.delta != null && b.delta !== 0) {
      await applyDelta(c, b.player_id, -b.delta, { reason: 'bet_reversal', betId: b.id, matchId, actor });
    }
    await c.query(`UPDATE bets SET status='p', delta=NULL, settled_at=NULL WHERE id=$1`, [b.id]);
  }
  await c.query(`UPDATE bet_legs SET status='p' WHERE match_id=$1`, [matchId]);
  return rows.length;
}

async function settleMatch(c, matchId, hg, ag, voided = false, actor = 'admin') {
  if (voided) {
    await c.query(`UPDATE bet_legs SET status='v' WHERE match_id=$1`, [matchId]);
  } else {
    const outcome = D.outcomeOf(hg, ag);
    await c.query(`UPDATE bet_legs SET status = CASE WHEN outcome = $2 THEN 'w' ELSE 'l' END WHERE match_id=$1`, [matchId, outcome]);
  }

  const { rows: bets } = await c.query(`
    SELECT DISTINCT b.*
      FROM bets b
      JOIN bet_legs l ON l.bet_id = b.id
     WHERE l.match_id=$1 AND b.status='p'
     ORDER BY b.id FOR UPDATE
  `, [matchId]);

  if (!bets.length) return 0;
  await lockPlayers(c, bets.map((b) => b.player_id));

  let settledCount = 0;
  for (const b of bets) {
    const legs = (await c.query(`SELECT * FROM bet_legs WHERE bet_id=$1 ORDER BY id`, [b.id])).rows;
    const s = D.settleCombo(b.stake, legs);

    if (s.status !== 'p') {
      settledCount++;
      await applyDelta(c, b.player_id, s.delta, {
        reason: s.status === 'w' ? 'bet_won' : 'bet_lost',
        betId: b.id,
        matchId,
        actor
      });
      await c.query(`UPDATE bets SET status=$2, delta=$3, settled_at=now() WHERE id=$1`, [b.id, s.status, s.delta]);
    }
  }
  return settledCount;
}

/** mode: 'set' (nouveau ou correction, avec re-règlement automatique) | 'cancel' (annule et rend les points). */
async function setResult(pool, { matchId, home, away, forfeit = 0, voided = false, cancel = false, requireNew = false, actor = 'admin' }) {
  return tx(pool, async (c) => {
    const m = (await c.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [matchId])).rows[0];
    if (!m) throw new HttpError(404, 'Match introuvable.');
    const old = (await c.query('SELECT * FROM results WHERE match_id=$1', [matchId])).rows[0];
    if (cancel && !old) throw new HttpError(404, "Ce match n'a pas de résultat.");
    if (requireNew && old) throw new HttpError(409, 'Un résultat existe déjà : utilise « Corriger ».');
    const reversed = old ? await reverseSettlement(c, matchId, actor) : 0;
    if (cancel) {
      await c.query('DELETE FROM results WHERE match_id=$1', [matchId]);
      return { cancelled: true, reversed, settled: 0 };
    }
    let [hg, ag] = [home || 0, away || 0];
    if (forfeit) [hg, ag] = D.forfeitScore(forfeit);
    await c.query(
      `INSERT INTO results(match_id,home_goals,away_goals,forfeit,voided) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (match_id) DO UPDATE SET home_goals=$2, away_goals=$3, forfeit=$4, voided=$5, entered_at=now()`,
      [matchId, hg, ag, forfeit, !!voided]);
    const settled = await settleMatch(c, matchId, hg, ag, !!voided, actor);
    return { score: [hg, ag], forfeit, voided: !!voided, reversed, settled };
  });
}

// ---------- administration ----------
async function adjustPoints(pool, { playerId, newTotal, delta, reason, actor = 'admin' }) {
  return tx(pool, async (c) => {
    const p = (await c.query('SELECT * FROM players WHERE id=$1 FOR UPDATE', [playerId])).rows[0];
    if (!p) throw new HttpError(404, 'Joueur introuvable.');
    const d = newTotal != null ? newTotal - p.balance : delta;
    if (!d) return { balance: p.balance, delta: 0 };
    const balance = await applyDelta(c, playerId, d, { reason: 'admin_adjust', note: reason, actor });
    return { balance, delta: d };
  });
}
async function resetPlayer(pool, playerId) {
  const r = await pool.query('UPDATE players SET claim_hash=NULL, claimed_at=NULL WHERE id=$1 RETURNING name', [playerId]);
  if (!r.rowCount) throw new HttpError(404, 'Joueur introuvable.');
  return r.rows[0].name;
}
async function setStart(pool, start) {
  await pool.query(`INSERT INTO settings(key,value) VALUES('start',$1) ON CONFLICT (key) DO UPDATE SET value=$1`, [start]);
}
async function adminState(pool) {
  const core = await loadCore(pool);
  const bets = await pool.query(`
    SELECT l.match_id, count(DISTINCT b.id)::int AS n, coalesce(sum(b.stake),0)::int AS total
      FROM bet_legs l
      JOIN bets b ON b.id = l.bet_id
     GROUP BY l.match_id
  `);
  const bm = new Map(bets.rows.map((b) => [b.match_id, b]));
  const pend = await pool.query(`SELECT player_id, sum(stake)::int AS s FROM bets WHERE status='p' GROUP BY player_id`);
  const pm = new Map(pend.rows.map((x) => [x.player_id, x.s]));
  return {
    cur: core.cur, start: core.start,
    matches: core.matches.map((m) => {
      const r = core.results.get(m.id);
      return { id: m.id, j: m.matchday, h: m.home, a: m.away, hour: m.hour, date: D.isoDate(core.start, m), referee: m.referee,
        result: r ? { h: r.home_goals, a: r.away_goals, ff: r.forfeit, voided: r.voided } : null,
        bets: (bm.get(m.id) || {}).n || 0, staked: (bm.get(m.id) || {}).total || 0 };
    }),
    players: core.players.map((p) => ({ id: p.id, name: p.name, kind: p.kind, claimed: !!p.claim_hash, balance: p.balance, pending: pm.get(p.id) || 0 })),
  };
}
async function audit(db, ip, action, success = true, detail = null) {
  try { await db.query('INSERT INTO admin_log(ip,action,success,detail) VALUES($1,$2,$3,$4)', [ip || null, action, success, detail ? JSON.stringify(detail) : null]); }
  catch (e) { console.error(JSON.stringify({ level: 'error', msg: 'audit_failed', err: e.message })); }
}
async function exportAll(pool) {
  const out = { exported_at: new Date().toISOString() };
  for (const t of ['players', 'matches', 'results', 'history_matches', 'bets', 'bet_legs', 'wallet_transactions', 'admin_log', 'settings']) {
    out[t] = (await pool.query(`SELECT * FROM ${t}`)).rows;
  }
  out.players = out.players.map(({ claim_hash, ...p }) => p); // ne jamais exporter les secrets
  return out;
}

module.exports = { loadCore, publicState, placeBet, setResult, adjustPoints, resetPlayer, setStart, adminState, audit, exportAll };
