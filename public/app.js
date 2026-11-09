import { PRESETS, DEFAULT_GAMES, resolveGame, parseShare, dayResult as computeDay } from './games.js';

// ================= Utils =================
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const shiftDate = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoDate(new Date(y, m - 1, d + n)); };
const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }); };
const fmtShort = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); };
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
let toastT;
function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', err); t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 4000); }

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts, headers: { ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  let data = null; try { data = await res.json(); } catch { }
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Non connecté'); }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Erreur ${res.status}`), { status: res.status, data });
  return data;
}

// ================= État =================
let me = null, PLAYERS = [], PIDS = [];
const COLORS = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)'];
const color = id => COLORS[Math.max(0, PIDS.indexOf(id))];
const nameOf = id => PLAYERS.find(p => p.id === id)?.name || id;
let scores = [], gameConfig = null, GAMES = [];
let selDate = today(), dirty = false, loaded = false, period = '30';

const setGames = () => { GAMES = (gameConfig || DEFAULT_GAMES).map(resolveGame).filter(Boolean); };
const activeGames = () => GAMES.filter(g => g.active);
const docOf = (date, p) => scores.find(s => s.date === date && s.player === p);
const allDates = () => [...new Set(scores.map(s => s.date))].sort();
const cache = new Map();
function dayResult(date) {
  if (cache.has(date)) return cache.get(date);
  const docs = {}; for (const p of PIDS) { const d = docOf(date, p); if (d) docs[p] = d; }
  const r = computeDay(GAMES, PIDS, docs); cache.set(date, r); return r;
}
const isWin = (w, p) => Array.isArray(w) && w.includes(p);
const dot = p => el('span', { class: 'dot', style: `background:${color(p)}` });

// ================= Connexion =================
let loginPlayer = null;
async function showLogin() {
  $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden');
  try {
    const { players } = await api('/api/players');
    const box = $('#who'); box.innerHTML = '';
    players.forEach((p, i) => box.append(el('button', { class: i === 0 && !loginPlayer ? 'on' : (loginPlayer === p.id ? 'on' : ''), onclick: e => { loginPlayer = p.id; box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget)); $('#pin').focus(); } }, p.name)));
    if (!loginPlayer) loginPlayer = players[0]?.id;
  } catch { }
}
async function doLogin() {
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ player: loginPlayer, pin: $('#pin').value }) });
    $('#pin').value = ''; $('#loginStatus').textContent = '';
    await boot();
  } catch (e) { $('#loginStatus').textContent = e.message; $('#loginStatus').classList.add('err'); }
}
$('#loginBtn').addEventListener('click', doLogin);
$('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('#logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); } catch { } es?.close(); showLogin(); });

// ================= Chargement & temps réel =================
let es = null;
async function loadState() {
  const s = await api('/api/state');
  me = s.me; PLAYERS = s.players; PIDS = PLAYERS.map(p => p.id);
  gameConfig = s.games; scores = s.scores.filter(x => PIDS.includes(x.player));
  loaded = true;
}
function connectEvents() {
  es?.close();
  es = new EventSource('/api/events');
  let t;
  es.onopen = () => { $('#live').classList.add('on'); $('#liveTxt').textContent = 'en direct'; };
  es.onerror = () => { $('#live').classList.remove('on'); $('#liveTxt').textContent = 'reconnexion…'; };
  es.onmessage = () => { clearTimeout(t); t = setTimeout(refresh, 200); };
}
async function refresh() {
  try {
    const keep = dirty ? snapshotForm() : null;
    await loadState(); setGames(); buildForm(keep); renderAll();
  } catch (e) { if (e.message !== 'Non connecté') showBanner('Connexion au serveur perdue, nouvel essai…'); }
}
async function boot() {
  try { await loadState(); } catch (e) { if (e.message !== 'Non connecté') showBanner('Serveur injoignable.'); return; }
  $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  $('#meName').textContent = me.name;
  $('#apiUrl').textContent = location.origin + '/api/text';
  api('/api/token').then(d => { $('#apiToken').textContent = 'Bearer ' + d.token; }).catch(() => { });
  setGames(); buildPastes(); buildForm(); $('#date').value = selDate; renderAll();
  connectEvents();
  await handleShareTarget();
}
// Au retour sur l'app (PWA restée ouverte), on resynchronise
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && me) refresh(); });

