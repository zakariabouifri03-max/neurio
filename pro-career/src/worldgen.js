// ── World generation: leagues, clubs, squads, national teams, fixtures ───────
// Everything is derived deterministically from the career seed, so a save only
// needs to store the seed + the *changes* (transfers, growth, results).

import { Rng, clamp, ri } from './rng.js';
import {
  LEAGUES, CLUB_SUFFIX, KIT_PALETTE, NATIONS, FIRST_NAMES, LAST_NAMES,
  REGION_NATIONS, FORMATIONS, POS_ORDER, TUNE,
} from './data.js';

export const SQUAD_SHAPE = [
  'GK', 'GK', 'GK', 'RB', 'RB', 'LB', 'LB', 'CB', 'CB', 'CB', 'CB',
  'DM', 'DM', 'CM', 'CM', 'CM', 'AM', 'AM', 'RW', 'LW', 'ST', 'ST', 'ST',
];

const nationById = Object.fromEntries(NATIONS.map((n) => [n[1], { name: n[0], code: n[1], flag: n[2], conf: n[3], power: n[4] }]));

function namesFor(rng, region) {
  const firsts = FIRST_NAMES[region] || FIRST_NAMES['eu-w'];
  const lasts = LAST_NAMES[region] || LAST_NAMES['eu-w'];
  return { first: rng.pick(firsts), last: rng.pick(lasts) };
}

export function playerName(region, rng) {
  const { first, last } = namesFor(rng, region);
  return `${first} ${last}`;
}

// mix of local + imported players, like a real squad
function pickNation(rng, league) {
  const pool = REGION_NATIONS[league.region] || REGION_NATIONS['eu-w'];
  const conf = rng.weighted(Object.keys(pool), (c) => pool[c]);
  const candidates = NATIONS.filter((n) => n[3] === conf);
  return rng.pick(candidates)[1];
}

export const OVERALL_W = { ST: [0.12, 0.3, 0.06, 0.22, 0.02, 0.28], RW: [0.22, 0.2, 0.12, 0.24, 0.04, 0.18],
  LW: [0.22, 0.2, 0.12, 0.24, 0.04, 0.18], AM: [0.12, 0.18, 0.26, 0.24, 0.06, 0.14],
  CM: [0.1, 0.12, 0.34, 0.2, 0.14, 0.1], DM: [0.1, 0.08, 0.26, 0.12, 0.32, 0.12],
  CB: [0.12, 0.03, 0.12, 0.08, 0.42, 0.23], RB: [0.2, 0.05, 0.16, 0.14, 0.28, 0.17],
  LB: [0.2, 0.05, 0.16, 0.14, 0.28, 0.17], GK: [0, 0, 0, 0, 0, 0] };

const AKEYS = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];

// Raise/lower a player's attributes so his overall moves by ~target points,
// keeping his positional shape (weights) intact.  Used for season growth,
// aging decline and world evolution — this is what keeps ratings believable.
export function growPlayer(p, target) {
  if (p.pos === 'GK') { p.gk = clamp(p.gk + target, TUNE.attrMin, TUNE.attrMax); return; }
  const w = OVERALL_W[p.pos] || OVERALL_W.CM;
  const shape = { pac: 1.0, sho: 1.0, pas: 1.0, dri: 1.0, def: 0.95, phy: 0.92 };
  const denom = AKEYS.reduce((s, k, i) => s + w[i] * shape[k], 0) || 1;
  const step = target / denom;
  AKEYS.forEach((k, i) => { p.attrs[k] = clamp(p.attrs[k] + step * shape[k], TUNE.attrMin, TUNE.attrMax); });
}

export function overall(p) {
  if (p.pos === 'GK') return Math.round(p.gk);
  const a = p.attrs;
  const w = OVERALL_W[p.pos] || OVERALL_W.CM;
  const wv = { ST: [0.12, 0.3, 0.06, 0.22, 0.02, 0.28], RW: [0.22, 0.2, 0.12, 0.24, 0.04, 0.18],
    LW: [0.22, 0.2, 0.12, 0.24, 0.04, 0.18], AM: [0.12, 0.18, 0.26, 0.24, 0.06, 0.14],
    CM: [0.1, 0.12, 0.34, 0.2, 0.14, 0.1], DM: [0.1, 0.08, 0.26, 0.12, 0.32, 0.12],
    CB: [0.12, 0.03, 0.12, 0.08, 0.42, 0.23], RB: [0.2, 0.05, 0.16, 0.14, 0.28, 0.17],
    LB: [0.2, 0.05, 0.16, 0.14, 0.28, 0.17], GK: [0, 0, 0, 0, 0, 0] }[p.pos] || [0.16, 0.16, 0.18, 0.18, 0.16, 0.16];
  const v = (a.pac * w[0] + a.sho * w[1] + a.pas * w[2] + a.dri * w[3] + a.def * w[4] + a.phy * w[5]);
  return Math.round(clamp(v, TUNE.attrMin, TUNE.attrMax));
}

