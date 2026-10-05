// ── Match engine ─────────────────────────────────────────────────────────────
// quickResult()   → lightning-fast score + scorers for every other fixture in
//                   the world (thousands per season).
// detailedMatch() → minute-by-minute simulation of the fixture the player is in,
//                   producing his touches, shots, passes, tackles, cards,
//                   minutes played and a 3.0–10.0 rating.

import { Rng, clamp, ri } from './rng.js';
import { overall, fitScore, bestEleven, teamRatings, teamRatingsFromRoles } from './worldgen.js';
import { FORMATIONS } from './data.js';

const ROLE_LINE = { GK: 'GK', RB: 'DF', LB: 'DF', CB: 'DF', DM: 'MF', CM: 'MF', AM: 'MF', RW: 'FW', LW: 'FW', ST: 'FW' };
const SCORE_W = { ST: 1.0, RW: 0.72, LW: 0.72, AM: 0.62, CM: 0.34, DM: 0.16, RB: 0.1, LB: 0.1, CB: 0.12, GK: 0.01 };
const CREATE_W = { AM: 1.0, RW: 0.9, LW: 0.9, CM: 0.62, ST: 0.5, RB: 0.4, LB: 0.4, DM: 0.25, CB: 0.08, GK: 0.03 };

export function poisson(rng, lambda) {
  const L = Math.exp(-clamp(lambda, 0.01, 8));
  let k = 0, p = 1;
  do { k++; p *= rng.f(); } while (p > L);
  return k - 1;
}

function hash01(key, seed) {
  let h = (seed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return (h % 100000) / 100000;
}

export function formFactor(club) {
  if (!club.form || !club.form.length) return 1;
  const pts = club.form.reduce((s, r) => s + (r === 'W' ? 1 : r === 'D' ? 0.5 : 0), 0) / club.form.length;
  return 0.90 + pts * 0.20;
}

export function teamStrengthFrom(world, clubId) {
  const club = world.clubById[clubId];
  const pool = club.playerIds.map((id) => world.byId[id]).filter(Boolean);
  const key = FORMATIONS[club.formation] ? club.formation : '4-3-3';
  const xi = bestEleven(pool.filter((p) => p.injuryWeeks === 0), key);
  return teamRatingsFromRoles(xi, xi.map((p) => p.slotRole || 'CM'));
}

// ── quick simulation ─────────────────────────────────────────────────────────
export function quickResult(world, homeId, awayId, rng, opts = {}) {
  const H = teamStrengthFrom(world, homeId), A = teamStrengthFrom(world, awayId);
  const adv = opts.neutral ? 0 : 3.4;
  const baseH = opts.neutral ? 1.19 : 1.34, baseA = opts.neutral ? 1.19 : 1.04;
  const hForm = formFactor(world.clubById[homeId]), aForm = formFactor(world.clubById[awayId]);
  const lamH = clamp(baseH * ((H.atk + adv) / Math.max(46, A.def + (opts.neutral ? 0 : 2.04))) ** 1.35 * hForm, 0.12, 4.8);
  const lamA = clamp(baseA * ((A.atk + adv * 0.4) / Math.max(46, H.def + adv * 0.6)) ** 1.35 * aForm, 0.10, 4.4);
  const gh = poisson(rng, lamH), ga = poisson(rng, lamA);
  return { gh, ga, homeId, awayId, scorersH: pickScorers(rng, world, homeId, gh), scorersA: pickScorers(rng, world, awayId, ga) };
}

export function pickScorers(rng, world, clubId, goals) {
  const club = world.clubById[clubId];
  const pool = club.playerIds.map((id) => world.byId[id]).filter(Boolean);
  const xi = bestEleven(pool);
  const out = [];
  for (let i = 0; i < goals; i++) {
    const p = rng.weighted(xi, (pl) => (SCORE_W[pl.slotRole] || 0.1) * (0.5 + overall(pl) / 90));
    let assist = rng.chance(0.7) ? rng.weighted(xi, (pl) => (CREATE_W[pl.slotRole] || 0.1) * (0.5 + overall(pl) / 90)) : null;
    if (assist && assist.id === p.id) assist = null;
    out.push({ scorer: p.id, assist: assist ? assist.id : null });
  }
  return out;
}

export function applyResult(table, homeId, awayId, gh, ga) {
  const h = table.find((r) => r.clubId === homeId), a = table.find((r) => r.clubId === awayId);
  if (!h || !a) return;
  h.p++; a.p++; h.gf += gh; h.ga += ga; a.gf += ga; a.ga += gh;
  if (gh > ga) { h.w++; a.l++; h.pts += 3; } else if (ga > gh) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; }
}

