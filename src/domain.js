'use strict';
// Logique pure (sans base de données, sans I/O) : cotes, classement, règlement des paris, calendrier.
// C'est le cœur testé automatiquement (tests/domain.test.js).

const OUTCOMES = 3; // 0 = domicile, 1 = nul, 2 = extérieur

/** Issue d'un score : 0 domicile gagne, 1 nul, 2 extérieur gagne. */
function outcomeOf(hg, ag) { return hg > ag ? 0 : hg === ag ? 1 : 2; }

/** Score effectif d'un forfait : le camp qui déclare forfait perd 0-3. */
function forfeitScore(forfeit) { return forfeit === 1 ? [0, 3] : [3, 0]; }

/**
 * Classement. `players` : joueurs de la ligue avec base_*; `matches` : calendrier;
 * `results` : Map match_id -> {home_goals, away_goals}. Tri : points, diff. de buts, buts pour.
 */
function standings(players, matches, results) {
  const t = new Map(players.map((p) => [p.id, {
    i: p.id, n: p.name, j: p.base_j, v: p.base_v, d: p.base_d, l: p.base_l, bp: p.base_bp, bc: p.base_bc,
  }]));
  for (const m of matches) {
    const r = results.get(m.id);
    if (!r || r.voided) continue; // un match annulé/reporté n'influe pas sur le classement
    const H = t.get(m.home), A = t.get(m.away);
    if (!H || !A) continue;
    H.j++; A.j++;
    H.bp += r.home_goals; H.bc += r.away_goals; A.bp += r.away_goals; A.bc += r.home_goals;
    if (r.home_goals > r.away_goals) { H.v++; A.l++; }
    else if (r.home_goals < r.away_goals) { A.v++; H.l++; }
    else { H.d++; A.d++; }
  }
  const rows = [...t.values()].map((x) => ({ ...x, base: x.v * 3 + x.d, pts: x.v * 3 + x.d, db: x.bp - x.bc }));
  return rows;
}
function sortStandings(rows) {
  return [...rows].sort((a, b) => b.pts - a.pts || b.db - a.db || b.bp - a.bp || a.i - b.i);
}

/** Cotes [domicile, nul, extérieur], calculées uniquement côté serveur. */
function odds(rows, homeId, awayId) {
  const by = new Map(rows.map((r) => [r.i, r]));
  const f = (x) => x.base + x.db * 0.15;
  const d = (f(by.get(homeId)) - f(by.get(awayId))) / 5;
  const ph = 1 / (1 + Math.exp(-d)), dr = 0.22;
  const p = [(1 - dr) * ph, dr, (1 - dr) * (1 - ph)];
  return p.map((q) => Math.min(12, Math.max(1.15, Math.round((0.92 / q) * 100) / 100)));
}

/** Règlement d'un pari simple : gain = mise × (cote − 1), perte = mise. */
function settleBet(bet, outcome) {
  if (outcome === 'v') { // match annulé / reporté
    return { status: 'w', delta: 0, odd: 1.0 };
  }
  return bet.outcome === outcome
    ? { status: 'w', delta: Math.round(bet.stake * (bet.odd - 1)) }
    : { status: 'l', delta: -bet.stake };
}

/** Calcul de la cote totale d'un combiné : produit des cotes, arrondie à 2 décimales. */
function comboOdds(oddsList) {
  if (!oddsList || !oddsList.length) return 1.0;
  const product = oddsList.reduce((acc, o) => acc * o, 1);
  return Math.round(product * 100) / 100;
}

/**
 * Règlement d'un pari (simple ou combiné) à partir de ses sélections (legs) :
 * legs : [ { outcome, odd, status: 'p'|'w'|'l'|'v' } ]
 * - Perdant dès qu'une sélection est perdue ('l').
 * - Gagnant quand TOUTES les sélections sont gagnantes ('w') ou annulées ('v').
 *   Les sélections annulées ('v') comptent pour une cote de 1.00.
 * - En attente ('p') sinon.
 */
function settleCombo(stake, legs) {
  if (legs.some((l) => l.status === 'l')) {
    return { status: 'l', delta: -stake, odd: comboOdds(legs.map((l) => l.odd)) };
  }
  if (legs.length > 0 && legs.every((l) => l.status === 'w' || l.status === 'v')) {
    const effectiveOdd = legs.reduce((acc, l) => acc * (l.status === 'v' ? 1.0 : l.odd), 1);
    const roundedOdd = Math.max(1.0, Math.round(effectiveOdd * 100) / 100);
    return { status: 'w', delta: Math.round(stake * (roundedOdd - 1)), odd: roundedOdd };
  }
  return { status: 'p', delta: null, odd: comboOdds(legs.map((l) => l.odd)) };
}

/** Journée en cours : la première (à partir de la J4) qui a encore un match sans résultat. */
function currentMatchday(matches, results) {
  for (let j = 4; j <= 34; j++) {
    if (matches.some((m) => m.matchday === j && !results.has(m.id))) return j;
  }
  return 34;
}

/** Coup d'envoi (Date, UTC/GMT) : date de départ de la J4 + 3 jours par journée + jour dans la journée. */
function kickoff(start, m) {
  const [y, mo, d] = start.split('-').map(Number);
  const n = (m.matchday - 4) * 3 + (m.day_in_md - 1);
  return new Date(Date.UTC(y, mo - 1, d + n, m.hour, 0, 0));
}
function isoDate(start, m) { return kickoff(start, m).toISOString().slice(0, 10); }

module.exports = { OUTCOMES, outcomeOf, forfeitScore, standings, sortStandings, odds, settleBet, comboOdds, settleCombo, currentMatchday, kickoff, isoDate };
