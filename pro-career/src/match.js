// ── Interactive match: plan → decisions → resolve ────────────────────────────
// planMatch()    builds a 90-minute script: every attack, shot, card and goal,
//                plus the "decision windows" where the user's player is on the
//                ball (or facing a shot, as a keeper).
// resolveMatch() applies the user's choices to that script. Each choice scales
//                the script's own probability (≈0.3× for a terrible decision,
//                ≈1.8× for a perfect one), so the match stays statistically
//                balanced: good play beats the model, bad play loses to it.

import { Rng, clamp, ri } from './rng.js';
import { overall, teamRatings } from './worldgen.js';
import { FORMATIONS } from './data.js';
import { buildLineup } from './engine.js';

const ROLE_LINE = { GK: 'GK', RB: 'DF', LB: 'DF', CB: 'DF', DM: 'MF', CM: 'MF', AM: 'MF', RW: 'FW', LW: 'FW', ST: 'FW' };
const SCORE_W = { ST: 1.0, RW: 0.72, LW: 0.72, AM: 0.62, CM: 0.34, DM: 0.16, RB: 0.1, LB: 0.1, CB: 0.12, GK: 0.01 };
const CREATE_W = { AM: 1.0, RW: 0.9, LW: 0.9, CM: 0.62, ST: 0.5, RB: 0.4, LB: 0.4, DM: 0.25, CB: 0.08, GK: 0.03 };

export const MOMENT_TYPES = {
  shot: {
    ar: 'الفرصة ديالك! شنو غادي تدير؟', en: 'Your chance! What do you do?', icon: '⚽',
    options: [
      { key: 'power', ar: 'تسديدة قوية', en: 'Power shot', icon: '💥' },
      { key: 'finesse', ar: 'تسديدة بزاوية', en: 'Finesse', icon: '🎯' },
      { key: 'chip', ar: 'رفعة فوق الحارس', en: 'Chip', icon: '🌈' },
      { key: 'square', ar: 'تمريرة لزميل', en: 'Square it', icon: '🤝' },
    ],
  },
  pass: {
    ar: 'الكرة عندك — فين غادي تمرّر؟', en: 'On the ball — where is the pass?', icon: '🅿️',
    options: [
      { key: 'through', ar: 'تمريرة بين الخطوط', en: 'Through ball', icon: '🪄' },
      { key: 'short', ar: 'تمريرة قصيرة آمنة', en: 'Safe short pass', icon: '🔁' },
      { key: 'cross', ar: 'عرضية فالمنطقة', en: 'Cross', icon: '✝️' },
      { key: 'dribble', ar: 'جري بالكرة', en: 'Carry it', icon: '🏃' },
    ],
  },
  duel: {
    ar: 'الخصم جاي بالكرة — دافع!', en: 'They attack your side — defend!', icon: '🛡️',
    options: [
      { key: 'tackle', ar: 'انزلاق قوي', en: 'Slide tackle', icon: '💪' },
      { key: 'contain', ar: 'حتّو وبقّي قدامو', en: 'Contain', icon: '🧱' },
      { key: 'press', ar: 'ضغط عالي', en: 'Press', icon: '⚡' },
      { key: 'hold', ar: 'تغطية زميل', en: 'Track runner', icon: '👀' },
    ],
  },
  gk: {
    ar: 'تسديدة جاية! قراها!', en: 'Shot incoming — read it!', icon: '🧤',
    options: [
      { key: 'left', ar: 'غير للشمال', en: 'Dive left', icon: '⬅️' },
      { key: 'right', ar: 'غير لليمين', en: 'Dive right', icon: '➡️' },
      { key: 'stand', ar: 'بقى واقف', en: 'Stand tall', icon: '🧍' },
      { key: 'rush', ar: 'خرج بسرعة', en: 'Rush out', icon: '🚀' },
    ],
  },
  penalty: {
    ar: 'پينالتي!', en: 'Penalty!', icon: '🎯',
    options: [
      { key: 'left', ar: 'الشمال بزاوية', en: 'Left corner', icon: '⬅️' },
      { key: 'right', ar: 'اليمين بزاوية', en: 'Right corner', icon: '➡️' },
      { key: 'power', ar: 'قوة فالنص', en: 'Blast down the middle', icon: '💥' },
      { key: 'panenka', ar: 'پانينكا 😎', en: 'Panenka', icon: '🎩' },
    ],
  },
  freekick: {
    ar: 'كرة ثابتة فموقع مزيان', en: 'Free kick in a good spot', icon: '🎯',
    options: [
      { key: 'over', ar: 'فوق الحيط', en: 'Over the wall', icon: '🌉' },
      { key: 'curl', ar: 'منحنية فالزاوية', en: 'Curl it', icon: '🌀' },
      { key: 'low', ar: 'أرضية قوية', en: 'Low and hard', icon: '⬇️' },
      { key: 'cross', ar: 'عرضية فالمنطقة', en: 'Cross it', icon: '✝️' },
    ],
  },
};

