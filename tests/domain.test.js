'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/domain');
const seed = require('../src/seed-data');

const league = seed.LEAGUE.map((b, i) => ({ id: i, name: b[0], base_j: b[1], base_v: b[2], base_d: b[3], base_l: b[4], base_bp: b[5], base_bc: b[6] }));
const fixtures = seed.buildFixtures().map((m) => ({ ...m }));

test('cotes : joueurs de même niveau', () => {
  const rows = D.standings(league, [], new Map());
  const eq = rows.map((r) => ({ ...r, base: 5, db: 0 }));
  assert.deepEqual(D.odds(eq, 0, 1), [2.36, 4.18, 2.36]);
});
test('cotes : toujours entre 1.15 et 12', () => {
  const rows = D.standings(league, [], new Map());
  for (const h of [0, 3, 17]) for (const a of [1, 5, 16]) {
    for (const o of D.odds(rows, h, a)) assert.ok(o >= 1.15 && o <= 12, `${h}-${a}: ${o}`);
  }
  const huge = rows.map((r) => ({ ...r, base: r.i === 0 ? 500 : 0, db: 0 }));
  assert.equal(D.odds(huge, 0, 1)[0], 1.18); // plancher réel : le nul garde 22 % de probabilité
  assert.equal(D.odds(huge, 0, 1)[2], 12);
});
test('classement : victoire, nul, défaite et tri', () => {
  const ms = [{ id: 1, home: 0, away: 1 }, { id: 2, home: 2, away: 3 }];
  const res = new Map([[1, { home_goals: 2, away_goals: 0 }], [2, { home_goals: 1, away_goals: 1 }]]);
  const rows = D.standings(league, ms, res);
  const g = (i) => rows.find((r) => r.i === i);
  assert.equal(g(0).pts, 3 * 3 + 3); // base 9 + victoire
  assert.equal(g(0).j, 4);
  assert.equal(g(1).l, 1);
  assert.equal(g(2).d, 2); // 1 nul de base + 1 nul
  assert.equal(g(0).db, 20 - 11 + 2);
  const sorted = D.sortStandings(rows);
  for (let k = 1; k < sorted.length; k++) assert.ok(sorted[k - 1].pts >= sorted[k].pts);
});
test('forfait : le camp forfait perd 0-3', () => {
  assert.deepEqual(D.forfeitScore(1), [0, 3]);
  assert.deepEqual(D.forfeitScore(2), [3, 0]);
  assert.equal(D.outcomeOf(...D.forfeitScore(1)), 2);
  assert.equal(D.outcomeOf(...D.forfeitScore(2)), 0);
});
test('règlement : gain = mise×(cote−1), perte = mise', () => {
  const bet = { outcome: 0, stake: 100, odd: 1.85 };
  assert.deepEqual(D.settleBet(bet, 0), { status: 'w', delta: 85 });
  assert.deepEqual(D.settleBet(bet, 1), { status: 'l', delta: -100 });
  assert.deepEqual(D.settleBet({ outcome: 1, stake: 333, odd: 4.18 }, 1), { status: 'w', delta: 1059 });
});
test('journée en cours et coup d’envoi', () => {
  const ms = fixtures.map((m) => ({ id: m.id, matchday: m.matchday, day_in_md: m.day_in_md, hour: m.hour }));
  assert.equal(D.currentMatchday(ms, new Map()), 4);
  const res = new Map(ms.filter((m) => m.matchday === 4).map((m) => [m.id, {}]));
  assert.equal(D.currentMatchday(ms, res), 5);
  assert.equal(D.kickoff('2026-11-19', ms[0]).toISOString(), '2026-11-19T18:00:00.000Z');
  const j5 = ms.find((m) => m.matchday === 5 && m.day_in_md === 2);
  assert.equal(D.kickoff('2026-11-19', j5).toISOString().slice(0, 10), '2026-11-23');
});
test('calendrier : 31 journées, chaque joueur joue une fois par journée, arbitres distincts', () => {
  assert.equal(fixtures.length, 31 * 9);
  for (let j = 4; j <= 34; j++) {
    const day = fixtures.filter((m) => m.matchday === j);
    const ids = day.flatMap((m) => [m.home, m.away]);
    assert.equal(new Set(ids).size, 18, `journée ${j}`);
    for (let g = 1; g <= 3; g++) {
      if (j === 4 && g === 1) continue; // J4 jour 1 : arbitres imposés à la main (Apolo, Akira, Apolo)
      const refs = day.filter((m) => m.day_in_md === g).map((m) => m.referee);
      assert.equal(new Set(refs).size, 3, `journée ${j} jour ${g}`);
    }
  }
});