function attrsFor(rng, pos, target) {
  const spread = (base, d = 6) => clamp(Math.round(base + rng.gauss() * d), TUNE.attrMin, TUNE.attrMax);
  const t = target;
  const table = {
    GK: () => ({ pac: spread(t - 22), sho: spread(t - 40), pas: spread(t - 18, 5), dri: spread(t - 25, 5), def: spread(t - 6), phy: spread(t - 4) }),
    CB: () => ({ pac: spread(t - 8), sho: spread(t - 28), pas: spread(t - 12, 5), dri: spread(t - 20), def: spread(t + 4), phy: spread(t + 4) }),
    RB: () => ({ pac: spread(t + 4), sho: spread(t - 22), pas: spread(t - 6), dri: spread(t - 6), def: spread(t - 2), phy: spread(t - 4, 5) }),
    LB: () => ({ pac: spread(t + 4), sho: spread(t - 22), pas: spread(t - 6), dri: spread(t - 6), def: spread(t - 2), phy: spread(t - 4, 5) }),
    DM: () => ({ pac: spread(t - 8), sho: spread(t - 18), pas: spread(t + 2), dri: spread(t - 8), def: spread(t + 2), phy: spread(t + 2) }),
    CM: () => ({ pac: spread(t - 4), sho: spread(t - 8), pas: spread(t + 4), dri: spread(t + 2), def: spread(t - 6), phy: spread(t - 2) }),
    AM: () => ({ pac: spread(t + 1), sho: spread(t + 2), pas: spread(t + 4), dri: spread(t + 6), def: spread(t - 20), phy: spread(t - 10) }),
    RW: () => ({ pac: spread(t + 6), sho: spread(t - 2), pas: spread(t + 1), dri: spread(t + 6), def: spread(t - 24), phy: spread(t - 8) }),
    LW: () => ({ pac: spread(t + 6), sho: spread(t - 2), pas: spread(t + 1), dri: spread(t + 6), def: spread(t - 24), phy: spread(t - 8) }),
    ST: () => ({ pac: spread(t + 2), sho: spread(t + 6), pas: spread(t - 8), dri: spread(t + 2), def: spread(t - 28), phy: spread(t + 1) }),
  }[pos] || (() => ({ pac: spread(t), sho: spread(t), pas: spread(t), dri: spread(t), def: spread(t), phy: spread(t) }));
  const a = table();
  for (const k of Object.keys(a)) a[k] = clamp(a[k] ?? t, TUNE.attrMin, TUNE.attrMax);
  return a;
}

let _pid = 0;
export function makePlayer(rng, { pos, target, league, clubId = null, age = null, nationCode = null, pot = null }) {
  const a = age == null ? ri(rng, 17, 34) : age;
  const code = nationCode || pickNation(rng, league);
  const nat = nationById[code];
  const region = nat ? (nat.conf === 'UEFA' ? (league.region.startsWith('eu') ? league.region : 'eu-w') : nat.conf === 'CAF' ? 'afr' : nat.conf === 'CONMEBOL' ? 'latam' : nat.conf === 'CONCACAF' ? 'northam' : 'mideast') : league.region;
  const nm = namesFor(rng, region);
  const gk = pos === 'GK';
  const p = {
    id: 'p' + (++_pid),
    first: nm.first, last: nm.last, name: `${nm.first} ${nm.last[0]}.`,
    full: `${nm.first} ${nm.last}`,
    age: a, pos, pos2: null, nation: code, clubId,
    attrs: gk ? null : attrsFor(rng, pos, target),
    gk: gk ? clamp(Math.round(target + rng.gauss() * 5), TUNE.attrMin, TUNE.attrMax) : clamp(Math.round(target - 38 + rng.gauss() * 4), TUNE.attrMin, 45),
    value: 0, wage: 0, contract: ri(rng, 1, 4), form: 0, morale: 70, fitness: 100,
    injuryWeeks: 0, growthBias: rng.range(0.6, 1.5), seasonGoals: 0, seasonAssists: 0, seasonApps: 0,
    careerGoals: 0, careerApps: 0, careerAssists: 0, history: [], notable: false,
  };
  p.pot = pot != null ? pot : clamp(Math.round(overall(p) + Math.max(1, (28 - a)) * rng.range(0.7, 2.2)), 40, TUNE.attrMax);
  if (a > 27) p.pot = overall(p);
  return p;
}

