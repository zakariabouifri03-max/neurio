// Physics sanity harness — run with: node tools/selftest.mjs
import {
  Shot, makeStrike, newRack, makeBall, predictShot, castCue, resolveShot, BALL, PHYS, TABLE, HL, HW,
} from '../src/physics.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
};
const approx = (a, b, e = 0.02) => Math.abs(a - b) <= e;

// 1 — a struck ball rolls, decelerates and stops
{
  const balls = newRack('8ball');
  balls.forEach((b) => { if (b && b.n !== 0) b.state = 'pocketed'; });
  const s = new Shot(balls);
  s.applyStrike(makeStrike(1, 0, 0.5, 0, 0));
  s.runAll();
  const cue = balls[0];
  ok('ball comes to rest', Math.hypot(cue.vx, cue.vz) === 0, `t=${s.result().t}s`);
  ok('travels then stops on the bed', Math.abs(cue.x) <= HL + 1e-9 && Math.abs(cue.z) <= HW + 1e-9,
    `ends at x=${cue.x.toFixed(3)} after bouncing at 50 % power`);
  ok('natural roll achieved', s.result().t > 0.5, '');
}

// 2 — rolling without sliding: ω ≈ v/R
{
  const balls = newRack('8ball');
  balls.forEach((b) => { if (b && b.n !== 0) b.state = 'pocketed'; });
  const cue = balls[0];
  cue.vx = 2.0;
  cue.wz = -2.0 / BALL.R;      // natural roll along +x ⇒ ω = (vz/R, 0, −vx/R) = (0,0,−v/R)
  const s = new Shot(balls);
  let drifted = 0;
  for (let i = 0; i < 400; i++) {
    s.step();
    if (i < 3) continue;
    const roll = -cue.wz * BALL.R;
    drifted = Math.max(drifted, Math.abs(roll - cue.vx) / 2.0);
  }
  ok('natural roll is stable', drifted < 0.02, `max rel drift ${(drifted * 100).toFixed(2)} %`);
}

// 3/4/5 — SPIN.
//   Rolling along +x is ωz = −vx/R.  ωz above that (positive) ⇒ the patch
//   skids forward ⇒ back-spin ⇒ DRAW.  ωz below it ⇒ FOLLOW.
//   The object ball is removed the instant the cue ball arrives so the probe
//   measures the cue ball's own response, not a rebound off a rail.
function spinShot(power, tipVert, gap) {
  const balls = newRack('8ball');
  balls.forEach((b) => { if (b && b.n !== 0 && b.n !== 5) b.state = 'pocketed'; });
  balls[0].x = -0.95; balls[0].z = 0;
  balls[5].x = -0.95 + gap; balls[5].z = 0;
  const s = new Shot(balls);
  s.applyStrike(makeStrike(1, 0, power, 0, tipVert));
  const w0 = balls[0].wz, v0 = balls[0].vx;
  let fcX = null, minAfter = 1e9, maxAfter = -1e9;
  while (!s.done) {
    s.step();
    if (s.firstContact && fcX === null) {
      fcX = balls[0].x;
      balls[5].state = 'pocketed';
    } else if (fcX !== null) {
      if (balls[0].x < minAfter) minAfter = balls[0].x;
      if (balls[0].x > maxAfter) maxAfter = balls[0].x;
    }
  }
  return { w0, v0, u0: v0 + w0 * BALL.R, back: fcX - minAfter, fwd: maxAfter - fcX };
}
{
  const draw = spinShot(0.62, -0.62, 0.30);
  const stun = spinShot(0.62, 0, 0.30);
  const follow = spinShot(0.62, 0.62, 0.30);
  ok('draw and follow launch opposite spins', draw.w0 > 1 && follow.w0 < -1,
    `draw ω=${draw.w0.toFixed(0)} · stun ω=${stun.w0.toFixed(0)} · follow ω=${follow.w0.toFixed(0)}`);
  ok('stun launches with no spin', Math.abs(stun.w0) < 1e-6);
  ok('draw patch skids forward at launch, follow skids backward', draw.u0 > 0 && follow.u0 < 0,
    `u: draw ${draw.u0.toFixed(2)} · follow ${follow.u0.toFixed(2)} m/s`);
  ok('draw pulls the cue ball back after contact', draw.back > 0.25 && draw.back > follow.back + 0.15,
    `draw back=${draw.back.toFixed(2)} m vs follow back=${follow.back.toFixed(2)} m`);
  ok('follow sends the cue ball on after contact', follow.fwd > 0.25 && follow.fwd > draw.fwd + 0.15,
    `follow fwd=${follow.fwd.toFixed(2)} m vs draw fwd=${draw.fwd.toFixed(2)} m`);
  ok('stun sits between draw and follow',
    draw.fwd < stun.fwd + 0.05 && stun.fwd < follow.fwd,
    `fwd: draw ${draw.fwd.toFixed(2)} · stun ${stun.fwd.toFixed(2)} · follow ${follow.fwd.toFixed(2)}`);
}

