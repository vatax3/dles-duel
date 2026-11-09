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
let players = [], meId = store.get('dd_me'), accessCode = false;
let scores = [], gameConfig = null, GAMES = [];
let selDate = today(), forId = null, period = '30', statGame = null;
const drafts = {};   // saisies non enregistrées, par joueur
let dirty = false;

const playerById = id => players.find(p => p.id === id);
const nameOf = id => playerById(id)?.name || id;
const activePlayers = () => players.filter(p => !p.archived);
const color = id => { const p = playerById(id); return p && p.slot < 8 ? `var(--c${p.slot + 1})` : 'var(--cx)'; };
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
    for (const p of activePlayers()) box.append(el('button', { class: 'chip', onclick: () => chooseMe(p.id) }, dot(p.id), p.name));
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
  players = s.players; gameConfig = s.games; scores = s.scores; accessCode = s.accessCode;
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
async function refresh() {
  try {
    if (dirty) drafts[forId] = readForm();
    await loadState();
    if (meId && !playerById(meId)) { store.set('dd_me', null); meId = null; return showGate('who'); }
    if (!playerById(forId) || playerById(forId).archived) forId = meId;
    buildForPicker(); buildForm(); renderAll();
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
  $('#meName').textContent = nameOf(meId);
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

// ================= Saisie (un joueur à la fois) =================
let inputs = {};
function buildForPicker() {
  const box = $('#forChips'); box.innerHTML = '';
  box.append(el('span', { class: 'hint', style: 'margin:0 4px 0 0' }, 'Pour :'));
  const ordered = [playerById(meId), ...activePlayers().filter(p => p.id !== meId)].filter(Boolean);
  for (const p of ordered) {
    const has = !!docOf(selDate, p.id), draft = !!drafts[p.id];
    box.append(el('button', { class: 'chip' + (p.id === forId ? ' on' : ''), title: has ? 'Scores déjà saisis' : null, onclick: () => switchFor(p.id) },
      dot(p.id), p.id === meId ? `${p.name} (toi)` : p.name, has ? ' ✓' : '', draft ? ' •' : ''));
  }
}
function switchFor(id) {
  if (id === forId) return;
  if (dirty) drafts[forId] = readForm();
  forId = id; buildForPicker(); buildForm(); $('#paste').value = ''; setStatus('');
}
function buildForm() {
  const box = $('#entry'); box.innerHTML = ''; inputs = {};
  for (const g of activeGames()) {
    const n = el('input', { type: 'number', min: g.min, max: g.max, inputmode: 'numeric', placeholder: '–', 'aria-label': g.name });
    const f = el('input', { type: 'checkbox' });
    n.addEventListener('input', () => { dirty = true; n.classList.remove('auto'); if (n.value) f.checked = false; });
    f.addEventListener('change', () => { dirty = true; if (f.checked) n.value = ''; n.disabled = f.checked; });
    inputs[g.id] = { num: n, fail: f };
    box.append(el('div', { class: 'erow' },
      el('div', { class: 'gname' }, `${g.ic} `, g.url ? el('a', { href: g.url, target: '_blank', rel: 'noopener' }, g.name) : g.name, el('small', {}, g.sub)),
      el('div', { class: 'cell' }, n, g.canFail ? el('label', { title: 'Raté' }, f, el('span', {}, 'Raté')) : null)));
  }
  if (!activeGames().length) box.append(el('div', { class: 'empty' }, 'Aucun jeu actif — va dans Réglages.'));
  if (drafts[forId]) { setInputs(drafts[forId]); dirty = true; } else { setInputs(docOf(selDate, forId)); dirty = false; }
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
    dirty = true;
  }
  const names = Object.keys(found).map(id => GAMES.find(g => g.id === id).name);
  setStatus(names.length ? `${nameOf(forId)} : ${names.join(', ')} détecté — vérifie et enregistre.` : (text.trim() ? 'Rien reconnu, remplis à la main.' : ''));
}
$('#paste').addEventListener('input', e => onPaste(e.target.value));
function setStatus(msg, err = false, id = '#status') { const s = $(id); s.textContent = msg; s.classList.toggle('err', err); }

async function savePlayer(pid, formVals) {
  const prev = docOf(selDate, pid) || {};
  const next = {}; for (const [k, v] of Object.entries(prev)) if (k !== 'date' && k !== 'player') next[k] = v;
  Object.assign(next, formVals); // les jeux en pause gardent leur score
  const changed = Object.keys({ ...prev, ...next }).some(k => k !== 'date' && k !== 'player' && (prev[k] ?? null) !== (next[k] ?? null));
  if (changed) await api(`/api/scores/${selDate}/${pid}`, { method: 'PUT', body: JSON.stringify({ values: next }) });
  return changed;
}
$('#save').addEventListener('click', async () => {
  const btn = $('#save'); btn.disabled = true; setStatus('Enregistrement…');
  try {
    if (dirty) drafts[forId] = readForm();
    const who = [];
    for (const [pid, vals] of Object.entries(drafts)) { if (await savePlayer(pid, vals)) who.push(nameOf(pid)); delete drafts[pid]; }
    dirty = false; $('#paste').value = '';
    setStatus(who.length ? `Enregistré ✓ (${who.join(', ')})` : 'Rien à enregistrer.');
    await refresh();
  } catch (e) { if (!(e instanceof Locked)) setStatus(`Échec : ${e.message}`, true); }
  finally { btn.disabled = false; }
});

function setDate(d) {
  if (dirty || Object.keys(drafts).length) { for (const k of Object.keys(drafts)) delete drafts[k]; toast('Saisie non enregistrée abandonnée', true); }
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
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.querySelectorAll('#period button').forEach(b => b.addEventListener('click', () => {
  period = b.dataset.p; document.querySelectorAll('#period button').forEach(x => x.classList.toggle('on', x === b)); renderStats();
}));
$('#gameSel').addEventListener('change', e => { statGame = e.target.value; renderStatGame(periodDates()); });

// ================= Rendu : jour =================
const fmtV = v => v == null || v === '' ? '–' : String(v);
function dayWinCounts(dates) {
  const c = {}; for (const d of dates) { const w = dayResult(d).dayWinner; if (w && w !== 'tie') c[w] = (c[w] || 0) + 1; } return c;
}
function renderHead() {
  const box = $('#headScore'); box.innerHTML = '';
  const c = dayWinCounts(allDates());
  const top = Object.entries(c).sort((a, b) => b[1] - a[1]);
  top.slice(0, 3).forEach(([p, n]) => box.append(el('span', { class: 'pill' }, dot(p), `${nameOf(p)} ${n}`)));
  if (top.length > 3) box.append(el('span', { class: 'pill' }, `+${top.length - 3}`));
}
function renderDuel() {
  const box = $('#duel'); box.innerHTML = '';
  $('#duelTitle').textContent = selDate === today() ? "Le duel d'aujourd'hui" : `Le duel — ${fmtDate(selDate)}`;
  const r = dayResult(selDate);
  const waiting = (selDate === today() ? regulars() : []).filter(p => !r.docs[p]);
  if (!r.ids.length) { box.append(el('div', { class: 'empty' }, 'Aucun score ce jour-là.' + (waiting.length ? ` En attente de ${waiting.map(nameOf).join(', ')}.` : ''))); return; }
  // classement du jour
  const order = [...r.ids].sort((a, b) => r.wins[b] - r.wins[a]);
  const rank = el('div', { class: 'rank' });
  let pos = 0, prev = null;
  order.forEach((p, i) => {
    if (r.wins[p] !== prev) { pos = i + 1; prev = r.wins[p]; }
    const played = GAMES.filter(g => r.docs[p]?.[g.id] != null).length;
    rank.append(el('div', { class: 'r' + (r.dayWinner === p ? ' first' : '') },
      el('div', { class: 'pos' }, r.compared ? `${pos}.` : '·'),
      el('div', {}, dot(p), el('b', {}, nameOf(p)), r.dayWinner === p ? ' 🏆' : '', el('div', { class: 'sub' }, `${played} jeu${played > 1 ? 'x' : ''} joué${played > 1 ? 's' : ''}`)),
      el('div', { class: 'pts', title: 'Jeux gagnés' }, r.compared ? r.wins[p] : '–')));
  });
  box.append(rank);
  const msg = r.ids.length < 2 ? 'Il faut au moins deux joueurs pour comparer.' : r.dayWinner === 'tie' ? 'Égalité en tête.' : !r.compared ? 'Aucun jeu en commun.' : null;
  if (msg || waiting.length) box.append(el('div', { class: 'hint', style: 'margin:0 0 10px' }, [msg, waiting.length ? `En attente de ${waiting.map(nameOf).join(', ')}.` : null].filter(Boolean).join(' ')));
  const t = el('table');
  t.append(el('tr', {}, el('th', {}, 'Jeu'), ...r.ids.map(p => el('th', {}, nameOf(p)))));
  for (const g of GAMES.filter(g => g.active || r.ids.some(p => r.docs[p]?.[g.id] != null))) {
    const w = r.perGame[g.id];
    t.append(el('tr', {}, el('td', {}, `${g.ic} ${g.name}`), ...r.ids.map(p => {
      const v = r.docs[p]?.[g.id];
      return el('td', { class: ['v', isWin(w, p) ? 'win' : '', v === 'X' ? 'x' : ''].join(' ') }, fmtV(v));
    })));
  }
  box.append(el('div', { class: 'scroll' }, t));
}

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
    t.append(el('tr', { class: 'clickrow', title: 'Ouvrir ce jour', onclick: () => { showTab('today'); setDate(d); scrollTo(0, 0); } },
      el('td', {}, fmtDate(d)),
      el('td', { style: 'white-space:nowrap' }, r.ids.map(p => el('span', { class: 'dot', style: `background:${color(p)};margin:0 1px`, title: nameOf(p) }))),
      ...games.map(g => { const w = r.perGame[g.id]; return el('td', { style: 'font-size:12px;white-space:nowrap' }, Array.isArray(w) ? w.map(p => el('span', { class: 'dot', style: `background:${color(p)};margin:0 1px`, title: nameOf(p) })) : w === 'tie' ? '=' : ''); }),
      el('td', {}, r.dayWinner && r.dayWinner !== 'tie' ? el('span', { class: 'pill w' }, nameOf(r.dayWinner)) : el('span', { class: 'pill' }, r.dayWinner === 'tie' ? 'égalité' : 'incomplet'))));
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
  top.innerHTML = ''; cbox.innerHTML = '';
  const dates = periodDates();
  const duel = dates.filter(d => dayResult(d).compared > 0);
  if (!duel.length) { top.append(el('div', { class: 'empty' }, 'Pas encore de journée en duel sur cette période.')); $('#statsGame').innerHTML = ''; return; }
  const st = {};
  const S = p => st[p] ||= { days: 0, dayWins: 0, gameWins: 0, gamesCmp: 0 };
  for (const d of duel) {
    const r = dayResult(d);
    for (const p of r.ids) { S(p).days++; if (r.dayWinner === p) S(p).dayWins++; }
    for (const g of GAMES) { const w = r.perGame[g.id]; if (!w) continue; for (const p of r.ids) if (r.docs[p]?.[g.id] != null) S(p).gamesCmp++; if (Array.isArray(w)) w.forEach(p => S(p).gameWins++); }
  }
  // série en cours (journées gagnées d'affilée, tout l'historique)
  let sU = null, sN = 0;
  for (const d of allDates().reverse()) { const r = dayResult(d); if (!r.compared) continue; if (r.dayWinner === 'tie') break; if (!sU) { sU = r.dayWinner; sN = 1; } else if (r.dayWinner === sU) sN++; else break; }

  const ids = Object.keys(st).sort((a, b) => st[b].dayWins - st[a].dayWins || st[b].gameWins - st[a].gameWins);
  const t = el('table');
  t.append(el('tr', {}, el('th', {}, '#'), el('th', {}, 'Joueur'), el('th', { title: 'Journées gagnées' }, 'Journées'), el('th', { title: 'Part des journées jouées qui ont été gagnées' }, '% gagnées'),
    el('th', { title: 'Jours où le joueur a posté' }, 'Jours joués'), el('th', { title: 'Jeux gagnés / jeux comparés' }, 'Jeux gagnés')));
  ids.forEach((p, i) => t.append(el('tr', {},
    el('td', { class: 'v' }, i + 1), el('td', {}, dot(p), nameOf(p), playerById(p)?.archived ? el('span', { class: 'pill', style: 'margin-left:6px' }, 'archivé') : null),
    el('td', { class: 'v' + (i === 0 && st[p].dayWins > (st[ids[1]]?.dayWins ?? -1) ? ' win' : '') }, st[p].dayWins),
    el('td', { class: 'v' }, `${Math.round(100 * st[p].dayWins / st[p].days)} %`),
    el('td', { class: 'v' }, st[p].days),
    el('td', { class: 'v' }, `${st[p].gameWins} / ${st[p].gamesCmp}`))));
  top.append(el('div', { class: 'scroll' }, t));
  const ties = duel.filter(d => dayResult(d).dayWinner === 'tie').length;
  top.append(el('div', { class: 'hint' }, `${duel.length} jours en duel sur la période${ties ? `, dont ${ties} avec égalité en tête` : ''}. Série en cours : ${sU ? `${nameOf(sU)}, ${sN} journée${sN > 1 ? 's' : ''} d'affilée` : 'aucune'}.`));

  renderChart(cbox, duel, ids.slice(0, 8));
  if (ids.length > 8) cbox.append(el('div', { class: 'hint' }, `Graphique limité aux 8 premiers du classement.`));

  // sélecteur de jeu
  const dset = new Set(dates);
  const games = GAMES.filter(g => scores.some(s => dset.has(s.date) && s[g.id] != null));
  const sel = $('#gameSel'); sel.innerHTML = '';
  for (const g of games) sel.append(el('option', { value: g.id }, `${g.ic} ${g.name}`));
  if (!games.some(g => g.id === statGame)) statGame = games[0]?.id || null;
  sel.value = statGame || '';
  renderStatGame(dates);
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
  const ids = Object.keys(st).sort((a, b) => st[b].wins - st[a].wins || (g.lower ? 1 : -1) * (avgOf(st[a]) - avgOf(st[b])));
  const fmtAvg = s => { const m = avgOf(s); return !g.lower ? Math.round(m).toLocaleString('fr-FR') : m.toFixed(2); };
  const fmtRec = s => { const b = g.lower ? Math.min(...s.vals) : Math.max(...s.vals); return g.canFail && g.lower && b === g.fail ? 'X' : b.toLocaleString('fr-FR'); };
  const t = el('table');
  t.append(el('tr', {}, el('th', {}, 'Joueur'), el('th', {}, 'Parties'), el('th', { title: 'Victoires / parties comparées' }, 'Victoires'), el('th', {}, 'Moyenne'), el('th', {}, 'Record'), el('th', {}, 'Ratés')));
  ids.forEach((p, i) => { const s = st[p]; t.append(el('tr', {},
    el('td', {}, dot(p), nameOf(p), streakU === p && streakN > 1 ? el('span', { class: 'pill', style: 'margin-left:6px' }, `série ${streakN}`) : null),
    el('td', { class: 'v' }, s.played), el('td', { class: 'v' + (i === 0 && s.wins > 0 ? ' win' : '') }, `${s.wins} / ${s.duels}`),
    el('td', { class: 'v' }, fmtAvg(s)), el('td', { class: 'v' }, fmtRec(s)), el('td', { class: 'v' }, g.canFail ? s.fails : '–'))); });
  box.append(t);
  box.append(el('div', { class: 'hint' }, `${g.sub}${g.lower ? ', plus bas = mieux' : ', plus haut = mieux'}. Moyenne : un raté compte comme le pire score.`));
}
const avgOf = s => s.vals.reduce((a, b) => a + b, 0) / s.vals.length;

function renderChart(box, duel, ids) {
  box.append(el('div', { class: 'legend', style: 'flex-wrap:wrap' }, ...ids.map(p => el('span', {}, dot(p), nameOf(p)))));
  const cum = Object.fromEntries(ids.map(p => [p, []])); const run = Object.fromEntries(ids.map(p => [p, 0]));
  duel.forEach(d => { const w = dayResult(d).dayWinner; if (w in run) run[w]++; ids.forEach(p => cum[p].push(run[p])); });
  const W = 640, H = 240, L = 34, R = 92, T = 20, B = 26;
  const n = duel.length, yMax = Math.max(1, ...ids.map(p => run[p]));
  const x = i => n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1);
  const y = v => T + (H - T - B) * (1 - v / yMax);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Cumul des journées gagnées : ' + ids.map(p => `${nameOf(p)} ${run[p]}`).join(', ') });
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
  for (const p of ids) {
    if (n > 1) svg.append(sv('polyline', { points: cum[p].map((v, i) => `${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: color(p), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    svg.append(sv('circle', { cx: x(n - 1), cy: y(cum[p][n - 1]), r: 4, fill: color(p), stroke: 'var(--panel)', 'stroke-width': 2 }));
  }
  // étiquettes de fin (4 max pour rester lisible), décalées si elles se chevauchent
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
      ...[...ids].sort((a, b) => cum[b][i] - cum[a][i]).map(p => el('div', {}, dot(p), `${nameOf(p)} `, el('b', {}, cum[p][i]))));
    tip.style.display = 'block';
    const px = x(i) * rect.width / W; tip.style.left = Math.min(rect.width - tip.offsetWidth, Math.max(0, px - tip.offsetWidth / 2)) + 'px'; tip.style.top = '28px';
  };
  hit.addEventListener('mousemove', show); hit.addEventListener('touchstart', e => show(e.touches[0]), { passive: true });
  hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); hv.forEach(c => c.setAttribute('visibility', 'hidden')); });
}

// ================= Réglages : joueurs =================
function renderPlayers() {
  const list = $('#plist'); list.innerHTML = '';
  for (const p of players) {
    const nScores = scores.filter(s => s.player === p.id).length;
    const nameBox = el('div', {}, el('b', {}, p.name), p.id === meId ? ' (toi)' : '', el('small', {}, `${nScores} jour${nScores > 1 ? 's' : ''} de scores${p.archived ? ' · archivé' : ''}`));
    const rename = () => {
      const inp = el('input', { value: p.name, maxlength: 24, style: 'width:100%' });
      const ok = async () => { try { await api(`/api/players/${p.id}`, { method: 'PATCH', body: JSON.stringify({ name: inp.value }) }); await refresh(); } catch (e) { if (!(e instanceof Locked)) setStatus(e.message, true, '#pStatus'); } };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') renderPlayers(); });
      nameBox.replaceWith(el('div', { class: 'row', style: 'flex-wrap:nowrap' }, inp, el('button', { class: 'sm primary', onclick: ok }, 'OK')));
      inp.focus(); inp.select();
    };
    list.append(el('div', { class: 'gitem' + (p.archived ? ' off' : '') },
      el('div', { class: 'ic' }, dot(p.id)), nameBox,
      el('div', { class: 'acts' },
        el('button', { class: 'sm', onclick: rename }, 'Renommer'),
        p.id !== meId ? el('button', { class: 'sm', onclick: () => patchPlayer(p.id, { archived: !p.archived }) }, p.archived ? 'Réactiver' : 'Archiver') : null,
        !nScores && p.id !== meId ? el('button', { class: 'sm', title: 'Supprimer', 'aria-label': `Supprimer ${p.name}`, onclick: () => deletePlayer(p.id) }, '✕') : null)));
  }
}
async function patchPlayer(id, body) { try { await api(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); await refresh(); } catch (e) { if (!(e instanceof Locked)) setStatus(e.message, true, '#pStatus'); } }
async function deletePlayer(id) { try { await api(`/api/players/${id}`, { method: 'DELETE' }); await refresh(); } catch (e) { if (!(e instanceof Locked)) setStatus(e.message, true, '#pStatus'); } }
async function addPlayer() {
  const name = $('#addName').value.trim(); if (!name) return setStatus('Donne un nom.', true, '#pStatus');
  try { await api('/api/players', { method: 'POST', body: JSON.stringify({ name }) }); $('#addName').value = ''; setStatus(`${name} ajouté ✓`, false, '#pStatus'); await refresh(); }
  catch (e) { if (!(e instanceof Locked)) setStatus(e.message, true, '#pStatus'); }
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
  if (dirty) drafts[forId] = readForm();
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
    for (const p of r.ids) lines.push([d, nameOf(p), ...games.map(g => r.docs[p][g.id] ?? ''), r.wins[p], r.dayWinner === 'tie' ? 'égalité' : r.dayWinner ? nameOf(r.dayWinner) : ''].join(';'));
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
    setStatus(`${r.imported} fiches importées ✓${r.createdPlayers.length ? ` · joueurs créés : ${r.createdPlayers.join(', ')}` : ''}`, false, '#ioStatus'); await refresh();
  } catch (err) { if (!(err instanceof Locked)) setStatus(`Import impossible : ${err.message}`, true, '#ioStatus'); }
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
  $('#meName').textContent = nameOf(meId);
  renderHead(); renderDuel(); renderHistory(); renderPlayers(); renderGamesTab();
  if (!$('#tab-stats').classList.contains('hidden')) renderStats();
}

boot();