export function pushForm(world, clubId, res) {
  const c = world.clubById[clubId];
  c.form.push(res);
  if (c.form.length > 5) c.form.shift();
}

// ── line-up selection (the manager's call) ───────────────────────────────────
export function buildLineup(world, clubId, formationKey, opts = {}) {
  const formation = FORMATIONS[formationKey] || FORMATIONS['4-3-3'];
  const club = world.clubById[clubId];
  const pool = club.playerIds.map((id) => world.byId[id]).filter((p) => p && p.injuryWeeks === 0 && (p.fitness ?? 100) > 35);
  const forcedId = opts.forcedPlayerId || null;
  const trust = opts.trust ?? 50;
  const seed = opts.seed ?? 1;
  const slots = formation.slots.map((s) => s.role);
  const picked = [];
  const used = new Set();
  for (const role of slots) {
    let best = null, bs = -1e9;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      const s = fitScore(p, role) + (hash01(p.id + role, seed) - 0.5) * 3.4 + (p.form || 0) * 0.5;
      if (s > bs) { bs = s; best = p; }
    }
    if (best) { used.add(best.id); picked.push({ player: best, role, score: bs }); }
  }
  // squeeze the user's player in if he is close to the man in his slot
  if (forcedId && !used.has(forcedId)) {
    const me = world.byId[forcedId];
    if (me) {
      const cands = picked
        .map((s) => ({ s, d: fitScore(me, s.role) + trust * 0.16 - s.score }))
        .filter((o) => !(o.s.role === 'GK' && me.pos !== 'GK') && !(o.s.role !== 'GK' && me.pos === 'GK'))
        .sort((a, b) => b.d - a.d);
      if (cands.length && (opts.forceStart || cands[0].d > -1.5)) {
        const { s } = cands[0];
        const i = picked.indexOf(s);
        picked[i] = { player: me, role: s.role, score: fitScore(me, s.role) };
        used.delete(s.player.id); used.add(me.id);
      }
    }
  }
  const xi = picked.map((s) => s.player);
  const roles = picked.map((s) => s.role);
  const bench = pool.filter((p) => !used.has(p.id)).sort((a, b) => overall(b) - overall(a));
  return { xi, roles, bench, formation: formationKey, ratings: teamRatingsFromRoles(xi, roles) };
}

