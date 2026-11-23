'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const cfg = require('./config');
const { HttpError } = require('./errors');
const auth = require('./auth');
const S = require('./services');
const events = require('./events');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadImages() { // 0.jpg, 1.jpg… dans web/img/avatars -> { id: '/img/avatars/0.jpg' }
  const dir = path.join(cfg.STATIC_DIR, 'img', 'avatars'), out = {};
  try { for (const f of fs.readdirSync(dir)) { const m = /^(\d+)\.(jpe?g|png|webp)$/i.exec(f); if (m) out[+m[1]] = `/img/avatars/${f}`; } } catch (_) { /* pas d'images */ }
  return out;
}
let sentry = null;
if (process.env.SENTRY_DSN) {
  try { sentry = require('@sentry/node'); sentry.init({ dsn: process.env.SENTRY_DSN, environment: cfg.prod ? 'production' : 'development' }); }
  catch (_) { console.warn('SENTRY_DSN défini mais @sentry/node n’est pas installé (npm i @sentry/node).'); }
}

// ---------- schémas de validation ----------
const id = z.number().int().min(0).max(100000);
const schemas = {
  claim: z.object({ playerId: id }).strict(),
  bet: z.object({ matchId: id, outcome: z.number().int().min(0).max(2), stake: z.number().int().min(1).max(1000), oddSeen: z.number().min(1).max(100).optional() }).strict(),
  login: z.object({ password: z.string().min(1).max(200) }).strict(),
  result: z.union([
    z.object({ matchId: id, home: z.number().int().min(0).max(99), away: z.number().int().min(0).max(99) }).strict(),
    z.object({ matchId: id, forfeit: z.union([z.literal(1), z.literal(2)]) }).strict(),
  ]),
  points: z.object({ playerId: id, newTotal: z.number().int().min(0).max(10000000).optional(), delta: z.number().int().min(-10000000).max(10000000).optional(), reason: z.string().trim().min(1).max(200) })
    .strict().refine((v) => (v.newTotal === undefined) !== (v.delta === undefined)),
  start: z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !isNaN(Date.parse(s))) }).strict(),
};
const parse = (schema, body) => { const r = schema.safeParse(body); if (!r.success) throw new HttpError(400, 'Requête invalide.'); return r.data; };
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp(pool, opts = {}) {
  const app = express();
  const imgs = loadImages();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway : 1 proxy devant l'appli (IP réelle pour les limites de débit)

  // ---------- en-têtes HTTP & CSP restrictive ----------
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],            // aucun script inline, aucun onclick="…"
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ['https://fonts.gstatic.com'],
        imgSrc: ["'self'"],               // images locales uniquement
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'self'", "https://huggingface.co", "https://*.hf.space"], objectSrc: ["'none'"],
        ...(cfg.prod ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    frameguard: false, // géré de manière moderne et compatible par frameAncestors ci-dessus
    // « same-origin » (et pas « no-referrer ») : avec no-referrer certains navigateurs envoient « Origin: null » sur les POST
    referrerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));
  // CORS fermé : aucun en-tête Access-Control-* n'est jamais émis -> même origine uniquement.

  // ---------- limitation de débit ----------
  const rl = (limit, windowMs = 60000) => rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, handler: (req, res) => res.status(429).json({ error: 'Trop de requêtes, réessaie dans un instant.' }) });
  app.use('/api', rl(opts.apiLimit || 300));
  const writeLimit = rl(opts.writeLimit || 30);
  const claimLimit = rl(opts.claimLimit || 10, 60 * 60000);
  const loginFails = new Map();
  const loginLimit = rateLimit({
    windowMs: 15 * 60000, limit: opts.loginLimit || 5, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res) => { S.audit(pool, req.ip, 'login_blocked', false); res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' }); },
  });

  app.use(express.json({ limit: '10kb' }));

  // ---------- anti-CSRF : Origin (ou Referer) = notre hôte + JSON obligatoire, en plus du cookie SameSite=Strict ----------
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const src = req.get('origin') || req.get('referer');
    let ok = false;
    try { ok = !!src && new URL(src).host === req.get('host'); } catch (_) { ok = false; }
    if (!ok) return res.status(403).json({ error: 'Origine refusée.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'Requête invalide.' });
    next();
  });

  app.get('/healthz', wrap(async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); }));

  // ---------- API publique ----------
  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  api.get('/state', wrap(async (req, res) => {
    const me = await auth.playerFromRequest(pool, req);
    res.json(await S.publicState(pool, me ? me.id : null, imgs, opts.now ? opts.now() : new Date()));
  }));
  api.get('/events', events.handler);

  api.post('/me/claim', claimLimit, wrap(async (req, res) => {
    const { playerId } = parse(schemas.claim, req.body);
    const p = await auth.claimPlayer(pool, req, res, playerId);
    events.notify();
    res.json({ ok: true, id: p.id, name: p.name });
  }));
  api.post('/me/release', writeLimit, wrap(async (req, res) => { await auth.releasePlayer(pool, req, res); events.notify(); res.json({ ok: true }); }));

  api.post('/bets', writeLimit, wrap(async (req, res) => {
    const me = await auth.playerFromRequest(pool, req);
    if (!me) throw new HttpError(401, 'Choisis d’abord ton pseudo en haut de la page.');
    const b = parse(schemas.bet, req.body);
    const out = await S.placeBet(pool, { playerId: me.id, matchId: b.matchId, outcome: b.outcome, stake: b.stake, oddSeen: b.oddSeen, now: opts.now ? opts.now() : new Date() });
    events.notify();
    res.status(201).json({ ok: true, ...out });
  }));

  // ---------- API admin ----------
  api.post('/admin/login', loginLimit, wrap(async (req, res) => {
    const { password } = parse(schemas.login, req.body);
    if (!cfg.adminPasswordHash) throw new HttpError(503, 'Administration désactivée : ADMIN_PASSWORD_HASH n’est pas défini.');
    if (!(await auth.verifyPassword(password, cfg.adminPasswordHash))) {
      const f = (loginFails.get(req.ip) || 0) + 1; loginFails.set(req.ip, f);
      await sleep(Math.min(250 * 2 ** (f - 1), 5000)); // délai croissant
      await S.audit(pool, req.ip, 'login', false);
      throw new HttpError(401, 'Mot de passe incorrect.');
    }
    loginFails.delete(req.ip);
    await auth.createAdminSession(pool, res, req.ip);
    await S.audit(pool, req.ip, 'login', true);
    res.json({ ok: true });
  }));
  const admin = express.Router();
  admin.use(auth.requireAdmin(pool));
  admin.get('/me', (req, res) => res.json({ ok: true, expires: req.admin.expires_at }));
  admin.post('/logout', wrap(async (req, res) => { await auth.destroyAdminSession(pool, req, res); await S.audit(pool, req.ip, 'logout'); res.json({ ok: true }); }));
  admin.get('/state', wrap(async (req, res) => res.json(await S.adminState(pool))));
  admin.get('/log', wrap(async (req, res) => res.json((await pool.query('SELECT id, at, ip, action, success, detail FROM admin_log ORDER BY id DESC LIMIT 200')).rows)));
  admin.get('/transactions', wrap(async (req, res) => {
    const pid = parseInt(req.query.player, 10);
    const q = Number.isInteger(pid)
      ? await pool.query('SELECT * FROM wallet_transactions WHERE player_id=$1 ORDER BY id DESC LIMIT 200', [pid])
      : await pool.query('SELECT * FROM wallet_transactions ORDER BY id DESC LIMIT 200');
    res.json(q.rows);
  }));
  admin.get('/export', wrap(async (req, res) => {
    await S.audit(pool, req.ip, 'export');
    res.set('Content-Disposition', `attachment; filename="stern-league-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(await S.exportAll(pool));
  }));
  const done = (action) => (req, res, data) => { events.notify(); S.audit(pool, req.ip, action, true, data); res.json({ ok: true, ...data }); };
  admin.post('/results', writeLimit, wrap(async (req, res) => {
    const b = parse(schemas.result, req.body);
    done('result_set')(req, res, await S.setResult(pool, { ...b, requireNew: true }));
  }));
  admin.put('/results', writeLimit, wrap(async (req, res) => {
    const b = parse(schemas.result, req.body);
    done('result_correct')(req, res, await S.setResult(pool, b));
  }));
  admin.delete('/results/:matchId', writeLimit, wrap(async (req, res) => {
    const matchId = parseInt(req.params.matchId, 10);
    if (!Number.isInteger(matchId)) throw new HttpError(400, 'Requête invalide.');
    done('result_cancel')(req, res, await S.setResult(pool, { matchId, cancel: true }));
  }));
  admin.post('/points', writeLimit, wrap(async (req, res) => {
    const b = parse(schemas.points, req.body);
    done('points_adjust')(req, res, { playerId: b.playerId, reason: b.reason, ...(await S.adjustPoints(pool, b)) });
  }));
  admin.post('/players/:id/reset', writeLimit, wrap(async (req, res) => {
    const pid = parseInt(req.params.id, 10);
    if (!Number.isInteger(pid)) throw new HttpError(400, 'Requête invalide.');
    done('player_reset')(req, res, { player: await S.resetPlayer(pool, pid) });
  }));
  admin.put('/start', writeLimit, wrap(async (req, res) => {
    const { start } = parse(schemas.start, req.body);
    await S.setStart(pool, start);
    done('start_set')(req, res, { start });
  }));
  api.use('/admin', admin);
  api.use((req, res) => res.status(404).json({ error: 'Introuvable.' }));
  app.use('/api', api);

  // ---------- fichiers statiques ----------
  app.use(express.static(cfg.STATIC_DIR, {
    extensions: ['html'], // /admin -> admin.html, /legal -> legal.html
    setHeaders: (res, p) => res.set('Cache-Control', p.includes(`${path.sep}img${path.sep}`) ? 'public, max-age=86400' : 'no-cache'),
  }));
  app.use((req, res) => res.status(404).type('text/plain').send('Page introuvable.'));

  // ---------- erreurs : jamais de détail technique côté client ----------
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Requête invalide.' });
    console.error(JSON.stringify({ level: 'error', msg: err.message, stack: err.stack, path: req.path }));
    if (sentry) sentry.captureException(err);
    res.status(500).json({ error: 'Erreur interne. Réessaie dans un instant.' });
  });
  return app;
}
module.exports = { createApp };