// Partage Android (Web Share Target) : l'app s'ouvre sur /?text=…
async function handleShareTarget() {
  const u = new URL(location.href);
  const text = ['title', 'text', 'url'].map(k => u.searchParams.get(k)).filter(Boolean).join('\n');
  if (!text) return;
  history.replaceState(null, '', '/');
  try {
    const r = await api('/api/text', { method: 'POST', body: JSON.stringify({ text, player: me.id }) });
    toast(r.message);
    await refresh();
  } catch (e) {
    toast(e.message + ' Colle-le à la main.', true);
    const ta = document.querySelector(`[data-paste="${me.id}"]`); if (ta) { ta.value = text; ta.dispatchEvent(new Event('input')); }
  }
}

// ================= Saisie =================
let inputs = {};
function buildPastes() {
  const box = $('#pastes'); box.innerHTML = '';
  box.style.gridTemplateColumns = PLAYERS.length > 2 ? 'repeat(auto-fit,minmax(200px,1fr))' : '';
  const ordered = [me.id, ...PIDS.filter(p => p !== me.id)];
  for (const p of ordered) {
    const ta = el('textarea', { 'data-paste': p, placeholder: "Colle tout d'un coup, ça se remplit tout seul" });
    ta.addEventListener('input', () => onPaste(p, ta.value));
    box.append(el('div', {}, el('label', {}, dot(p), `Partages de ${nameOf(p)}${p === me.id ? ' (toi)' : ''}`), ta));
  }
}
function snapshotForm() { const o = {}; for (const p of PIDS) o[p] = readForm(p); return o; }
function buildForm(keep = null) {
  const t = $('#entry'); t.innerHTML = '';
  inputs = Object.fromEntries(PIDS.map(p => [p, {}]));
  t.append(el('tr', {}, el('th', {}, 'Jeu'), ...PIDS.map(p => el('th', {}, dot(p), nameOf(p)))));
  for (const g of activeGames()) {
    const cells = PIDS.map(p => {
      const n = el('input', { type: 'number', min: g.min, max: g.max, inputmode: 'numeric', placeholder: '–', 'aria-label': `${g.name} ${nameOf(p)}` });
      const f = el('input', { type: 'checkbox' });
      n.addEventListener('input', () => { dirty = true; n.classList.remove('auto'); if (n.value) f.checked = false; });
      f.addEventListener('change', () => { dirty = true; if (f.checked) n.value = ''; n.disabled = f.checked; });
      inputs[p][g.id] = { num: n, fail: f };
      return el('td', {}, el('div', { class: 'cell' }, n, g.canFail ? el('label', { title: 'Raté' }, f, el('span', {}, 'Raté')) : null));
    });
    t.append(el('tr', {}, el('td', { class: 'gname' }, `${g.ic} `, g.url ? el('a', { href: g.url, target: '_blank', rel: 'noopener' }, g.name) : g.name, el('small', {}, g.sub)), ...cells));
  }
  if (!activeGames().length) t.append(el('tr', {}, el('td', { colspan: PIDS.length + 1, class: 'empty' }, 'Aucun jeu actif — va dans Réglages.')));
  if (keep) { for (const p of PIDS) setInputs(p, keep[p]); dirty = true; } else fillForm();
}
function setInputs(p, vals) {
  for (const g of activeGames()) {
    const inp = inputs[p]?.[g.id]; if (!inp) continue;
    const v = vals ? vals[g.id] : null;
    inp.num.classList.remove('auto');
    inp.fail.checked = v === 'X'; inp.num.disabled = v === 'X';
    inp.num.value = (v == null || v === 'X') ? '' : v;
  }
}
function fillForm() {
  for (const p of PIDS) setInputs(p, docOf(selDate, p));
  document.querySelectorAll('[data-paste]').forEach(t => t.value = '');
  dirty = false;
}
function readForm(p) {
  const out = {};
  for (const g of activeGames()) {
    const inp = inputs[p]?.[g.id]; if (!inp) continue;
    if (g.canFail && inp.fail.checked) { out[g.id] = 'X'; continue; }
    if (inp.num.value === '') { out[g.id] = null; continue; }
    const n = Math.round(Number(inp.num.value));
    out[g.id] = isFinite(n) ? Math.max(g.min, Math.min(g.max, n)) : null;
  }
  return out;
}
function onPaste(p, text) {
  const found = parseShare(text, activeGames());
  for (const [id, v] of Object.entries(found)) {
    const inp = inputs[p][id]; if (!inp) continue;
    if (v === 'X') { inp.fail.checked = true; inp.num.value = ''; inp.num.disabled = true; }
    else { inp.fail.checked = false; inp.num.disabled = false; inp.num.value = v; inp.num.classList.add('auto'); }
    dirty = true;
  }
  const names = Object.keys(found).map(id => GAMES.find(g => g.id === id).name);
  setStatus(names.length ? `${nameOf(p)} : ${names.join(', ')} détecté — vérifie et enregistre.` : (text.trim() ? 'Rien reconnu, remplis à la main.' : ''));
}
function setStatus(msg, err = false, id = '#status') { const s = $(id); s.textContent = msg; s.classList.toggle('err', err); }

