'use strict';
// Tests sur une vraie base Postgres : TEST_DATABASE_URL=postgresql://... npm test
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const url = process.env.TEST_DATABASE_URL;

describe('intégration Postgres', { skip: !url && 'TEST_DATABASE_URL non défini' }, () => {
  const { createPool, migrate } = require('../src/db');
  const S = require('../src/services');
  const D = require('../src/domain');
  const cfg = require('../src/config');
  const auth = require('../src/auth');
  const { createApp } = require('../src/app');
  let pool;
  const T0 = new Date('2026-11-19T10:00:00Z'); // avant le 1er match (18h GMT)
  const PER_SON = 18, MANJIRO = 19, ARIEL = 37;
  const bal = async (id) => (await pool.query('SELECT balance FROM players WHERE id=$1', [id])).rows[0].balance;
  const journalSum = async (id) => (await pool.query('SELECT coalesce(sum(delta),0)::int s FROM wallet_transactions WHERE player_id=$1', [id])).rows[0].s;
  const bet = (playerId, matchId, outcome, stake, extra = {}) => S.placeBet(pool, { playerId, matchId, outcome, stake, now: T0, ...extra });
  const code = (e) => e.status;

  before(async () => { pool = createPool(url); });
  after(async () => { await pool.end(); });
  beforeEach(async () => { await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await migrate(pool); });

  it('la cote vient du serveur ; une cote périmée est refusée', async () => {
    const core = await S.loadCore(pool);
    const expected = D.odds(core.rows, 11, 17)[0];
    const r = await bet(PER_SON, 1, 0, 100, { oddSeen: expected });
    assert.equal(r.odd, expected);
    await assert.rejects(bet(PER_SON, 1, 0, 100, { oddSeen: 9.99 }), (e) => code(e) === 409 && e.extra.code === 'odds_changed');
  });
  it('refuse : propre match, match commencé, journée non publiée, match joué', async () => {
    await assert.rejects(bet(11, 1, 0, 10), (e) => code(e) === 403);
    await assert.rejects(S.placeBet(pool, { playerId: PER_SON, matchId: 1, outcome: 0, stake: 10, now: new Date('2026-11-19T18:00:00Z') }), (e) => code(e) === 409);
    await assert.rejects(bet(PER_SON, 10, 0, 10), (e) => code(e) === 404); // J5 pas encore publiée
    await S.setResult(pool, { matchId: 1, home: 1, away: 0 });
    await assert.rejects(bet(PER_SON, 1, 0, 10), (e) => code(e) === 409);
  });
  it('limite de 1000 pts par match et solde disponible', async () => {
    await bet(PER_SON, 1, 0, 600);
    await assert.rejects(bet(PER_SON, 1, 1, 500), (e) => code(e) === 422);
    await bet(PER_SON, 1, 1, 400);
    await assert.rejects(bet(ARIEL, 3, 0, 76), (e) => code(e) === 422); // Ariel n'a que 75 pts
  });
  it('paris simultanés : jamais plus que le solde ni que 1000 pts/match', async () => {
    const same = await Promise.allSettled(Array.from({ length: 8 }, () => bet(PER_SON, 2, 0, 300)));
    assert.equal(same.filter((r) => r.status === 'fulfilled').length, 3);
    const poor = await Promise.allSettled([3, 4, 5, 3, 4, 5].map((m) => bet(ARIEL, m, 0, 25)));
    assert.equal(poor.filter((r) => r.status === 'fulfilled').length, 3); // 3 × 25 = 75
  });
  it('règlement : gains, pertes, journal cohérent ; annulation puis correction', async () => {
    const b0 = [await bal(PER_SON), await bal(MANJIRO)];
    const a = await bet(PER_SON, 1, 0, 100), b = await bet(MANJIRO, 1, 1, 100);
    await S.setResult(pool, { matchId: 1, home: 2, away: 1 });
    const gain = Math.round(100 * (a.odd - 1));
    assert.equal(await bal(PER_SON), b0[0] + gain);
    assert.equal(await bal(MANJIRO), b0[1] - 100);
    // annulation : tout revient
    const c = await S.setResult(pool, { matchId: 1, cancel: true });
    assert.equal(c.reversed, 2);
    assert.equal(await bal(PER_SON), b0[0]); assert.equal(await bal(MANJIRO), b0[1]);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM bets WHERE status='p'`)).rows[0].n, 2);
    // nouvelle saisie : nul -> Manjiro gagne
    await S.setResult(pool, { matchId: 1, home: 0, away: 0 });
    assert.equal(await bal(MANJIRO), b0[1] + Math.round(100 * (b.odd - 1)));
    assert.equal(await bal(PER_SON), b0[0] - 100);
    // correction 3-0 : re-règlement automatique
    await S.setResult(pool, { matchId: 1, home: 3, away: 0 });
    assert.equal(await bal(MANJIRO), b0[1] - 100);
    assert.equal(await bal(PER_SON), b0[0] + gain);
    for (const id of [PER_SON, MANJIRO]) assert.equal(await journalSum(id), await bal(id)); // balance = somme du journal
  });
  it('combiné : 3 matchs (gagnant, annulé), validation et calcul de gain', async () => {
    const core = await S.loadCore(pool);
    const o1 = D.odds(core.rows, 11, 17)[0]; // Match 1 outcome 0
    const o2 = D.odds(core.rows, 15, 4)[0];  // Match 2 outcome 0
    const o3 = D.odds(core.rows, 9, 3)[0];   // Match 3 outcome 0

    // Refus de combiner 2 issues du même match
    await assert.rejects(
      S.placeBet(pool, { playerId: PER_SON, selections: [{ matchId: 1, outcome: 0 }, { matchId: 1, outcome: 1 }], stake: 100, now: T0 }),
      (e) => code(e) === 400
    );

    // Combiné valide de 3 matchs
    const combo = await S.placeBet(pool, {
      playerId: PER_SON,
      selections: [{ matchId: 1, outcome: 0 }, { matchId: 2, outcome: 0 }, { matchId: 3, outcome: 0 }],
      stake: 100,
      now: T0,
    });
    assert.equal(combo.type, 'combo');
    assert.equal(combo.odd, D.comboOdds([o1, o2, o3]));

    // Match 1 gagné
    await S.setResult(pool, { matchId: 1, home: 2, away: 0 });
    let bRow = (await pool.query('SELECT * FROM bets WHERE id=$1', [combo.id])).rows[0];
    assert.equal(bRow.status, 'p');

    // Match 2 annulé (cote 1.00)
    await S.setResult(pool, { matchId: 2, voided: true });
    bRow = (await pool.query('SELECT * FROM bets WHERE id=$1', [combo.id])).rows[0];
    assert.equal(bRow.status, 'p');

    // Match 3 gagné -> le combiné gagne avec cote o1 * 1.0 * o3
    const beforeWin = await bal(PER_SON);
    await S.setResult(pool, { matchId: 3, home: 3, away: 1 });
    bRow = (await pool.query('SELECT * FROM bets WHERE id=$1', [combo.id])).rows[0];
    assert.equal(bRow.status, 'w');
    const expectedOdd = D.comboOdds([o1, 1.0, o3]);
    const expectedGain = Math.round(100 * (expectedOdd - 1));
    assert.equal(await bal(PER_SON), beforeWin + expectedGain);
  });
  it('forfait : 0-3 règle les paris, un résultat existant ne s’écrase pas par erreur', async () => {
    const a = await bet(PER_SON, 1, 2, 50); // extérieur gagne
    const before = await bal(PER_SON);
    await S.setResult(pool, { matchId: 1, forfeit: 1, requireNew: true }); // domicile forfait
    assert.equal(await bal(PER_SON), before + Math.round(50 * (a.odd - 1)));
    await assert.rejects(S.setResult(pool, { matchId: 1, home: 1, away: 1, requireNew: true }), (e) => code(e) === 409);
  });
  it('ajustement de points journalisé', async () => {
    const r = await S.adjustPoints(pool, { playerId: ARIEL, newTotal: 500, reason: 'test' });
    assert.equal(r.balance, 500); assert.equal(r.delta, 425);
    assert.equal(await journalSum(ARIEL), 500);
  });
  it('un pseudo se réserve une seule fois, l’admin peut le libérer', async () => {
    const res = () => ({ cookie() {}, clearCookie() {} });
    const req = { headers: {} };
    await auth.claimPlayer(pool, req, res(), 25);
    await assert.rejects(auth.claimPlayer(pool, { headers: {} }, res(), 25), (e) => code(e) === 409);
    await S.resetPlayer(pool, 25);
    await auth.claimPlayer(pool, { headers: {} }, res(), 25);
  });

  describe('HTTP', () => {
    let server, base;
    before(async () => {
      cfg.adminPasswordHash = await auth.hashPassword('un-mot-de-passe-solide');
      server = createApp(pool, { loginLimit: 3, now: () => T0 }).listen(0);
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => server.close());
    const call = (method, path, body, headers = {}) => fetch(base + path, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

    it('CSRF : POST sans Origin ou depuis un autre site refusé ; en-têtes de sécurité présents', async () => {
      assert.equal((await fetch(base + '/api/me/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"playerId":1}' })).status, 403);
      assert.equal((await call('POST', '/api/me/claim', { playerId: 1 }, { Origin: 'https://evil.example' })).status, 403);
      const r = await fetch(base + '/api/state');
      assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));
      assert.equal(r.headers.get('x-frame-options'), 'DENY');
      assert.equal(r.headers.get('access-control-allow-origin'), null);
    });
    it('l’état public ne contient ni calendrier futur ni secrets', async () => {
      const s = await (await fetch(base + '/api/state')).json();
      assert.equal(s.cur, 4);
      assert.ok(s.matches.every((m) => m.j <= 4));
      assert.ok(!JSON.stringify(s).includes('claim_hash'));
    });
    it('parier exige un pseudo réservé ; la mise est validée', async () => {
      assert.equal((await call('POST', '/api/bets', { matchId: 1, outcome: 0, stake: 10 })).status, 401);
      const c = await call('POST', '/api/me/claim', { playerId: PER_SON });
      assert.equal(c.status, 200);
      const ck = cookieOf(c);
      assert.match(c.headers.getSetCookie()[0], /HttpOnly/i);
      assert.match(c.headers.getSetCookie()[0], /SameSite=Strict/i);
      assert.equal((await call('POST', '/api/bets', { matchId: 1, outcome: 0, stake: -5 }, { Cookie: ck })).status, 400);
      assert.equal((await call('POST', '/api/bets', { matchId: 1, outcome: 0, stake: 10, odd: 50 }, { Cookie: ck })).status, 400); // champs inconnus refusés
      assert.equal((await call('POST', '/api/bets', { matchId: 1, outcome: 0, stake: 10 }, { Cookie: ck })).status, 201);
      assert.equal((await call('POST', '/api/me/claim', { playerId: MANJIRO }, { Cookie: ck })).status, 409);
    });
    it('admin : connexion, session, limitation des essais', async () => {
      assert.equal((await fetch(base + '/api/admin/state')).status, 401);
      assert.equal((await call('POST', '/api/admin/login', { password: 'mauvais' })).status, 401);
      const ok = await call('POST', '/api/admin/login', { password: 'un-mot-de-passe-solide' });
      assert.equal(ok.status, 200);
      const sc = ok.headers.getSetCookie()[0];
      assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Strict/i);
      const ck = cookieOf(ok);
      assert.equal((await fetch(base + '/api/admin/state', { headers: { Cookie: ck } })).status, 200);
      const r = await call('POST', '/api/admin/results', { matchId: 1, home: 2, away: 2 }, { Cookie: ck });
      assert.equal(r.status, 200);
      assert.equal((await call('POST', '/api/admin/logout', {}, { Cookie: ck })).status, 200);
      assert.equal((await fetch(base + '/api/admin/state', { headers: { Cookie: ck } })).status, 401);
      assert.ok((await pool.query(`SELECT count(*)::int n FROM admin_log WHERE action='login'`)).rows[0].n >= 2);
      // 3 échecs max (loginLimit=3) : le 4e essai est bloqué même avec le bon mot de passe
      await call('POST', '/api/admin/login', { password: 'x' }); await call('POST', '/api/admin/login', { password: 'y' });
      assert.equal((await call('POST', '/api/admin/login', { password: 'un-mot-de-passe-solide' })).status, 429);
    });
  });
});
