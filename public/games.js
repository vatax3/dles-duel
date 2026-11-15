// Catalogue des jeux, lecture des textes de partage et logique de comparaison.
// Module partagé : utilisé par le navigateur (app.js) ET par le serveur (server.js).

const num = s => +String(s).replace(/[^\d]/g, '');
const seg = (text, re, len = 500) => { const i = text.search(re); return i < 0 ? null : text.slice(i, i + len); };
const frac = (text, re, den) => {
  const s = seg(text, re); if (!s) return undefined;
  const m = s.match(new RegExp(`(?:^|[^\\d])(\\d{1,2}|[Xx])\\s*\\/\\s*${den}(?!\\d)`));
  return m ? (/x/i.test(m[1]) ? 'X' : +m[1]) : undefined;
};

export const PRESETS = {
  wordle: { name: 'Wordle', ic: '🟩', url: 'https://www.nytimes.com/games/wordle/index.html', sub: 'essais /6', lower: true, min: 1, max: 6, fail: 7, canFail: true,
    parse: t => { const m = t.match(/Wordle[\s#]*[\d\s., ]*?\s([1-6Xx])\s*\/\s*6/i); return m ? (/x/i.test(m[1]) ? 'X' : +m[1]) : undefined; } },
  globle: { name: 'Globle', ic: '🌍', url: 'https://globle-game.com/', sub: 'essais', lower: true, min: 1, max: 200, canFail: false,
    parse: t => { if (!/globle/i.test(t)) return; const m = t.match(/=\s*(\d{1,3})\s*$/m) || t.match(/(?:guesses|essais)\s*[:=]?\s*(\d{1,3})(?!\s*[.,]\d)/i); return m ? +m[1] : undefined; } },
  angle: { name: 'Angle', ic: '📐', url: 'https://www.angle.wtf/', sub: 'essais /4', lower: true, min: 1, max: 4, fail: 5, canFail: true,
    parse: t => { const m = t.match(/Angle\s*#?\s*\d+\s+([1-4Xx])\s*\/\s*4/i); if (m) return /x/i.test(m[1]) ? 'X' : +m[1]; return frac(t, /#angle\b/i, 4); } },
  minecraftle: { name: 'Minecraftle', ic: '⛏️', url: 'https://minecraftle.zachmanson.com/', sub: 'essais /10', lower: true, min: 1, max: 10, fail: 11, canFail: true,
    parse: t => frac(t, /minecraftle/i, 10) },
  poople: { name: 'Poople', ic: '💩', url: 'https://poople.io/', sub: 'étapes', lower: true, min: 1, max: 99, canFail: false,
    parse: t => { const s = seg(t, /poople/i); if (!s) return; const m = s.match(/(\d{1,2})\s*(?:steps?|moves?|étapes?|coups?|changes?)\b/i) || s.match(/\bin\s+(\d{1,2})\b/i) || s.match(/\b(\d{1,2})\s*\/\s*\d{1,2}\b/); return m ? +m[1] : undefined; } },
  krillion: { name: 'Krillion', ic: '🦐', url: 'https://krillion.io/', sub: 'points /700', lower: false, min: 0, max: 700, canFail: false,
    parse: t => { const i = t.search(/krillion/i); if (i < 0) return;
      const read = s => { let m, v;
        if ((m = s.match(/(\d[\d\s., ]{0,6})\s*(?:pts|points?)\b/i))) v = num(m[1]);
        else if ((m = s.match(/(\d[\d\s., ]{0,6})\s*\/\s*700/))) v = num(m[1]);
        else if ((m = s.match(/(\d[\d\s., ]{0,7})\s*m\b/))) v = Math.round(num(m[1]) / 10);
        return (v != null && v <= 700) ? v : undefined; };
      const after = read(t.slice(i, i + 500)); if (after !== undefined) return after;
      const before = t.slice(Math.max(0, i - 120), i); const nl = before.lastIndexOf('\n\n'); return read(nl >= 0 ? before.slice(nl) : before); } },
  perceptle: { name: 'Perceptle', ic: '👁️', url: 'https://perceptle.com/', sub: 'score /100', lower: false, min: 0, max: 100, canFail: false,
    parse: t => { const s = seg(t, /perceptle/i, 600); if (!s) return; let m;
      if ((m = s.match(/(?:^|[^\d])(\d{1,3})\s*\/\s*100(?!\d)/))) return +m[1];
      if ((m = s.match(/(?:score|total)\s*[:=]?\s*(\d{1,3})(?!\d)/i))) return +m[1];
      const rest = s.slice(9).replace(/#\s*\d+/g, ' ').replace(/\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/g, ' ');
      m = rest.match(/(?:^|[^\d])(\d{1,3})(?!\d)/); if (m && +m[1] <= 100) return +m[1];
      m = t.match(/(?:^|[^\d#])(\d{1,3})(?!\d)[^\d\n]{0,30}perceptle/i); return m && +m[1] <= 100 ? +m[1] : undefined; } },
  // Noillirk = Krillion à l'envers (réponse la plus commune). Version officielle : playdaily.org/noillirk (7 questions, altitude). Barème supposé identique à Krillion.
  noillirk: { name: 'Noillirk', ic: '🎈', url: 'https://playdaily.org/noillirk', sub: 'points /700', lower: false, min: 0, max: 700, canFail: false,
    parse: t => { const s = seg(t, /noillirk/i, 500); if (!s) return; let m, v;
      if ((m = s.match(/(\d[\d\s.,\u202f]{0,6})\s*(?:pts|points?)\b/i))) v = num(m[1]);
      else if ((m = s.match(/(?:^|[^\d])(\d{1,4})\s*\/\s*\d{3,4}(?!\d)/))) v = +m[1];
      else if ((m = s.match(/(\d[\d\s.,\u202f]{0,7})\s*(?:m|mètres?|meters?)\b/i))) v = Math.round(num(m[1]) / 10);
      else if ((m = s.match(/(?:score|total)\s*[:=]?\s*(\d{1,4})(?!\d)/i))) v = +m[1];
      return (v != null && v <= 700) ? v : undefined; } },
  // Magnitudle : on compte le mode principal « Size It Up » (5 comparaisons, 500 points max)
  magnitudle: { name: 'Magnitudle', ic: '📏', url: 'https://magnitudle.com/size-it-up', sub: 'Size It Up /500', lower: false, min: 0, max: 500, canFail: false,
    parse: t => { const s = seg(t, /magnitudle|size\s*it\s*up/i, 600); if (!s) return; let m, v;
      if ((m = s.match(/(?:^|[^\d])(\d{1,3})\s*\/\s*500(?!\d)/))) v = +m[1];
      else if ((m = s.match(/(\d{1,3})\s*(?:pts|points?)\b/i))) v = +m[1];
      else if ((m = s.match(/(?:score|total)\s*[:=]?\s*(\d{1,3})(?!\d)/i))) v = +m[1];
      return (v != null && v <= 500) ? v : undefined; } },
  eraly: { name: 'Eraly', ic: '🕰️', url: 'https://eraly.io/', sub: 'points /700', lower: false, min: 0, max: 700, canFail: false,
    parse: t => { const s = seg(t, /eraly/i, 600); if (!s) return; let m, v;
      if ((m = s.match(/(\d[\d\s., ]{0,4})\s*\/\s*700(?!\d)/))) v = num(m[1]);
      else if ((m = s.match(/(\d[\d\s., ]{0,4})\s*(?:pts|points?)\b/i))) v = num(m[1]);
      else if ((m = s.match(/(?:score|total)\s*[:=]?\s*(\d{1,3})(?!\d)/i))) v = +m[1];
      return (v != null && v <= 700) ? v : undefined; } },
  connections: { name: 'Connections', ic: '🟪', url: 'https://www.nytimes.com/games/connections', sub: 'erreurs /4', lower: true, min: 0, max: 3, fail: 4, canFail: true,
    parse: t => { const s = seg(t, /connections/i, 800); if (!s) return; const rows = s.split('\n').map(l => [...l.matchAll(/🟨|🟩|🟦|🟪/gu)].map(x => x[0])).filter(r => r.length === 4);
      if (!rows.length) return; const solved = rows.filter(r => r.every(x => x === r[0])).length; return solved >= 4 ? rows.length - solved : 'X'; } },
  strands: { name: 'Strands', ic: '🧵', url: 'https://www.nytimes.com/games/strands', sub: 'indices', lower: true, min: 0, max: 30, canFail: false,
    parse: t => { const s = seg(t, /strands/i, 600); if (!s) return; return [...s.matchAll(/💡/gu)].length; } },
  worldle: { name: 'Worldle', ic: '🗺️', url: 'https://worldle.teuteuf.fr/', sub: 'essais /6', lower: true, min: 1, max: 6, fail: 7, canFail: true, parse: t => frac(t, /worldle/i, 6) },
  tradle: { name: 'Tradle', ic: '🚢', url: 'https://games.oec.world/en/tradle/', sub: 'essais /6', lower: true, min: 1, max: 6, fail: 7, canFail: true, parse: t => frac(t, /tradle/i, 6) },
  flagle: { name: 'Flagle', ic: '🏳️', url: 'https://www.flagle.io/', sub: 'essais /6', lower: true, min: 1, max: 6, fail: 7, canFail: true, parse: t => frac(t, /flagle/i, 6) },
  travle: { name: 'Travle', ic: '🧭', url: 'https://travle.earth/', sub: 'essais en trop', lower: true, min: 0, max: 99, fail: 100, canFail: true,
    parse: t => { const s = seg(t, /travle/i); if (!s) return; if (/❌/u.test(s)) return 'X'; const m = s.match(/\+\s*(\d{1,2})/); return m ? +m[1] : (/✅/u.test(s) ? 0 : undefined); } },
  framed: { name: 'Framed', ic: '🎬', url: 'https://framed.wtf/', sub: 'essais /6', lower: true, min: 1, max: 6, fail: 7, canFail: true,
    parse: t => { const s = seg(t, /framed/i, 300); if (!s) return; const sq = [...s.matchAll(/🟥|🟩|⬛|⬜/gu)].map(x => x[0]).slice(0, 6); if (!sq.length) return; const i = sq.indexOf('🟩'); return i < 0 ? 'X' : i + 1; } },
  bandle: { name: 'Bandle', ic: '🎸', url: 'https://bandle.app/', sub: 'essais /6', lower: true, min: 1, max: 6, fail: 7, canFail: true, parse: t => frac(t, /bandle/i, 6) },
  costcodle: { name: 'Costcodle', ic: '🛒', url: 'https://costcodle.com/', sub: 'essais /6', lower: true, min: 1, max: 6, fail: 7, canFail: true, parse: t => frac(t, /costcodle/i, 6) },
  nerdle: { name: 'Nerdle', ic: '🧮', url: 'https://nerdlegame.com/', sub: 'essais /6', lower: true, min: 1, max: 6, fail: 7, canFail: true, parse: t => frac(t, /nerdle/i, 6) },
  contexto: { name: 'Contexto', ic: '🧠', url: 'https://contexto.me/', sub: 'essais', lower: true, min: 1, max: 9999, canFail: false,
    parse: t => { const s = seg(t, /contexto/i); if (!s) return; const m = s.match(/(\d{1,4})\s*(?:guesses|essais|tentatives|palpites|intentos)/i); return m ? +m[1] : undefined; } },
  waffle: { name: 'Waffle', ic: '🧇', url: 'https://wafflegame.net/', sub: 'étoiles /5', lower: false, min: 0, max: 5, canFail: false,
    parse: t => { const s = seg(t, /waffle/i); if (!s) return; const m = s.match(/(?:^|[^\d])([0-5Xx])\s*\/\s*5(?!\d)/); return m ? (/x/i.test(m[1]) ? 0 : +m[1]) : undefined; } },
  quordle: { name: 'Quordle', ic: '🔢', url: 'https://www.merriam-webster.com/games/quordle/', sub: 'total essais', lower: true, min: 4, max: 52, canFail: false,
    parse: t => { const s = seg(t, /quordle/i, 200); if (!s) return; const d = [...s.matchAll(/([1-9])️?⃣/gu)].map(x => +x[1]); const fails = [...s.matchAll(/🟥/gu)].length; if (d.length + fails < 4) return; return d.slice(0, 4 - Math.min(4, fails)).reduce((a, b) => a + b, 0) + 13 * Math.min(4, fails); } },
  octordle: { name: 'Octordle', ic: '🐙', url: 'https://www.britannica.com/games/octordle/', sub: 'score', lower: true, min: 8, max: 200, canFail: false,
    parse: t => { const s = seg(t, /octordle/i, 300); if (!s) return; const m = s.match(/score\s*:?\s*(\d{1,3})/i); return m ? +m[1] : undefined; } },
  timeguessr: { name: 'TimeGuessr', ic: '⏳', url: 'https://timeguessr.com/', sub: 'points /50 000', lower: false, min: 0, max: 50000, canFail: false,
    parse: t => { const s = seg(t, /timeguessr/i); if (!s) return; const m = s.match(/(\d[\d,.\s ]{0,7})\s*\/\s*50[,.\s ]?000/); return m ? num(m[1]) : undefined; } },
};

// Description courte et limite de temps de chaque jeu du catalogue (affichées dans l'app)
const DETAILS = {
  wordle: ['Trouver le mot de 5 lettres en 6 essais.', 'Sans chrono'],
  globle: ['Trouver le pays mystère : chaque essai colore les pays selon leur distance (plus chaud = plus près). Essais illimités, le moins possible.', 'Sans chrono'],
  angle: ['Deviner un angle en degrés avec des indications plus / moins, en 4 essais.', 'Sans chrono'],
  minecraftle: ['Retrouver la recette de craft Minecraft du jour en 10 essais, façon Wordle.', 'Sans chrono'],
  poople: ['Échelle de mots en anglais : partir d\'un mot de 4 lettres et atteindre POOP en changeant une lettre à la fois, chaque étape étant un vrai mot. Le moins d\'étapes possible.', 'Sans chrono'],
  krillion: ['7 questions ouvertes (« Cite un oiseau ») : plus ta réponse valide est rare, plus elle rapporte (10 à 100 pts par question).', '25 s / question'],
  noillirk: ['L\'inverse de Krillion : donner la réponse que la plupart des gens donneraient. 7 questions, version officielle sur playdaily.org.', '15 s / question'],
  perceptle: ['5 épreuves de perception (compter, trajectoire, angle, rythme, proportion), chacune sur 100 ; le score est la moyenne. Pas de compte à rebours, mais certaines épreuves demandent des réflexes. Le vendredi, les règles changent.', 'Sans chrono'],
  magnitudle: ['Mode Size It Up : redimensionner des silhouettes à la taille réelle d\'objets, par rapport à une référence. 5 comparaisons, 500 pts max.', 'Sans chrono'],
  eraly: ['Deviner l\'année de 7 moments historiques : année exacte = 100 pts, puis 85, 60, 30 ou 10 selon l\'écart.', '25 s / question'],
  connections: ['Regrouper 16 mots en 4 groupes de 4 au thème caché. 4 erreurs maximum.', 'Sans chrono'],
  strands: ['Trouver les mots d\'un thème caché dans une grille de lettres, dont le « spangram » qui la traverse. On compte les indices utilisés.', 'Sans chrono'],
  worldle: ['Reconnaître un pays à sa silhouette en 6 essais, avec distance et direction à chaque essai.', 'Sans chrono'],
  tradle: ['Deviner un pays d\'après la répartition de ses exportations, en 6 essais.', 'Sans chrono'],
  flagle: ['Deviner un drapeau qui se dévoile morceau par morceau, en 6 essais.', 'Sans chrono'],
  travle: ['Relier deux pays par la plus courte chaîne de pays voisins ; on compte les essais en trop.', 'Sans chrono'],
  framed: ['Deviner un film à partir d\'images, une nouvelle image à chaque essai, 6 essais.', 'Sans chrono'],
  bandle: ['Deviner une chanson : un instrument de plus à chaque essai, 6 essais.', 'Sans chrono'],
  costcodle: ['Deviner le prix d\'un article Costco en 6 essais (plus / moins).', 'Sans chrono'],
  nerdle: ['Wordle des maths : trouver une équation de 8 caractères en 6 essais.', 'Sans chrono'],
  contexto: ['Trouver le mot secret : chaque essai est classé selon sa proximité de sens. Essais illimités, le moins possible.', 'Sans chrono'],
  waffle: ['Remettre en place les lettres d\'une grille en forme de gaufre en 15 échanges max ; les échanges restants donnent des étoiles.', 'Sans chrono'],
  quordle: ['4 Wordle en même temps, en 9 essais ; le score est le total des essais.', 'Sans chrono'],
  octordle: ['8 Wordle en même temps, en 13 essais ; le score est le total.', 'Sans chrono'],
  timeguessr: ['5 photos : deviner où et en quelle année elles ont été prises (50 000 pts max).', 'Chrono selon le mode'],
};
for (const [id, [desc, timer]] of Object.entries(DETAILS)) if (PRESETS[id]) Object.assign(PRESETS[id], { desc, timer });

export const DEFAULT_GAMES = ['wordle', 'globle', 'angle', 'minecraftle', 'poople', 'krillion', 'noillirk', 'perceptle', 'magnitudle', 'eraly'].map(id => ({ id, active: true }));

function customParser(g) {
  const kw = (g.keyword || g.name || '').trim(); if (!kw) return () => undefined;
  const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return t => {
    const s = seg(t, re); if (!s) return;
    if (g.kind === 'fraction') { const m = s.match(/(?:^|[^\d])(\d{1,4}|[Xx])\s*\/\s*\d{1,4}/); return m ? (/x/i.test(m[1]) ? 'X' : +m[1]) : undefined; }
    const m = s.slice(kw.length).replace(/#\s*\d+/g, ' ').match(/(\d[\d,. ]*)/); return m ? num(m[1]) : undefined;
  };
}

/** Transforme une entrée de configuration stockée en jeu utilisable. */
export function resolveGame(stored) {
  if (!stored || typeof stored.id !== 'string') return null;
  if (PRESETS[stored.id]) return { ...PRESETS[stored.id], id: stored.id, active: stored.active !== false };
  if (!stored.custom) return null;
  const lower = stored.lower !== false, max = Math.max(1, +stored.max || 10);
  const g = { id: stored.id, custom: true, name: String(stored.name || 'Jeu').slice(0, 30), ic: String(stored.ic || '🎲').slice(0, 4), url: stored.url || '',
    keyword: stored.keyword, kind: stored.kind === 'fraction' ? 'fraction' : 'number',
    sub: stored.kind === 'fraction' ? `essais /${max}` : (lower ? 'score (bas = mieux)' : 'points'),
    lower, min: lower ? (stored.kind === 'fraction' ? 1 : 0) : 0, max, canFail: !!stored.canFail && lower, fail: max + 1, active: stored.active !== false,
    desc: String(stored.desc || '').slice(0, 300), timer: String(stored.timer || '').slice(0, 40) };
  g.parse = customParser(g);
  return g;
}

/** Nettoie une configuration reçue (côté serveur). */
export function sanitizeConfig(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set(), out = [];
  for (const x of list.slice(0, 60)) {
    if (!x || typeof x.id !== 'string' || !/^[a-z0-9_]{1,40}$/i.test(x.id) || seen.has(x.id)) continue;
    seen.add(x.id);
    if (PRESETS[x.id]) { out.push({ id: x.id, active: x.active !== false }); continue; }
    if (!x.custom) continue;
    let url = typeof x.url === 'string' ? x.url.slice(0, 300) : '';
    if (url && !/^https?:\/\//i.test(url)) url = '';
    out.push({ id: x.id, custom: true, active: x.active !== false, name: String(x.name || 'Jeu').slice(0, 30), ic: String(x.ic || '🎲').slice(0, 4), url,
      keyword: String(x.keyword || x.name || '').slice(0, 40), kind: x.kind === 'fraction' ? 'fraction' : 'number',
      max: Math.max(1, Math.min(1e6, Math.round(+x.max || 10))), lower: x.lower !== false, canFail: !!x.canFail,
      desc: String(x.desc || '').slice(0, 300), timer: String(x.timer || '').slice(0, 40) });
  }
  return out;
}

/** Lit un texte de partage (un ou plusieurs jeux collés) et renvoie {gameId: valeur}. */
export function parseShare(text, games) {
  const out = {};
  if (!text) return out;
  for (const g of games) {
    let v; try { v = g.parse(text); } catch { v = undefined; }
    if (v === undefined || v === null || (typeof v === 'number' && !isFinite(v))) continue;
    if (v === 'X') { if (g.canFail) out[g.id] = 'X'; continue; }
    out[g.id] = Math.max(g.min, Math.min(g.max, v));
  }
  return out;
}

// ---------- Comparaison ----------
export function rankVal(g, v) {
  if (v == null || v === '') return null;
  if (v === 'X') return g.lower ? (g.fail ?? 1e9) : 1e9;
  const n = Number(v); if (!isFinite(n)) return null;
  return g.lower ? n : -n;
}

/** Gagnant(s) d'un jeu pour un jour. null = pas comparable (moins de 2 joueurs), 'tie' = égalité parfaite, sinon tableau d'ids. */
export function gameWinners(g, entries) {
  const ranked = entries.map(e => ({ ...e, r: rankVal(g, e.v) })).filter(e => e.r != null);
  if (ranked.length < 2) return null;
  const best = Math.min(...ranked.map(e => e.r));
  const w = ranked.filter(e => e.r === best).map(e => e.p);
  return w.length === ranked.length ? 'tie' : w;
}

/** Résultat d'une journée. docs = {playerId: {gameId: valeur}} */
export function dayResult(games, playerIds, docs) {
  const wins = Object.fromEntries(playerIds.map(p => [p, 0]));
  const perGame = {};
  let compared = 0;
  for (const g of games) {
    const w = gameWinners(g, playerIds.map(p => ({ p, v: docs[p]?.[g.id] })));
    perGame[g.id] = w;
    if (w) compared++;
    if (Array.isArray(w)) w.forEach(p => wins[p]++);
  }
  const present = playerIds.filter(p => docs[p]);
  let dayWinner = null;
  if (compared) {
    const max = Math.max(...present.map(p => wins[p]));
    const lead = present.filter(p => wins[p] === max);
    dayWinner = lead.length === 1 ? lead[0] : 'tie';
  }
  return { docs, wins, perGame, compared, dayWinner, complete: present.length === playerIds.length };
}