// ── detailed match ───────────────────────────────────────────────────────────
export function detailedMatch(world, opts) {
  const rng = new Rng((opts.seed ?? 1) >>> 0);
  const me = opts.player || null;
  const myClubId = opts.clubId, oppClubId = opts.opponentId;
  const isHome = opts.home !== false;
  const trust = opts.trust ?? 50;

  const line = buildLineup(world, myClubId, opts.formation || '4-3-3', { seed: opts.seed ?? 1, forcedPlayerId: me?.id, trust, forceStart: opts.forceStart });
  const oppLine = buildLineup(world, oppClubId, opts.oppFormation || '4-3-3', { seed: (opts.seed ?? 1) + 7 });
  const M = line.ratings, O = oppLine.ratings;

  const starting = !!me && line.xi.some((p) => p.id === me.id);
  const idx = starting ? line.xi.findIndex((p) => p.id === me.id) : -1;
  const myRole = starting ? line.roles[idx] : null;
  const group = ROLE_LINE[myRole || me?.pos || 'CM'];
  const attr = (k) => {
    if (!me) return 55;
    if (me.attrs) return me.attrs[k] ?? 55;
    return { pac: 48, sho: 32, pas: 58, dri: 44, def: 55, phy: 70 }[k] ?? 55;
  };

  const sideAdv = opts.neutral ? 0 : (isHome ? 3.4 : -3.4);
  const events = [], highlights = [];
  let gh = 0, ga = 0;
  let shotsMine = 0, shotsOpp = 0, sotMine = 0, sotOpp = 0, possMine = 0, possOpp = 0;

  const inbox = (o) => { if (highlights.length < 40) highlights.push(o); return o; };

  const stats = me ? {
    minutes: 0, touches: 0, passes: 0, passesOk: 0, keyPasses: 0, shots: 0, onTarget: 0,
    goals: 0, assists: 0, dribbles: 0, dribblesOk: 0, tackles: 0, interceptions: 0, fouls: 0,
    yellow: 0, red: 0, duels: 0, duelsWon: 0, rating: 0, bigChancesMissed: 0, saves: 0,
    conceded: 0, minutesList: [],
  } : null;

  let onPitch = starting;
  const subOn = starting ? -1 : (me && rng.chance(0.7) ? ri(rng, 46, 78) : -1);
  let subOff = starting && rng.chance(0.3) ? ri(rng, 58, 88) : -1;
  let injured = false;

  const involvementBase = { FW: 0.34, MF: 0.24, DF: 0.11, GK: 0.02 }[group] ?? 0.14;
  const chanceInv = { ST: 0.40, RW: 0.30, LW: 0.30, AM: 0.26, CM: 0.16, DM: 0.10, CB: 0.06, RB: 0.09, LB: 0.09, GK: 0.01 };
  const shootInv = { ST: 0.85, RW: 0.60, LW: 0.60, AM: 0.50, CM: 0.28, DM: 0.12, CB: 0.06, RB: 0.10, LB: 0.10, GK: 0.0 };

  const perf = [];
  const note = (min, kind, text, side = 'my') => inbox({ min, kind, text, side });

  for (let min = 1; min <= 90; min++) {
    if (me && min === subOn && !starting) {
      onPitch = true;
      const replaced = line.xi.slice().sort((a, b) => overall(a) - overall(b))[0];
      note(min, 'sub', `🔄 ${me.full} comes on for ${replaced.full}`, 'my');
    }
    if (me && min === subOff && starting && onPitch) { onPitch = false; note(min, 'sub', `🔄 ${me.full} is subbed off`, 'my'); }

    const pMine = clamp(0.5 + (M.mid + sideAdv * 0.6 - O.mid) / 130, 0.26, 0.74);
    const iAttack = rng.chance(pMine);
    if (iAttack) possMine++; else possOpp++;
    const att = iAttack ? M : O, def = iAttack ? O : M;

    const danger = clamp(0.215 * (att.atk / Math.max(48, def.def)) ** 1.6, 0.05, 0.42);
    if (!rng.chance(danger)) {
      if (onPitch && iAttack && rng.chance(involvementBase * 0.6)) {
        stats.touches++; stats.passes++;
        if (rng.chance(0.72 + (attr('pas') - 60) / 300)) stats.passesOk++;
      } else if (onPitch && !iAttack && rng.chance(0.06)) { stats.tackles++; perf.push(0.5); }
      continue;
    }

    // who shoots?
    let shooterIsMe = false;
    if (onPitch && iAttack && rng.chance(involvementBase * 1.5 * (shootInv[myRole] ?? 0.2) + 0.05)) shooterIsMe = true;
    let shooter;
    if (shooterIsMe) shooter = me;
    else {
      const xi = iAttack ? line.xi : oppLine.xi, roles = iAttack ? line.roles : oppLine.roles;
      const pick = rng.weighted(xi.map((p, i) => ({ p, role: roles[i] })), (o) => (SCORE_W[o.role] || 0.1) * (0.5 + overall(o.p) / 90));
      shooter = pick.p;
    }

    const defQuality = def.def * 0.55 + def.gk * 0.45;
    const shotQ = shooter.pos === 'GK' ? 50 : (shooter.attrs?.sho ?? 55) * 0.6 + (shooter.attrs?.dri ?? 55) * 0.2 + overall(shooter) * 0.2;
    const pGoal = clamp(0.115 + (shotQ - defQuality) * 0.006 + (iAttack ? 0.02 : -0.01), 0.03, 0.44);
    const isGoal = rng.chance(pGoal);
    const onTarget = isGoal || rng.chance(0.58);

    if (iAttack) { shotsMine++; if (onTarget) sotMine++; } else { shotsOpp++; if (onTarget) sotOpp++; }
    if (shooterIsMe) {
      stats.shots++; if (onTarget) stats.onTarget++;
      if (!isGoal && rng.chance(0.22)) stats.bigChancesMissed++;
      perf.push(isGoal ? 3 : onTarget ? 0.6 : -0.5);
    }

    if (isGoal) {
      if (iAttack) gh++; else ga++;
      let assist = null;
      if (rng.chance(0.7)) {
        const xi = iAttack ? line.xi : oppLine.xi, roles = iAttack ? line.roles : oppLine.roles;
        const a = rng.weighted(xi.map((p, i) => ({ p, role: roles[i] })).filter((o) => o.p.id !== shooter.id),
          (o) => (CREATE_W[o.role] || 0.1) * (0.5 + overall(o.p) / 90));
        assist = a ? a.p : null;
      }
      if (onPitch && iAttack && assist && assist.id === me.id) { stats.assists++; perf.push(2.4); }
      const scorerName = shooter.full || shooter.name;
      note(min, isGoal && iAttack ? 'goal' : 'goalOpp',
        iAttack ? `⚽ ${scorerName} scores!${assist ? ` (assist ${assist.full})` : ''}` : `😖 ${scorerName} scores for ${world.clubById[oppClubId].short}`,
        iAttack ? 'my' : 'opp');
      if (shooterIsMe) note(min, 'goalme', `🔥 THAT'S YOUR GOAL, ${me.last?.toUpperCase() || ''}!`, 'my');
    } else if (onTarget) {
      if (onPitch && !iAttack && group === 'GK') { stats.saves++; perf.push(1.2); }
      const keeper = ((iAttack ? oppLine : line).xi.find((p) => p.pos === 'GK')) || {};
      if (shooterIsMe) note(min, 'save', `🧤 ${keeper.full || 'The keeper'} denies you!`, iAttack ? 'my' : 'opp');
      else if (rng.chance(0.3)) note(min, rng.chance(0.5) ? 'save' : 'miss', `💥 ${shooter.full || shooter.name} ${rng.chance(0.5) ? 'is denied by the keeper' : 'shoots just wide'}`, iAttack ? 'my' : 'opp');
    } else if (rng.chance(0.5) && onPitch && !iAttack && ['DF', 'MF'].includes(group)) { stats.interceptions++; perf.push(0.45); }

    // touches around the big moment
    if (onPitch && iAttack) {
      stats.touches += ri(rng, 1, 3);
      if (rng.chance(0.55)) { stats.passes++; if (rng.chance(0.82)) stats.passesOk++; }
      if (!shooterIsMe && rng.chance((chanceInv[myRole] ?? 0.15) * 0.35)) { stats.keyPasses++; perf.push(1.0); }
      if (rng.chance(0.14)) {
        stats.dribbles++;
        if (rng.chance(attr('dri') / 115)) { stats.dribblesOk++; perf.push(0.5); }
      }
    }
    if (onPitch && !iAttack) {
      if (rng.chance(0.3)) stats.touches++;
      if (rng.chance(0.15)) {
        stats.duels++;
        if (rng.chance(0.5 + (attr('phy') - 65) / 150)) {
          stats.duelsWon++;
          if (rng.chance(0.45)) { stats.tackles++; perf.push(0.55); }
        } else { stats.fouls++; perf.push(-0.25); }
      }
    }

    if (onPitch && rng.chance(stats.fouls > 2 ? 0.013 : 0.006)) {
      if (stats.yellow) { stats.red = 1; note(min, 'red', `🟥 ${me.full} is sent off!`, 'my'); onPitch = false; perf.push(-3); }
      else { stats.yellow = 1; note(min, 'yellow', `🟨 ${me.full} goes into the book`, 'my'); perf.push(-0.6); }
    }
    if (onPitch && !injured && rng.chance(0.0035) && min < 86) {
      const wks = ri(rng, 1, 5);
      note(min, 'injury', `🚑 ${me.full} pulls up injured`, 'my');
      opts.injuryOut = wks; injured = true; onPitch = false; subOff = min;
    }
  }

  let rating = 0;
  if (stats) {
    const playedMin = starting ? (subOff > 0 ? subOff : 90) : (subOn > 0 ? 90 - subOn : 0);
    stats.minutes = playedMin;
    const share = clamp(playedMin / 90, 0, 1);
    rating = 5.95 + perf.reduce((s, v) => s + v, 0) * 0.17 * (0.7 + share * 0.3);
    const res = gh > ga ? 0.42 : gh === ga ? 0.08 : -0.32;
    rating += res * share;
    if (group === 'GK' && ga === 0 && playedMin > 25) rating += 0.55;
    if (group === 'DF' && ga === 0 && playedMin > 25) rating += 0.35;
    if (stats.goals) rating += 0.45 * stats.goals;
    if (stats.assists) rating += 0.3;
    if (stats.red) rating -= 1.2;
    rating = clamp(rating, 3, 10);
    stats.rating = Math.round(rating * 10) / 10;
    stats.conceded = ga;
    stats.possession = Math.round((possMine / Math.max(1, possMine + possOpp)) * 100);
    stats.distanceKm = Math.round(playedMin * (group === 'GK' ? 0.055 : group === 'MF' ? 0.125 : 0.115) * 100) / 100;
    stats.sprints = Math.round(playedMin * (group === 'FW' ? 0.22 : group === 'MF' ? 0.18 : 0.12));
  }

  const motm = pickMOTM(world, [{ id: myClubId, xi: line.xi }, { id: oppClubId, xi: oppLine.xi }], { me, stats });

  return {
    gh, ga,
    homeId: isHome ? myClubId : oppClubId, awayId: isHome ? oppClubId : myClubId,
    homeGoals: isHome ? gh : ga, awayGoals: isHome ? ga : gh,
    events: highlights, stats, starting, subOn, subOff, role: myRole,
    lines: { mine: line, opp: oppLine },
    shots: { mine: shotsMine, opp: shotsOpp }, sot: { mine: sotMine, opp: sotOpp },
    possMine: stats ? stats.possession : 50,
    motm, myClubId, oppClubId, competition: opts.competition || 'League',
  };
}