$('#save').addEventListener('click', async () => {
  const btn = $('#save'); btn.disabled = true; setStatus('Enregistrement…');
  try {
    for (const p of PIDS) {
      const prev = docOf(selDate, p) || {};
      const next = {}; for (const [k, v] of Object.entries(prev)) if (k !== 'date' && k !== 'player') next[k] = v;
      Object.assign(next, readForm(p)); // les jeux en pause gardent leur score
      const changed = Object.keys({ ...prev, ...next }).some(k => k !== 'date' && k !== 'player' && (prev[k] ?? null) !== (next[k] ?? null));
      if (!changed) continue;
      await api(`/api/scores/${selDate}/${p}`, { method: 'PUT', body: JSON.stringify({ values: next }) });
    }
    dirty = false; setStatus('Enregistré ✓'); await refresh();
  } catch (e) { setStatus(`Échec : ${e.message}`, true); }
  finally { btn.disabled = false; }
});

function setDate(d) { selDate = d; $('#date').value = d; fillForm(); setStatus(''); renderDuel(); }
$('#date').addEventListener('change', e => e.target.value && setDate(e.target.value));
$('#prevDay').addEventListener('click', () => setDate(shiftDate(selDate, -1)));
$('#nextDay').addEventListener('click', () => setDate(shiftDate(selDate, 1)));
$('#todayBtn').addEventListener('click', () => setDate(today()));

// ================= Onglets =================
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
  for (const t of ['today', 'history', 'stats', 'settings']) $('#tab-' + t).classList.toggle('hidden', t !== name);
  if (name === 'stats') renderStats();
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.querySelectorAll('#period button').forEach(b => b.addEventListener('click', () => {
  period = b.dataset.p; document.querySelectorAll('#period button').forEach(x => x.classList.toggle('on', x === b)); renderStats();
}));