function attrOf(p, k) {
  if (!p) return 55;
  if (p.attrs) return p.attrs[k] ?? 55;
  return { pac: 48, sho: 32, pas: 58, dri: 44, def: 55, phy: 70 }[k] ?? 55;
}

// ── plan ─────────────────────────────────────────────────────────────────────
export function planMatch(world, opts) {
  const seed = (opts.seed ?? 1) >>> 0;
  const rng = new Rng(seed);
  const me = opts.player || null;
  const myClubId = opts.clubId, oppClubId = opts.opponentId;
  const isHome = opts.home !== false;
  const trust = opts.trust ?? 50;

  const line = buildLineup(world, myClubId, opts.formation || '4-3-3', { seed, forcedPlayerId: me?.id, trust, forceStart: opts.forceStart });
  const oppLine = buildLineup(world, oppClubId, opts.oppFormation || '4-3-3', { seed: seed + 7717 });
  const M = line.ratings, O = oppLine.ratings;

  const starting = !!me && line.xi.some((p) => p.id === me.id);
  const myIdx = starting ? line.xi.findIndex((p) => p.id === me.id) : -1;
  const myRole = starting ? line.roles[myIdx] : (me ? me.pos : 'CM');
  const group = ROLE_LINE[myRole] || 'MF';
  const subOn = starting ? -1 : (me && rng.chance(0.72) ? ri(rng, 42, 76) : -1);
  const subOff = starting && rng.chance(0.28) ? ri(rng, 58, 88) : -1;

  const sideAdv = opts.neutral ? 0 : (isHome ? 3.4 : -3.4);
  const minutes = [];
  const moments = [];
  const perMin = {};

  // share of the team's dangerous attacks that belongs to the player
  const shootInv = { ST: 0.26, RW: 0.19, LW: 0.19, AM: 0.16, CM: 0.085, DM: 0.04, CB: 0.02, RB: 0.03, LB: 0.03, GK: 0 };
  const createInv = { ST: 0.095, RW: 0.16, LW: 0.16, AM: 0.19, CM: 0.15, DM: 0.08, CB: 0.03, RB: 0.08, LB: 0.08, GK: 0.01 };
  const tackleInv = { DF: 0.17, MF: 0.13, FW: 0.055, GK: 0.9 };

  // Calibrate the chance rate exactly like the quick-sim engine (identical λ
  // formulas), so a match the user plays is statistically the same as one the
  // AI simulates — his decisions are the only extra input.
  const neutral = !!opts.neutral;
  const myBase = neutral ? 1.19 : (isHome ? 1.34 : 1.04), oppBase = neutral ? 1.19 : (isHome ? 1.04 : 1.34);
  const myAtkBonus = neutral ? 0 : (isHome ? 3.4 : 1.36), oppAtkBonus = neutral ? 0 : (isHome ? 1.36 : 3.4);
  const myDefBonus = neutral ? 0 : (isHome ? 2.04 : 0), oppDefBonus = neutral ? 0 : (isHome ? 0 : 2.04);
  const lamMine = clamp(myBase * ((M.atk + myAtkBonus) / Math.max(46, O.def + oppDefBonus)) ** 1.35, 0.12, 4.8);
  const lamOpp = clamp(oppBase * ((O.atk + oppAtkBonus) / Math.max(46, M.def + myDefBonus)) ** 1.35, 0.10, 4.4);
  const dangerMine = clamp(lamMine / 5.2, 0.06, 0.45);
  const dangerOpp = clamp(lamOpp / 5.2, 0.06, 0.42);

  const addMoment = (mo) => { mo.id = 'm' + moments.length; moments.push(mo); return mo; };

  for (let t = 1; t <= 90; t++) {
    const onPitch = !!me && ((starting && t <= (subOff > 0 ? subOff : 90)) || (!starting && subOn > 0 && t >= subOn));
    const rec = { t, side: null, kind: 'nothing', scorerId: null, assistId: null, momentId: null };
    if (onPitch) perMin[t] = { touches: 0, passAtt: 0, passOk: 0 };

    const pMine = clamp(0.5 + (M.mid + sideAdv * 0.6 - O.mid) / 130, 0.26, 0.74);
    const iAttack = rng.chance(pMine);
    rec.side = iAttack ? 'mine' : 'opp';
    const def = iAttack ? O : M;
    const danger = iAttack ? dangerMine : dangerOpp;

    if (!rng.chance(danger)) {
      const pm = perMin[t];
      if (pm && iAttack && rng.chance(0.42)) {
        pm.touches++;
        if (rng.chance(0.62)) { pm.passAtt++; if (rng.chance(0.72 + (attrOf(me, 'pas') - 60) / 300)) pm.passOk++; }
      }
      minutes.push(rec);
      continue;
    }

    // ── the attack: does the player take it himself? ──
    let handled = false;
    if (onPitch && iAttack && me) {
      const invShot = (shootInv[myRole] ?? 0.05) * (0.75 + attrOf(me, 'sho') / 260);
      const invPass = (createInv[myRole] ?? 0.06) * (0.8 + attrOf(me, 'pas') / 300);
      const r = rng.f();
      if (r < invShot) {
        const defQ = def.def * 0.55 + def.gk * 0.45;
        const shotQ = attrOf(me, 'sho') * 0.6 + attrOf(me, 'dri') * 0.2 + overall(me) * 0.2;
        const pGoal = clamp(0.088 + (shotQ - defQ) * 0.006, 0.025, 0.4);
        const ctx = {
          range: 6 + Math.round(rng.range(0, 18)), angle: rng.chance(0.5) ? 'central' : (rng.chance(0.5) ? 'left' : 'right'),
          keeperRushed: rng.chance(0.22), openTeammate: rng.chance(0.45), defenders: ri(rng, 0, 4),
          bigChance: rng.chance(0.35), pGoal,
        };
        addMoment({ t, type: 'shot', side: 'mine', ctx, decision: null });
        rec.kind = 'moment'; rec.momentId = 'm' + (moments.length - 1);
        perMin[t].touches++;
        handled = true;
      } else if (r < invShot + invPass) {
        const ctx = {
          runners: ri(rng, 0, 3), pressing: ri(rng, 0, 3), space: rng.chance(0.5),
          third: t < 30 ? 'own' : t < 60 ? 'middle' : 'final', lane: rng.pick(['left', 'center', 'right']),
          defenderNear: ri(rng, 0, 2),
        };
        addMoment({ t, type: 'pass', side: 'mine', ctx, decision: null });
        rec.kind = 'moment'; rec.momentId = 'm' + (moments.length - 1);
        perMin[t].touches++;
        handled = true;
      }
    }

    if (!handled) {
      // a normal shot by somebody else — the script's own outcome
      const xi = iAttack ? line.xi : oppLine.xi, roles = iAttack ? line.roles : oppLine.roles;
      const pick = rng.weighted(xi.map((p, i) => ({ p, role: roles[i] })), (o) => (SCORE_W[o.role] || 0.1) * (0.5 + overall(o.p) / 90));
      const shooter = pick.p;
      const defQuality = def.def * 0.55 + def.gk * 0.45;
      const shotQ = shooter.pos === 'GK' ? 50 : attrOf(shooter, 'sho') * 0.6 + attrOf(shooter, 'dri') * 0.2 + overall(shooter) * 0.2;
      const pGoal = clamp(0.088 + (shotQ - defQuality) * 0.006, 0.03, 0.42);
      const goal = rng.chance(pGoal);
      const onTarget = goal || rng.chance(0.6);
      rec.scorerId = shooter.id;
      if (goal) {
        rec.kind = 'goal';
        rec.assistId = rng.chance(0.72) ? rng.weighted(xi.map((p, i) => ({ p, role: roles[i] })).filter((o) => o.p.id !== shooter.id),
          (o) => (CREATE_W[o.role] || 0.1) * (0.5 + overall(o.p) / 90) * (o.p.id === me?.id ? 0.45 : 1)).p.id : null;
      } else rec.kind = onTarget ? 'save' : 'miss';

      // ── the player's defensive decision window on this attack ──
      if (onPitch && !iAttack && me) {
        const inv = (tackleInv[group] ?? 0.1);
        if (rng.chance(inv)) {
          const isGkStop = group === 'GK' && (rec.kind === 'goal' || rec.kind === 'save');
          const mo = addMoment({
            t, type: isGkStop ? 'gk' : 'duel', side: 'opp',
            ctx: {
              threat: rec.kind === 'goal' ? 'deadly' : 'normal', side: rng.pick(['left', 'center', 'right']),
              support: rng.chance(0.55), opponentSkill: Math.round(O.atk - 55 + rng.range(-8, 8)),
              shotSide: rng.pick(['left', 'center', 'right']), shotPower: rng.range(0.5, 1), targetRecord: rec.kind,
            },
            decision: null,
          });
          rec.momentId = mo.id;
        }
      }
    }

    // set pieces
    if (!handled && onPitch && ['ST', 'AM', 'RW', 'LW', 'CM'].includes(myRole)) {
      if (rec.kind !== 'goal' && rng.chance(0.0015)) {
        const mo = addMoment({ t, type: 'penalty', side: 'mine', ctx: { keeperSide: rng.pick(['left', 'center', 'right']) }, decision: null });
        rec.kind = 'moment'; rec.momentId = mo.id; handled = true;
      } else if (iAttack && rec.kind !== 'goal' && rng.chance(0.0016)) {
        const mo = addMoment({ t, type: 'freekick', side: 'mine', ctx: { distance: ri(rng, 18, 30), wall: ri(rng, 3, 5) }, decision: null });
        rec.kind = 'moment'; rec.momentId = mo.id; handled = true;
      }
    }

    minutes.push(rec);
  }

  // off-ball events for the user
  const cardMin = me && starting && rng.chance(0.09) ? ri(rng, 20, 85) : -1;
  const secondYellow = cardMin > 0 && rng.chance(0.12);
  const injuryMin = me && rng.chance(0.05) ? ri(rng, 15, 84) : -1;

  return {
    seed, home: isHome, myClubId, oppClubId, competition: opts.competition || 'League',
    line, oppLine, M, O, minutes, moments, perMin, starting, subOn, subOff,
    myRole, group, cardMin, secondYellow, injuryMin, injuries: injuryMin > 0 ? ri(rng, 1, 5) : 0,
    neutral: !!opts.neutral, trust, meId: me?.id ?? null, meName: me?.full ?? '',
  };
}