export function buildWorld(seed) {
  const rng = new Rng(seed ^ 0x9e3779b9);
  _pid = 0;
  const leagues = [], clubs = [], players = [], nations = [];
  const byNation = {};

  LEAGUES.forEach((L, li) => {
    // league reputation: 0.78 (small) → 1.0 (top-5)
    const rep = 0.62 + L.tier * 0.076;
    const league = {
      id: L.id, name: L.name, short: L.short, country: L.country, flag: L.flag,
      tier: L.tier, rep, region: L.region, clubIds: [], table: null, results: [],
    };
    leagues.push(league);
    const nClubs = 16;
    const cities = rng.shuffle(L.cities).slice(0, nClubs);
    cities.forEach((city, ci) => {
      const suffix = rng.pick(CLUB_SUFFIX);
      const name = /FC|United|City|Athletic|Town/.test(suffix) && city.endsWith('FC') ? city : `${city} ${suffix}`;
      // club prestige: 1..5 stars inside the league, top 3 clubs are the giants
      const rank = ci; // cities were shuffled → random standing, then top seeds get pushed up
      const pseed = rank === 0 ? 3 : rank < 4 ? 2 : rank < 9 ? 1 : 0;
      const prestige = clamp(pseed + ri(rng, 0, 1), 1, 5);
      const strength = clamp(36 + L.tier * 6.5 + prestige * 3.4 + rng.gauss() * 2.6, 42, 90);
      const colors = KIT_PALETTE[(li * 16 + ci) % KIT_PALETTE.length];
      const club = {
        id: `c${li + 1}${ci < 9 ? '0' : ''}${ci + 1}`,
        name, short: city.split(' ')[0].slice(0, 12), city, leagueId: L.id,
        colors, prestige, strength, playerIds: [],
        budget: Math.round((strength - 38) ** 1.7 * 0.35 * 1e6),
        wageBudget: Math.round((strength - 38) ** 1.5 * 620),
        stadium: `${city.split(' ')[0]} ${rng.pick(['Arena', 'Park', 'Stadium', 'Bowl', 'Coliseum', 'Ground'])}`,
        capacity: ri(rng, 12, 60) * 1200 + (prestige * 4000),
        manager: { name: '', style: rng.pick(['Attacking', 'Balanced', 'Catenaccio', 'Gegenpress', 'Tiki-Taka', 'Counter']), patience: 60 },
        form: [], trophies: { league: 0, cup: 0, continental: 0 }, reputation: Math.round(prestige * 18 + L.tier * 4),
        isPlayerClub: false,
      };
      const mname = namesFor(rng, L.region);
      club.manager.name = `${mname.first} ${mname.last}`;
      leagues[li].clubIds.push(club.id);
      clubs.push(club);

      // squad
      const need = rng.shuffle(SQUAD_SHAPE.concat(rng.chance(0.5) ? ['CM'] : []));
      need.forEach((pos) => {
        const isStar = rng.chance(0.14);
        const target = clamp(strength + rng.gauss() * 4.2 + (isStar ? rng.range(3, 8) : 0), 40, 92);
        const age = rng.weighted([ri(rng, 17, 20), ri(rng, 21, 24), ri(rng, 25, 28), ri(rng, 29, 34)], () => 1);
        const p = makePlayer(rng, { pos, target, league: L, clubId: club.id, age });
        p.notable = isStar || overall(p) >= 82;
        players.push(p);
        club.playerIds.push(p.id);
      });
    });
    league.clubIds = clubs.filter((c) => c.leagueId === L.id).map((c) => c.id);
  });

  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]));

  // club strength = average of best XI
  clubs.forEach((c) => {
    const xi = bestEleven(c.playerIds.map((id) => byId[id]));
    c.strength = Math.round(xi.reduce((s, p) => s + overall(p), 0) / Math.max(1, xi.length));
  });

  // national teams: best 26 players per nation (any league)
  NATIONS.forEach((n) => {
    const [name, code, flag, conf, power] = n;
    const pool = players.filter((p) => p.nation === code).sort((a, b) => overall(b) - overall(a));
    const squadIds = pool.slice(0, 26).map((p) => p.id);
    const top = pool.slice(0, 11);
    const rating = top.length ? Math.round(top.reduce((s, p) => s + overall(p), 0) / top.length) : power;
    const nat = { id: code, name, code, flag, conf, power, rating, squadIds, manager: `${namesFor(rng, 'eu-w').first} ${namesFor(rng, 'eu-w').last}` };
    nations.push(nat);
    byNation[code] = nat;
  });

  return { seed, leagues, clubs, players, nations, byNation, byId, clubById, season: 1, week: 0, year: 2026 };
}

// best XI for an arbitrary pool of players, picking a valid formation shape
export function bestEleven(pool, formationKey = '4-3-3') {
  const slots = FORMATIONS[formationKey].slots.map((s) => s.role);
  const used = new Set();
  const out = [];
  slots.forEach((role, i) => {
    let best = null, bestScore = -1;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      const s = fitScore(p, role) - (i < 1 ? 0 : 0);
      if (s > bestScore) { bestScore = s; best = p; }
    }
    if (best) { used.add(best.id); out.push({ ...best, slotRole: role }); }
  });
  // fall back if the pool is tiny
  for (const p of pool) { if (out.length >= 11) break; if (!used.has(p.id)) { used.add(p.id); out.push({ ...p, slotRole: 'CM' }); } }
  return out;
}