function pickMOTM(world, sides, info) {
  const list = [];
  for (const s of sides) for (const p of s.xi) {
    let score = overall(p) / 12 + hash01(p.id, 7);
    if (info.me && p.id === info.me.id && info.stats) score += (info.stats.rating - 6.4) * 3.2;
    if (info.stats && info.stats.goals && p.id === info.me?.id) score += info.stats.goals * 0.7;
    list.push({ id: p.id, score, name: p.full });
  }
  list.sort((a, b) => b.score - a.score);
  return list[0] || null;
}

// ── knockouts ────────────────────────────────────────────────────────────────
export function playTie(world, aId, bId, rng, opts = {}) {
  const r = quickResult(world, aId, bId, rng, opts);
  let { gh, ga } = r;
  let pens = null;
  if (gh === ga) {
    gh += poisson(rng, 0.34); ga += poisson(rng, 0.30);
    if (gh === ga) {
      const a = ri(rng, 3, 5), b = ri(rng, 3, 5);
      pens = a === b ? [a + 1, b] : [a, b];
      if (pens[0] === pens[1]) pens[1] += 1;
    }
  }
  const winner = gh !== ga ? (gh > ga ? aId : bId) : (pens[0] > pens[1] ? aId : bId);
  return { ...r, gh, ga, pens, winner };
}