// ── option evaluation: how well does this choice fit the situation? ──────────
export function evalOption(plan, moment, key, player, rng) {
  const jitter = rng ? (rng.f() - 0.5) * 0.26 : 0;
  const A = (k) => attrOf(player, k);
  const ctx = moment.ctx || {};
  let q = 0.5;
  if (moment.type === 'shot') {
    if (key === 'power') q = 0.44 + (A('sho') - 62) / 130 + (ctx.range < 14 ? 0.18 : -0.06) - ctx.defenders * 0.05 + (ctx.bigChance ? 0.06 : 0);
    else if (key === 'finesse') q = 0.42 + (A('sho') - 62) / 140 + (ctx.angle !== 'central' ? 0.16 : 0.03) - ctx.defenders * 0.03 + (ctx.keeperRushed ? 0.14 : 0);
    else if (key === 'chip') q = 0.20 + (A('dri') - 60) / 150 + (ctx.keeperRushed ? 0.5 : -0.04) - ctx.defenders * 0.025;
    else if (key === 'square') q = 0.44 + (A('pas') - 62) / 165 + (ctx.openTeammate ? 0.3 : -0.26);
    if (ctx.bigChance) q += 0.05;
  } else if (moment.type === 'pass') {
    if (key === 'through') q = 0.34 + (A('pas') - 62) / 120 + (ctx.runners > 1 ? 0.24 : ctx.runners === 1 ? 0.08 : -0.14) - ctx.pressing * 0.06 + (ctx.third === 'final' ? 0.06 : 0);
    else if (key === 'short') q = 0.7 + (A('pas') - 62) / 200 - ctx.defenderNear * 0.05;
    else if (key === 'cross') q = 0.32 + (A('pas') - 62) / 130 + (ctx.lane !== 'center' ? 0.15 : -0.1) + (ctx.third === 'final' ? 0.1 : -0.08) - ctx.pressing * 0.03;
    else if (key === 'dribble') q = 0.36 + (A('dri') - 62) / 120 + (ctx.space ? 0.22 : -0.12) - ctx.defenderNear * 0.09;
  } else if (moment.type === 'duel') {
    const target = ctx.threat === 'deadly' ? 'aggressive' : 'patient';
    if (key === 'tackle') q = (target === 'aggressive' ? 0.56 : 0.30) + (A('def') - 62) / 130 - Math.max(0, ctx.opponentSkill) * 0.012;
    else if (key === 'contain') q = (target === 'patient' ? 0.62 : 0.42) + (A('def') - 62) / 150 + (ctx.support ? 0.16 : -0.04);
    else if (key === 'press') q = (target === 'aggressive' ? 0.6 : 0.38) + (A('phy') - 62) / 140 + (A('pac') - 60) / 200;
    else if (key === 'hold') q = (ctx.side !== 'center' ? 0.6 : 0.44) + (A('def') - 62) / 170;
  } else if (moment.type === 'gk') {
    if (key === 'left' || key === 'right') q = 0.52 + (A('phy') - 60) / 300 + (ctx.shotPower < 0.8 ? 0.12 : -0.06);
    else if (key === 'stand') q = 0.46 + (A('def') - 60) / 250;
    else q = 0.42 + (A('pac') - 55) / 300;
  } else if (moment.type === 'penalty') {
    const keeper = ctx.keeperSide;
    if (key === 'left') q = keeper === 'left' ? 0.34 : 0.94;
    else if (key === 'right') q = keeper === 'right' ? 0.34 : 0.94;
    else if (key === 'power') q = keeper === 'center' ? 0.66 : 0.9;
    else q = keeper === 'center' ? 0.22 : 0.88;
  } else if (moment.type === 'freekick') {
    if (key === 'over') q = 0.28 + (A('sho') - 62) / 130 - ctx.wall * 0.03;
    else if (key === 'curl') q = 0.32 + (A('sho') - 62) / 120 + (A('dri') - 60) / 250 + (ctx.distance > 24 ? 0.06 : -0.04);
    else if (key === 'low') q = 0.3 + (A('sho') - 55) / 140 + (ctx.distance < 24 ? 0.1 : -0.06);
    else q = 0.34 + (A('pas') - 62) / 130 + (ctx.distance > 24 ? 0.12 : 0);
  }
  return clamp(q + jitter, 0.02, 0.99);
}