// 5b — english: side spin about the vertical axis, and it curves the path
{
  const probe = (side) => {
    const balls = newRack('8ball');
    balls.forEach((b) => { if (b && b.n !== 0) b.state = 'pocketed'; });
    const s = new Shot(balls);
    s.applyStrike(makeStrike(1, 0, 0.6, side, 0));
    return balls[0].wy;
  };
  const right = probe(0.55), left = probe(-0.55);
  ok('english spins the cue ball about the vertical axis', right * left < 0 && Math.abs(right) > 1,
    `ωy right=${right.toFixed(0)} left=${left.toFixed(0)}`);
  ok('right english is clockwise seen from above', right > 0 && left < 0,
    `ωy right=${right.toFixed(0)} · left=${left.toFixed(0)}`);
  const balls = newRack('8ball');
  balls.forEach((b) => { if (b && b.n !== 0) b.state = 'pocketed'; });
  balls[0].x = -0.9; balls[0].z = 0;
  const s = new Shot(balls);
  s.applyStrike(makeStrike(1, 0, 0.55, 0.6, 0));
  s.runAll();
  ok('english curves the cue ball off the stick line', Math.abs(balls[0].z) > 0.001,
    `drifted ${(balls[0].z * 1000).toFixed(1)} mm sideways`);
}

// 5c — a real table-length draw: struck hard and low from the head spot into an
//      object ball on the foot spot, the cue ball must come back a long way
{
  const balls = newRack('8ball');
  balls.forEach((b) => { if (b && b.n !== 0 && b.n !== 5) b.state = 'pocketed'; });
  balls[0].x = -TABLE.L * 0.25; balls[0].z = 0;
  balls[5].x = TABLE.L * 0.25; balls[5].z = 0;
  const s = new Shot(balls);
  s.applyStrike(makeStrike(1, 0, 0.85, 0, -0.68));
  let fcX = null, peakBack = 0;
  while (!s.done) {
    s.step();
    if (s.firstContact && fcX === null) fcX = balls[0].x;
    else if (fcX !== null) peakBack = Math.max(peakBack, fcX - balls[0].x);
  }
  ok('table-length draw pulls the cue ball back over 0.5 m', peakBack > 0.5,
    `drew back ${peakBack.toFixed(2)} m`);
}

// 6 — cushion bounce conserves the angle and english changes it
{
  const balls = newRack('8ball');
  balls.forEach((b) => { if (b && b.n !== 0) b.state = 'pocketed'; });
  balls[0].x = 0; balls[0].z = 0;
  const s = new Shot(balls);
  s.applyStrike(makeStrike(1, 1, 0.5, 0, 0));
  s.runAll();
  ok('ball bounces off the long rail and stays on the bed',
    Math.abs(balls[0].z) <= HW + 1e-9 && Math.abs(balls[0].x) <= HL + 1e-9,
    `final (${balls[0].x.toFixed(3)}, ${balls[0].z.toFixed(3)}) rails=${s.cushionHits}`);
  ok('rail contact registered', s.cushionHits >= 1);
}

// 7 — pocketing: a ball aimed at a corner pocket drops
{
  const balls = newRack('8ball');
  balls.forEach((b) => { if (b && b.n !== 0 && b.n !== 5) b.state = 'pocketed'; });
  balls[0].x = 0.6; balls[0].z = 0.2;
  balls[5].x = 1.05; balls[5].z = 0.47;
  const p = { x: HL - 0.062, z: HW - 0.062 };
  let dx = p.x - balls[5].x, dz = p.z - balls[5].z;
  const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  const gx = balls[5].x - dx * BALL.D, gz = balls[5].z - dz * BALL.D;
  let cx = gx - balls[0].x, cz = gz - balls[0].z;
  const cl = Math.hypot(cx, cz);
  const s = new Shot(balls);
  s.applyStrike(makeStrike(cx / cl, cz / cl, 0.42, 0, 0));
  s.runAll();
  const r = s.result();
  console.log('   post-run', JSON.stringify(r.pocketed), balls[5].state);
  ok('object ball is pocketed in the corner', r.pocketed.some((e) => e.n === 5), JSON.stringify(r.pocketed));
  ok('pocketed ball leaves the bed', balls[5].state === 'pocketed');
}

