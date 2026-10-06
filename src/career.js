/* ============================================================
   Botola 25 — career.js
   Season / league table / transfers / training.
   Pure logic, no DOM — the same code runs in the browser and in tests.
   ============================================================ */

import { CLUBS, clubById, makeSquad, buildFixtureList, emptyTable, sortTable } from './data.js';
import { rngFrom, clamp } from './util.js';

export const SEASON_LENGTH = 22; // rounds in a double round-robin of 12 clubs

/* ---------- team strength from the actual squad ---------- */
export function teamStrength(squad) {
  const att = squad.filter((p) => ['ST', 'LM', 'RM', 'CM'].includes(p.role));
  const def = squad.filter((p) => ['CB', 'LB', 'RB', 'GK'].includes(p.role));
  const avg = (a, k) => a.reduce((s, p) => s + (p[k] || 0), 0) / Math.max(1, a.length);
  return {
    att: avg(att, 'shoot') * 0.55 + avg(att, 'pace') * 0.25 + avg(att, 'pass') * 0.2,
    def: avg(def, 'defend') * 0.7 + avg(def, 'pace') * 0.15 + avg(squad.slice(0, 1), 'gk') * 0.15,
    ovr: squad.reduce((s, p) => s + p.rating, 0) / squad.length,
  };
}

/* ---------- career lifecycle ---------- */
export function newCareer(clubId, opts = {}) {
  const club = clubById(clubId);
  const seasonSeed = (opts.seed || 20250) >>> 0;
  const squads = {};
  CLUBS.forEach((c, i) => {
    squads[c.id] = makeSquad(seasonSeed + i * 104729, c.rate);
  });
  const c = {
    clubId: club.id,
    season: 1,
    coins: 250,
    gems: 3,
    round: 0,
    seasonSeed,
    squads,
    fixtures: buildFixtureList(CLUBS.map((x) => x.id)),
    table: emptyTable(CLUBS.map((x) => x.id)),
    form: [],
    trophies: [],
    market: [],
    difficulty: opts.difficulty || 1,
    halfSeconds: opts.halfSeconds || 120,
    stats: { played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, bestFinish: null },
    trained: 0,
  };
  c.market = genMarket(c);
  return c;
}

export const mySquad = (c) => c.squads[c.clubId];
export const myClub = (c) => clubById(c.clubId);

export function nextFixture(c) {
  for (let r = c.round; r < c.fixtures.length; r++) {
    const g = c.fixtures[r].find((f) => f.home === c.clubId || f.away === c.clubId);
    if (g) return { round: r, ...g };
  }
  return null;
}

export function roundFixtures(c, r) {
  return c.fixtures[r] || [];
}

/* ---------- simulating the matches the user does not play ---------- */
function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

export function simOtherResults(c, round) {
  const rng = rngFrom(c.seasonSeed * 31 + round * 7919);
  const out = [];
  for (const f of roundFixtures(c, round)) {
    if (f.home === c.clubId || f.away === c.clubId) continue;
    const hs = teamStrength(c.squads[f.home]);
    const as = teamStrength(c.squads[f.away]);
    const lh = clamp(1.45 * (hs.att / Math.max(55, as.def)) + 0.25, 0.25, 4.2);
    const la = clamp(1.2 * (as.att / Math.max(55, hs.def)), 0.2, 3.8);
    out.push({ ...f, hg: poisson(rng, lh), ag: poisson(rng, la) });
  }
  return out;
}

export function applyResult(c, f, hg, ag) {
  const row = (id) => c.table.find((r) => r.id === id);
  const h = row(f.home), a = row(f.away);
  if (!h || !a) return;
  h.p++; a.p++; h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
  if (hg > ag) { h.w++; a.l++; h.pts += 3; }
  else if (hg < ag) { a.w++; h.l++; a.pts += 3; }
  else { h.d++; a.d++; h.pts++; a.pts++; }
}

/* Play the user's match, then resolve the rest of the round */
export function commitUserResult(c, fixture, hg, ag) {
  applyResult(c, fixture, hg, ag);
  for (const r of simOtherResults(c, fixture.round)) applyResult(c, r, r.hg, r.ag);

  const won = (fixture.home === c.clubId) ? hg > ag : ag > hg;
  const drew = hg === ag;
  c.stats.played++;
  if (won) c.stats.wins++; else if (drew) c.stats.draws++; else c.stats.losses++;
  if (fixture.home === c.clubId) { c.stats.gf += hg; c.stats.ga += ag; }
  else { c.stats.gf += ag; c.stats.ga += hg; }
  c.form.push(won ? 'W' : drew ? 'D' : 'L');
  if (c.form.length > 5) c.form.shift();

  // rewards
  const reward = won ? 120 : drew ? 55 : 20;
  const gemReward = won ? 1 : 0;
  c.coins += reward + Math.round(hg * 12);
  c.gems += gemReward;
  c.round = fixture.round + 1;

  const res = { reward, gemReward, won, drew };
  if (c.round >= c.fixtures.length) res.seasonEnd = endSeason(c);
  return res;
}

export function tableSorted(c) {
  return sortTable(c.table);
}

export function userPosition(c) {
  return tableSorted(c).findIndex((r) => r.id === c.clubId) + 1;
}

