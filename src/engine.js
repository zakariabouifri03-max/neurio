/* ============================================================
   Botola 25 — engine.js
   The match simulation: ball physics, player movement, team AI,
   goalkeeping, restarts, match clock and rules.

   100 % pure JS (no DOM, no Three.js) so the whole engine can be
   unit-tested head-less in Node — see tools/sim-test.mjs
   ============================================================ */

import { PITCH, FORMATION, homeSpot } from './data.js';
import { clamp, lerp, dist2D, norm2D, rngFrom, TAU, damp } from './util.js';

const G = 18.6;             // game-feel gravity (m/s²)
const BALL_DRAG = 0.10;
const BALL_ROLL = 2.9;      // rolling deceleration (m/s²)
const CTRL_R = 0.85;        // control radius (m)
const H = PITCH.HX, W = PITCH.HZ;

export const ST = {
  KICKOFF: 'kickoff', PLAY: 'play', THROW: 'throwin', GOALKICK: 'goalkick',
  CORNER: 'corner', FREEKICK: 'freekick', GOAL: 'goal', HALF: 'half', FULL: 'full',
};

/* ------------------------------------------------------------------ */
export function createMatch(cfg) {
  const rng = rngFrom(cfg.seed || 12345);
  const halfSeconds = cfg.halfSeconds || 120;

  const m = {
    cfg, rng, halfSeconds,
    teams: [
      mkTeam(cfg.home, cfg.squads[0], +1, 0),
      mkTeam(cfg.away, cfg.squads[1], -1, 1),
    ],
    players: [],
    ball: { p: { x: 0, y: PITCH.BALL_R, z: 0 }, v: { x: 0, y: 0, z: 0 }, owner: -1, lastTouch: -1, lockT: 0, spin: 0, trail: [] },
    state: ST.KICKOFF,
    stateT: 0,
    restart: null,
    clock: 0,          // real seconds played
    minute: 0,
    half: 1,
    human: cfg.human === undefined ? 0 : cfg.human,   // which team the user drives
    aiLevel: cfg.aiLevel || 1,
    active: -1,
    events: [],
    msg: '',
    msgT: 0,
    possession: [0, 0],
    shots: [0, 0],
    onTarget: [0, 0],
    passCount: [0, 0],
    over: false,
    result: null,
    // transient flags set by the UI layer each frame
    input: { mx: 0, mz: 0, sprint: false, pass: false, shoot: false, shootHold: 0, switch: false, tackle: false },
    _acc: 0,
  };

  m.teams.forEach((t) => t.players.forEach((p) => m.players.push(p)));
  m.players.forEach((p, i) => (p.i = i));

  setupKickoff(m, 0, true);
  return m;
}