// ================= Rendu : jour =================
const fmtV = v => v == null || v === '' ? '–' : String(v);
const winLabel = w => w === 'tie' ? 'égalité' : nameOf(w);
function renderHead() {
  const box = $('#headScore'); box.innerHTML = '';
  const c = Object.fromEntries(PIDS.map(p => [p, 0]));
  for (const d of allDates()) { const w = dayResult(d).dayWinner; if (w && w !== 'tie') c[w]++; }
  if (!Object.values(c).some(Boolean)) return;
  PIDS.forEach(p => box.append(el('span', { class: 'pill' }, dot(p), `${nameOf(p)} ${c[p]}`)));
}
function renderDuel() {
  const box = $('#duel'); box.innerHTML = '';
  $('#duelTitle').textContent = selDate === today() ? "Le duel d'aujourd'hui" : `Le duel — ${fmtDate(selDate)}`;
  const r = dayResult(selDate);
  if (!Object.keys(r.docs).length) { box.append(el('div', { class: 'empty' }, 'Aucun score ce jour-là.')); return; }
  const big = el('div', { class: 'score-big' });
  PIDS.forEach((p, i) => {
    if (i) big.append(el('div', { class: 'vs' }, '–'));
    big.append(el('div', { class: 'pl' }, el('div', { class: 'n' }, dot(p), nameOf(p)), el('div', { class: 'v' }, r.docs[p] ? r.wins[p] : '…')));
  });
  box.append(big);
  const missing = PIDS.filter(p => !r.docs[p]);
  const msg = missing.length ? el('span', { class: 'pill' }, `En attente de ${missing.map(nameOf).join(', ')}…`)
    : r.dayWinner === 'tie' ? el('span', { class: 'pill' }, 'Égalité') : r.dayWinner ? el('span', { class: 'pill w' }, `🏆 ${nameOf(r.dayWinner)} gagne la journée`) : el('span', { class: 'pill' }, 'Aucun jeu en commun');
  box.append(el('div', { style: 'text-align:center;margin-bottom:12px' }, msg));
  const t = el('table');
  t.append(el('tr', {}, el('th', {}, 'Jeu'), ...PIDS.map(p => el('th', {}, nameOf(p)))));
  for (const g of GAMES.filter(g => g.active || PIDS.some(p => r.docs[p]?.[g.id] != null))) {
    const w = r.perGame[g.id];
    t.append(el('tr', {}, el('td', {}, `${g.ic} ${g.name}`), ...PIDS.map(p => {
      const v = r.docs[p]?.[g.id];
      return el('td', { class: ['v', isWin(w, p) ? 'win' : '', v === 'X' ? 'x' : ''].join(' ') }, fmtV(v));
    })));
  }
  box.append(t);
}

// ================= Rendu : historique =================
function renderHistory() {
  const box = $('#history'); box.innerHTML = '';
  const dates = allDates().reverse();
  if (!dates.length) { box.append(el('div', { class: 'empty' }, 'Rien encore. Rentrez vos premiers scores !')); return; }
  const games = GAMES.filter(g => scores.some(s => s[g.id] != null));
  const t = el('table');
  t.append(el('tr', {}, el('th', {}, 'Jour'), el('th', {}, 'Score'), ...games.map(g => el('th', { title: g.name }, g.ic)), el('th', {}, 'Vainqueur')));
  for (const d of dates) {
    const r = dayResult(d);
    t.append(el('tr', { class: 'clickrow', title: 'Ouvrir ce jour', onclick: () => { showTab('today'); setDate(d); scrollTo(0, 0); } },
      el('td', {}, fmtDate(d)),
      el('td', { class: 'v' }, r.compared ? PIDS.map(p => r.docs[p] ? r.wins[p] : '·').join('–') : '–'),
      ...games.map(g => { const w = r.perGame[g.id]; return el('td', { style: 'font-size:12px;white-space:nowrap' }, Array.isArray(w) ? w.map(p => el('span', { class: 'dot', style: `background:${color(p)};margin:0 1px`, title: nameOf(p) })) : w === 'tie' ? '=' : ''); }),
      el('td', {}, r.dayWinner && r.dayWinner !== 'tie' ? el('span', { class: 'pill w' }, nameOf(r.dayWinner)) : el('span', { class: 'pill' }, r.dayWinner === 'tie' ? 'égalité' : 'incomplet'))));
  }
  box.append(t);
  box.append(el('div', { class: 'hint' }, 'Pastille = qui a gagné le jeu, « = » = égalité. Clique sur un jour pour le corriger.'));
}