const ROLE_FIT = {
  GK: { GK: 0 }, RB: { RB: 0, LB: -2, CB: -6, DM: -9, RW: -12, CM: -14, AM: -16, LW: -18, ST: -22, GK: -45 },
  LB: { LB: 0, RB: -2, CB: -6, DM: -9, LW: -12, CM: -14, AM: -16, RW: -18, ST: -22, GK: -45 },
  CB: { CB: 0, DM: -5, RB: -6, LB: -6, CM: -12, AM: -20, RW: -22, LW: -22, ST: -25, GK: -45 },
  DM: { DM: 0, CM: -2, CB: -5, AM: -5, RB: -8, LB: -8, CM2: -2, RW: -12, LW: -12, ST: -14, GK: -45 },
  CM: { CM: 0, DM: -3, AM: -3, RW: -6, LW: -6, RB: -9, LB: -9, CB: -12, ST: -10, GK: -45 },
  AM: { AM: 0, CM: -4, RW: -4, LW: -4, ST: -5, DM: -10, RB: -16, LB: -16, CB: -22, GK: -45 },
  RW: { RW: 0, LW: -1, AM: -4, ST: -7, CM: -10, RB: -8, LB: -8, DM: -18, CB: -24, GK: -45 },
  LW: { LW: 0, RW: -1, AM: -4, ST: -7, CM: -10, LB: -8, RB: -8, DM: -18, CB: -24, GK: -45 },
  ST: { ST: 0, AM: -6, RW: -8, LW: -8, CM: -14, DM: -20, CB: -30, RB: -24, LB: -24, GK: -45 },
};

export function fitScore(p, role) {
  const m = ROLE_FIT[role] || {};
  let pen = m[p.pos];
  if (pen == null) pen = m[p.pos2] != null ? m[p.pos2] - 1 : -20;
  if (p.pos2 && m[p.pos2] != null) pen = Math.max(pen, m[p.pos2] - 1);
  return overall(p) + pen;
}

export function effectiveRating(p, role) {
  const m = ROLE_FIT[role] || {};
  let pen = m[p.pos];
  if (p.pos2 && m[p.pos2] != null) pen = Math.max(pen ?? -30, m[p.pos2] - 1);
  if (pen == null) pen = -20;
  return clamp(overall(p) + pen, 20, TUNE.attrMax);
}

// ── fixtures: double round-robin (circle method) ─────────────────────────────
export function makeLeagueRounds(clubIds) {
  const n = clubIds.length;
  const ids = clubIds.slice();
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i], b = ids[n - 1 - i];
      round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    ids.splice(1, 0, ids.pop()); // rotate
  }
  const second = rounds.map((round) => round.map(([a, b]) => [b, a]));
  return rounds.concat(second);
}

export function newTable(clubIds) {
  return clubIds.map((id) => ({ clubId: id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }));
}

export function sortTable(table) {
  return table.slice().sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.clubId.localeCompare(b.clubId));
}

// classify by the roles actually being played (no re-derivation), which keeps
// every formation — wing-backs included — rated on the same scale
export function teamRatingsFromRoles(xi, roles) {
  const atk = [], def = [], mid = [];
  let gk = 62;
  xi.forEach((p, i) => {
    const role = roles[i];
    const r = overall(p);
    if (role === 'GK') { gk = (p.gk ?? r); def.push(r + 1); }
    else if (['CB', 'RB', 'LB'].includes(role)) def.push(r);
    else if (['DM', 'CM', 'AM'].includes(role)) mid.push(r);
    else atk.push(r);
  });
  const avg = (a, d) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : d);
  const m = avg(mid, 58);
  return { atk: avg(atk, m), mid: m, def: avg(def, 58) * 0.94, gk, xi };
}

export function teamRatings(pool) {
  const xi = bestEleven(pool);
  const atk = [], def = [], mid = [];
  xi.forEach((p) => {
    const r = overall(p);
    const role = p.slotRole;
    if (role === 'GK') def.push(r + 2);
    else if (['CB', 'RB', 'LB'].includes(role)) def.push(r);
    else if (['DM', 'CM', 'AM'].includes(role)) mid.push(r);
    else atk.push(r);
  });
  const avg = (a, d = 68) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : d);
  return {
    atk: avg(atk, avg(mid)), mid: avg(mid), def: avg(def) * 0.92, gk: Math.max(...xi.map((p) => (p.pos === 'GK' ? p.gk : 0)), 62),
    xi,
  };
}