function mkTeam(club, squad, dir, idx) {
  return {
    idx, club, dir, squad, score: 0,
    players: squad.map((s, i) => ({
      team: idx, slot: i, role: s.role, data: s,
      p: { x: 0, y: 0, z: 0 }, v: { x: 0, z: 0 },
      face: dir > 0 ? 0 : Math.PI,
      home: homeSpot(FORMATION[i], dir),
      target: { x: 0, z: 0 },
      state: 'run', anim: Math.random() * TAU, speed: 0,
      controlT: 0, kickT: 0, stunT: 0, diveT: 0, celebT: 0,
      hasBall: false, roleTask: 'home',
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Set-ups                                                            */
/* ------------------------------------------------------------------ */
export function setupKickoff(m, teamIdx, initial) {
  const kickDir = m.teams[teamIdx].dir;   // team taking the kick-off attacks this way
  m.ball.p.x = 0; m.ball.p.z = 0; m.ball.p.y = PITCH.BALL_R;
  m.ball.v.x = m.ball.v.y = m.ball.v.z = 0;
  m.ball.owner = -1; m.ball.lockT = 0; m.ball.lastTouch = -1;

  m.teams.forEach((t) => {
    t.players.forEach((pl, i) => {
      const spot = t.dir === kickDir
        ? { x: Math.min(-2.5, homeSpot(FORMATION[i], t.dir).x), z: homeSpot(FORMATION[i], t.dir).z }
        : homeSpot(FORMATION[i], t.dir);
      pl.p.x = spot.x; pl.p.z = spot.z; pl.p.y = 0;
      pl.v.x = pl.v.z = 0;
      pl.face = t.dir > 0 ? 0 : Math.PI;
      pl.state = 'idle'; pl.stunT = 0; pl.diveT = 0;
      pl.home = homeSpot(FORMATION[i], t.dir);
    });
  });
  // one striker steps to the ball
  const st = m.teams[teamIdx].players[9];
  st.p.x = -1.1 * kickDir; st.p.z = 0.5; st.face = kickDir > 0 ? 0 : Math.PI;

  m.state = ST.KICKOFF;
  m.stateT = initial ? 1.2 : 1.4;
  m.restart = { type: 'kickoff', team: teamIdx };
  m.msg = initial ? '⚽ Coup d’envoi!' : '⚽ Coup d’envoi';
  m.msgT = 1.8;
}

function placeRestart(m, type, team, spot) {
  m.ball.p.x = spot.x; m.ball.p.z = spot.z; m.ball.p.y = PITCH.BALL_R;
  m.ball.v.x = m.ball.v.y = m.ball.v.z = 0;
  m.ball.owner = -1; m.ball.lockT = 0.9;
  m.state = type;
  m.stateT = 1.0;
  m.restart = { type, team, spot };
  // nearest team-mate collects it
  const t = m.teams[team];
  let best = null, bd = 1e9;
  t.players.forEach((pl) => {
    if (pl.role === 'GK' && type !== ST.GOALKICK) return;
    const d = dist2D(pl.p, spot);
    if (d < bd) { bd = d; best = pl; }
  });
  if (best) { best.p.x = spot.x - t.dir * 0.6; best.p.z = spot.z + 0.4; }
  return best;
}

/* ------------------------------------------------------------------ */
/*  Public entry point                                                 */
/* ------------------------------------------------------------------ */
export function stepMatch(m, dt, input) {
  if (input) {
    m.input.mx = input.mx || 0;
    m.input.mz = input.mz || 0;
    m.input.sprint = !!input.sprint;
    m.input.pass = !!input.pass;
    m.input.tackle = !!input.tackle;
    m.input.switch = !!input.switch;
    if (input.shootHeld !== undefined) {
      if (input.shootHeld) m.input.shootHold = Math.min(1, m.input.shootHold + dt * 1.25);
      else if (m.input.shootHold > 0) { m.input.shoot = true; }
    }
  }
  dt = Math.min(dt, 0.05);
  m._acc += dt;
  const h = 1 / 120;
  let guard = 0;
  while (m._acc >= h && guard++ < 12) {
    m._acc -= h;
    fixed(m, h);
  }
  m.input.pass = m.input.tackle = m.input.switch = m.input.shoot = false;
}

function fixed(m, dt) {
  m.stateT -= dt;
  if (m.msgT > 0) m.msgT -= dt;

  if (m.state === ST.FULL) { updateLoose(m, dt); return; }

  if (m.state === ST.GOAL) {
    celebrate(m, dt);
    updateLoose(m, dt);
    if (m.stateT <= 0) {
      if (m.minute >= 90) finish(m);
      else setupKickoff(m, m.restart.concededBy);
    }
    return;
  }
  if (m.state === ST.HALF) {
    updateLoose(m, dt);
    if (m.stateT <= 0) { swapSides(m); setupKickoff(m, 1); }
    return;
  }

  if (m.state === ST.KICKOFF) {
    settlePlayers(m, dt, 0.6);
    if (m.stateT <= 0) {
      m.state = ST.PLAY;
      giveBall(m, m.teams[m.restart.team].players[9]);
      whistle(m);
    }
    return;
  }

  if (m.state === ST.THROW || m.state === ST.GOALKICK || m.state === ST.CORNER || m.state === ST.FREEKICK) {
    settlePlayers(m, dt, 0.55);
    if (m.stateT <= 0) {
      const kind = m.restart.type;
      m.state = ST.PLAY;
      const t = m.teams[m.restart.team];
      let taker = null, bd = 1e9;
      t.players.forEach((pl) => {
        if (kind === ST.GOALKICK && pl.role !== 'GK') return;
        const d = dist2D(pl.p, m.ball.p);
        if (d < bd) { bd = d; taker = pl; }
      });
      if (taker) {
        taker.p.x = m.ball.p.x - t.dir * 0.7;
        taker.p.z = m.ball.p.z + 0.3;
        taker.stunT = 0;
        giveBall(m, taker);
      }
      m.ball.lockT = 0;
      whistle(m);
    }
    return;
  }

  /* ---- live play ---- */
  m.clock += dt;
  m.minute = (m.clock / m.halfSeconds) * 45 + (m.half - 1) * 45;

  ai(m, dt);
  movePlayers(m, dt);
  updateBall(m, dt);
  handleControl(m, dt);
  boundaries(m);

  if (m.minute >= 45 && m.half === 1 && m.state === ST.PLAY) {
    m.half = 2;
    m.state = ST.HALF;
    m.stateT = 3.0;
    m.msg = '⏱️ Mi-temps';
    m.msgT = 3;
    whistle(m, 2);
  } else if (m.minute >= 90 && m.state === ST.PLAY) {
    finish(m);
  }
}

function swapSides(m) {
  m.teams.forEach((t) => {
    t.dir *= -1;
    t.players.forEach((pl, i) => (pl.home = homeSpot(FORMATION[i], t.dir)));
  });
  m.half = 2;
  m.clock = m.halfSeconds; // minute continues from 45
}

function finish(m) {
  m.state = ST.FULL;
  m.over = true;
  const a = m.teams[0].score, b = m.teams[1].score;
  m.result = { home: a, away: b, winner: a > b ? 0 : b > a ? 1 : -1 };
  m.msg = '🏁 Fin du match';
  m.msgT = 6;
  whistle(m, 3);
}

function whistle(m, n = 1) { m.whistle = (m.whistle || 0) + n; }
function celebrate(m, dt) {
  m.teams.forEach((t) => t.players.forEach((pl) => {
    if (pl.celebT > 0) { pl.celebT -= dt; pl.state = 'celebrate'; pl.anim += dt * 9; }
    else pl.state = 'run';
  }));
}

/* ------------------------------------------------------------------ */
/*  Possession helpers                                                 */
/* ------------------------------------------------------------------ */
function giveBall(m, pl) {
  m.ball.owner = pl.i;
  m.ball.lockT = 0.25;
  pl.hasBall = true;
  pl.holdT = 0.45 + m.rng() * 0.55;   // receive → carry → *then* release
  pl.runToBall = 0;
  m.teams.forEach((t) => t.players.forEach((q) => { if (q !== pl) q.hasBall = false; }));
  m.ball.lastTouch = pl.i;
  m.ball.gkTried = 0;
  m.shotCounted = false;
}

function loseBall(m) {
  if (m.ball.owner >= 0) m.players[m.ball.owner].hasBall = false;
  m.ball.owner = -1;
  m.ball.lockT = 0.22;
}

/* ------------------------------------------------------------------ */
/*  Player movement                                                    */
/* ------------------------------------------------------------------ */
function playerSpeed(pl, sprint) {
  const base = 5.5 + (pl.data.pace / 100) * 3.3;
  const stam = 0.72 + 0.28 * (pl.data.stamina / 100);
  return base * (sprint ? 1.3 : 1) * stam * (pl.stunT > 0 ? 0.25 : 1);
}

function movePlayers(m, dt) {
  for (const pl of m.players) {
    if (pl.stunT > 0) pl.stunT -= dt;
    if (pl.kickT > 0) pl.kickT -= dt;

    // belt & braces: a mobile game must never die on a NaN frame
    if (!Number.isFinite(pl.target.x) || !Number.isFinite(pl.target.z)) {
      pl.target.x = pl.home.x; pl.target.z = pl.home.z;
    }
    if (!Number.isFinite(pl.p.x) || !Number.isFinite(pl.p.z) ||
        !Number.isFinite(pl.v.x) || !Number.isFinite(pl.v.z)) {
      pl.p.x = pl.home.x; pl.p.z = pl.home.z; pl.v.x = pl.v.z = 0;
      m.rescued = (m.rescued || 0) + 1;
    }

    let dx = pl.target.x - pl.p.x, dz = pl.target.z - pl.p.z;
    const d = Math.hypot(dx, dz);
    const sprinting = pl.sprint && d > 1.2;
    let max = playerSpeed(pl, sprinting);
    // dribbling is slower than sprinting free — that is what lets defenders
    // actually catch a carrier instead of chasing him forever
    if (pl.hasBall) max *= 0.93;
    else if (pl.roleTask === 'press') max *= 1.03;
    pl.speed = max;

    if (d < 0.12) {
      pl.v.x *= 0.6; pl.v.z *= 0.6;
    } else {
      dx /= d; dz /= d;
      const want = Math.min(max, d * 3.2);
      pl.v.x = damp(pl.v.x, dx * want, 9, dt);
      pl.v.z = damp(pl.v.z, dz * want, 9, dt);
      pl.face += clamp(angleDiff(pl.face, Math.atan2(dz, dx)), -9 * dt, 9 * dt);
    }
    pl.p.x += pl.v.x * dt;
    pl.p.z += pl.v.z * dt;

    // keep everyone inside a padded field
    pl.p.x = clamp(pl.p.x, -H - 3, H + 3);
    pl.p.z = clamp(pl.p.z, -W - 3, W + 3);

    const sp = Math.hypot(pl.v.x, pl.v.z);
    if (pl.diveT > 0) { pl.diveT -= dt; pl.state = 'dive'; }
    else if (pl.celebT > 0) pl.state = 'celebrate';
    else if (pl.kickT > 0) pl.state = 'kick';
    else pl.state = sp > 0.8 ? 'run' : 'idle';
    if (pl.state === 'run') pl.anim += dt * (5 + sp * 1.15);
    if (sprinting) pl.data.stamina = Math.max(5, pl.data.stamina - dt * 1.9);
    else pl.data.stamina = Math.min(100, pl.data.stamina + dt * 0.9);

    // separation so players do not stack
    for (const o of m.players) {
      if (o === pl) continue;
      const ox = pl.p.x - o.p.x, oz = pl.p.z - o.p.z;
      const dd = ox * ox + oz * oz;
      if (dd < 0.55 && dd > 1e-5) {
        const l = Math.sqrt(dd), push = (0.74 - l) * 0.5;
        pl.p.x += (ox / l) * push; pl.p.z += (oz / l) * push;
      }
    }
  }
}

const angleDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

function settlePlayers(m, dt, mult) {
  for (const pl of m.players) {
    const spot = restartSpot(m, pl);
    pl.target.x = spot.x; pl.target.z = spot.z;
  }
  movePlayers(m, dt * mult);
}

function restartSpot(m, pl) {
  const r = m.restart;
  if (!r || !r.spot) return pl.home;
  const t = m.teams[pl.team];
  const attack = t.dir;
  // shift the whole block towards the restart point
  const sx = clamp(r.spot.x * 0.45, -26, 26);
  const sz = clamp(r.spot.z * 0.25, -12, 12);
  let x = pl.home.x + sx, z = pl.home.z + sz;
  if (pl.role === 'GK') { x = gkLineX(t); z = clamp(r.spot.z * 0.2, -4, 4); }
  if (r.type === ST.GOALKICK && pl.role === 'GK') { x = gkLineX(t) + attack * 2; z = 0; }
  return { x, z };
}

const gkLineX = (t) => (t.dir > 0 ? -H + 2.2 : H - 2.2);

/* ------------------------------------------------------------------ */
/*  Ball physics                                                       */
/* ------------------------------------------------------------------ */
function updateLoose(m, dt) {
  const b = m.ball;
  // dead ball: kill the flight so it never ends up in the car park
  b.v.x *= 0.9; b.v.z *= 0.9;
  b.v.y -= G * dt;
  b.p.x += b.v.x * dt; b.p.y += b.v.y * dt; b.p.z += b.v.z * dt;
  if (b.p.y < PITCH.BALL_R) {
    b.p.y = PITCH.BALL_R;
    if (b.v.y < 0) b.v.y = -b.v.y * 0.5;
    if (Math.abs(b.v.y) < 0.6) b.v.y = 0;
    const sp = Math.hypot(b.v.x, b.v.z);
    if (sp > 0.01) {
      const ns = Math.max(0, sp - BALL_ROLL * dt);
      b.v.x *= ns / sp; b.v.z *= ns / sp;
    }
  }
  const drag = 1 - BALL_DRAG * dt;
  b.v.x *= drag; b.v.z *= drag;
  if (b.lockT > 0) b.lockT -= dt;
}

function updateBall(m, dt) {
  const b = m.ball;
  if (b.lockT > 0) b.lockT -= dt;
  const prevX = b.p.x;

  if (b.owner >= 0) {
    const pl = m.players[b.owner];
    const lead = 0.62 + Math.min(1.4, Math.hypot(pl.v.x, pl.v.z) * 0.12);
    const tx = pl.p.x + Math.cos(pl.face) * lead;
    const tz = pl.p.z + Math.sin(pl.face) * lead;
    b.p.x = damp(b.p.x, tx, 22, dt);
    b.p.z = damp(b.p.z, tz, 22, dt);
    b.p.y = damp(b.p.y, PITCH.BALL_R, 20, dt);
    b.v.x = pl.v.x; b.v.z = pl.v.z; b.v.y = 0;
    b.spin += dt * 6;
    return;
  }

  b.v.y -= G * dt;
  b.p.x += b.v.x * dt; b.p.y += b.v.y * dt; b.p.z += b.v.z * dt;

  // ground
  if (b.p.y < PITCH.BALL_R) {
    b.p.y = PITCH.BALL_R;
    if (b.v.y < -0.8) { b.v.y = -b.v.y * 0.52; }
    else b.v.y = 0;
    const sp = Math.hypot(b.v.x, b.v.z);
    if (sp > 0.02) {
      const ns = Math.max(0, sp - BALL_ROLL * dt);
      b.v.x *= ns / sp; b.v.z *= ns / sp;
    }
  }
  const drag = 1 - BALL_DRAG * dt;
  b.v.x *= drag; b.v.z *= drag;
  b.spin += Math.hypot(b.v.x, b.v.z) * dt * 4;

  // ---- did it cross a goal line? the keeper gets one chance at it ----
  if (b.owner < 0) {
    for (const t of m.teams) {
      const gx = t.dir > 0 ? -H : H;             // the line *this* keeper defends
      if ((prevX - gx) * (b.p.x - gx) < 0 && b.v.x * t.dir < 0) {
        const f = (gx - prevX) / (b.p.x - prevX || 1e-9);
        const zc = b.p.z - b.v.z * dt * (1 - f);
        const yc = Math.max(0, b.p.y - b.v.y * dt * (1 - f));
        if (Math.abs(zc) < PITCH.GOAL_W / 2 && yc < PITCH.GOAL_H) gkAttempt(m, t, zc, yc, gx);
      }
    }
  }

  // posts + crossbar (approximated as 3 cylinders per goal)
  for (const gx of [-H, H]) {
    if (Math.abs(b.p.x - gx) < 0.35 && Math.abs(b.p.z) < PITCH.GOAL_W / 2 + 0.3) {
      for (const pz of [-PITCH.GOAL_W / 2, PITCH.GOAL_W / 2]) {
        if (Math.abs(b.p.z - pz) < 0.24 && b.p.y < PITCH.GOAL_H) {
          b.v.z = -b.v.z * 0.6; b.p.z = pz + Math.sign(b.p.z - pz) * 0.24;
          m.postHit = (m.postHit || 0) + 1;
        }
      }
      if (Math.abs(b.p.y - PITCH.GOAL_H) < 0.2 && Math.abs(b.p.z) < PITCH.GOAL_W / 2) {
        b.v.y = -Math.abs(b.v.y) * 0.5 - 1; m.postHit = (m.postHit || 0) + 1;
      }
    }
  }
}

function gkAttempt(m, t, zc, yc, gx) {
  const b = m.ball;
  const gk = t.players[0];
  if (b.gkTried) return;                     // one attempt per ball flight
  b.gkTried = 1;

  const skill = gk.data.gk / 100;
  const diving = gk.diveT > 0 || gk.diving;
  // how far the keeper can get: standing block vs full stretch
  const reach = (diving ? 2.45 : 1.45) * (0.78 + skill * 0.45);
  const dz = Math.abs(zc - gk.p.z);
  const dy = Math.abs(yc - (diving ? 1.05 : 0.95));
  const d = Math.hypot(dz, dy);
  const speed = Math.hypot(b.v.x, b.v.z);

  m.onTarget[1 - t.idx]++;            // it reached the frame
  m.shotCounted = true;
  if (d > reach) { if (m.dbg) console.log(`   GK OUT OF REACH d=${d.toFixed(2)} > ${reach.toFixed(2)} zc=${zc.toFixed(1)} gkz=${gk.p.z.toFixed(1)}`); return; }
  const closeness = 1 - d / reach;             // 1 = right at him
  const p = clamp(0.42 + closeness * 0.5 + skill * 0.24 - speed * 0.006, 0.15, 0.96);
  const roll = m.rng();
  if (m.dbg) console.log(`   GK d=${d.toFixed(2)} reach=${reach.toFixed(2)} diving=${!!diving} zc=${zc.toFixed(1)} gkz=${gk.p.z.toFixed(1)} yc=${yc.toFixed(2)} v=${speed.toFixed(0)} p=${p.toFixed(2)} -> ${roll < p ? 'SAVE' : 'GOAL'}`);
  m.saves = (m.saves || 0) + 1;
  if (roll < p) {
    const hold = closeness > 0.55 && speed < 22;
    gk.diveT = Math.max(gk.diveT, 0.45);
    gk.kickT = 0.4;
    if (hold) {
      giveBall(m, gk);
      b.v.x = b.v.y = b.v.z = 0;
      pushEvent(m, `🧤 ${m.minute.toFixed(0)}' Arrêt de ${gk.data.name}`);
    } else {
      b.v.x = t.dir * (3 + m.rng() * 5);
      b.v.z = (m.rng() - 0.5) * 9;
      b.v.y = 1 + m.rng() * 3;
      b.lockT = 0.25;
      pushEvent(m, `🧤 ${m.minute.toFixed(0)}' Repoussé par ${gk.data.name}`);
    }
    m.saved = (m.saved || 0) + 1;
  } else {
    gk.diveT = Math.max(gk.diveT, 0.4);        // beaten, but he went
    pushEvent(m, `😱 ${m.minute.toFixed(0)}' Ça frôle!`);
  }
}

/* ------------------------------------------------------------------ */
/*  Control / tackling / kicking                                       */
/* ------------------------------------------------------------------ */
function handleControl(m, dt) {
  const b = m.ball;
  if (b.owner < 0 && b.lockT <= 0 && b.p.y < 1.5) {
    const bspeed = Math.hypot(b.v.x, b.v.z);
    let best = -1, bd = 1e9;
    for (const pl of m.players) {
      if (pl.stunT > 0 || pl.role === 'GK') continue;
      const d = dist2D(pl.p, b.p);
      // quick players kill the ball from further out; a rocket needs a clean touch
      let reach = 1.0 + (pl.data.pace / 100) * 0.45;
      if (bspeed > 17) reach = Math.min(reach, 0.95);
      if (pl.roleTask === 'press' || pl.roleTask === 'run') reach += 0.2;
      if (d < reach && d < bd) { bd = d; best = pl.i; }
    }
    if (best >= 0) giveBall(m, m.players[best]);
  }

  // a keeper can also smother a loose ball rolled into his area
  for (const t of m.teams) {
    const gk = t.players[0];
    const speed = Math.hypot(b.v.x, b.v.z);
    if (b.owner < 0 && speed < 11 && dist2D(gk.p, b.p) < 1.25 + (gk.diveT > 0 ? 1.1 : 0) && b.p.y < 1.8) {
      gk.kickT = 0.4; gk.diveT = Math.max(gk.diveT, 0.35);
      giveBall(m, gk);
      b.v.x = b.v.y = b.v.z = 0;
      pushEvent(m, `🧤 ${m.minute.toFixed(0)}' ${gk.data.name} se saisit du ballon`);
    }
  }

  // possession accounting
  if (b.owner >= 0) {
    const pl = m.players[b.owner];
    m.possession[pl.team] += dt;
    // human team: which player the user drives
    if (pl.team === m.human && m.active !== pl.i) m.active = pl.i;
  } else if (m.human >= 0 && m.active >= 0 && m.players[m.active].team === m.human) {
    // keep driving the nearest team-mate
    const cur = m.players[m.active];
    if (dist2D(cur.p, b.p) > 14) m.active = nearestMate(m, m.human, b.p, m.active);
  } else {
    m.active = nearestMate(m, m.human, b.p, -1);
  }
  if (m.active < 0 && m.human >= 0) m.active = nearestMate(m, m.human, b.p, -1);

  if (m.input.switch && m.human >= 0) m.active = nearestMate(m, m.human, b.p, m.active, true);

  // tackling near the carrier
  if (m.input.tackle) doTackle(m, m.human);
  if (b.owner >= 0) {
    const carrierTeam = m.players[b.owner].team;
    const defTeam = 1 - carrierTeam;
    // human presses with the button; the CPU presses on its own timing
    if (defTeam !== m.human) aiTackle(m, defTeam, dt);
  }
}

function nearestMate(m, team, at, except, cycle) {
  if (team < 0 || !m.teams[team]) return -1;      // spectator / CPU-vs-CPU sim
  let best = -1, bd = 1e9;
  const list = m.teams[team].players.filter((p) => p.role !== 'GK');
  const sorted = list.map((p) => ({ p, d: dist2D(p.p, at) })).sort((a, b) => a.d - b.d);
  if (cycle && except >= 0) {
    const idx = sorted.findIndex((s) => s.p.i === except);
    const nxt = sorted[(idx + 1) % sorted.length];
    if (nxt) return nxt.p.i;
  }
  for (const s of sorted) { if (s.p.i !== except || !cycle) { best = s.p.i; bd = s.d; break; } }
  void bd;
  return best;
}

function doTackle(m, team) {
  const b = m.ball;
  if (b.owner < 0) return;
  const carrier = m.players[b.owner];
  if (carrier.team === team) return;
  let t = null, bd = 1e9;
  m.teams[team].players.forEach((pl) => {
    if (pl.role === 'GK') return;
    const d = dist2D(pl.p, b.p);
    if (d < bd) { bd = d; t = pl; }
  });
  if (!t || bd > 2.2) return;
  const chance = clamp(0.35 + (t.data.defend - carrier.data.pace) / 130, 0.12, 0.88);
  t.kickT = 0.35; t.diveT = 0.45;
  if (m.rng() < chance) {
    loseBall(m);
    b.v.x = Math.cos(t.face) * 5; b.v.z = Math.sin(t.face) * 5; b.v.y = 1;
    pushEvent(m, '🦵 ' + t.data.name + ' récupère!');
  } else {
    t.stunT = 0.7;
    pushEvent(m, '⚠️ Tacle manqué');
  }
}

function aiTackle(m, team, dt) {
  const b = m.ball;
  const carrier = m.players[b.owner];
  for (const pl of m.teams[team].players) {
    if (pl.role === 'GK' || pl.kickT > 0 || pl.roleTask !== 'press') continue;
    if (dist2D(pl.p, b.p) < 1.3 && m.rng() < dt * (0.45 + m.aiLevel * 0.35)) {
      pl.kickT = 0.35; pl.diveT = 0.4;
      const chance = clamp(0.3 + (pl.data.defend - carrier.data.pace) / 140, 0.1, 0.8);
      if (m.rng() < chance) {
        loseBall(m);
        b.v.x = Math.cos(pl.face) * 4.5; b.v.z = Math.sin(pl.face) * 4.5; b.v.y = 0.8;
      } else pl.stunT = 0.6;
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Kicking: pass / shot / clear                                       */
/* ------------------------------------------------------------------ */
function kick(m, pl, dirx, dirz, power, lift) {
  const b = m.ball;
  const n = norm2D(dirx, dirz);
  const acc = 0.55 + (pl.data.pass / 100) * 0.45;
  const spread = (1 - acc) * 0.16 * (power / 26);
  const a = Math.atan2(n.z, n.x) + (m.rng() - 0.5) * spread;
  b.v.x = Math.cos(a) * power;
  b.v.z = Math.sin(a) * power;
  b.v.y = lift;
  b.p.y = Math.max(b.p.y, 0.16);
  b.lockT = 0.3;
  pl.kickT = 0.32;
  pl.hasBall = false;
  b.owner = -1;
  b.lastTouch = pl.i;
  b.gkTried = 0;                       // new flight → the keeper gets a fresh chance
  m.shotCounted = false;
  m.lastKicker = pl.i;
  pl.heldLast = false;   // invalidate any cached dribble decision
  pl.decideT = 0;
}

function bestPassTarget(m, pl) {
  const t = m.teams[pl.team];
  const goalX = t.dir > 0 ? H : -H;
  let best = null, bs = -1e9;
  for (const mate of t.players) {
    if (mate === pl || mate.role === 'GK') continue;
    const dx = mate.p.x - pl.p.x, dz = mate.p.z - pl.p.z;
    const d = Math.hypot(dx, dz);
    if (d < 5 || d > 42) continue;
    const fwd = ((mate.p.x - pl.p.x) * t.dir) / Math.max(1, d);
    // how free is he?
    let md = 1e9;
    for (const o of m.teams[1 - pl.team].players) {
      const od = dist2D(o.p, mate.p);
      if (od < md) md = od;
    }
    const goalBias = (1 - Math.abs(mate.p.x - goalX) / 105) * 0.6;
    const inFinalThird = (mate.p.x * t.dir) > H - 34 ? 1.6 : 0;
    const s = fwd * 1.7 + Math.min(md, 14) * 0.24 + goalBias * 2.2 + inFinalThird - d * 0.02;
    if (s > bs) { bs = s; best = mate; }
  }
  return best;
}

function passTo(m, pl, mate) {
  const t = m.teams[pl.team];
  // lead the runner a little
  const leadT = 0.45;
  const tx = mate.p.x + mate.v.x * leadT * t.dir * 0 + mate.v.x * leadT;
  const tz = mate.p.z + mate.v.z * leadT;
  const dx = tx - pl.p.x, dz = tz - pl.p.z;
  const d = Math.hypot(dx, dz);
  const power = clamp(7.5 + d * 0.52, 8.5, 23);
  kick(m, pl, dx, dz, power, d > 26 ? 2.6 : 0.9);
  m.passCount[pl.team]++;
  mate.runToBall = 2.2;          // the receiver goes to meet the ball…
  mate.runTo = { x: tx, z: tz }; // …at the spot it was aimed at
  pl.saidPass = 0.5;
}

function shoot(m, pl) {
  const t = m.teams[pl.team];
  const goalX = t.dir > 0 ? H : -H;
  const dist = Math.abs(goalX - pl.p.x);
  const skill = pl.data.shoot / 100;

  // how tight is he? pressure ruins finishing
  let press = 1e9;
  for (const o of m.teams[1 - t.idx].players) {
    const d = dist2D(o.p, pl.p);
    if (d < press) press = d;
  }
  const rushed = press < 2.2 ? 1 : press < 4 ? 0.5 : 0;

  // aim for a corner, then let the error decide if it is on target
  const side = m.rng() < 0.5 ? -1 : 1;
  const aimZ = side * lerp(1.1, PITCH.GOAL_W / 2 - 0.35, m.rng());
  const sigma = lerp(3.0, 1.05, skill) + rushed * 1.7 + Math.max(0, dist - 18) * 0.075;
  const tz = aimZ + m.rng.gauss() * sigma;

  const highShot = m.rng() < 0.22 + rushed * 0.25;
  const aimY = highShot ? lerp(1.3, PITCH.GOAL_H + 0.9, m.rng()) : lerp(0.15, 1.2, m.rng());
  const ty = aimY + m.rng.gauss() * 0.28;

  const dx = goalX - pl.p.x, dz = tz - pl.p.z;
  const d = Math.hypot(dx, dz);
  const power = clamp(30 - d * 0.26, 17, 31) * (0.78 + skill * 0.32);
  const lift = ty > 1 ? 3.2 + (d / 30) * 3.2 : 1.0 + d * 0.03;

  m.shots[pl.team]++;
  kick(m, pl, dx, dz, power, lift);
  pl.shotT = 0.8;
  m.shotBy = pl.i;
}

function clearBall(m, pl) {
  const t = m.teams[pl.team];
  const mate = bestPassTarget(m, pl);
  if (mate && dist2D(pl.p, mate.p) < 38 && m.rng() < 0.75) passTo(m, pl, mate);
  else kick(m, pl, t.dir, (m.rng() - 0.5) * 1.6, 26, 5.5);
}

/* ------------------------------------------------------------------ */
/*  Artificial intelligence                                            */
/* ------------------------------------------------------------------ */
function ai(m, dt) {
  const b = m.ball;
  const owner = b.owner >= 0 ? m.players[b.owner] : null;

  for (const t of m.teams) {
    const mine = owner && owner.team === t.idx;
    const goalX = t.dir > 0 ? H : -H;

    // who presses?
    let pressers = t.players
      .filter((p) => p.role !== 'GK')
      .map((p) => ({ p, d: dist2D(p.p, b.p) }))
      .sort((a, c) => a.d - c.d);
    const press1 = pressers[0] && pressers[0].p;
    const press2 = pressers[1] && pressers[1].p;

    for (const pl of t.players) {
      pl.sprint = false;
      if (pl.role === 'GK') { gkAi(m, t, pl, dt); continue; }
      if (pl.stunT > 0) { pl.target.x = pl.p.x; pl.target.z = pl.p.z; continue; }

      // ---- human-controlled player is driven by input, not AI ----
      if (t.idx === m.human && pl.i === m.active) { humanPlayer(m, pl, dt); continue; }

      if (mine && pl === owner) { aiCarrier(m, t, pl, dt, goalX); continue; }

      if (!mine && (pl === press1 || (pl === press2 && dist2D(pl.p, b.p) < 12))) {
        pl.roleTask = 'press';
        pl.target.x = b.p.x + b.v.x * 0.16;
        pl.target.z = b.p.z + b.v.z * 0.16;
        pl.sprint = true;
        continue;
      }
      // a pass is coming to him → go and meet it where it will land
      if (pl.runToBall > 0) {
        if (b.owner >= 0 && m.players[b.owner] === pl) pl.runToBall = 0;
        else {
          pl.runToBall -= dt;
          pl.roleTask = 'run';
          const tgt = pl.runTo && Number.isFinite(pl.runTo.x)
            ? pl.runTo
            : { x: b.p.x + b.v.x * 0.3, z: b.p.z + b.v.z * 0.3 };
          pl.target.x = clamp(tgt.x, -H, H);
          pl.target.z = clamp(tgt.z, -W, W);
          pl.sprint = true;
          continue;
        }
      }

      pl.roleTask = 'shape';

      // shape: formation home, dragged towards the ball + attack/defend shift
      const bx = clamp(b.p.x, -H, H), bz = clamp(b.p.z, -W, W);
      // how deep is the ball into the final third? (0 → our half, 1 → their box)
      const prog = clamp((bx * t.dir + H) / (2 * H), 0, 1);
      const shiftX = bx * (mine ? 0.42 : 0.34);
      const shiftZ = bz * (mine ? 0.3 : 0.22);
      let hx = pl.home.x + shiftX;
      let hz = pl.home.z * (mine ? 1.16 : 0.9) + shiftZ;

      if (mine) {
        const isFwd = pl.role === 'ST' || pl.role === 'LM' || pl.role === 'RM';
        const isMid = pl.role === 'CM';
        // the deeper the ball, the more bodies commit forward
        if (isFwd) hx += t.dir * (8 + prog * 8);
        else if (isMid) hx += t.dir * (3 + prog * 12);
        else hx += t.dir * (2 + prog * 5);
        // strikers stretch towards the box when we are high up the pitch
        if (pl.role === 'ST' && prog > 0.68) hz *= 0.55;
        // wingers hug the touchline to give the carrier an out-ball
        if ((pl.role === 'LM' || pl.role === 'RM') && prog > 0.5) hz += Math.sign(pl.home.z) * 4;
        // never bunch up on top of the carrier
        if (dist2D({ x: hx, z: hz }, owner ? owner.p : b.p) < 6) hz += (hz > bz ? 5 : -5);
      } else {
        hx -= t.dir * (2.5 + prog * 3);
        if (pl.role === 'CB' || pl.role === 'LB' || pl.role === 'RB') hz *= 0.82;
      }
      pl.target.x = clamp(hx, -H - 2, H + 2);
      pl.target.z = clamp(hz, -W - 2, W + 2);
      pl.sprint = dist2D(pl.p, pl.target) > (mine ? 12 : 8);
    }
  }

  // loose-ball chase: both teams send their nearest man
  if (!owner) {
    for (const t of m.teams) {
      const ranked = t.players
        .filter((pl) => pl.role !== 'GK' && pl.stunT <= 0 && pl.runToBall <= 0)
        .map((pl) => ({ pl, d: dist2D(pl.p, b.p) }))
        .sort((a, c) => a.d - c.d);
      ranked.slice(0, 2).forEach((e, n) => {
        e.pl.roleTask = 'press';
        const lead = n === 0 ? 0.25 : 0.5;
        e.pl.target.x = clamp(b.p.x + b.v.x * lead, -H, H);
        e.pl.target.z = clamp(b.p.z + b.v.z * lead, -W, W);
        e.pl.sprint = true;
      });
    }
  }
}

const skillOf = (pl) => pl.data.shoot / 100;

function aiCarrier(m, t, pl, dt, goalX) {
  const b = m.ball;
  const distGoal = Math.abs(goalX - pl.p.x);
  const lat = Math.abs(pl.p.z);

  // pressure?
  let near = 1e9;
  for (const o of m.teams[1 - t.idx].players) {
    const d = dist2D(o.p, pl.p);
    if (d < near) near = d;
  }

  // A cached decision is only reusable while we still hold the ball and the
  // cached target actually exists — otherwise fall through and re-decide.
  pl.decideT = (pl.decideT || 0) - dt;
  const cached = pl.decideT > 0 && pl.heldLast && Number.isFinite(pl.aiTx) && Number.isFinite(pl.aiTz);
  pl.heldLast = true;
  if (cached) {
    pl.target.x = pl.aiTx; pl.target.z = pl.aiTz;
    pl.sprint = near > 3.5;
    return;
  }
  pl.decideT = 0.22 + m.rng() * 0.2;

  if (pl.holdT > 0) pl.holdT -= dt;
  const protected_ = pl.holdT > 0 && near > 2.0;

  // SHOOT — a shot is never "held"
  const shootRange = 17 + (pl.data.shoot - 70) * 0.2;
  if (distGoal < shootRange && lat < 20) {
    const p = distGoal < 9 ? 0.72 : distGoal < 15 ? 0.32 : 0.13;
    if (m.rng() < p * (0.6 + skillOf(pl) * 0.6)) { shoot(m, pl); return; }
  }
  if (!protected_) {
    // PASS when squeezed
    if (near < 3.0 && m.rng() < 0.75) {
      const mate = bestPassTarget(m, pl);
      if (mate) { passTo(m, pl, mate); return; }
    }
    // through-ball to a runner — this is how the AI creates chances
    if (m.rng() < 0.22) {
      const mate = bestPassTarget(m, pl);
      if (mate && dist2D(pl.p, mate.p) > 9) { passTo(m, pl, mate); return; }
    }
  }
  // DRIBBLE at goal, bending around pressure
  const dx = t.dir, dz = -pl.p.z * 0.05;
  const avoid = { x: 0, z: 0 };
  for (const o of m.teams[1 - t.idx].players) {
    const ox = pl.p.x - o.p.x, oz = pl.p.z - o.p.z;
    const d2 = ox * ox + oz * oz;
    if (d2 < 36) { const l = Math.sqrt(d2) || 1; avoid.x += (ox / l) * (6 - Math.sqrt(d2)) * 0.12; avoid.z += (oz / l) * (6 - Math.sqrt(d2)) * 0.22; }
  }
  const n = norm2D(dx, dz + avoid.z);
  const run = 7 + (m.rng() - 0.5) * 3;
  pl.aiTx = clamp(pl.p.x + n.x * run, -H - 1, H + 1);
  pl.aiTz = clamp(pl.p.z + n.z * run, -W - 1, W + 1);
  pl.target.x = pl.aiTx; pl.target.z = pl.aiTz;
  pl.sprint = near > 3 && distGoal > 18;
  void b;
}

function gkAi(m, t, pl, dt) {
  const b = m.ball;
  const lineX = gkLineX(t);
  const attack = t.dir;
  pl.roleTask = 'gk';

  if (b.owner >= 0 && m.players[b.owner] === pl) {
    // has the ball: wait a beat then distribute
    pl.puntT = (pl.puntT === undefined ? 0.9 : pl.puntT) - dt;
    pl.target.x = lineX + attack * 3; pl.target.z = 0;
    if (pl.puntT <= 0) {
      pl.puntT = 0.9;
      const mate = bestPassTarget(m, pl);
      if (mate) passTo(m, pl, mate);
      else kick(m, pl, attack, (m.rng() - 0.5) * 1.4, 24, 6);
    }
    return;
  }

  // ---- shot stopping: read where the ball will cross the line and go there
  const toLine = (lineX - b.p.x) / (b.v.x || 1e-6);
  if (b.v.x * attack < 0 && toLine > 0 && toLine < 1.1 && Math.abs(b.v.x) > 8) {
    const zc = clamp(b.p.z + b.v.z * toLine, -PITCH.GOAL_W / 2 - 1, PITCH.GOAL_W / 2 + 1);
    const yc = b.p.y + b.v.y * toLine;
    pl.target.x = lineX + attack * 0.35;
    pl.target.z = zc;
    pl.face = Math.atan2(b.p.z - pl.p.z, b.p.x - pl.p.x);
    // commit to a dive when he cannot get there on his feet
    if (Math.abs(zc - pl.p.z) > 1.15 || yc > 1.3) pl.diveT = Math.max(pl.diveT, Math.min(0.85, toLine));
    pl.diving = pl.diveT > 0;
    pl.sprint = true;
    return;
  }
  pl.diving = false;

  // positioning on the line, coming out for through balls
  const danger = clamp((H - Math.abs(b.p.x - lineX)) / 40, 0, 1);
  let gx = lineX + attack * (0.6 + danger * 4.2);
  let gz = clamp(b.p.z * (0.34 + danger * 0.2), -PITCH.GOAL_W / 2 - 0.5, PITCH.GOAL_W / 2 + 0.5);
  if (Math.abs(b.p.x - lineX) > 42) { gx = lineX + attack * 0.8; gz = clamp(b.p.z * 0.2, -3, 3); }
  pl.target.x = gx; pl.target.z = gz;
  pl.sprint = dist2D(pl.p, pl.target) > 4;
  pl.face = Math.atan2(b.p.z - pl.p.z, b.p.x - pl.p.x);
}

/* ------------------------------------------------------------------ */
/*  Human driven player                                                */
/* ------------------------------------------------------------------ */
function humanPlayer(m, pl, dt) {
  const inp = m.input;
  pl.roleTask = 'human';
  const has = m.ball.owner === pl.i;
  let mx = inp.mx, mz = inp.mz;

  // keyboard/joystick gives *screen* space → world space happens in main.js
  const mag = Math.hypot(mx, mz);
  if (mag > 0.08) {
    const n = norm2D(mx, mz);
    const run = 6 + Math.min(1, mag) * 4;
    pl.target.x = clamp(pl.p.x + n.x * run, -H - 2, H + 2);
    pl.target.z = clamp(pl.p.z + n.z * run, -W - 2, W + 2);
    pl.sprint = inp.sprint;
  } else {
    if (has) { pl.target.x = pl.p.x; pl.target.z = pl.p.z; }
    else {
      // auto-track the ball a little so it never feels dead
      pl.target.x = m.ball.p.x; pl.target.z = m.ball.p.z;
      pl.sprint = false;
    }
  }

  if (inp.shoot && has) {
    const power = 0.35 + inp.shootHold * 0.65;
    pl.data.shoot = pl.data.shoot; // keep stat
    const t = m.teams[pl.team];
    const goalX = t.dir > 0 ? H : -H;
    const dist = Math.abs(goalX - pl.p.x);
    if (dist < 40) { m.shotPower = power; shoot(m, pl); }
    else clearBall(m, pl);
    m.input.shootHold = 0;
  } else if (inp.pass && has) {
    const mate = bestPassTarget(m, pl);
    if (mate) passTo(m, pl, mate);
    else clearBall(m, pl);
  }
  void dt;
}

/* ------------------------------------------------------------------ */
/*  Boundaries, goals, restarts                                        */
/* ------------------------------------------------------------------ */
function boundaries(m) {
  const b = m.ball;
  if (m.state !== ST.PLAY) return;

  const inMouth = Math.abs(b.p.z) < PITCH.GOAL_W / 2 && b.p.y < PITCH.GOAL_H;

  // ---- GOAL ---- (which team scores depends on the direction it attacks,
  // and that flips at half time — never hard-code it on the axis sign)
  const team0ToPlus = m.teams[0].dir > 0;
  if (b.p.x > H + 0.05 && inMouth) return goal(m, team0ToPlus ? 0 : 1);
  if (b.p.x < -H - 0.05 && inMouth) return goal(m, team0ToPlus ? 1 : 0);

  // behind the net / off the sides
  const outX = Math.abs(b.p.x) > H + PITCH.GOAL_D + 0.4;
  const outZ = Math.abs(b.p.z) > W + 0.3;
  if (outX || outZ) {
    const last = b.lastTouch >= 0 ? m.players[b.lastTouch] : null;
    const lastTeam = last ? last.team : (b.p.x > 0 ? 0 : 1);
    if (outZ) {
      // throw-in for the other team
      const team = 1 - lastTeam;
      const spot = { x: clamp(b.p.x, -H + 2, H - 2), z: Math.sign(b.p.z) * (W - 0.4) };
      placeRestart(m, ST.THROW, team, spot);
      m.msg = '🙌 Rentrée de touche'; m.msgT = 1.6;
      pushEvent(m, `🙌 ${m.minute.toFixed(0)}' Rentrée de touche — ${m.teams[team].club.short}`);
    } else {
      const attackSide = Math.sign(b.p.x);          // which goal line the ball crossed
      // the team defending that line is the one attacking the *other* way
      const attackingPlus = m.teams[0].dir > 0;
      const defendingTeam = attackSide > 0 ? (attackingPlus ? 1 : 0) : (attackingPlus ? 0 : 1);
      if (lastTeam === defendingTeam) {
        placeRestart(m, ST.GOALKICK, defendingTeam, { x: attackSide * (H - 5.5), z: 4 });
        m.msg = '🥅 Renvoi aux 6 mètres'; m.msgT = 1.6;
        pushEvent(m, `🥅 ${m.minute.toFixed(0)}' Renvoi — ${m.teams[defendingTeam].club.short}`);
      } else {
        placeRestart(m, ST.CORNER, 1 - defendingTeam, { x: attackSide * (H - 0.4), z: Math.sign(b.p.z || 1) * (W - 0.4) });
        m.msg = '🚩 Corner'; m.msgT = 1.6;
        pushEvent(m, `🚩 ${m.minute.toFixed(0)}' Corner — ${m.teams[1 - defendingTeam].club.short}`);
      }
    }
    loseBall(m);
    return;
  }
}

function goal(m, scoringTeam) {
  const t = m.teams[scoringTeam];
  t.score++;
  // a goal is by definition on target (covers walked-in / deflected ones)
  if (!m.shotCounted) { m.onTarget[scoringTeam]++; m.shotCounted = true; m.walkIn = (m.walkIn || 0) + 1; }
  const scorer = m.ball.lastTouch >= 0 ? m.players[m.ball.lastTouch] : null;
  if (scorer) { scorer.data.goals++; m.scorer = scorer.data.name; }
  m.state = ST.GOAL;
  m.stateT = 3.4;
  m.restart = { concededBy: 1 - scoringTeam };
  m.msg = scorer ? `⚽ GOAL! ${scorer.data.name}` : '⚽ GOAL!';
  m.msgT = 3.2;
  m.goalFlash = 1;
  whistle(m, 2);
  pushEvent(m, `⚽ ${m.minute.toFixed(0)}' ${scorer ? scorer.data.name : 'But'} — ${m.teams[0].score}:${m.teams[1].score}`);
  // celebrate: scorer + nearby mates
  t.players.forEach((pl) => {
    if (dist2D(pl.p, m.ball.p) < 22) { pl.celebT = 3.2; }
  });
  loseBall(m);
}

function pushEvent(m, text) {
  m.events.push({ min: Math.floor(m.minute), text });
  if (m.events.length > 40) m.events.shift();
}

/* ---- small helpers used by the UI ---- */
export function possessionPct(m) {
  const a = m.possession[0], b = m.possession[1];
  const s = a + b;
  return s < 0.01 ? 50 : Math.round((a / s) * 100);
}

export function teamOfPlayer(m, i) { return i >= 0 ? m.players[i].team : -1; }
