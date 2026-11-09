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
const ACCESS_CODE = (process.env.ACCESS_CODE || '').trim();      // facultatif : code commun pour entrer sur le site
const NOTIFY_URL = process.env.NOTIFY_URL || '';
const NOTIFY_DELAY = (+process.env.NOTIFY_DELAY_SECONDS || 90) * 1000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const TZ = process.env.TZ || 'Europe/Paris';
const ACCESS_DAYS = 365;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Secret (signature des cookies et jetons) ----------
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
  CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, slot INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
`);
const q = {
  allScores: db.prepare('SELECT date, player, data, updated_at FROM scores ORDER BY date'),
  dayScores: db.prepare('SELECT player, data FROM scores WHERE date = ?'),
  getScore: db.prepare('SELECT data FROM scores WHERE date = ? AND player = ?'),
  upsert: db.prepare(`INSERT INTO scores (date, player, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date, player) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`),
  del: db.prepare('DELETE FROM scores WHERE date = ? AND player = ?'),
  countScores: db.prepare('SELECT COUNT(*) AS n FROM scores WHERE player = ?'),
  recentPlayers: db.prepare('SELECT DISTINCT player FROM scores WHERE date >= ?'),
  getCfg: db.prepare('SELECT value FROM config WHERE key = ?'),
  setCfg: db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  players: db.prepare('SELECT id, name, slot, archived FROM players ORDER BY slot'),
  player: db.prepare('SELECT id, name, slot, archived FROM players WHERE id = ?'),
  playerByName: db.prepare('SELECT id FROM players WHERE lower(name) = lower(?)'),
  maxSlot: db.prepare('SELECT COALESCE(MAX(slot), -1) AS m FROM players'),
  addPlayer: db.prepare('INSERT INTO players (id, name, slot, archived, created_at) VALUES (?, ?, ?, 0, ?)'),
  renamePlayer: db.prepare('UPDATE players SET name = ? WHERE id = ?'),
  archivePlayer: db.prepare('UPDATE players SET archived = ? WHERE id = ?'),
  delPlayer: db.prepare('DELETE FROM players WHERE id = ?'),
};
const getGamesConfig = () => { const r = q.getCfg.get('games'); return r ? JSON.parse(r.value) : null; };
const resolvedGames = () => (getGamesConfig() || DEFAULT_GAMES).map(resolveGame).filter(Boolean);
const listPlayers = () => q.players.all().map(p => ({ id: p.id, name: p.name, slot: p.slot, archived: !!p.archived }));
const getPlayer = id => (typeof id === 'string' && q.player.get(id)) || null;

// ---------- Joueurs ----------
const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);
function slugify(name) {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'joueur';
  let id = base, i = 2; while (getPlayer(id)) id = `${base}-${i++}`;
  return id;
}
function createPlayer(name, id = null) {
  const n = cleanName(name); if (!n) throw Object.assign(new Error('Nom vide'), { status: 400 });
  if (!id && q.playerByName.get(n)) throw Object.assign(new Error(`« ${n} » existe déjà`), { status: 409 });
  const pid = id && /^[a-z0-9_-]{1,40}$/i.test(id) && !getPlayer(id) ? id : slugify(n);
  q.addPlayer.run(pid, n, q.maxSlot.get().m + 1, new Date().toISOString());
  return getPlayer(pid);
}
// Reprise d'une ancienne config par variable PLAYERS="val:Val[:PIN],pips:Pips" (uniquement si la table est vide)
if (!q.players.all().length && process.env.PLAYERS) {
  for (const s of process.env.PLAYERS.split(',').map(x => x.trim()).filter(Boolean)) {
    const [id, name] = s.split(':'); try { createPlayer(name || id, id); } catch { }
  }
  console.log(`Joueurs initialisés depuis PLAYERS : ${listPlayers().map(p => p.name).join(', ')}`);
}

// ---------- Utilitaires ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fmtLocal = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const todayLocal = () => fmtLocal(new Date());
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
function writeScore(date, player, values) {
  const clean = cleanValues(values);
  if (!Object.keys(clean).length) q.del.run(date, player);
  else q.upsert.run(date, player, JSON.stringify(clean), new Date().toISOString(), null);
  broadcast();
  scheduleNotify(date, player);
  return clean;
}

// ---------- Accès (code commun facultatif) ----------
function parseCookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }); return o; }
function bearerPlayer(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const t = auth.slice(7).trim();
  return listPlayers().find(p => safeEq(apiToken(p.id), t)) || null;
}
function hasAccess(req) {
  if (!ACCESS_CODE) return true;
  if (bearerPlayer(req)) return true;
  const c = parseCookies(req).acc; if (!c) return false;
  const [body, sig] = c.split('.'); if (!body || !sig || !safeEq(hmac(body), sig)) return false;
  const [kind, exp, codeHash] = Buffer.from(body, 'base64url').toString().split('|');
  return kind === 'acc' && +exp > Date.now() && codeHash === hmac('code:' + ACCESS_CODE).slice(0, 12); // changer le code invalide les anciens accès
}
function accessCookie(req) {
  const body = Buffer.from(`acc|${Date.now() + ACCESS_DAYS * 864e5}|${hmac('code:' + ACCESS_CODE).slice(0, 12)}`).toString('base64url');
  const secure = process.env.COOKIE_SECURE === 'true' || req.headers['x-forwarded-proto'] === 'https';
  return `acc=${body}.${hmac(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ACCESS_DAYS * 86400}${secure ? '; Secure' : ''}`;
}
const attempts = new Map(); // anti-bruteforce du code : 10 essais / 10 min / IP
function tooMany(ip) { const now = Date.now(), a = (attempts.get(ip) || []).filter(t => now - t < 6e5); attempts.set(ip, a); return a.length >= 10; }

// ---------- Temps réel (SSE) ----------
const clients = new Set();
let bTimer = null;
function broadcast() { clearTimeout(bTimer); bTimer = setTimeout(() => { for (const res of clients) res.write('data: change\n\n'); }, 150); }
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

// ---------- Notifications (ntfy / Discord / Slack) ----------
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
  const players = listPlayers(), nameOf = id => players.find(p => p.id === id)?.name || id;
  const n = Object.keys(docs[player]).length;
  const label = date === todayLocal() ? "aujourd'hui" : `du ${date.split('-').reverse().join('/')}`;
  let msg = `${nameOf(player)} a posté ses scores ${label} (${n} jeu${n > 1 ? 'x' : ''}).`;
  const ids = Object.keys(docs);
  const r = dayResult(games, ids, docs);
  if (r.compared) {
    msg += '\n' + [...ids].sort((a, b) => r.wins[b] - r.wins[a]).map(id => `${nameOf(id)} ${r.wins[id]}`).join(' · ');
    if (r.dayWinner && r.dayWinner !== 'tie') msg += ` — 🏆 ${nameOf(r.dayWinner)} en tête`;
  }
  // joueurs « habituels » (actifs ces 14 derniers jours) qui n'ont pas encore posté
  const since = fmtLocal(new Date(Date.now() - 14 * 864e5));
  const missing = q.recentPlayers.all(since).map(x => x.player).filter(id => !docs[id] && players.some(p => p.id === id && !p.archived)).map(nameOf);
  if (missing.length) msg += `\nÀ toi de jouer : ${missing.join(', ')} !`;
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

    if (p === '/api/unlock' && req.method === 'POST') {
      if (!ACCESS_CODE) return send(res, 200, { ok: true });
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
      if (tooMany(ip)) return send(res, 429, { error: "Trop d'essais, réessaie dans 10 minutes." });
      const { code } = await readJson(req, 1e4);
      if (!safeEq(String(code || '').trim().toLowerCase(), ACCESS_CODE.toLowerCase())) { attempts.get(ip).push(Date.now()); return send(res, 401, { error: 'Code incorrect' }); }
      return send(res, 200, { ok: true }, { 'Set-Cookie': accessCookie(req) });
    }
    if (p === '/api/lock' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': 'acc=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });

    if (!hasAccess(req)) return send(res, 401, { error: 'Code d\'accès requis', locked: true });
    // Protection CSRF : les requêtes qui modifient doivent venir de la même origine (ou d'un jeton Bearer)
    if (req.method !== 'GET' && !req.headers.authorization) {
      const origin = req.headers.origin; const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (origin && new URL(origin).host !== host) return send(res, 403, { error: 'Origine refusée' });
    }

    if (p === '/api/state' && req.method === 'GET') {
      const scores = q.allScores.all().map(r => ({ date: r.date, player: r.player, ...JSON.parse(r.data) }));
      return send(res, 200, { players: listPlayers(), games: getGamesConfig(), scores, today: todayLocal(), notify: !!NOTIFY_URL, accessCode: !!ACCESS_CODE });
    }
    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 5000\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }

    // ----- Joueurs -----
    if (p === '/api/players' && req.method === 'POST') {
      const { name } = await readJson(req, 1e4);
      const pl = createPlayer(name); broadcast();
      return send(res, 201, { ok: true, player: { ...pl, archived: !!pl.archived } });
    }
    let m;
    if ((m = p.match(/^\/api\/players\/([\w-]+)$/))) {
      const pl = getPlayer(m[1]); if (!pl) return send(res, 404, { error: 'Joueur inconnu' });
      if (req.method === 'PATCH') {
        const { name, archived } = await readJson(req, 1e4);
        if (name !== undefined) {
          const n = cleanName(name); if (!n) return send(res, 400, { error: 'Nom vide' });
          const other = q.playerByName.get(n); if (other && other.id !== pl.id) return send(res, 409, { error: `« ${n} » existe déjà` });
          q.renamePlayer.run(n, pl.id);
        }
        if (archived !== undefined) q.archivePlayer.run(archived ? 1 : 0, pl.id);
        broadcast(); return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        if (q.countScores.get(pl.id).n > 0) return send(res, 409, { error: 'Ce joueur a des scores : archive-le plutôt.' });
        q.delPlayer.run(pl.id); broadcast(); return send(res, 200, { ok: true });
      }
    }
    if ((m = p.match(/^\/api\/token\/([\w-]+)$/)) && req.method === 'GET') {
      if (!getPlayer(m[1])) return send(res, 404, { error: 'Joueur inconnu' });
      return send(res, 200, { token: apiToken(m[1]) });
    }

    // ----- Scores -----
    if ((m = p.match(/^\/api\/scores\/(\d{4}-\d{2}-\d{2})\/([\w-]+)$/)) && req.method === 'PUT') {
      if (!getPlayer(m[2])) return send(res, 404, { error: 'Joueur inconnu' });
      const { values } = await readJson(req, 1e5);
      return send(res, 200, { ok: true, values: writeScore(m[1], m[2], values) });
    }
    if (p === '/api/config' && req.method === 'PUT') {
      const { games } = await readJson(req, 2e5);
      const clean = sanitizeConfig(games); if (!clean) return send(res, 400, { error: 'Configuration invalide' });
      q.setCfg.run('games', JSON.stringify(clean)); broadcast();
      return send(res, 200, { ok: true, games: clean });
    }
    // Texte de partage : PWA (partage Android, joueur indiqué) ou raccourci iOS (jeton Bearer = joueur)
    if (p === '/api/text' && req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      const body = ct.includes('json') ? await readJson(req, 2e4) : { text: await readBody(req, 2e4) };
      const pl = bearerPlayer(req) || getPlayer(body.player);
      if (!pl) return send(res, 400, { error: 'Joueur inconnu : choisis qui tu es dans l\'app.' });
      const text = [body.title, body.text, body.url].filter(Boolean).join('\n');
      const date = DATE_RE.test(body.date || '') ? body.date : todayLocal();
      const games = resolvedGames().filter(g => g.active);
      const found = parseShare(text, games);
      if (!Object.keys(found).length) return send(res, 422, { error: 'Aucun score reconnu dans le texte.', found: {} });
      const prev = q.getScore.get(date, pl.id);
      writeScore(date, pl.id, { ...(prev ? JSON.parse(prev.data) : {}), ...found });
      const names = Object.keys(found).map(id => `${games.find(g => g.id === id).name} ${found[id]}`);
      return send(res, 200, { ok: true, date, player: pl.id, found, message: `Enregistré pour ${pl.name} : ${names.join(', ')}` });
    }
    if (p === '/api/export' && req.method === 'GET') {
      const scores = q.allScores.all().map(r => ({ date: r.date, uid: r.player, ...JSON.parse(r.data), updatedAt: r.updated_at }));
      return send(res, 200, { exportedAt: new Date().toISOString(), players: listPlayers(), games: getGamesConfig() || DEFAULT_GAMES, scores },
        { 'Content-Disposition': `attachment; filename="duel-dles-${todayLocal()}.json"` });
    }
    // Import d'une sauvegarde (démo Claude ou ici). Les joueurs inconnus sont créés ; les scores importés remplacent ceux du même jour/joueur.
    if (p === '/api/import' && req.method === 'POST') {
      const data = await readJson(req, 2e7);
      const list = Array.isArray(data.scores) ? data.scores : [];
      const names = Object.fromEntries((Array.isArray(data.players) ? data.players : []).map(x => [x.id, x.name]));
      const KNOWN = { val: 'Val', pips: 'Pips' };
      let n = 0, created = [];
      db.exec('BEGIN');
      try {
        for (const s of list) {
          const pid = s?.uid ?? s?.player;
          if (!s || !DATE_RE.test(s.date || '') || typeof pid !== 'string' || !/^[\w-]{1,40}$/.test(pid)) continue;
          if (!getPlayer(pid)) { const nm = names[pid] || KNOWN[pid] || pid; try { createPlayer(q.playerByName.get(cleanName(nm)) ? `${nm} (${pid})` : nm, pid); created.push(nm); } catch { continue; } }
          const { date, uid, player: _p, updatedAt, ...values } = s;
          const clean = cleanValues(values);
          if (!Object.keys(clean).length) continue;
          q.upsert.run(date, pid, JSON.stringify(clean), updatedAt || new Date().toISOString(), null); n++;
        }
        const cfg = sanitizeConfig(data.games);
        if (cfg && cfg.length && data.replaceGames !== false) q.setCfg.run('games', JSON.stringify(cfg));
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      broadcast();
      return send(res, 200, { ok: true, imported: n, createdPlayers: created });
    }
    return send(res, 404, { error: 'Route inconnue' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Erreur serveur' });
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, () => console.log(`Duel des dles → http://localhost:${PORT}  (${listPlayers().length} joueur(s)${ACCESS_CODE ? ', code d\'accès actif' : ', accès libre'}${NOTIFY_URL ? ', notifications actives' : ''})`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
