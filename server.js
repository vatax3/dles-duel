// Duel des dles — serveur auto-hébergé. Aucune dépendance : Node ≥ 22 (node:sqlite).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_GAMES, resolveGame, sanitizeConfig, parseShare, dayResult } from './public/games.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const NOTIFY_URL = process.env.NOTIFY_URL || '';
const NOTIFY_DELAY = (+process.env.NOTIFY_DELAY_SECONDS || 90) * 1000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const TZ = process.env.TZ || 'Europe/Paris';
const SESSION_DAYS = 180;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Joueurs : PLAYERS="val:Val:1234,pips:Pips:5678" ----------
const PLAYERS = (process.env.PLAYERS || 'val:Val:0000,pips:Pips:0000').split(',').map(s => s.trim()).filter(Boolean).map(s => {
  const [id, name, pin] = s.split(':');
  if (!/^[a-z0-9_-]{1,20}$/i.test(id || '') || !pin) throw new Error(`PLAYERS invalide : « ${s} » (format id:Nom:PIN)`);
  return { id, name: name || id, pin };
});
if (PLAYERS.length < 2 || PLAYERS.length > 4) throw new Error('PLAYERS doit contenir 2 à 4 joueurs');
const PIDS = PLAYERS.map(p => p.id);
const playerById = id => PLAYERS.find(p => p.id === id);
if (PLAYERS.some(p => p.pin === '0000')) console.warn('⚠️  PIN par défaut détecté : définis PLAYERS dans ton .env');

// ---------- Secret (signature des sessions et jetons) ----------
const secretFile = path.join(DATA_DIR, 'secret');
const SECRET = process.env.SECRET || (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim()
  : (() => { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(secretFile, s, { mode: 0o600 }); return s; })());
const hmac = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const apiToken = id => hmac('api:' + id).slice(0, 32);

// ---------- Base SQLite ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'duel.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS scores (date TEXT NOT NULL, player TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT, PRIMARY KEY (date, player));
  CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
const q = {
  allScores: db.prepare('SELECT date, player, data, updated_at FROM scores ORDER BY date'),
  dayScores: db.prepare('SELECT player, data FROM scores WHERE date = ?'),
  getScore: db.prepare('SELECT data FROM scores WHERE date = ? AND player = ?'),
  upsert: db.prepare(`INSERT INTO scores (date, player, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date, player) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`),
  del: db.prepare('DELETE FROM scores WHERE date = ? AND player = ?'),
  getCfg: db.prepare('SELECT value FROM config WHERE key = ?'),
  setCfg: db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
};
const getGamesConfig = () => { const r = q.getCfg.get('games'); return r ? JSON.parse(r.value) : null; };
const resolvedGames = () => (getGamesConfig() || DEFAULT_GAMES).map(resolveGame).filter(Boolean);

// ---------- Utilitaires ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function cleanValues(values) {
  const out = {};
  if (!values || typeof values !== 'object') return out;
  for (const [k, v] of Object.entries(values).slice(0, 80)) {
    if (!/^[a-z0-9_]{1,40}$/i.test(k)) continue;
    if (v === null || v === '') continue;
    if (v === 'X') { out[k] = 'X'; continue; }
    const n = Number(v); if (isFinite(n) && n >= 0 && n <= 1e7) out[k] = Math.round(n);
  }
  return out;
}
function writeScore(date, player, values, by) {
  const clean = cleanValues(values);
  if (!Object.keys(clean).length) q.del.run(date, player);
  else q.upsert.run(date, player, JSON.stringify(clean), new Date().toISOString(), by);
  broadcast();
  scheduleNotify(date, player);
  return clean;
}