export function defaultDecision(plan, moment, player, rng) {
  const keys = MOMENT_TYPES[moment.type].options.map((o) => o.key);
  let bestKey = keys[0], bestQ = -1;
  for (const k of keys) {
    const noisy = evalOption(plan, moment, k, player, null) + (rng ? rng.range(-0.24, 0.2) : 0);
    if (noisy > bestQ) { bestQ = noisy; bestKey = k; }
  }
  return bestKey;
}

// maps an execution quality to a probability multiplier on the scripted event
function mult(q) { return clamp(0.34 + 1.5 * clamp(q - 0.2, 0, 0.8), 0.3, 1.5); }

// ── resolve (step by step, so the UI can play a match live) ─────────────────
// createRunner() exposes tick(minute) / needsDecision(minute) / result(), so a
// UI can animate the 90 minutes, pause on the player's decision windows, and
// still get exactly the same numbers as a headless simulation.
export function createRunner(world, plan, rngSeed = null) {
  const rng = new Rng((rngSeed ?? plan.seed + 991) >>> 0);
  const me = plan.meId ? world.byId[plan.meId] : null;
  const stats = me ? {
    minutes: 0, touches: 0, passes: 0, passesOk: 0, keyPasses: 0, shots: 0, onTarget: 0, goals: 0,
    assists: 0, dribbles: 0, dribblesOk: 0, tackles: 0, interceptions: 0, fouls: 0, yellow: 0, red: 0,
    duels: 0, duelsWon: 0, rating: 0, bigChancesMissed: 0, saves: 0, conceded: 0, penaltyTaken: 0,
    penaltyScored: 0, distanceKm: 0, sprints: 0, decisions: 0, goodDecisions: 0,
  } : null;
  const momentById = Object.fromEntries(plan.moments.map((m) => [m.id, m]));
  const highlights = [];
  const perf = [];
  let gh = 0, ga = 0, shotsMine = 0, shotsOpp = 0, sotMine = 0, sotOpp = 0;
  let onPitch = plan.starting, subOffDone = false;
  const lastMinute = [];

  const log = (min, kind, text, side = 'my') => {
    if (highlights.length < 70) highlights.push({ min, kind, text, side });
    lastMinute.push({ min, kind, text, side });
  };

  function needsDecision(t) {
    const rec = plan.minutes[t - 1];
    if (!rec || !rec.momentId) return null;
    const mo = momentById[rec.momentId];
    return mo && !mo.decision ? mo : null;
  }

  function tick(t, decisions = {}) {
    lastMinute.length = 0;
    if (plan.subOn > 0 && t === plan.subOn && !plan.starting && me) { onPitch = true; log(t, 'sub', `🔄 ${me.full} comes on`, 'my'); }
    if (plan.subOff > 0 && t === plan.subOff && plan.starting && !subOffDone) { onPitch = false; subOffDone = true; log(t, 'sub', `🔄 ${me.full} is subbed off`, 'my'); }
    if (plan.cardMin === t && me) {
      if (plan.secondYellow) { if (stats) stats.red = 1; log(t, 'red', `🟥 Second yellow — ${me.full} is off!`, 'my'); if (plan.group !== 'GK') onPitch = false; }
      else { if (stats) stats.yellow = 1; log(t, 'yellow', `🟨 ${me.full} is booked`, 'my'); }
    }
    if (plan.injuryMin === t && me) { log(t, 'injury', `🚑 ${me.full} goes down injured`, 'my'); onPitch = false; subOffDone = true; }

    const rec = plan.minutes[t - 1];
    if (!rec) return lastMinute;
    const pm = plan.perMin[t];
    if (onPitch && pm && stats) { stats.touches += pm.touches; stats.passes += pm.passAtt; stats.passesOk += pm.passOk; }

    // a decision window that replaces the attack
    if (rec.kind === 'moment' && rec.momentId) {
      const mo = momentById[rec.momentId];
      const key = decisions[mo.id] || mo.decision || defaultDecision(plan, mo, me, rng);
      mo.decision = key;
      const q = evalOption(plan, mo, key, me, rng);
      if (stats) { stats.decisions++; if (q > 0.62) stats.goodDecisions++; }

      if (mo.type === 'shot') {
        if (stats) stats.shots++;
        shotsMine++;
        if (key === 'square') {
          if (q >= 0.66 && rng.chance(0.16 + (mo.ctx.bigChance ? 0.05 : 0))) {
            gh++; sotMine++;
            const mate = plan.line.xi[ri(rng, 0, plan.line.xi.length - 1)];
            if (stats) { stats.keyPasses++; stats.assists++; }
            perf.push(2.9);
            log(t, 'goal', `⚽ ${mate.full} scores from your square ball — ASSIST!`, 'my');
          } else {
            if (stats) stats.keyPasses++;
            perf.push(0.7);
            log(t, 'pass', `You square it — cleared away`, 'my');
          }
        } else {
          const p = clamp(mo.ctx.pGoal * mult(q), 0.005, 0.85);
          if (rng.chance(p)) {
            gh++; sotMine++;
            if (stats) { stats.goals++; stats.onTarget++; }
            perf.push(3.2);
            log(t, 'goal', `⚽⚽ GOOOAL! ${me.full} scores!`, 'my');
          } else if (rng.chance(0.5)) {
            sotMine++;
            if (stats) { stats.onTarget++; stats.bigChancesMissed++; }
            perf.push(0.5);
            log(t, 'save', `🧤 Your shot is saved!`, 'my');
          } else {
            if (stats) stats.bigChancesMissed++;
            perf.push(-0.8);
            log(t, 'miss', `😩 You drag it wide`, 'my');
          }
        }
      } else if (mo.type === 'pass') {
        if (stats) stats.passes++;
        const complete = rng.chance(clamp(0.32 + (q - 0.3) * 1.15, 0.12, 0.96));
        if (complete) {
          if (stats) { stats.passesOk++; stats.touches++; }
          perf.push(0.25);
          const big = ((key === 'through' || key === 'cross') && q >= 0.62) || q >= 0.86;
          if (big) {
            if (stats) stats.keyPasses++;
            perf.push(0.9);
            if (rng.chance(clamp(0.075 + mo.ctx.runners * 0.03 + (q - 0.6) * 0.24, 0.02, 0.28))) {
              shotsMine++;
              if (rng.chance(0.27)) {
                gh++; sotMine++;
                const mate = plan.line.xi[ri(rng, 0, plan.line.xi.length - 1)];
                if (stats) stats.assists++;
                perf.push(2.7);
                log(t, 'goal', `⚽ ${mate.full} finishes your ball — ASSIST!`, 'my');
              } else log(t, 'save', `Chance created by you — saved`, 'my');
            } else log(t, 'pass', `Brilliant ball from ${me.full}`, 'my');
          }
        } else {
          perf.push(-0.4);
          log(t, 'miss', `Your pass goes astray`, 'my');
        }
      } else if (mo.type === 'penalty') {
        if (stats) stats.penaltyTaken++;
        shotsMine++;
        const p = clamp(mult(q) * 0.62, 0.05, 0.95);
        if (rng.chance(p)) { gh++; sotMine++; if (stats) { stats.goals++; stats.penaltyScored++; stats.onTarget++; } perf.push(3.0); log(t, 'goal', `🎯 Penalty buried by ${me.full}!`, 'my'); }
        else { perf.push(-2.2); log(t, 'miss', `❌ Penalty missed!`, 'my'); }
      } else if (mo.type === 'freekick') {
        shotsMine++;
        const p = clamp(mult(q) * (mo.ctx.distance < 22 ? 0.1 : 0.06), 0.01, 0.4);
        if (rng.chance(p)) { gh++; sotMine++; if (stats) { stats.goals++; stats.onTarget++; stats.shots++; } perf.push(3.0); log(t, 'goal', `🎯 Free kick GOAL by ${me.full}!`, 'my'); }
        else if (rng.chance(0.5)) { sotMine++; if (stats) { stats.shots++; stats.onTarget++; } perf.push(0.4); log(t, 'save', `Your free kick is saved`, 'my'); }
        else { if (stats) stats.shots++; perf.push(-0.4); log(t, 'miss', `Free kick into the wall`, 'my'); }
      }
      return lastMinute;
    }

    // a decision window layered on top of the scripted attack
    let denied = false, concededBonus = false;
    if (rec.momentId) {
      const mo = momentById[rec.momentId];
      const key = decisions[mo.id] || mo.decision || defaultDecision(plan, mo, me, rng);
      mo.decision = key;
      const q = evalOption(plan, mo, key, me, rng);
      if (stats) { stats.decisions++; if (q > 0.62) stats.goodDecisions++; }
      if (mo.type === 'gk') {
        const guessed = key === mo.ctx.shotSide || (key === 'stand' && mo.ctx.shotSide === 'center');
        const saved = guessed ? rng.chance(clamp(0.35 + (q - 0.4) * 0.9, 0.2, 0.95)) : rng.chance(clamp((q - 0.8) * 1.2, 0.02, 0.5));
        if (saved) {
          denied = true;
          if (stats) { stats.saves++; perf.push(rec.kind === 'goal' ? 2.2 : 1.2); }
          log(t, 'save', `🧤 WHAT A SAVE! ${me.full} keeps it out!`, 'my');
        } else if (rec.kind === 'save') {
          concededBonus = true;
          if (stats) perf.push(-1.3);
          log(t, 'goalOpp', `😖 You dive the wrong way — goal`, 'opp');
        } else if (stats) perf.push(-0.9);
      } else {
        if (stats) stats.duels++;
        const won = rng.chance(clamp(0.12 + (q - 0.3) * 1.2, 0.05, 0.92));
        if (won) {
          denied = true;
          if (stats) { stats.duelsWon++; stats.tackles++; }
          perf.push(0.9);
          log(t, 'tackle', `💪 ${me.full} wins the ball back`, 'my');
          if (rng.chance(0.08)) {
            const mate = plan.line.xi[ri(rng, 0, plan.line.xi.length - 1)];
            if (rng.chance(0.2)) { gh++; shotsMine++; sotMine++; log(t, 'goal', `⚡ Counter-attack! ${mate.full} scores`, 'my'); }
          }
        } else if (key === 'tackle' && q < 0.3 && rng.chance(0.7)) {
          if (stats) stats.fouls++;
          perf.push(-0.9);
          log(t, 'foul', `😬 You give away a free kick`, 'my');
          if (rec.kind !== 'goal' && rng.chance(0.08)) { ga++; concededBonus = true; log(t, 'goalOpp', `😖 They score from the free kick`, 'opp'); }
        } else if (stats) perf.push(-0.5);
      }
    }

    // the scripted outcome for this minute
    if (rec.kind === 'goal') {
      const scorer = world.byId[rec.scorerId];
      const assist = rec.assistId ? world.byId[rec.assistId] : null;
      if (denied) {
        if (rec.side === 'mine') { shotsMine++; sotMine++; log(t, 'save', `🧤 ${scorer ? scorer.full : 'The shot'} is stopped`, 'my'); }
        else { shotsOpp++; sotOpp++; log(t, 'save', `🧤 You deny ${scorer ? scorer.full : 'them'}!`, 'opp'); }
      } else if (rec.side === 'mine') {
        gh++; shotsMine++; sotMine++;
        log(t, 'goal', `⚽ ${scorer ? scorer.full : 'Goal'} scores${assist ? ` (${assist.full})` : ''}`, 'my');
      } else {
        ga++; shotsOpp++; sotOpp++;
        log(t, 'goalOpp', `😖 ${scorer ? scorer.full : 'They'} score for ${world.clubById[plan.oppClubId].short}`, 'opp');
      }
      if (!denied && assist && me && assist.id === me.id && stats) { stats.assists++; perf.push(1.6); }
    } else if (rec.kind === 'save') {
      if (rec.side === 'mine') { shotsMine++; sotMine++; } else { shotsOpp++; sotOpp++; }
      if (concededBonus && rec.side === 'opp') { ga++; shotsOpp++; sotOpp++; }
      const shooter = world.byId[rec.scorerId];
      if (rec.side === 'mine' && rng.chance(0.5)) log(t, 'save', `🧤 ${shooter ? shooter.full : 'Shot'} denied by the keeper`, 'my');
      else if (rec.side === 'opp' && rng.chance(0.35) && !denied) log(t, 'save', `🧤 ${shooter ? shooter.full : 'Shot'} is saved`, 'opp');
    } else if (rec.kind === 'miss') {
      if (rec.side === 'mine') shotsMine++; else shotsOpp++;
      const shooter = world.byId[rec.scorerId];
      if (rng.chance(0.3)) log(t, 'miss', `↗️ ${shooter ? shooter.full : 'Shot'} off target`, rec.side === 'mine' ? 'my' : 'opp');
    }
    return lastMinute;
  }

  function result() {
    let rating = 0;
    if (stats) {
      const playedMin = plan.starting ? (plan.subOff > 0 ? plan.subOff : 90) : (plan.subOn > 0 ? 90 - plan.subOn : 0);
      stats.minutes = playedMin;
      const share = clamp(playedMin / 90, 0, 1);
      rating = 6.1 + perf.reduce((s, v) => s + v, 0) * 0.17 * (0.7 + share * 0.3);
      const res = gh > ga ? 0.42 : gh === ga ? 0.08 : -0.32;
      rating += res * share;
      if (plan.group === 'GK' && ga === 0 && playedMin > 25) rating += 0.6;
      if (plan.group === 'DF' && ga === 0 && playedMin > 25) rating += 0.35;
      if (stats.goals) rating += 0.42 * stats.goals;
      if (stats.assists) rating += 0.28;
      if (stats.red) rating -= 1.3;
      rating = clamp(rating, 3, 10);
      stats.rating = Math.round(rating * 10) / 10;
      stats.conceded = ga;
      stats.distanceKm = Math.round(playedMin * (plan.group === 'GK' ? 0.055 : plan.group === 'MF' ? 0.125 : 0.115) * 100) / 100;
      stats.sprints = Math.round(playedMin * (plan.group === 'FW' ? 0.22 : plan.group === 'MF' ? 0.18 : 0.12));
    }
    let motm = plan.line.xi[0]?.id, best = -99;
    const winners = gh > ga ? plan.line.xi : gh < ga ? plan.oppLine.xi : [...plan.line.xi, ...plan.oppLine.xi];
    for (const p of [...plan.line.xi, ...plan.oppLine.xi]) {
      let s = overall(p) / 14 + rng.f() * 1.1 + (winners.includes(p) ? 0.6 : 0);
      if (me && p.id === me.id && stats) {
        s = overall(p) / 14 + 0.55 + (gh > ga ? 0.6 : 0) + Math.max(0, stats.rating - 7.45) * 1.9 + stats.goals * 0.9 + stats.assists * 0.4;
      }
      if (s > best) { best = s; motm = p.id; }
    }
    return {
      gh, ga,
      homeId: plan.home ? plan.myClubId : plan.oppClubId,
      awayId: plan.home ? plan.oppClubId : plan.myClubId,
      myGoals: gh, oppGoals: ga,
      events: highlights, stats, motm,
      starting: plan.starting, role: plan.myRole, minutes: stats ? stats.minutes : 0,
      shots: { mine: shotsMine, opp: shotsOpp }, sot: { mine: sotMine, opp: sotOpp },
      possession: clamp(Math.round(50 + (plan.M.mid - plan.O.mid) * 0.8 * (plan.home ? 1 : -1)), 25, 75),
      competition: plan.competition, plan,
    };
  }

  return { tick, needsDecision, result, stats, state: () => ({ gh, ga, stats, highlights }) };
}

// headless version of the same thing
export function resolveMatch(world, plan, decisions = {}, rngSeed = null) {
  const runner = createRunner(world, plan, rngSeed);
  for (let t = 1; t <= 90; t++) runner.tick(t, decisions);
  return runner.result();
}

export function planToTimeline(plan) { return plan.minutes.map((r, i) => ({ ...r, min: i + 1 })); }
