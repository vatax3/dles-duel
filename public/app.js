import { PRESETS, DEFAULT_GAMES, RANK_POINTS, resolveGame, parseShare, dayResult as computeDay } from './games.js';

// ================= Utils =================
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const parseIso = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const shiftDate = (iso, n) => { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const fmtDate = iso => parseIso(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtShort = iso => parseIso(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const fmtLong = iso => parseIso(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const mondayOf = iso => { const d = parseIso(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDate(d); };
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
};
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { } } };
let toastT;
function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', err); t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 4000); }

class Locked extends Error { }
async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts, headers: { ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  let data = null; try { data = await res.json(); } catch { }
  if (res.status === 401 && data?.locked) { showGate('code'); throw new Locked('Code requis'); }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Erreur ${res.status}`), { status: res.status, data });
  return data;
}

// ================= État =================
let players = [], meId = store.get('dd_me'), accessCode = false, notifyOn = false;
let scores = [], gameConfig = null, GAMES = [];
let selDate = today(), forId = null, period = '30', statGame = null;

const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const playerById = id => players.find(p => p.id === id);
const nameOf = id => playerById(id)?.name || id;
const emojiOf = id => playerById(id)?.emoji || '';
const label = id => (emojiOf(id) ? `${emojiOf(id)} ` : '') + nameOf(id);
const activePlayers = () => players.filter(p => !p.archived);
const colorIdx = id => { const p = playerById(id); if (!p) return -1; return p.color ?? (p.slot < 8 ? p.slot : -1); };
const color = id => { const i = colorIdx(id); return i >= 0 ? `var(--c${i + 1})` : 'var(--cx)'; };
const colorHex = id => { const i = colorIdx(id); return i >= 0 ? PALETTE[i] : '#6b7280'; };
const dot = id => el('span', { class: 'dot', style: `background:${color(id)}` });
const setGames = () => { GAMES = (gameConfig || DEFAULT_GAMES).map(resolveGame).filter(Boolean); };
const activeGames = () => GAMES.filter(g => g.active);
const docOf = (date, p) => scores.find(s => s.date === date && s.player === p);
const allDates = () => [...new Set(scores.map(s => s.date))].sort();
const cache = new Map();
function dayResult(date) {
  if (cache.has(date)) return cache.get(date);
  const docs = {}; for (const s of scores) if (s.date === date) docs[s.player] = s;
  const ids = players.map(p => p.id).filter(id => docs[id]);
  const r = computeDay(GAMES, ids, docs); r.ids = ids; cache.set(date, r); return r;
}
const isWin = (w, p) => Array.isArray(w) && w.includes(p);
// joueurs « habituels » : non archivés et ayant joué ces 14 derniers jours
const regulars = () => { const from = shiftDate(today(), -14); const s = new Set(scores.filter(x => x.date >= from).map(x => x.player)); return activePlayers().filter(p => s.has(p.id)).map(p => p.id); };

// ================= Entrée : code puis « qui es-tu ? » =================
function showGate(step) {
  $('#appView').classList.add('hidden'); $('#gateView').classList.remove('hidden');
  $('#codeStep').classList.toggle('hidden', step !== 'code');
  $('#whoStep').classList.toggle('hidden', step !== 'who');
  $('#gateStatus').textContent = '';
  if (step === 'code') $('#code').focus();
  if (step === 'who') {
    const box = $('#who'); box.innerHTML = '';
    for (const p of activePlayers()) box.append(el('button', { class: 'chip', onclick: () => chooseMe(p.id) }, dot(p.id), label(p.id)));
    if (!activePlayers().length) box.append(el('div', { class: 'hint' }, 'Aucun joueur pour l\'instant : ajoute-toi ci-dessous.'));
  }
}
function gateError(msg) { const s = $('#gateStatus'); s.textContent = msg; s.classList.add('err'); }
async function unlock() {
  try { await api('/api/unlock', { method: 'POST', body: JSON.stringify({ code: $('#code').value }) }); $('#code').value = ''; await boot(); }
  catch (e) { if (!(e instanceof Locked)) gateError(e.message); }
}
$('#codeBtn').addEventListener('click', unlock);
$('#code').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
async function chooseMe(id) { meId = id; store.set('dd_me', id); forId = id; await enterApp(); }
async function addSelf() {
  const name = $('#newName').value.trim(); if (!name) return gateError('Donne ton prénom.');
  try { const r = await api('/api/players', { method: 'POST', body: JSON.stringify({ name }) }); $('#newName').value = ''; await loadState(); await chooseMe(r.player.id); }
  catch (e) { if (!(e instanceof Locked)) gateError(e.message); }
}
$('#newBtn').addEventListener('click', addSelf);
$('#newName').addEventListener('keydown', e => { if (e.key === 'Enter') addSelf(); });
$('#switchMe').addEventListener('click', () => { store.set('dd_me', null); meId = null; showGate('who'); });
$('#lockBtn').addEventListener('click', async () => { try { await api('/api/lock', { method: 'POST' }); } catch { } es?.close(); showGate('code'); });

// ================= Chargement & temps réel =================
let es = null;
async function loadState() {
  const s = await api('/api/state');
  players = s.players; gameConfig = s.games; scores = s.scores; accessCode = s.accessCode; notifyOn = s.notify;
  setGames();
}
function connectEvents() {
  es?.close();
  es = new EventSource('/api/events');
  let t;
  es.onopen = () => { $('#live').classList.add('on'); $('#liveTxt').textContent = 'en direct'; };
  es.onerror = () => { $('#live').classList.remove('on'); $('#liveTxt').textContent = 'reconnexion…'; };
  es.onmessage = () => { clearTimeout(t); t = setTimeout(refresh, 200); };
}
const editing = () => document.activeElement && $('#entry').contains(document.activeElement);
async function refresh() {
  try {
    await loadState();
    if (meId && !playerById(meId)) { store.set('dd_me', null); meId = null; return showGate('who'); }
    if (!playerById(forId) || playerById(forId).archived) forId = meId;
    buildForPicker();
    if (!editing() && !pending) buildForm(); // ne jamais reconstruire sous les doigts de quelqu'un qui tape
    renderAll();
  } catch (e) { if (!(e instanceof Locked)) showBanner('Connexion au serveur perdue, nouvel essai…'); }
}
async function boot() {
  try { await loadState(); }
  catch (e) { if (!(e instanceof Locked)) { showGate(null); gateError('Serveur injoignable.'); } return; }
  if (!meId || !playerById(meId) || playerById(meId).archived) return showGate('who');
  await enterApp();
}
async function enterApp() {
  $('#gateView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  forId = meId;
  $('#lockBtn').classList.toggle('hidden', !accessCode);
  $('#apiUrl').textContent = location.origin + '/api/text';
  api(`/api/token/${meId}`).then(d => { $('#apiToken').textContent = 'Bearer ' + d.token; }).catch(() => { });
  buildForPicker(); buildForm(); $('#date').value = selDate; renderAll();
  connectEvents();
  await handleShareTarget();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && meId && !$('#appView').classList.contains('hidden')) refresh(); });

// Partage Android (Web Share Target) : l'app s'ouvre sur /?text=…
async function handleShareTarget() {
  const u = new URL(location.href);
  const text = ['title', 'text', 'url'].map(k => u.searchParams.get(k)).filter(Boolean).join('\n');
  if (!text) return;
  history.replaceState(null, '', '/');
  try {
    const r = await api('/api/text', { method: 'POST', body: JSON.stringify({ text, player: meId }) });
    toast(r.message); await refresh();
  } catch (e) {
    toast(e.message + ' Colle-le à la main.', true);
    $('#paste').value = text; onPaste(text);
  }
}

// ================= Saisie : un joueur à la fois, enregistrement automatique =================
let inputs = {};
function buildForPicker() {
  const box = $('#forChips'); box.innerHTML = '';
  box.append(el('span', { class: 'hint', style: 'margin:0 4px 0 0' }, 'Pour :'));
  const ordered = [playerById(meId), ...activePlayers().filter(p => p.id !== meId)].filter(Boolean);
  for (const p of ordered) {
    const has = !!docOf(selDate, p.id);
    box.append(el('button', { class: 'chip' + (p.id === forId ? ' on' : ''), title: has ? 'Scores déjà saisis' : null, onclick: () => switchFor(p.id) },
      dot(p.id), label(p.id), p.id === meId ? ' (toi)' : '', has ? ' ✓' : ''));
  }
}
async function switchFor(id) {
  if (id === forId) return;
  await flushSave();
  forId = id; buildForPicker(); buildForm(); $('#paste').value = ''; setStatus('');
}
function buildForm() {
  const box = $('#entry'); box.innerHTML = ''; inputs = {};
  const doc = docOf(selDate, forId) || {};
  // les jeux pas encore joués (par ce joueur, ce jour-là) d'abord
  const todo = activeGames().filter(g => doc[g.id] == null), done = activeGames().filter(g => doc[g.id] != null);
  const row = g => {
    const n = el('input', { type: 'number', min: g.min, max: g.max, inputmode: 'numeric', placeholder: '–', 'aria-label': g.name });
    const f = el('input', { type: 'checkbox' });
    n.addEventListener('input', () => { n.classList.remove('auto'); if (n.value) f.checked = false; scheduleSave(1200); });
    n.addEventListener('blur', () => { if (pending) scheduleSave(200); });
    f.addEventListener('change', () => { if (f.checked) n.value = ''; n.disabled = f.checked; scheduleSave(300); });
    inputs[g.id] = { num: n, fail: f };
    const desc = g.desc ? el('div', { class: 'gdesc hidden' }, g.desc) : null;
    return el('div', { class: 'erow' + (doc[g.id] != null ? ' done' : '') },
      el('div', { class: 'gname' }, `${g.ic} `, el('b', {}, g.name),
        g.desc ? el('button', { class: 'info', type: 'button', title: 'Description', 'aria-label': `Description de ${g.name}`, onclick: () => desc.classList.toggle('hidden') }, 'ⓘ') : null,
        g.url ? el('a', { class: 'play', href: g.url, target: '_blank', rel: 'noopener' }, 'Jouer ↗') : null,
        el('small', {}, g.sub), g.timer ? el('small', { class: 'timer' }, `⏱ ${g.timer}`) : null),
      el('div', { class: 'cell' }, n, g.canFail ? el('label', { title: 'Raté' }, f, el('span', {}, 'Raté')) : null),
      desc);
  };
  todo.forEach(g => box.append(row(g)));
  if (todo.length && done.length) box.append(el('div', { class: 'donehead' }, `Déjà joué (${done.length})`));
  done.forEach(g => box.append(row(g)));
  if (!activeGames().length) box.append(el('div', { class: 'empty' }, 'Aucun jeu actif — va dans Réglages.'));
  if (!todo.length && done.length) box.prepend(el('div', { class: 'donehead', style: 'color:var(--accent)' }, `Tous les jeux du jour sont faits 🎉`));
  setInputs(doc);
}
function setInputs(vals) {
  for (const g of activeGames()) {
    const inp = inputs[g.id]; if (!inp) continue;
    const v = vals ? vals[g.id] : null;
    inp.num.classList.remove('auto');
    inp.fail.checked = v === 'X'; inp.num.disabled = v === 'X';
    inp.num.value = (v == null || v === 'X') ? '' : v;
  }
}
function readForm() {
  const out = {};
  for (const g of activeGames()) {
    const inp = inputs[g.id]; if (!inp) continue;
    if (g.canFail && inp.fail.checked) { out[g.id] = 'X'; continue; }
    if (inp.num.value === '') { out[g.id] = null; continue; }
    const n = Math.round(Number(inp.num.value));
    out[g.id] = isFinite(n) ? Math.max(g.min, Math.min(g.max, n)) : null;
  }
  return out;
}
function onPaste(text) {
  const found = parseShare(text, activeGames());
  for (const [id, v] of Object.entries(found)) {
    const inp = inputs[id]; if (!inp) continue;
    if (v === 'X') { inp.fail.checked = true; inp.num.value = ''; inp.num.disabled = true; }
    else { inp.fail.checked = false; inp.num.disabled = false; inp.num.value = v; inp.num.classList.add('auto'); }
  }
  const names = Object.keys(found).map(id => GAMES.find(g => g.id === id).name);
  if (names.length) { setStatus(`${nameOf(forId)} : ${names.join(', ')} détecté…`); scheduleSave(150, true); }
  else setStatus(text.trim() ? 'Rien reconnu, remplis à la main.' : '');
}
$('#paste').addEventListener('input', e => onPaste(e.target.value));
$('#pasteBtn').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return toast('Le presse-papiers est vide.', true);
    $('#paste').value = text; onPaste(text);
  } catch { toast('Le navigateur refuse l\'accès au presse-papiers : colle à la main dans la zone.', true); $('#paste').focus(); }
});
function setStatus(msg, kind = '', id = '#status') { const s = $(id); s.textContent = msg; s.classList.toggle('err', kind === 'err'); s.classList.toggle('ok', kind === 'ok'); }

let pending = null, saveTimer = null, rebuildAfter = false;
function scheduleSave(delay, rebuild = false) {
  pending = { pid: forId, date: selDate, vals: readForm() };
  rebuildAfter = rebuildAfter || rebuild;
  clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, delay);
}
async function flushSave() {
  clearTimeout(saveTimer);
  const job = pending; if (!job) return;
  pending = null;
  const prev = docOf(job.date, job.pid) || {};
  const next = {}; for (const [k, v] of Object.entries(prev)) if (k !== 'date' && k !== 'player') next[k] = v;
  Object.assign(next, job.vals); // les jeux en pause gardent leur score
  const changed = Object.keys({ ...prev, ...next }).some(k => k !== 'date' && k !== 'player' && (prev[k] ?? null) !== (next[k] ?? null));
  if (!changed) { if (rebuildAfter) { rebuildAfter = false; $('#paste').value = ''; } return; }
  setStatus('Enregistrement…');
  try {
    await api(`/api/scores/${job.date}/${job.pid}`, { method: 'PUT', body: JSON.stringify({ values: next }) });
    const t = new Date();
    setStatus(`Enregistré ✓ ${nameOf(job.pid)} · ${pad(t.getHours())}:${pad(t.getMinutes())}`, 'ok');
    const rebuild = rebuildAfter; rebuildAfter = false;
    if (rebuild) $('#paste').value = '';
    await loadState(); buildForPicker();
    if (rebuild && !editing()) buildForm();
    renderAll();
  } catch (e) { if (!(e instanceof Locked)) { setStatus(`Échec de l'enregistrement : ${e.message}`, 'err'); pending = job; } }
}
addEventListener('pagehide', () => { if (pending) flushSave(); });

async function setDate(d) {
  await flushSave();
  selDate = d; $('#date').value = d; $('#paste').value = ''; setStatus('');
  buildForPicker(); buildForm(); renderDuel();
}
$('#date').addEventListener('change', e => e.target.value && setDate(e.target.value));
$('#prevDay').addEventListener('click', () => setDate(shiftDate(selDate, -1)));
$('#nextDay').addEventListener('click', () => setDate(shiftDate(selDate, 1)));
$('#todayBtn').addEventListener('click', () => setDate(today()));

// ================= Onglets =================
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
  for (const t of ['today', 'history', 'stats', 'settings']) $('#tab-' + t).classList.toggle('hidden', t !== name);
  if (name === 'stats') renderStats();
  scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.querySelectorAll('#period button').forEach(b => b.addEventListener('click', () => {
  period = b.dataset.p; document.querySelectorAll('#period button').forEach(x => x.classList.toggle('on', x === b)); renderStats();
}));
$('#gameSel').addEventListener('change', e => { statGame = e.target.value; renderStatGame(periodDates()); });

// ================= Rendu : jour =================
const fmtV = v => v == null || v === '' ? '–' : String(v);
function renderHead() {
  const box = $('#headScore'); box.innerHTML = '';
  const c = {};
  for (const d of allDates()) { const w = dayResult(d).dayWinner; if (w && w !== 'tie') c[w] = (c[w] || 0) + 1; }
  const top = Object.entries(c).sort((a, b) => b[1] - a[1]);
  top.slice(0, 3).forEach(([p, n]) => box.append(el('span', { class: 'pill', title: 'Journées gagnées' }, dot(p), `${label(p)} 🏆${n}`)));
  if (top.length > 3) box.append(el('span', { class: 'pill' }, `+${top.length - 3}`));
}
function dayOrder(r) { return [...r.ids].sort((a, b) => r.points[b] - r.points[a] || r.wins[b] - r.wins[a]); }
function placeOf(r, order) { const pl = {}; order.forEach((p, i) => { pl[p] = i > 0 && r.points[p] === r.points[order[i - 1]] ? pl[order[i - 1]] : i + 1; }); return pl; }
function renderDuel() {
  const box = $('#duel'); box.innerHTML = '';
  $('#duelTitle').textContent = selDate === today() ? "Le duel d'aujourd'hui" : `Le duel — ${fmtDate(selDate)}`;
  const r = dayResult(selDate);
  const waiting = (selDate === today() ? regulars() : []).filter(p => !r.docs[p]);
  $('#shareImg').classList.toggle('hidden', !r.compared);
  if (!r.ids.length) { box.append(el('div', { class: 'empty' }, 'Aucun score ce jour-là.' + (waiting.length ? ` En attente de ${waiting.map(nameOf).join(', ')}.` : ''))); return; }
  const order = dayOrder(r), pl = placeOf(r, order);
  // podium (3 premiers) puis le reste
  if (r.compared) {
    const pod = el('div', { class: 'podium' });
    const step = (p, cls) => p ? el('div', { class: `step ${cls}`, style: `border-top:4px solid ${color(p)}` },
      el('div', { class: 'emo' }, emojiOf(p) || ['🥇', '🥈', '🥉'][pl[p] - 1] || '🎖️'),
      el('div', { class: 'nm' }, nameOf(p)), el('div', { class: 'pts' }, r.points[p]), el('div', { class: 'pl' }, `${pl[p] === 1 ? '1er' : `${pl[p]}e`} · ${r.wins[p]} jeu${r.wins[p] > 1 ? 'x' : ''} gagné${r.wins[p] > 1 ? 's' : ''}`))
      : el('div', { class: 'step empty' });
    pod.append(step(order[1], 's2'), step(order[0], 's1'), step(order[2], 's3'));
    box.append(pod);
  }
  if (order.length > 3 || !r.compared) {
    const rank = el('div', { class: 'rank' });
    for (const p of (r.compared ? order.slice(3) : order)) {
      const played = GAMES.filter(g => r.docs[p]?.[g.id] != null).length;
      rank.append(el('div', { class: 'r' }, el('div', { class: 'pos' }, r.compared ? `${pl[p]}.` : '·'),
        el('div', {}, dot(p), el('b', {}, label(p)), el('div', { class: 'sub' }, `${played} jeu${played > 1 ? 'x' : ''} joué${played > 1 ? 's' : ''}`)),
        el('div', { class: 'pts', title: 'Points du jour' }, r.compared ? r.points[p] : '–')));
    }
    box.append(rank);
  }
  const msg = r.ids.length < 2 ? 'Il faut au moins deux joueurs pour comparer.' : r.dayWinner === 'tie' ? 'Égalité en tête.' : !r.compared ? 'Aucun jeu en commun.' : r.dayWinner ? `🏆 ${label(r.dayWinner)} mène la journée.` : null;
  box.append(el('div', { class: 'hint', style: 'margin:0 0 10px' }, [msg, waiting.length ? `En attente de ${waiting.map(nameOf).join(', ')}.` : null].filter(Boolean).join(' ')));
  const t = el('table');
  t.append(el('tr', {}, el('th', {}, 'Jeu'), ...order.map(p => el('th', {}, label(p)))));
  for (const g of GAMES.filter(g => g.active || r.ids.some(p => r.docs[p]?.[g.id] != null))) {
    const w = r.perGame[g.id], rk = r.ranks[g.id];
    t.append(el('tr', {}, el('td', { title: [g.desc, g.timer && `⏱ ${g.timer}`].filter(Boolean).join('\n') || null }, `${g.ic} ${g.name}`), ...order.map(p => {
      const v = r.docs[p]?.[g.id];
      return el('td', { class: ['v', isWin(w, p) ? 'win' : '', v === 'X' ? 'x' : ''].join(' ') }, fmtV(v),
        rk && rk[p] ? el('small', { class: 'rk', title: `${rk[p]}e place` }, `+${RANK_POINTS[rk[p] - 1] ?? 1}`) : null);
    })));
  }
  t.append(el('tr', {}, el('td', {}, el('b', {}, 'Total')), ...order.map(p => el('td', { class: 'v' }, el('b', {}, r.compared ? r.points[p] : '–')))));
  box.append(el('div', { class: 'scroll' }, t));
  // confettis : une fois par jour et par appareil, quand tous les habitués ont posté
  if (r.compared && !waiting.length && r.dayWinner && r.dayWinner !== 'tie' && r.ids.length >= 2) {
    const key = `dd_confetti_${selDate}`;
    if (!store.get(key) && !$('#tab-today').classList.contains('hidden')) { store.set(key, '1'); confetti(colorHex(r.dayWinner)); toast(`🏆 ${label(r.dayWinner)} remporte la journée !`); }
  }
}

// ================= Confettis =================
function confetti(main) {
  const c = $('#confetti'), ctx = c.getContext('2d'); if (!ctx) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  const cols = [main, '#e5b53b', '#6aaa64', '#e9ecf2', ...PALETTE];
  const parts = Array.from({ length: 160 }, () => ({ x: Math.random() * c.width, y: -Math.random() * c.height * 0.4, vx: (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 5,
    s: (5 + Math.random() * 7) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cols[Math.floor(Math.random() * cols.length)] }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) { p.x += p.vx; p.y += p.vy * devicePixelRatio; p.vy += 0.05; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }
    if (t - t0 < 3500) requestAnimationFrame(frame); else ctx.clearRect(0, 0, c.width, c.height);
  })(t0);
}

// ================= Image du résultat à partager =================
$('#shareImg').addEventListener('click', async () => {
  const r = dayResult(selDate); if (!r.compared) return;
  const order = dayOrder(r), pl = placeOf(r, order);
  const games = GAMES.filter(g => r.ids.some(p => r.docs[p]?.[g.id] != null));
  const W = 1080, rowH = 64, colW = Math.min(170, Math.floor((W - 380) / Math.max(1, order.length)));
  const H = 260 + order.length * 92 + 70 + games.length * rowH + 90;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const font = (w, s, mono) => `${w} ${s}px ${mono ? '"JetBrains Mono", ui-monospace, monospace' : '"Space Grotesk", system-ui, sans-serif'}`;
  x.fillStyle = '#0f1115'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#e9ecf2'; x.font = font(700, 56); x.fillText('Duel des ', 60, 100); const w1 = x.measureText('Duel des ').width;
  x.fillStyle = '#6aaa64'; x.fillText('dles', 60 + w1, 100);
  x.fillStyle = '#8b93a5'; x.font = font(500, 32); x.fillText(fmtLong(selDate), 60, 156);
  let y = 220;
  order.forEach((p, i) => {
    x.fillStyle = i === 0 ? '#2a2312' : '#171a21'; roundRect(x, 60, y, W - 120, 76, 14); x.fill();
    if (i === 0) { x.strokeStyle = '#e5b53b'; x.lineWidth = 2; x.stroke(); }
    x.fillStyle = colorHex(p); x.beginPath(); x.arc(110, y + 38, 12, 0, 7); x.fill();
    x.fillStyle = '#8b93a5'; x.font = font(700, 30, true); x.fillText(`${pl[p]}.`, 140, y + 49);
    x.fillStyle = '#e9ecf2'; x.font = font(700, 34); x.fillText(`${label(p)}${p === r.dayWinner ? '  🏆' : ''}`, 200, y + 50);
    x.font = font(700, 38, true); x.textAlign = 'right'; x.fillText(`${r.points[p]} pts`, W - 90, y + 52); x.textAlign = 'left';
    y += 92;
  });
  y += 30;
  x.font = font(500, 24); x.fillStyle = '#8b93a5';
  order.forEach((p, i) => { x.textAlign = 'center'; x.fillText(nameOf(p).slice(0, 10), 380 + colW * i + colW / 2, y); });
  x.textAlign = 'left'; y += 20;
  for (const g of games) {
    x.fillStyle = '#171a21'; roundRect(x, 60, y, W - 120, rowH - 8, 10); x.fill();
    x.fillStyle = '#e9ecf2'; x.font = font(500, 28); x.fillText(`${g.ic} ${g.name}`, 80, y + 38);
    order.forEach((p, i) => {
      const v = r.docs[p]?.[g.id], cx = 380 + colW * i + colW / 2;
      if (isWin(r.perGame[g.id], p)) { x.fillStyle = '#6aaa64'; roundRect(x, cx - colW / 2 + 8, y + 6, colW - 16, rowH - 20, 8); x.fill(); x.fillStyle = '#0b0d10'; }
      else x.fillStyle = v === 'X' ? '#d65c5c' : '#e9ecf2';
      x.font = font(700, 28, true); x.textAlign = 'center'; x.fillText(fmtV(v), cx, y + 38); x.textAlign = 'left';
    });
    y += rowH;
  }
  x.fillStyle = '#8b93a5'; x.font = font(500, 22); x.fillText('Points par jeu selon la place : 10 · 7 · 5 · 3 · 2 · 1', 60, H - 40);
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  const file = new File([blob], `duel-dles-${selDate}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Duel des dles', text: `Résultats du ${fmtDate(selDate)}` }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = el('a', { href: URL.createObjectURL(blob), download: file.name }); document.body.append(a); a.click(); a.remove();
  toast('Image téléchargée ✓');
});
function roundRect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }

// ================= Rendu : historique =================
function renderHistory() {
  const box = $('#history'); box.innerHTML = '';
  const dates = allDates().reverse();
  if (!dates.length) { box.append(el('div', { class: 'empty' }, 'Rien encore. Rentrez vos premiers scores !')); return; }
  const games = GAMES.filter(g => scores.some(s => s[g.id] != null));
  const t = el('table');
  t.append(el('tr', {}, el('th', {}, 'Jour'), el('th', {}, 'Joueurs'), ...games.map(g => el('th', { title: g.name }, g.ic)), el('th', {}, 'Vainqueur')));
  for (const d of dates) {
    const r = dayResult(d);
    t.append(el('tr', { class: 'clickrow', title: 'Ouvrir ce jour', onclick: () => { showTab('today'); setDate(d); } },
      el('td', {}, fmtDate(d)),
      el('td', { style: 'white-space:nowrap' }, r.ids.map(p => el('span', { class: 'dot', style: `background:${color(p)};margin:0 1px`, title: nameOf(p) }))),
      ...games.map(g => { const w = r.perGame[g.id]; return el('td', { style: 'font-size:12px;white-space:nowrap' }, Array.isArray(w) ? w.map(p => el('span', { class: 'dot', style: `background:${color(p)};margin:0 1px`, title: nameOf(p) })) : w === 'tie' ? '=' : ''); }),
      el('td', {}, r.dayWinner && r.dayWinner !== 'tie' ? el('span', { class: 'pill w' }, `${label(r.dayWinner)} · ${r.points[r.dayWinner]}`) : el('span', { class: 'pill' }, r.dayWinner === 'tie' ? 'égalité' : 'incomplet'))));
  }
  box.append(t);
  box.append(el('div', { class: 'hint' }, 'Joueurs = qui a posté. Pastille sous un jeu = qui l\'a gagné, « = » = égalité. Clique sur un jour pour le corriger.'));
}

// ================= Rendu : stats =================
function periodDates() {
  const ds = allDates(); if (period === 'all') return ds;
  const from = shiftDate(today(), -(+period - 1)); return ds.filter(d => d >= from);
}
function renderStats() {
  const top = $('#statsTop'), cbox = $('#chart');
  top.innerHTML = ''; cbox.innerHTML = ''; $('#h2h').innerHTML = '';
  const dates = periodDates();
  const duel = dates.filter(d => dayResult(d).compared > 0);
  renderPalmares(); renderBadges();
  if (!duel.length) { top.append(el('div', { class: 'empty' }, 'Pas encore de journée en duel sur cette période.')); $('#statsGame').innerHTML = ''; return; }
  const st = {};
  const S = p => st[p] ||= { days: 0, dayWins: 0, firsts: 0, points: 0 };
  for (const d of duel) {
    const r = dayResult(d);
    for (const p of r.ids) { S(p).days++; S(p).points += r.points[p]; S(p).firsts += r.wins[p]; if (r.dayWinner === p) S(p).dayWins++; }
  }
  let sU = null, sN = 0;
  for (const d of allDates().reverse()) { const r = dayResult(d); if (!r.compared) continue; if (r.dayWinner === 'tie') break; if (!sU) { sU = r.dayWinner; sN = 1; } else if (r.dayWinner === sU) sN++; else break; }

  const ids = Object.keys(st).sort((a, b) => st[b].points - st[a].points || st[b].dayWins - st[a].dayWins);
  const t = el('table');
  t.append(el('tr', {}, el('th', {}, '#'), el('th', {}, 'Joueur'), el('th', { title: 'Total des points de place' }, 'Points'), el('th', { title: 'Moyenne de points par jour joué' }, 'Pts / jour'),
    el('th', { title: 'Journées gagnées' }, 'Journées'), el('th', { title: 'Part des journées jouées qui ont été gagnées' }, '% gagnées'), el('th', {}, 'Jours joués'), el('th', { title: 'Nombre de 1ʳᵉˢ places sur un jeu' }, '1ʳᵉˢ places')));
  ids.forEach((p, i) => t.append(el('tr', {},
    el('td', { class: 'v' }, ['🥇', '🥈', '🥉'][i] || i + 1), el('td', {}, dot(p), label(p), playerById(p)?.archived ? el('span', { class: 'pill', style: 'margin-left:6px' }, 'archivé') : null),
    el('td', { class: 'v' + (i === 0 ? ' win' : '') }, st[p].points),
    el('td', { class: 'v' }, (st[p].points / st[p].days).toFixed(1)),
    el('td', { class: 'v' }, st[p].dayWins), el('td', { class: 'v' }, `${Math.round(100 * st[p].dayWins / st[p].days)} %`),
    el('td', { class: 'v' }, st[p].days), el('td', { class: 'v' }, st[p].firsts))));
  top.append(el('div', { class: 'scroll' }, t));
  const ties = duel.filter(d => dayResult(d).dayWinner === 'tie').length;
  top.append(el('div', { class: 'hint' }, `${duel.length} jours en duel sur la période${ties ? `, dont ${ties} avec égalité en tête` : ''}. Série en cours : ${sU ? `${nameOf(sU)}, ${sN} journée${sN > 1 ? 's' : ''} gagnée${sN > 1 ? 's' : ''} d'affilée` : 'aucune'}. Classement aux points cumulés : jouer souvent compte, la moyenne par jour donne le niveau.`));

  renderChart(cbox, duel, ids.slice(0, 8));
  if (ids.length > 8) cbox.append(el('div', { class: 'hint' }, 'Graphique limité aux 8 premiers du classement.'));
  renderH2H(duel, ids);

  const dset = new Set(dates);
  const games = GAMES.filter(g => scores.some(s => dset.has(s.date) && s[g.id] != null));
  const sel = $('#gameSel'); sel.innerHTML = '';
  for (const g of games) sel.append(el('option', { value: g.id }, `${g.ic} ${g.name}`));
  if (!games.some(g => g.id === statGame)) statGame = games[0]?.id || null;
  sel.value = statGame || '';
  renderStatGame(dates);
}
function renderH2H(duel, ids) {
  const box = $('#h2h');
  if (ids.length < 2) return;
  const res = {}; // res[a][b] = [victoires de a contre b, défaites]
  for (const a of ids) { res[a] = {}; for (const b of ids) res[a][b] = [0, 0]; }
  for (const d of duel) {
    const r = dayResult(d);
    for (const a of r.ids) for (const b of r.ids) {
      if (a === b || !res[a] || !res[a][b]) continue;
      // uniquement les jeux joués par les deux ce jour-là
      let pa = 0, pb = 0;
      for (const g of GAMES) { const rk = r.ranks[g.id]; if (rk && rk[a] && rk[b]) { if (rk[a] < rk[b]) pa++; else if (rk[b] < rk[a]) pb++; } }
      if (pa > pb) res[a][b][0]++; else if (pb > pa) res[a][b][1]++;
    }
  }
  const t = el('table', { class: 'h2h' });
  t.append(el('tr', {}, el('th', {}, 'Contre →'), ...ids.map(b => el('th', {}, label(b)))));
  for (const a of ids) t.append(el('tr', {}, el('td', {}, dot(a), el('b', {}, label(a))), ...ids.map(b => {
    if (a === b) return el('td', { class: 'self' }, '—');
    const [w, l] = res[a][b];
    return el('td', { class: 'v' + (w > l ? ' lead' : ''), title: `${nameOf(a)} a battu ${nameOf(b)} ${w} fois, perdu ${l} fois` }, w + l ? `${w}–${l}` : '·');
  })));
  box.append(t, el('div', { class: 'hint' }, 'Journées gagnées – perdues de la ligne contre la colonne, en ne comparant que les jeux joués par les deux ce jour-là.'));
}
function renderStatGame(dates) {
  const box = $('#statsGame'); box.innerHTML = '';
  const g = GAMES.find(x => x.id === statGame); if (!g) return;
  const st = {};
  for (const d of dates) {
    const r = dayResult(d), w = r.perGame[g.id];
    for (const p of r.ids) {
      const v = r.docs[p]?.[g.id]; if (v == null) continue;
      const s = st[p] ||= { played: 0, duels: 0, wins: 0, fails: 0, vals: [] };
      s.played++; if (v === 'X') s.fails++; s.vals.push(v === 'X' ? (g.fail ?? g.max) : Number(v));
      if (w) s.duels++; if (isWin(w, p)) s.wins++;
    }
  }
  let streakU = null, streakN = 0;
  for (const d of allDates().reverse()) { const x = dayResult(d).perGame[g.id]; if (!x) continue; if (x === 'tie' || x.length > 1) break; if (!streakU) { streakU = x[0]; streakN = 1; } else if (x[0] === streakU) streakN++; else break; }
  const avgOf = s => s.vals.reduce((a, b) => a + b, 0) / s.vals.length;
  const ids = Object.keys(st).sort((a, b) => st[b].wins - st[a].wins || (g.lower ? 1 : -1) * (avgOf(st[a]) - avgOf(st[b])));
  const fmtAvg = s => { const m = avgOf(s); return !g.lower ? Math.round(m).toLocaleString('fr-FR') : m.toFixed(2); };
  const fmtRec = s => { const b = g.lower ? Math.min(...s.vals) : Math.max(...s.vals); return g.canFail && g.lower && b === g.fail ? 'X' : b.toLocaleString('fr-FR'); };
  const t = el('table');
  t.append(el('tr', {}, el('th', {}, 'Joueur'), el('th', {}, 'Parties'), el('th', { title: '1ʳᵉˢ places / parties comparées' }, 'Victoires'), el('th', {}, 'Moyenne'), el('th', {}, 'Record'), el('th', {}, 'Ratés')));
  ids.forEach((p, i) => { const s = st[p]; t.append(el('tr', {},
    el('td', {}, dot(p), label(p), streakU === p && streakN > 1 ? el('span', { class: 'pill', style: 'margin-left:6px' }, `série ${streakN}`) : null),
    el('td', { class: 'v' }, s.played), el('td', { class: 'v' + (i === 0 && s.wins > 0 ? ' win' : '') }, `${s.wins} / ${s.duels}`),
    el('td', { class: 'v' }, fmtAvg(s)), el('td', { class: 'v' }, fmtRec(s)), el('td', { class: 'v' }, g.canFail ? s.fails : '–'))); });
  box.append(t);
  box.append(el('div', { class: 'hint' }, `${g.sub}${g.lower ? ', plus bas = mieux' : ', plus haut = mieux'}. Moyenne : un raté compte comme le pire score.`));
}

function renderChart(box, duel, ids) {
  box.append(el('div', { class: 'legend', style: 'flex-wrap:wrap' }, ...ids.map(p => el('span', {}, dot(p), label(p)))));
  const cum = Object.fromEntries(ids.map(p => [p, []])); const run = Object.fromEntries(ids.map(p => [p, 0]));
  duel.forEach(d => { const r = dayResult(d); ids.forEach(p => { run[p] += r.points[p] || 0; cum[p].push(run[p]); }); });
  const W = 640, H = 240, L = 40, R = 104, T = 20, B = 26;
  const n = duel.length, yMax = Math.max(1, ...ids.map(p => run[p]));
  const x = i => n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1);
  const y = v => T + (H - T - B) * (1 - v / yMax);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Points cumulés : ' + ids.map(p => `${nameOf(p)} ${run[p]}`).join(', ') });
  const raw = yMax / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = Math.max(1, [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw));
  for (let v = 0; v <= yMax; v += step) {
    svg.append(sv('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--grid)', 'stroke-width': 1 }));
    const tx = sv('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 11, 'font-family': 'JetBrains Mono, monospace' }); tx.textContent = v; svg.append(tx);
  }
  const ticks = Math.min(n, 6);
  for (let k = 0; k < ticks; k++) {
    const i = ticks === 1 ? 0 : Math.round(k * (n - 1) / (ticks - 1));
    const tx = sv('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 }); tx.textContent = fmtShort(duel[i]); svg.append(tx);
  }
  for (const p of ids) {
    if (n > 1) svg.append(sv('polyline', { points: cum[p].map((v, i) => `${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: color(p), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    svg.append(sv('circle', { cx: x(n - 1), cy: y(cum[p][n - 1]), r: 4, fill: color(p), stroke: 'var(--panel)', 'stroke-width': 2 }));
  }
  const ends = ids.slice(0, 4).map(p => ({ p, v: cum[p][n - 1], yy: y(cum[p][n - 1]) })).sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;
  for (const e of ends) { const lb = sv('text', { x: x(n - 1) + 10, y: e.yy + 4, fill: 'var(--text)', 'font-size': 12 }); lb.textContent = `${nameOf(e.p)} ${e.v}`; svg.append(lb); }
  const cross = sv('line', { y1: T, y2: H - B, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
  const hv = ids.map(p => sv('circle', { r: 4, fill: color(p), stroke: 'var(--panel)', 'stroke-width': 2, visibility: 'hidden' }));
  svg.append(cross, ...hv);
  const hit = sv('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
  svg.append(hit);
  const tip = el('div', { class: 'tip' });
  box.append(svg, tip);
  const show = evt => {
    const rect = svg.getBoundingClientRect(); const sx = (evt.clientX - rect.left) * W / rect.width;
    const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((sx - L) / ((W - L - R) / (n - 1)))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    ids.forEach((p, k) => { hv[k].setAttribute('cx', x(i)); hv[k].setAttribute('cy', y(cum[p][i])); hv[k].setAttribute('visibility', 'visible'); });
    const r = dayResult(duel[i]);
    tip.innerHTML = '';
    tip.append(el('div', { style: 'color:var(--muted)' }, fmtDate(duel[i]), r.dayWinner && r.dayWinner !== 'tie' ? ` · 🏆 ${nameOf(r.dayWinner)}` : ' · égalité'),
      ...[...ids].sort((a, b) => cum[b][i] - cum[a][i]).map(p => el('div', {}, dot(p), `${nameOf(p)} `, el('b', {}, cum[p][i]), r.points[p] != null ? el('span', { style: 'color:var(--muted)' }, ` (+${r.points[p]})`) : null)));
    tip.style.display = 'block';
    const px = x(i) * rect.width / W; tip.style.left = Math.min(rect.width - tip.offsetWidth, Math.max(0, px - tip.offsetWidth / 2)) + 'px'; tip.style.top = '28px';
  };
  hit.addEventListener('mousemove', show); hit.addEventListener('touchstart', e => show(e.touches[0]), { passive: true });
  hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); hv.forEach(c => c.setAttribute('visibility', 'hidden')); });
}

// ================= Palmarès (semaines et mois, tout l'historique) =================
function championsBy(keyOf, fmtKey, limit) {
  const groups = {};
  for (const d of allDates()) { const r = dayResult(d); if (!r.compared) continue; const k = keyOf(d); const gp = groups[k] ||= {}; for (const p of r.ids) gp[p] = (gp[p] || 0) + r.points[p]; }
  return Object.keys(groups).sort().reverse().slice(0, limit).map(k => {
    const gp = groups[k], order = Object.keys(gp).sort((a, b) => gp[b] - gp[a]);
    const tie = order.length > 1 && gp[order[0]] === gp[order[1]];
    return { k, label: fmtKey(k), champ: order[0], pts: gp[order[0]], tie, second: order[1], secondPts: gp[order[1]] };
  });
}
function renderPalmares() {
  const box = $('#palmares'); box.innerHTML = '';
  const thisWeek = mondayOf(today()), thisMonth = today().slice(0, 7);
  const weeks = championsBy(mondayOf, k => k === thisWeek ? 'Cette semaine (en cours)' : `Semaine du ${fmtShort(k)}`, 8);
  const months = championsBy(d => d.slice(0, 7), k => { const s = parseIso(k + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); return (k === thisMonth ? `${s} (en cours)` : s).replace(/^./, c => c.toUpperCase()); }, 6);
  if (!weeks.length) { box.append(el('div', { class: 'empty' }, 'Pas encore de palmarès.')); return; }
  const col = (title, list) => el('div', {}, el('h3', {}, title), ...list.map(x => el('div', { class: 'line' },
    el('span', { class: 'when' }, x.label),
    el('span', {}, x.tie ? '🤝 ' : '🏆 ', dot(x.champ), el('b', {}, label(x.champ)), ` ${x.pts} pts`, x.tie ? ` = ${nameOf(x.second)}` : ''))));
  const titles = {};
  for (const x of weeks) if (x.k !== thisWeek && !x.tie) titles[x.champ] = (titles[x.champ] || 0) + 1;
  const tl = Object.entries(titles).sort((a, b) => b[1] - a[1]);
  box.append(el('div', { class: 'palm' }, col('Champions de la semaine', weeks), col('Champions du mois', months)));
  if (tl.length) box.append(el('div', { class: 'hint' }, 'Titres hebdo (semaines terminées affichées) : ' + tl.map(([p, n]) => `${label(p)} ×${n}`).join(' · ')));
}

// ================= Badges (tout l'historique) =================
function longestStreak(dates) {
  let best = 0, cur = 0, prev = null;
  for (const d of dates) { cur = prev && shiftDate(prev, 1) === d ? cur + 1 : 1; best = Math.max(best, cur); prev = d; }
  return best;
}
function renderBadges() {
  const box = $('#badges'); box.innerHTML = '';
  const byP = {};
  for (const s of scores) (byP[s.player] ||= []).push(s);
  const dayWins = {}, perfect = {};
  for (const d of allDates()) {
    const r = dayResult(d);
    if (r.dayWinner && r.dayWinner !== 'tie') dayWins[r.dayWinner] = (dayWins[r.dayWinner] || 0) + 1;
    if (r.compared >= 3) for (const p of r.ids) if (r.wins[p] === r.compared) perfect[p] = (perfect[p] || 0) + 1;
  }
  const has = id => GAMES.some(g => g.id === id);
  const count = (p, id, test) => (byP[p] || []).filter(s => s[id] != null && s[id] !== 'X' && test(Number(s[id]))).length;
  const DEFS = [
    { ic: '👑', name: 'Roi du jour', tip: 'Journées gagnées', n: p => dayWins[p] || 0 },
    { ic: '💯', name: 'Journée parfaite', tip: '1er sur tous les jeux comparés (3 jeux min.)', n: p => perfect[p] || 0 },
    { ic: '🔥', name: 'Série de 7 jours', tip: 'A posté 7 jours d\'affilée (record de série affiché)', n: p => { const s = longestStreak((byP[p] || []).map(x => x.date).sort()); return s >= 7 ? s : 0; }, fmt: n => `${n} j` },
    { ic: '🟩', name: 'Wordle en 2', tip: 'Wordle trouvé en 2 essais ou moins', game: 'wordle', n: p => count(p, 'wordle', v => v <= 2) },
    { ic: '📐', name: 'Angle du 1er coup', game: 'angle', tip: 'Angle trouvé au premier essai', n: p => count(p, 'angle', v => v === 1) },
    { ic: '🌍', name: 'Globle en 3', game: 'globle', tip: 'Globle trouvé en 3 essais ou moins', n: p => count(p, 'globle', v => v <= 3) },
    { ic: '⛏️', name: 'Crafteur', game: 'minecraftle', tip: 'Minecraftle en 3 essais ou moins', n: p => count(p, 'minecraftle', v => v <= 3) },
    { ic: '🦐', name: 'Abysses', game: 'krillion', tip: 'Krillion à 500 points ou plus', n: p => count(p, 'krillion', v => v >= 500) },
    { ic: '🎈', name: 'Stratosphère', game: 'noillirk', tip: 'Noillirk à 500 points ou plus', n: p => count(p, 'noillirk', v => v >= 500) },
    { ic: '👁️', name: 'Œil de lynx', game: 'perceptle', tip: 'Perceptle à 90 ou plus', n: p => count(p, 'perceptle', v => v >= 90) },
    { ic: '📏', name: 'Bon coup d\'œil', game: 'magnitudle', tip: 'Magnitudle à 450 ou plus', n: p => count(p, 'magnitudle', v => v >= 450) },
    { ic: '🕰️', name: 'Historien', game: 'eraly', tip: 'Eraly à 600 points ou plus', n: p => count(p, 'eraly', v => v >= 600) },
  ].filter(b => !b.game || has(b.game));
  const ids = activePlayers().map(p => p.id).filter(p => byP[p]);
  if (!ids.length) { box.append(el('div', { class: 'empty' }, 'Pas encore de badges.')); return; }
  const wrap = el('div', { class: 'badges' });
  for (const p of ids) {
    const got = DEFS.map(b => ({ b, n: b.n(p) })).filter(x => x.n > 0);
    wrap.append(el('div', { class: 'bp' }, el('div', { class: 'who' }, dot(p), label(p)),
      el('div', { class: 'chips' }, got.length ? got.map(({ b, n }) => el('span', { class: 'badge', title: b.tip }, `${b.ic} ${b.name}`, el('b', {}, b.fmt ? b.fmt(n) : `×${n}`))) : el('span', { class: 'hint', style: 'margin:0' }, 'Aucun pour l\'instant'))));
  }
  box.append(wrap, el('div', { class: 'hint' }, 'Survole un badge pour voir comment l\'obtenir. ' + DEFS.map(b => `${b.ic} ${b.tip.toLowerCase()}`).join(' · ') + '.'));
}

// ================= Réglages : joueurs =================
function renderPlayers() {
  const list = $('#plist'); list.innerHTML = '';
  for (const p of players) {
    const nScores = scores.filter(s => s.player === p.id).length;
    const nameBox = el('div', {}, el('b', {}, p.name), p.id === meId ? ' (toi)' : '', el('small', {}, `${nScores} jour${nScores > 1 ? 's' : ''} de scores${p.archived ? ' · archivé' : ''}`),
      el('div', { class: 'swatches' }, ...PALETTE.map((hex, i) => el('button', { class: colorIdx(p.id) === i ? 'on' : '', style: `background:${hex}`, title: 'Choisir cette couleur', 'aria-label': `Couleur ${i + 1}`, onclick: () => patchPlayer(p.id, { color: i }) }))));
    const rename = () => {
      const inp = el('input', { value: p.name, maxlength: 24, style: 'width:100%' });
      const ok = async () => { try { await api(`/api/players/${p.id}`, { method: 'PATCH', body: JSON.stringify({ name: inp.value }) }); await refresh(); } catch (e) { if (!(e instanceof Locked)) setStatus(e.message, 'err', '#pStatus'); } };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') renderPlayers(); });
      nameBox.replaceWith(el('div', { class: 'row', style: 'flex-wrap:nowrap' }, inp, el('button', { class: 'sm primary', onclick: ok }, 'OK')));
      inp.focus(); inp.select();
    };
    const emo = el('button', { class: 'emo-btn', title: 'Changer l\'emoji', 'aria-label': `Emoji de ${p.name}`, onclick: () => {
      const inp = el('input', { value: p.emoji || '', maxlength: 8, placeholder: '😀', style: 'width:52px;text-align:center;font-size:18px;padding:4px' });
      const ok = () => patchPlayer(p.id, { emoji: inp.value });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') renderPlayers(); });
      inp.addEventListener('blur', ok);
      emo.replaceWith(inp); inp.focus();
    } }, p.emoji || '＋');
    list.append(el('div', { class: 'gitem' + (p.archived ? ' off' : '') },
      el('div', { class: 'ic' }, emo), nameBox,
      el('div', { class: 'acts' },
        el('button', { class: 'sm', onclick: rename }, 'Renommer'),
        p.id !== meId ? el('button', { class: 'sm', onclick: () => patchPlayer(p.id, { archived: !p.archived }) }, p.archived ? 'Réactiver' : 'Archiver') : null,
        !nScores && p.id !== meId ? el('button', { class: 'sm', title: 'Supprimer', 'aria-label': `Supprimer ${p.name}`, onclick: () => deletePlayer(p.id) }, '✕') : null)));
  }
  if (notifyOn) list.append(el('div', { class: 'row', style: 'margin-top:8px' }, el('button', { class: 'sm', onclick: async () => { try { await api('/api/recap', { method: 'POST' }); toast('Récap envoyé ✓'); } catch (e) { toast(e.message, true); } } }, '📨 Envoyer le récap de la semaine maintenant')));
}
async function patchPlayer(id, body) { try { await api(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); await refresh(); } catch (e) { if (!(e instanceof Locked)) setStatus(e.message, 'err', '#pStatus'); } }
async function deletePlayer(id) { try { await api(`/api/players/${id}`, { method: 'DELETE' }); await refresh(); } catch (e) { if (!(e instanceof Locked)) setStatus(e.message, 'err', '#pStatus'); } }
async function addPlayer() {
  const name = $('#addName').value.trim(); if (!name) return setStatus('Donne un nom.', 'err', '#pStatus');
  try { await api('/api/players', { method: 'POST', body: JSON.stringify({ name }) }); $('#addName').value = ''; setStatus(`${name} ajouté ✓`, 'ok', '#pStatus'); await refresh(); }
  catch (e) { if (!(e instanceof Locked)) setStatus(e.message, 'err', '#pStatus'); }
}
$('#addBtn').addEventListener('click', addPlayer);
$('#addName').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });

// ================= Réglages : jeux =================
function renderGamesTab() {
  const list = $('#glist'); list.innerHTML = '';
  const cfg = gameConfig || DEFAULT_GAMES;
  cfg.forEach((stored, i) => {
    const g = resolveGame(stored); if (!g) return;
    list.append(el('div', { class: 'gitem' + (g.active ? '' : ' off') },
      el('div', { class: 'ic' }, g.ic),
      el('div', {}, el('b', {}, g.name), el('small', {}, `${g.sub}${g.timer ? ` · ⏱ ${g.timer}` : ''}${g.custom ? ' · perso' : ''}${g.active ? '' : ' · en pause'}`), g.desc ? el('small', { class: 'gdesc2' }, g.desc) : null),
      el('div', { class: 'acts' },
        el('button', { class: 'sm', title: 'Monter', 'aria-label': 'Monter', disabled: i === 0, onclick: () => moveGame(i, -1) }, '↑'),
        el('button', { class: 'sm', title: 'Descendre', 'aria-label': 'Descendre', disabled: i === cfg.length - 1, onclick: () => moveGame(i, 1) }, '↓'),
        el('button', { class: 'sm', onclick: () => toggleGame(i) }, g.active ? 'Pause' : 'Activer'),
        el('button', { class: 'sm', title: 'Retirer de la liste (les scores restent)', 'aria-label': 'Retirer', onclick: () => removeGame(i) }, '✕'))));
  });
  const cat = $('#catalog'); cat.innerHTML = '';
  const have = new Set(cfg.map(c => c.id));
  const rest = Object.entries(PRESETS).filter(([id]) => !have.has(id));
  if (!rest.length) cat.append(el('div', { class: 'empty' }, 'Tout le catalogue est déjà dans ta liste.'));
  for (const [id, p] of rest) cat.append(el('div', { class: 'cat' },
    el('div', { class: 'row', style: 'gap:8px;flex-wrap:nowrap;align-items:flex-start' }, el('span', { style: 'font-size:20px' }, p.ic),
      el('div', { class: 't' }, p.url ? el('a', { href: p.url, target: '_blank', rel: 'noopener', style: 'color:inherit' }, p.name) : p.name,
        el('small', {}, `${p.sub}${p.timer ? ` · ⏱ ${p.timer}` : ''}`), p.desc ? el('small', { class: 'gdesc2' }, p.desc) : null)),
    el('button', { class: 'sm', 'aria-label': `Ajouter ${p.name}`, onclick: () => addPreset(id) }, '+')));
}
let cfgQueue = Promise.resolve();
async function saveConfig(next) {
  await flushSave();
  gameConfig = next; setGames(); buildForm(); renderAll();
  cfgQueue = cfgQueue.then(() => api('/api/config', { method: 'PUT', body: JSON.stringify({ games: next }) }))
    .catch(e => toast(`Liste des jeux non enregistrée : ${e.message}`, true));
}
const cfgCopy = () => (gameConfig || DEFAULT_GAMES).map(c => ({ ...c }));
function moveGame(i, d) { const c = cfgCopy(); const [x] = c.splice(i, 1); c.splice(i + d, 0, x); saveConfig(c); }
function toggleGame(i) { const c = cfgCopy(); c[i].active = c[i].active === false; saveConfig(c); }
function removeGame(i) { const c = cfgCopy(); c.splice(i, 1); saveConfig(c); }
function addPreset(id) { const c = cfgCopy(); c.push({ id, active: true }); saveConfig(c); }
$('#cAdd').addEventListener('click', () => {
  const name = $('#cName').value.trim();
  if (!name) return setStatus('Donne un nom au jeu.', 'err', '#cStatus');
  let url = $('#cUrl').value.trim(); if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  const c = cfgCopy();
  c.push({ id: 'c_' + Date.now().toString(36), custom: true, active: true, name: name.slice(0, 30), ic: $('#cIc').value.trim().slice(0, 4) || '🎲', url,
    keyword: $('#cKw').value.trim() || name, kind: $('#cKind').value, max: Math.max(1, Math.round(+$('#cMax').value || 10)),
    lower: $('#cLower').checked, canFail: $('#cFail').checked, desc: $('#cDesc').value.trim().slice(0, 300), timer: $('#cTimer').value.trim().slice(0, 40) });
  saveConfig(c);
  ['#cName', '#cIc', '#cUrl', '#cKw', '#cDesc', '#cTimer'].forEach(s => $(s).value = '');
  setStatus(`${name} ajouté ✓`, 'ok', '#cStatus');
});

// ================= Export / import =================
function toCsv() {
  const games = GAMES.filter(g => scores.some(s => s[g.id] != null));
  const lines = [['date', 'joueur', ...games.map(g => g.name), 'points', 'premieres_places', 'vainqueur_du_jour'].join(';')];
  for (const d of allDates()) {
    const r = dayResult(d);
    for (const p of r.ids) lines.push([d, nameOf(p), ...games.map(g => r.docs[p][g.id] ?? ''), r.points[p], r.wins[p], r.dayWinner === 'tie' ? 'égalité' : r.dayWinner ? nameOf(r.dayWinner) : ''].join(';'));
  }
  return lines.join('\n');
}
$('#copyCsv').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(toCsv()); toast('CSV copié ✓'); } catch { toast('Copie refusée par le navigateur', true); }
});
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const r = await api('/api/import', { method: 'POST', body: JSON.stringify(data) });
    setStatus(`${r.imported} fiches importées ✓${r.createdPlayers.length ? ` · joueurs créés : ${r.createdPlayers.join(', ')}` : ''}`, 'ok', '#ioStatus'); await refresh();
  } catch (err) { if (!(err instanceof Locked)) setStatus(`Import impossible : ${err.message}`, 'err', '#ioStatus'); }
  e.target.value = '';
});

// ================= Installation PWA =================
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installWrap').classList.remove('hidden'); });
$('#installBtn').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installWrap').classList.add('hidden'); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });

// ================= Global =================
function showBanner(msg) { const b = $('#banner'); b.textContent = msg; b.classList.toggle('hidden', !msg); }
function renderAll() {
  cache.clear(); showBanner('');
  $('#meName').textContent = label(meId);
  renderHead(); renderDuel(); renderHistory(); renderPlayers(); renderGamesTab();
  if (!$('#tab-stats').classList.contains('hidden')) renderStats();
}

boot();
