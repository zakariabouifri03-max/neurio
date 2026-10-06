/* ============================================================
   tools/sim-test.mjs — head-less match simulation harness.

   Runs the real engine (the same code the browser runs) and checks:
     · every match reaches 90'
     · no NaN ever appears in a position
     · no restart state dead-locks
     · shots / goals / possession look like actual football
   Two modes:
     · CPU vs CPU  (human = -1)  → used by the career sim, checks balance
     · scripted human            → exercises the input-driven code path

   Usage:  node tools/sim-test.mjs [matchesPerMode] [seed]
   ============================================================ */

import { createMatch, stepMatch, possessionPct, ST } from '../src/engine.js';
import { CLUBS, makeSquad } from '../src/data.js';
import { rngFrom } from '../src/util.js';

const N = Number(process.argv[2] || 5);
const SEED0 = Number(process.argv[3] || 2026);

let fails = 0;
const check = (ok, label, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) fails++;
};

function runMatch(k, mode) {
  const seed = SEED0 + k * 7919 + (mode === 'human' ? 13 : 0);
  const home = CLUBS[k % CLUBS.length];
  const away = CLUBS[(k + 5) % CLUBS.length];
  const m = createMatch({
    home, away,
    squads: [makeSquad(seed, home.rate), makeSquad(seed ^ 0x9e37, away.rate)],
    seed, halfSeconds: 100, human: mode === 'human' ? 0 : -1, aiLevel: 1,
  });
  const inRng = rngFrom(seed ^ 0xbeef);
  let t = 0, lastState = m.state, stuck = 0, maxStuck = 0, maxStuckState = m.state, guard = 0;
  const dt = 1 / 60;
  let sawNaN = false;

  while (!m.over && guard++ < 60 * 60 * 8) {
    let input = undefined;
    if (mode === 'human') {
      const a = inRng() * Math.PI * 2;
      const mag = inRng() < 0.15 ? 0 : 0.4 + inRng() * 0.6;
      input = {
        mx: Math.cos(a) * mag, mz: Math.sin(a) * mag,
        sprint: inRng() < 0.3, pass: inRng() < 0.02, shootHeld: inRng() < 0.03,
        tackle: inRng() < 0.02, switch: inRng() < 0.01,
      };
    }
    stepMatch(m, dt, input);
    t += dt;
    if (!Number.isFinite(m.ball.p.x) || !Number.isFinite(m.ball.p.y) ||
        m.players.some((p) => !Number.isFinite(p.p.x) || !Number.isFinite(p.p.z))) sawNaN = true;
    if (m.state === lastState) stuck++;
    else { if (stuck > maxStuck) { maxStuck = stuck; maxStuckState = lastState; } stuck = 0; lastState = m.state; }
  }
  return { m, t, maxStuck, maxStuckState, sawNaN, home, away };
}

function report(res, mode) {
  const { m, t, maxStuck, maxStuckState, sawNaN, home, away } = res;
  const a = m.teams[0].score, b = m.teams[1].score;
  const pos = possessionPct(m);
  console.log(`\n[${mode}] ${home.short} ${a}–${b} ${away.short}  (${t.toFixed(0)}s real → ${m.minute.toFixed(0)}')`);
  check(m.over, 'reached full time', `minute=${m.minute.toFixed(1)}`);
  check(!sawNaN, 'no NaN in any position');
  check(maxStuckState === ST.PLAY || maxStuck < 60 * 20,
    'no restart dead-lock', `longest='${maxStuckState}' ${(maxStuck / 60).toFixed(1)}s`);
  check(m.shots[0] + m.shots[1] >= 4, 'shots happened',
    `shots=${m.shots[0] + m.shots[1]} onTarget=${m.onTarget[0] + m.onTarget[1]}`);
  check(m.events.length > 3, 'event ticker fed', `${m.events.length} events`);
  return { goals: a + b, shots: m.shots[0] + m.shots[1], onT: m.onTarget[0] + m.onTarget[1], pos, res: m.rescued || 0 };
}

const acc = { cpu: { g: 0, s: 0, t: 0, pos: [] }, human: { g: 0, s: 0, t: 0, pos: [] } };
let rescued = 0;

for (const mode of ['cpu', 'human']) {
  console.log(`\n════════ mode: ${mode === 'cpu' ? 'CPU vs CPU (career sim)' : 'scripted human'} ════════`);
  for (let k = 0; k < N; k++) {
    const r = report(runMatch(k, mode), mode);
    acc[mode].g += r.goals; acc[mode].s += r.shots; acc[mode].t += r.onT; acc[mode].pos.push(r.pos);
    rescued += r.res;
  }
}

// balance only makes sense for CPU vs CPU
const cpuPos = acc.cpu.pos;
const avgPos = cpuPos.reduce((x, y) => x + y, 0) / cpuPos.length;
const spread = Math.max(...cpuPos) - Math.min(...cpuPos);
console.log('\n────── summary ──────');
for (const mode of ['cpu', 'human']) {
  const A = acc[mode];
  console.log(`${mode.padEnd(6)} goals/game ${(A.g / N).toFixed(2)}   shots/game ${(A.s / N).toFixed(1)}   on-target/game ${(A.t / N).toFixed(1)}`);
}
console.log(`cpu possession (team0): avg ${avgPos.toFixed(0)}%  spread ${spread.toFixed(0)}%  [${cpuPos.join(', ')}]`);
console.log(`NaN rescues: ${rescued} (should be 0)`);
check(avgPos > 33 && avgPos < 67, 'CPU-vs-CPU possession is balanced', `avg ${avgPos.toFixed(0)}%`);
check(acc.cpu.g / N >= 1.5 && acc.cpu.g / N <= 5.5, 'goals per game realistic', `${(acc.cpu.g / N).toFixed(2)}`);
check(rescued === 0, 'engine never needed a NaN rescue');

console.log(fails === 0 ? '\n✅ ALL CHECKS PASSED' : `\n❌ ${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