export function endSeason(c) {
  const t = tableSorted(c);
  const pos = t.findIndex((r) => r.id === c.clubId) + 1;
  const champion = pos === 1;
  const prize = champion ? 1500 : pos <= 3 ? 700 : pos <= 6 ? 300 : 120;
  c.coins += prize;
  c.gems += champion ? 10 : pos <= 3 ? 4 : 1;
  if (champion) c.trophies.push({ season: c.season, name: `Botola ${c.season}` });
  c.stats.bestFinish = c.stats.bestFinish === null ? pos : Math.min(c.stats.bestFinish, pos);

  // new season: everyone regenerates a little, ratings drift
  c.season++;
  c.round = 0;
  c.table = emptyTable(CLUBS.map((x) => x.id));
  c.seasonSeed = (c.seasonSeed * 1103515245 + 12345) >>> 0;
  CLUBS.forEach((club, i) => {
    if (club.id === c.clubId) {
      // the user's squad ages; veterans retire, youth comes through
      const fresh = makeSquad(c.seasonSeed + i, club.rate);
      c.squads[club.id] = c.squads[club.id].map((p, slot) => {
        const age = p.age + 1;
        if (age > 35) return { ...fresh[slot], goals: 0, apps: 0 };
        const drift = age < 26 ? 1 : age > 31 ? -1.5 : 0.3;
        return {
          ...p, age,
          pace: clamp(Math.round(p.pace + drift), 40, 96),
          shoot: clamp(Math.round(p.shoot + drift * 0.7), 40, 96),
          rating: clamp(Math.round(p.rating + drift), 40, 96),
          goals: 0, apps: 0,
        };
      });
    } else {
      c.squads[club.id] = makeSquad(c.seasonSeed + i * 104729, club.rate + Math.round((Math.random() - 0.5) * 3));
    }
  });
  c.market = genMarket(c);
  return { pos, champion, prize };
}

/* ---------- transfer market ---------- */
const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CM', 'LM', 'RM', 'ST'];

export function genMarket(c) {
  const rng = rngFrom((c.seasonSeed ^ (c.season * 7717)) >>> 0);
  const list = [];
  for (let i = 0; i < 8; i++) {
    const role = POSITIONS[rng.int(POSITIONS.length)];
    const rate = clamp(Math.round(58 + rng.gauss() * 9 + c.season * 1.2), 52, 93);
    const base = makeSquad(rng.int(1e9), rate);
    const p = base.find((x) => x.role === role) || base[0];
    const price = Math.round((Math.pow(p.rating / 55, 4.2) * 90 + 60) / 5) * 5;
    list.push({ ...p, role, price, from: CLUBS[rng.int(CLUBS.length)].short });
  }
  return list;
}

export function refreshMarket(c) {
  if (c.coins < 40) return { ok: false, why: 'ما عندكش 40 قطعة' };
  c.coins -= 40;
  c.seasonSeed = (c.seasonSeed * 1664525 + 1013904223) >>> 0;
  c.market = genMarket(c);
  return { ok: true };
}

export function buyPlayer(c, idx) {
  const p = c.market[idx];
  if (!p) return { ok: false, why: 'اللاعب ما كاينش' };
  if (c.coins < p.price) return { ok: false, why: 'الفلوس ما كفاتش' };
  c.coins -= p.price;
  const squad = mySquad(c);
  // he takes the shirt of the weakest player in his role, else the weakest overall
  let target = squad.filter((x) => x.role === p.role).sort((a, b) => a.rating - b.rating)[0];
  if (!target) target = squad.slice().sort((a, b) => a.rating - b.rating)[0];
  const slot = squad.indexOf(target);
  squad[slot] = { ...p, uid: target.uid, no: target.no, slot, goals: 0, apps: 0 };
  c.market.splice(idx, 1);
  return { ok: true, replaced: target.name, added: p.name };
}

export function trainPlayer(c, uid, attr) {
  const p = mySquad(c).find((x) => x.uid === uid);
  if (!p) return { ok: false, why: 'اللاعب ما كاينش' };
  if (!['pace', 'shoot', 'pass', 'defend'].includes(attr)) return { ok: false, why: 'صفة غير صالحة' };
  if (p[attr] >= 96) return { ok: false, why: 'وصل الماكسيموم' };
  const cost = 60 + Math.round((p[attr] - 55) * 9);
  if (c.coins < cost) return { ok: false, why: `خاصك ${cost} قطعة` };
  c.coins -= cost;
  p[attr] = Math.min(96, p[attr] + 1 + (Math.random() < 0.3 ? 1 : 0));
  p.rating = Math.min(96, p.rating + 1);
  c.trained++;
  return { ok: true, cost, value: p[attr] };
}

/* The squad is always the starting XI (the engine plays 11 v 11), so selling
   does not shrink it — the youth academy fills the shirt with a fresh player
   of the same role. That is the trade-off: cash now, quality later.        */
export function sellPlayer(c, uid) {
  const squad = mySquad(c);
  const i = squad.findIndex((x) => x.uid === uid);
  if (i < 0) return { ok: false, why: 'اللاعب ما كاينش' };
  const p = squad[i];
  const price = Math.round((Math.pow(p.rating / 55, 4.0) * 70 + 40) / 5) * 5;
  const fresh = makeSquad((c.seasonSeed ^ Math.imul(uid + 1, 2654435761)) >>> 0, myClub(c).rate);
  squad[i] = { ...fresh[i], uid: p.uid, no: p.no, goals: 0, apps: 0 };
  c.coins += price;
  return { ok: true, price, name: p.name, replacement: squad[i].name, rating: squad[i].rating };
}

/* ---------- top scorers ---------- */
export function topScorers(c) {
  const all = [];
  CLUBS.forEach((club) => c.squads[club.id].forEach((p) => {
    if (p.goals > 0) all.push({ name: p.name, club: club.short, goals: p.goals });
  }));
  return all.sort((a, b) => b.goals - a.goals).slice(0, 8);
}