// ---------- Sessions ----------
function parseCookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }); return o; }
function sessionPlayer(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) { const t = auth.slice(7).trim(); const p = PLAYERS.find(x => safeEq(apiToken(x.id), t)); if (p) return p; }
  const c = parseCookies(req).sess; if (!c) return null;
  const [body, sig] = c.split('.'); if (!body || !sig || !safeEq(hmac(body), sig)) return null;
  const [id, exp] = Buffer.from(body, 'base64url').toString().split('|');
  if (+exp < Date.now()) return null;
  return playerById(id) || null;
}
function sessionCookie(req, id) {
  const body = Buffer.from(`${id}|${Date.now() + SESSION_DAYS * 864e5}`).toString('base64url');
  const secure = process.env.COOKIE_SECURE === 'true' || req.headers['x-forwarded-proto'] === 'https';
  return `sess=${body}.${hmac(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}
const attempts = new Map(); // anti-bruteforce : 10 essais / 10 min / IP
function tooMany(ip) {
  const now = Date.now(), a = (attempts.get(ip) || []).filter(t => now - t < 6e5);
  attempts.set(ip, a); return a.length >= 10;
}

// ---------- Temps réel (SSE) ----------
const clients = new Set();
let bTimer = null;
function broadcast() { clearTimeout(bTimer); bTimer = setTimeout(() => { for (const res of clients) res.write('data: change\n\n'); }, 150); }
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

// ---------- Notifications (ntfy / Discord / webhook JSON) ----------
const pending = new Map();
function scheduleNotify(date, player) {
  if (!NOTIFY_URL) return;
  const key = `${date}|${player}`;
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(() => { pending.delete(key); sendNotify(date, player).catch(e => console.error('notification :', e.message)); }, NOTIFY_DELAY));
}
async function sendNotify(date, player) {
  const games = resolvedGames();
  const docs = {}; for (const r of q.dayScores.all(date)) docs[r.player] = JSON.parse(r.data);
  if (!docs[player]) return;
  const n = Object.keys(docs[player]).length;
  const label = date === todayLocal() ? "aujourd'hui" : `du ${date.split('-').reverse().join('/')}`;
  let msg = `${playerById(player).name} a posté ses scores ${label} (${n} jeu${n > 1 ? 'x' : ''}).`;
  const r = dayResult(games, PIDS, docs);
  if (r.complete && r.compared) {
    msg += `\n${PLAYERS.map(p => `${p.name} ${r.wins[p.id]}`).join(' – ')}`;
    msg += r.dayWinner === 'tie' ? ' · égalité' : ` · 🏆 ${playerById(r.dayWinner).name}`;
  } else {
    const missing = PLAYERS.filter(p => !docs[p.id]).map(p => p.name);
    if (missing.length) msg += `\nÀ toi de jouer, ${missing.join(' et ')} !`;
  }
  if (PUBLIC_URL) msg += `\n${PUBLIC_URL}`;
  const isDiscord = /discord(app)?\.com\/api\/webhooks/.test(NOTIFY_URL);
  const isSlack = /hooks\.slack\.com/.test(NOTIFY_URL);
  const opts = isDiscord || isSlack
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isDiscord ? { content: msg } : { text: msg }) }
    : { method: 'POST', headers: { 'Title': 'Duel des dles', 'Tags': 'trophy', ...(PUBLIC_URL ? { 'Click': PUBLIC_URL } : {}) }, body: msg };
  const res = await fetch(NOTIFY_URL, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
function send(res, status, body, headers = {}) {
  const isObj = body && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SEC_HEADERS, 'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
async function readBody(req, limit = 5e6) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Corps trop gros'), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
async function readJson(req, limit) { const t = await readBody(req, limit); try { return t ? JSON.parse(t) : {}; } catch { throw Object.assign(new Error('JSON invalide'), { status: 400 }); } }
function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath); if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Interdit');
  fs.readFile(file, (err, data) => {
    if (err) return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => e2 ? send(res, 404, 'Introuvable') : send(res, 200, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }));
    const ext = path.extname(file);
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.png' || ext === '.svg' ? 'public, max-age=86400' : 'no-cache' });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (!p.startsWith('/api/')) return serveStatic(req, res, p);
    if (p === '/api/health') return send(res, 200, { ok: true });
    if (p === '/api/players' && req.method === 'GET') return send(res, 200, { players: PLAYERS.map(({ id, name }) => ({ id, name })) });

    if (p === '/api/login' && req.method === 'POST') {
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
      if (tooMany(ip)) return send(res, 429, { error: 'Trop d\'essais, réessaie dans 10 minutes.' });
      const { player, pin } = await readJson(req, 1e4);
      const pl = playerById(player);
      if (!pl || !safeEq(pl.pin, String(pin || ''))) { attempts.get(ip).push(Date.now()); return send(res, 401, { error: 'PIN incorrect' }); }
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, pl.id) });
    }
    if (p === '/api/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': 'sess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });

    const me = sessionPlayer(req);
    if (!me) return send(res, 401, { error: 'Non connecté' });
    // Protection CSRF : les requêtes qui modifient doivent venir de la même origine (ou d'un jeton Bearer)
    if (req.method !== 'GET' && !req.headers.authorization) {
      const origin = req.headers.origin; const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (origin && new URL(origin).host !== host) return send(res, 403, { error: 'Origine refusée' });
    }

    if (p === '/api/state' && req.method === 'GET') {
      const scores = q.allScores.all().map(r => ({ date: r.date, player: r.player, ...JSON.parse(r.data) })).filter(s => PIDS.includes(s.player));
      return send(res, 200, { me: { id: me.id, name: me.name }, players: PLAYERS.map(({ id, name }) => ({ id, name })), games: getGamesConfig(), scores, today: todayLocal(), notify: !!NOTIFY_URL });
    }
    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 5000\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    let m;
    if ((m = p.match(/^\/api\/scores\/(\d{4}-\d{2}-\d{2})\/([\w-]+)$/)) && req.method === 'PUT') {
      if (!playerById(m[2])) return send(res, 404, { error: 'Joueur inconnu' });
      const { values } = await readJson(req, 1e5);
      return send(res, 200, { ok: true, values: writeScore(m[1], m[2], values, me.id) });
    }
    if (p === '/api/config' && req.method === 'PUT') {
      const { games } = await readJson(req, 2e5);
      const clean = sanitizeConfig(games); if (!clean) return send(res, 400, { error: 'Configuration invalide' });
      q.setCfg.run('games', JSON.stringify(clean)); broadcast();
      return send(res, 200, { ok: true, games: clean });
    }
    // Texte de partage : utilisé par la PWA (partage Android) et le raccourci iOS (jeton Bearer)
    if (p === '/api/text' && req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      const body = ct.includes('json') ? await readJson(req, 2e4) : { text: await readBody(req, 2e4) };
      const text = [body.title, body.text, body.url].filter(Boolean).join('\n');
      const date = DATE_RE.test(body.date || '') ? body.date : todayLocal();
      const player = playerById(body.player) ? body.player : me.id;
      const games = resolvedGames().filter(g => g.active);
      const found = parseShare(text, games);
      if (!Object.keys(found).length) return send(res, 422, { error: 'Aucun score reconnu dans le texte.', found: {} });
      const prev = q.getScore.get(date, player);
      const merged = { ...(prev ? JSON.parse(prev.data) : {}), ...found };
      writeScore(date, player, merged, me.id);
      const names = Object.keys(found).map(id => `${games.find(g => g.id === id).name} ${found[id]}`);
      return send(res, 200, { ok: true, date, player, found, message: `Enregistré pour ${playerById(player).name} : ${names.join(', ')}` });
    }
    if (p === '/api/token' && req.method === 'GET') return send(res, 200, { token: apiToken(me.id) });
    if (p === '/api/export' && req.method === 'GET') {
      const scores = q.allScores.all().map(r => ({ date: r.date, uid: r.player, ...JSON.parse(r.data), updatedAt: r.updated_at }));
      return send(res, 200, { exportedAt: new Date().toISOString(), games: getGamesConfig() || DEFAULT_GAMES, scores },
        { 'Content-Disposition': `attachment; filename="duel-dles-${todayLocal()}.json"` });
    }
    // Import d'une sauvegarde JSON (celle de la démo ou celle d'ici). Les scores importés remplacent ceux du même jour/joueur.
    if (p === '/api/import' && req.method === 'POST') {
      const data = await readJson(req, 2e7);
      const list = Array.isArray(data.scores) ? data.scores : [];
      let n = 0;
      db.exec('BEGIN');
      try {
        for (const s of list) {
          const player = s.uid ?? s.player;
          if (!s || !DATE_RE.test(s.date || '') || !playerById(player)) continue;
          const { date, uid, player: _p, updatedAt, ...values } = s;
          const clean = cleanValues(values);
          if (!Object.keys(clean).length) continue;
          q.upsert.run(date, player, JSON.stringify(clean), updatedAt || new Date().toISOString(), me.id); n++;
        }
        const cfg = sanitizeConfig(data.games);
        if (cfg && cfg.length && data.replaceGames !== false) q.setCfg.run('games', JSON.stringify(cfg));
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      broadcast();
      return send(res, 200, { ok: true, imported: n });
    }
    return send(res, 404, { error: 'Route inconnue' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Erreur serveur' });
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, () => console.log(`Duel des dles → http://localhost:${PORT}  (joueurs : ${PLAYERS.map(p => p.name).join(', ')}${NOTIFY_URL ? ', notifications actives' : ''})`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