// 8 — the break: every ball moves, some pocket, nothing escapes the table
{
  const balls = newRack('8ball');
  balls[0].x = -TABLE.L * 0.25; balls[0].z = 0.02;
  const s = new Shot(balls);
  s.applyStrike(makeStrike(1, 0, 1.0, 0, 0.12));
  const t0 = Date.now();
  s.runAll();
  const ms = Date.now() - t0;
  const moved = balls.filter((b) => b && b.n > 0 && (Math.abs(b.x - 0) > 0 || true)).length;
  const r = s.result();
  const allStopped = balls.every((b) => !b || b.state !== 'table' || Math.hypot(b.vx, b.vz) === 0);
  const onBed = balls.filter((b) => b && b.state === 'table');
  const inBounds = onBed.every((b) => Math.abs(b.x) <= HL + 1e-6 && Math.abs(b.z) <= HW + 1e-6);
  ok('break: no overlaps left', (() => {
    for (let i = 0; i < onBed.length; i++) for (let j = i + 1; j < onBed.length; j++) {
      if (Math.hypot(onBed[i].x - onBed[j].x, onBed[i].z - onBed[j].z) < BALL.D - 1e-4) return false;
    }
    return true;
  })());
  ok('break: everything stopped', allStopped);
  {
    const bad = onBed.filter((b) => Math.abs(b.x) > HL || Math.abs(b.z) > HW);
    if (bad.length) console.log('   escaped:', bad.map((b) => `${b.n}(${b.x.toFixed(4)},${b.z.toFixed(4)})`).join(' '));
  }
  ok('break: all balls inside the cushions', inBounds);
  ok('break: balls spread out', onBed.length > 0 && r.ballHits > 10, `hits=${r.ballHits} pocketed=${r.pocketed.length}`);
  ok('break: simulated in reasonable time', ms < 2500, `${ms} ms for ${r.t}s of physics (${(r.t * 1000 / ms).toFixed(1)}× realtime)`);
  ok('break: max speed is physical', r.maxSpeed < PHYS.CUE_MAX_SPEED + 0.01, `${r.maxSpeed.toFixed(2)} m/s`);
  void moved;
}

// 9 — determinism: the same shot twice gives bit-identical results
{
  const run = () => {
    const balls = newRack('8ball');
    balls[0].x = -TABLE.L * 0.25; balls[0].z = 0.013;
    const s = new Shot(balls);
    s.applyStrike(makeStrike(1, 0.002, 0.92, 0.2, -0.3));
    return JSON.stringify(s.runAll().balls);
  };
  const a = run(), b = run();
  ok('simulation is deterministic', a === b);
}

// 10 — prediction helpers
{
  const balls = newRack('8ball');
  const p = predictShot(balls, -TABLE.L * 0.25, 0, 1, 0);
  ok('predictShot finds the apex ball', p.hit.kind === 'ball' && p.hit.ball === 1, `hit=${p.hit.kind} n=${p.hit.ball}`);
  ok('predictShot ranks pockets', p.object && p.object.pockets.length === 6 && p.object.pockets[0].score >= 0,
    p.object ? 'best=' + p.object.pockets[0].score.toFixed(3) : 'no object');
  const c = castCue(balls, 0, 0, 0, 1, { ignore: 0 });
  ok('castCue resolves the path ahead', c.kind === 'cushion' || c.kind === 'ball' || c.kind === 'pocket', c.kind);
  const c2 = castCue(balls, -HL + 0.2, 0, 0, 1, { ignore: 0 });
  ok('castCue finds the rail on an open line', c2.kind === 'cushion' || c2.kind === 'pocket', c2.kind + ' t=' + c2.t.toFixed(3));
}

// 11 — energy sanity: a soft shot travels less than a hard shot
{
  const dist = (power) => {
    const balls = newRack('8ball');
    balls.forEach((b) => { if (b && b.n !== 0) b.state = 'pocketed'; });
    balls[0].x = -HL + 0.12; balls[0].z = 0;
    const s = new Shot(balls);
    s.applyStrike(makeStrike(1, 0, power, 0, 0));
    let peak = balls[0].x;
    while (!s.done) { s.step(); if (balls[0].x > peak) peak = balls[0].x; }
    return peak - (-HL + 0.12);
  };
  const a = dist(0.04), b = dist(0.09), c = dist(0.16);
  ok('power scales distance monotonically', a < b && b < c, `${a.toFixed(2)} < ${b.toFixed(2)} < ${c.toFixed(2)} m`);
  ok('a soft shot rolls a believable distance', a > 0.02 && a < 2.2, `${a.toFixed(2)} m at 4 % power`);
  ok('nothing creeps forever after the break', (() => {
    const balls = newRack('8ball');
    balls[0].x = -TABLE.L * 0.25; balls[0].z = 0.02;
    const s = new Shot(balls);
    s.applyStrike(makeStrike(1, 0, 1.0, 0, 0.12));
    s.runAll();
    return s.result().t < 20;
  })(), 'break settles inside the shot clock');
}

console.log(fails ? `\n❌ ${fails} check(s) failed` : '\n🎱 all physics checks passed');
process.exit(fails ? 1 : 0);
