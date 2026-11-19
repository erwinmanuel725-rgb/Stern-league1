'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const { HttpError } = require('./errors');

// ---------- mot de passe admin (scrypt) : format scrypt$N$r$p$sel$hash ----------
function scrypt(pw, salt, N, r, p) {
  return new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
}
async function hashPassword(pw) {
  const N = 32768, r = 8, p = 1, salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, N, r, p);
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, salt, hash] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const key = await scrypt(pw, Buffer.from(salt, 'base64'), +N, +r, +p);
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch (_) { return false; }
}

// ---------- cookies ----------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { /* cookie illisible : ignoré */ } }
  }
  return out;
}
const cookieOpts = (maxAgeMs) => ({ httpOnly: true, secure: cfg.prod, sameSite: 'strict', path: '/', maxAge: maxAgeMs });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- session admin (cookie HttpOnly + Secure + SameSite=Strict, expiration serveur) ----------
const ADMIN_COOKIE = 'sl_admin';
async function createAdminSession(pool, res, ip) {
  const token = newToken(), ms = cfg.adminSessionHours * 3600 * 1000;
  await pool.query('INSERT INTO admin_sessions(token_hash,expires_at,ip) VALUES($1, now() + ($2 || \' milliseconds\')::interval, $3)', [sha(token), String(ms), ip]);
  res.cookie(ADMIN_COOKIE, token, cookieOpts(ms));
}
async function adminFromRequest(pool, req) {
  const t = parseCookies(req)[ADMIN_COOKIE];
  if (!t) return null;
  const r = await pool.query('SELECT token_hash, expires_at FROM admin_sessions WHERE token_hash=$1 AND expires_at > now()', [sha(t)]);
  return r.rows[0] || null;
}
async function destroyAdminSession(pool, req, res) {
  const t = parseCookies(req)[ADMIN_COOKIE];
  if (t) await pool.query('DELETE FROM admin_sessions WHERE token_hash=$1', [sha(t)]);
  res.clearCookie(ADMIN_COOKIE, cookieOpts());
}
const requireAdmin = (pool) => async (req, res, next) => {
  try {
    const s = await adminFromRequest(pool, req);
    if (!s) return res.status(401).json({ error: 'Authentification requise.' });
    req.admin = s;
    next();
  } catch (e) { next(e); }
};

// ---------- identité joueur : le 1er appareil qui choisit un pseudo le réserve ----------
const PLAYER_COOKIE = 'sl_player';
async function claimPlayer(pool, req, res, playerId) {
  const cur = await playerFromRequest(pool, req);
  if (cur && cur.id === playerId) return cur;
  if (cur) throw new HttpError(409, `Tu es déjà connecté en tant que « ${cur.name} ». Libère-le d'abord pour changer de pseudo.`);
  const secret = newToken();
  const r = await pool.query('UPDATE players SET claim_hash=$2, claimed_at=now() WHERE id=$1 AND claim_hash IS NULL RETURNING id, name', [playerId, sha(secret)]);
  if (!r.rowCount) {
    const ex = await pool.query('SELECT 1 FROM players WHERE id=$1', [playerId]);
    throw new HttpError(ex.rowCount ? 409 : 404, ex.rowCount ? "Ce pseudo est déjà réservé par un autre appareil. Demande à l'organisateur de le libérer si c'est une erreur." : 'Pseudo inconnu.');
  }
  res.cookie(PLAYER_COOKIE, `${playerId}.${secret}`, cookieOpts(400 * 24 * 3600 * 1000));
  return r.rows[0];
}
async function playerFromRequest(pool, req) {
  const raw = parseCookies(req)[PLAYER_COOKIE];
  if (!raw) return null;
  const i = raw.indexOf('.');
  const id = parseInt(raw.slice(0, i), 10);
  if (!(id >= 0) || i < 0) return null;
  const r = await pool.query('SELECT id, name, claim_hash FROM players WHERE id=$1', [id]);
  const p = r.rows[0];
  if (!p || !p.claim_hash || !safeEq(sha(raw.slice(i + 1)), p.claim_hash)) return null;
  return { id: p.id, name: p.name };
}
async function releasePlayer(pool, req, res) {
  const p = await playerFromRequest(pool, req);
  if (p) await pool.query('UPDATE players SET claim_hash=NULL, claimed_at=NULL WHERE id=$1', [p.id]);
  res.clearCookie(PLAYER_COOKIE, cookieOpts());
}

module.exports = { hashPassword, verifyPassword, requireAdmin, adminFromRequest, createAdminSession, destroyAdminSession, claimPlayer, playerFromRequest, releasePlayer };
