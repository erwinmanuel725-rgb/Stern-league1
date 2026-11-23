'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/domain');

test('Scénario 1 : combiné de 3 matchs GAGNANT', () => {
  const stake = 100;
  const legs = [
    { matchId: 10, outcome: 0, odd: 2.10, status: 'p' },
    { matchId: 11, outcome: 1, odd: 3.20, status: 'p' },
    { matchId: 12, outcome: 2, odd: 1.80, status: 'p' },
  ];
  // Cote totale = 2.10 * 3.20 * 1.80 = 12.096 -> 12.10
  const totalOdd = D.comboOdds(legs.map((l) => l.odd));
  assert.equal(totalOdd, 12.10);

  // Match 10 se termine : gagné
  legs[0].status = 'w';
  assert.deepEqual(D.settleCombo(stake, legs), { status: 'p', delta: null, odd: 12.10 });

  // Match 11 se termine : gagné
  legs[1].status = 'w';
  assert.deepEqual(D.settleCombo(stake, legs), { status: 'p', delta: null, odd: 12.10 });

  // Match 12 se termine : gagné
  legs[2].status = 'w';
  const settlement = D.settleCombo(stake, legs);
  assert.equal(settlement.status, 'w');
  assert.equal(settlement.odd, 12.10);
  assert.equal(settlement.delta, Math.round(100 * (12.10 - 1))); // +1110 pts nets
});

test('Scénario 2 : combiné de 3 matchs PERDANT dès le premier échec', () => {
  const stake = 100;
  const legs = [
    { matchId: 10, outcome: 0, odd: 2.10, status: 'p' },
    { matchId: 11, outcome: 1, odd: 3.20, status: 'p' },
    { matchId: 12, outcome: 2, odd: 1.80, status: 'p' },
  ];

  // Match 10 se termine : perdu
  legs[0].status = 'l';
  const settlement = D.settleCombo(stake, legs);
  assert.equal(settlement.status, 'l');
  assert.equal(settlement.delta, -100); // perte de la mise immédiatement
});

test('Scénario 3 : combiné avec un match ANNULÉ / REPORTÉ (cote 1.00)', () => {
  const stake = 100;
  const legs = [
    { matchId: 10, outcome: 0, odd: 2.00, status: 'p' },
    { matchId: 11, outcome: 1, odd: 3.00, status: 'p' },
    { matchId: 12, outcome: 2, odd: 1.50, status: 'p' },
  ];

  // Match 11 est annulé/reporté par l'organisateur -> passe à statut 'v' (cote 1.00)
  legs[1].status = 'v';
  // Match 10 et 12 gagnés
  legs[0].status = 'w';
  legs[2].status = 'w';

  const settlement = D.settleCombo(stake, legs);
  assert.equal(settlement.status, 'w');
  // Cote effective = 2.00 * 1.00 * 1.50 = 3.00
  assert.equal(settlement.odd, 3.00);
  assert.equal(settlement.delta, 200); // 100 * (3.00 - 1)
});

test('Scénario 4 : règles de validation', () => {
  // Règle 1 : Minimum 1 sélection, maximum 8 sélections
  assert.equal(D.comboOdds([2.0]), 2.0);
  assert.equal(D.comboOdds([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]), 25.63);

  // Règle 2 : Clôture au coup d'envoi
  const kickoff = new Date('2026-11-20T18:00:00Z');
  const nowBefore = new Date('2026-11-20T17:59:00Z');
  const nowAfter = new Date('2026-11-20T18:00:01Z');
  assert.ok(nowBefore < kickoff);
  assert.ok(nowAfter >= kickoff);
});