// ================= Rendu : stats =================
function periodDates() {
  const ds = allDates(); if (period === 'all') return ds;
  const from = shiftDate(today(), -(+period - 1)); return ds.filter(d => d >= from);
}
function renderStats() {
  const top = $('#statsTop'), gbox = $('#statsGames'), cbox = $('#chart');
  top.innerHTML = ''; gbox.innerHTML = ''; cbox.innerHTML = '';
  const dates = periodDates();
  const duel = dates.filter(d => dayResult(d).compared > 0);
  if (!duel.length) { top.append(el('div', { class: 'empty' }, 'Pas encore de journée en duel sur cette période.')); return; }
  const dw = Object.fromEntries([...PIDS, 'tie'].map(k => [k, 0]));
  duel.forEach(d => dw[dayResult(d).dayWinner]++);
  let sU = null, sN = 0;
  for (const d of allDates().reverse()) { const r = dayResult(d); if (!r.compared) continue; if (r.dayWinner === 'tie') break; if (!sU) { sU = r.dayWinner; sN = 1; } else if (r.dayWinner === sU) sN++; else break; }

  const grid = el('div', { class: 'stats-grid' });
  for (const p of PIDS) grid.append(el('div', { class: 'stat' }, el('div', { class: 'k' }, dot(p), `Journées — ${nameOf(p)}`), el('div', { class: 'val' }, dw[p]), el('div', { class: 'k' }, `${Math.round(100 * dw[p] / duel.length)} % des duels`)));
  grid.append(el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Égalités'), el('div', { class: 'val' }, dw.tie), el('div', { class: 'k' }, `sur ${duel.length} jours en duel`)));
  grid.append(el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Série en cours'), el('div', { class: 'val' }, sU ? sN : '–'), el('div', { class: 'k' }, sU ? `${nameOf(sU)} enchaîne` : 'aucune')));
  top.append(grid);
  top.append(el('div', { class: 'bar2' }, ...PIDS.map(p => dw[p] ? el('div', { style: `flex:${dw[p]};background:${color(p)}`, title: `${nameOf(p)} ${dw[p]}` }) : null),
    dw.tie ? el('div', { style: `flex:${dw.tie};background:var(--line)`, title: `égalités ${dw.tie}` }) : null));

  renderChart(cbox, duel);

  const t = el('table');
  t.append(el('tr', {}, el('th', {}, 'Jeu'), el('th', { title: 'Jours où il a été joué par au moins deux joueurs' }, 'Duels'),
    ...PIDS.map(p => el('th', {}, nameOf(p))), el('th', {}, '='),
    ...PIDS.map(p => el('th', {}, `Moy. ${nameOf(p)}`)), ...PIDS.map(p => el('th', {}, `Record ${nameOf(p)}`)), el('th', {}, 'Série')));
  const dset = new Set(dates);
  for (const g of GAMES.filter(g => scores.some(s => dset.has(s.date) && s[g.id] != null))) {
    let duels = 0, ties = 0; const w = Object.fromEntries(PIDS.map(p => [p, 0]));
    const vals = Object.fromEntries(PIDS.map(p => [p, []])), fails = Object.fromEntries(PIDS.map(p => [p, 0]));
    for (const d of dates) {
      const r = dayResult(d), x = r.perGame[g.id];
      if (x) duels++; if (x === 'tie') ties++; if (Array.isArray(x)) x.forEach(p => w[p]++);
      for (const p of PIDS) { const v = r.docs[p]?.[g.id]; if (v == null) continue; if (v === 'X') fails[p]++; vals[p].push(v === 'X' ? (g.fail ?? g.max) : Number(v)); }
    }
    let gs = null, gn = 0;
    for (const d of allDates().reverse()) { const x = dayResult(d).perGame[g.id]; if (!x) continue; if (x === 'tie' || x.length > 1) break; if (!gs) { gs = x[0]; gn = 1; } else if (x[0] === gs) gn++; else break; }
    const avg = p => { const a = vals[p]; if (!a.length) return '–'; const m = a.reduce((s, v) => s + v, 0) / a.length; return (!g.lower ? Math.round(m).toLocaleString('fr-FR') : m.toFixed(2)) + (fails[p] ? ` (${fails[p]}✗)` : ''); };
    const rec = p => { const a = vals[p]; if (!a.length) return '–'; const b = g.lower ? Math.min(...a) : Math.max(...a); return g.canFail && g.lower && b === g.fail ? 'X' : b.toLocaleString('fr-FR'); };
    const mx = Math.max(...PIDS.map(p => w[p])), lead = PIDS.filter(p => w[p] === mx);
    t.append(el('tr', {}, el('td', {}, `${g.ic} ${g.name}`, g.active ? null : el('span', { class: 'pill', style: 'margin-left:6px' }, 'pause')),
      el('td', { class: 'v' }, duels),
      ...PIDS.map(p => el('td', { class: 'v' + (mx > 0 && lead.length === 1 && lead[0] === p ? ' win' : '') }, w[p])),
      el('td', { class: 'v' }, ties),
      ...PIDS.map(p => el('td', { class: 'v' }, avg(p))), ...PIDS.map(p => el('td', { class: 'v' }, rec(p))),
      el('td', {}, gs ? el('span', {}, dot(gs), gn) : '–')));
  }
  gbox.append(t);
  gbox.append(el('div', { class: 'hint' }, 'Victoires et égalités : seulement les jours où le jeu a été joué par au moins deux joueurs. Moyennes : un raté compte comme le pire score.'));
}

function renderChart(box, duel) {
  box.append(el('div', { class: 'legend' }, ...PIDS.map(p => el('span', {}, dot(p), nameOf(p)))));
  const cum = Object.fromEntries(PIDS.map(p => [p, []])); const run = Object.fromEntries(PIDS.map(p => [p, 0]));
  duel.forEach(d => { const w = dayResult(d).dayWinner; if (w && w !== 'tie') run[w]++; PIDS.forEach(p => cum[p].push(run[p])); });
  const W = 640, H = 230, L = 34, R = 64, T = 20, B = 26;
  const n = duel.length, yMax = Math.max(1, ...PIDS.map(p => run[p]));
  const x = i => n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1);
  const y = v => T + (H - T - B) * (1 - v / yMax);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Cumul des journées gagnées : ' + PIDS.map(p => `${nameOf(p)} ${run[p]}`).join(', ') });
  const step = Math.max(1, Math.ceil(yMax / 4));
  for (let v = 0; v <= yMax; v += step) {
    svg.append(sv('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--grid)', 'stroke-width': 1 }));
    const tx = sv('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 11, 'font-family': 'JetBrains Mono, monospace' }); tx.textContent = v; svg.append(tx);
  }
  const ticks = Math.min(n, 6);
  for (let k = 0; k < ticks; k++) {
    const i = ticks === 1 ? 0 : Math.round(k * (n - 1) / (ticks - 1));
    const tx = sv('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 }); tx.textContent = fmtShort(duel[i]); svg.append(tx);
  }
  // étiquettes de fin, décalées si elles se chevauchent
  const ends = PIDS.map(p => ({ p, v: cum[p][n - 1], yy: y(cum[p][n - 1]) })).sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;
  for (const p of PIDS) {
    if (n > 1) svg.append(sv('polyline', { points: cum[p].map((v, i) => `${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: color(p), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    svg.append(sv('circle', { cx: x(n - 1), cy: y(cum[p][n - 1]), r: 4, fill: color(p), stroke: 'var(--panel)', 'stroke-width': 2 }));
  }
  for (const e of ends) { const lb = sv('text', { x: x(n - 1) + 10, y: e.yy + 4, fill: 'var(--text)', 'font-size': 12 }); lb.textContent = `${nameOf(e.p)} ${e.v}`; svg.append(lb); }
  const cross = sv('line', { y1: T, y2: H - B, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
  const hv = PIDS.map(p => sv('circle', { r: 4, fill: color(p), stroke: 'var(--panel)', 'stroke-width': 2, visibility: 'hidden' }));
  svg.append(cross, ...hv);
  const hit = sv('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
  svg.append(hit);
  const tip = el('div', { class: 'tip' });
  box.append(svg, tip);
  const show = evt => {
    const rect = svg.getBoundingClientRect(); const sx = (evt.clientX - rect.left) * W / rect.width;
    const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((sx - L) / ((W - L - R) / (n - 1)))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    PIDS.forEach((p, k) => { hv[k].setAttribute('cx', x(i)); hv[k].setAttribute('cy', y(cum[p][i])); hv[k].setAttribute('visibility', 'visible'); });
    const r = dayResult(duel[i]);
    tip.innerHTML = '';
    tip.append(el('div', { style: 'color:var(--muted)' }, fmtDate(duel[i]), ` · ${PIDS.map(p => r.docs[p] ? r.wins[p] : '·').join('–')}`),
      ...PIDS.map(p => el('div', {}, dot(p), `${nameOf(p)} `, el('b', {}, cum[p][i]))));
    tip.style.display = 'block';
    const px = x(i) * rect.width / W; tip.style.left = Math.min(rect.width - tip.offsetWidth, Math.max(0, px - tip.offsetWidth / 2)) + 'px'; tip.style.top = '28px';
  };
  hit.addEventListener('mousemove', show); hit.addEventListener('touchstart', e => show(e.touches[0]), { passive: true });
  hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); hv.forEach(c => c.setAttribute('visibility', 'hidden')); });
}

// ================= Réglages : jeux =================
function renderGamesTab() {
  const list = $('#glist'); list.innerHTML = '';
  const cfg = gameConfig || DEFAULT_GAMES;
  cfg.forEach((stored, i) => {
    const g = resolveGame(stored); if (!g) return;
    list.append(el('div', { class: 'gitem' + (g.active ? '' : ' off') },
      el('div', { class: 'ic' }, g.ic),
      el('div', {}, el('b', {}, g.name), el('small', {}, `${g.sub}${g.custom ? ' · perso' : ''}${g.active ? '' : ' · en pause'}`)),
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
    el('div', { class: 'row', style: 'gap:8px' }, el('span', { style: 'font-size:20px' }, p.ic), el('div', { class: 't' }, p.name, el('small', {}, p.sub))),
    el('button', { class: 'sm', 'aria-label': `Ajouter ${p.name}`, onclick: () => addPreset(id) }, '+')));
}
let cfgQueue = Promise.resolve();
function saveConfig(next) {
  const keep = dirty ? snapshotForm() : null;
  gameConfig = next; setGames(); buildForm(keep); renderAll();
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
  if (!name) return setStatus('Donne un nom au jeu.', true, '#cStatus');
  let url = $('#cUrl').value.trim(); if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  const c = cfgCopy();
  c.push({ id: 'c_' + Date.now().toString(36), custom: true, active: true, name: name.slice(0, 30), ic: $('#cIc').value.trim().slice(0, 4) || '🎲', url,
    keyword: $('#cKw').value.trim() || name, kind: $('#cKind').value, max: Math.max(1, Math.round(+$('#cMax').value || 10)),
    lower: $('#cLower').checked, canFail: $('#cFail').checked });
  saveConfig(c);
  ['#cName', '#cIc', '#cUrl', '#cKw'].forEach(s => $(s).value = '');
  setStatus(`${name} ajouté ✓`, false, '#cStatus');
});

// ================= Export / import =================
function toCsv() {
  const games = GAMES.filter(g => scores.some(s => s[g.id] != null));
  const lines = [['date', 'joueur', ...games.map(g => g.name), 'jeux_gagnes', 'vainqueur_du_jour'].join(';')];
  for (const d of allDates()) {
    const r = dayResult(d);
    for (const p of PIDS) { const doc = r.docs[p]; if (!doc) continue; lines.push([d, nameOf(p), ...games.map(g => doc[g.id] ?? ''), r.wins[p], r.dayWinner ? winLabel(r.dayWinner) : ''].join(';')); }
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
    setStatus(`${r.imported} fiches importées ✓`, false, '#ioStatus'); await refresh();
  } catch (err) { setStatus(`Import impossible : ${err.message}`, true, '#ioStatus'); }
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
  renderHead(); renderDuel(); renderHistory(); renderGamesTab();
  if (!$('#tab-stats').classList.contains('hidden')) renderStats();
}

boot();
