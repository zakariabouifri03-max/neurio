import test from 'node:test';
import assert from 'node:assert/strict';
import { PITCH_LENGTH, PITCH_WIDTH, GOAL_WIDTH, GOAL_HEIGHT, BALL_RADIUS, MATCH_DURATION, clamp, damp, seeded, dist, stepBall, kickBall, stepPlayer, formatTime } from '../src/rabona/rules.js';

const makeBall = (extra={}) => ({ x:0, y:BALL_RADIUS, z:0, vx:0, vy:0, vz:0, spinX:0, spinY:0, spinZ:0, rotationX:0, rotationY:0, rotationZ:0, ...extra });
const makePlayer = (extra={}) => ({ x:0, z:0, vx:0, vz:0, angle:0, state:'idle', stateTimer:0, runCycle:0, wobbleX:0, wobbleZ:0, wobbleY:0, hasBall:false, isGoalkeeper:false, ...extra });

test('seeded RNG is deterministic', () => {
  const a = seeded(42), b = seeded(42), c = seeded(43);
  const seqA = Array.from({length:20}, a);
  const seqB = Array.from({length:20}, b);
  assert.deepEqual(seqA, seqB);
  assert.notEqual(seeded(42)(), c());
});

test('pitch and goal dimensions are sane', () => {
  assert.ok(PITCH_LENGTH > 50 && PITCH_LENGTH < 120);
  assert.ok(PITCH_WIDTH > 30 && PITCH_WIDTH < 80);
  assert.ok(GOAL_WIDTH > 5 && GOAL_WIDTH < 10);
  assert.equal(BALL_RADIUS, 0.43);
  assert.equal(MATCH_DURATION, 90);
});

test('ball falls with gravity and bounces', () => {
  const ball = makeBall({ y: 5, vy: 0 });
  for(let i=0;i<100;i++) stepBall(ball, 0.02);
  assert.ok(ball.y < 5);
  assert.ok(ball.y >= BALL_RADIUS - 0.001);
  // after bounce, should have some velocity
  const ball2 = makeBall({ y: 2, vy: -10 });
  stepBall(ball2, 0.05);
  assert.ok(ball2.y >= BALL_RADIUS);
});

test('ball stays within pitch bounds', () => {
  const ball = makeBall({ x: PITCH_LENGTH, z: PITCH_WIDTH, vx: 20, vz: 20 });
  for(let i=0;i<50;i++) stepBall(ball, 0.05);
  assert.ok(Math.abs(ball.x) <= PITCH_LENGTH/2 + 2);
  assert.ok(Math.abs(ball.z) <= PITCH_WIDTH/2 + 2);
});

test('kickBall gives velocity towards target', () => {
  const ball = makeBall();
  kickBall(ball, 0, 0, 20, 0, 15, 2, 0);
  assert.ok(ball.vx > 10);
  assert.ok(Math.abs(ball.vz) < 5);
  assert.ok(ball.vy > 0);
});

test('player accelerates towards input', () => {
  const p = makePlayer();
  for(let i=0;i<30;i++) stepPlayer(p, {mx:1,mz:0,sprint:false}, 0.05);
  assert.ok(p.vx > 3);
  assert.ok(p.x > 1);
});

test('player sprint is faster than walk', () => {
  const walk = makePlayer();
  const sprint = makePlayer();
  for(let i=0;i<40;i++){
    stepPlayer(walk, {mx:0,mz:1,sprint:false}, 0.05);
    stepPlayer(sprint, {mx:0,mz:1,sprint:true}, 0.05);
  }
  assert.ok(sprint.vz > walk.vz);
  assert.ok(sprint.z > walk.z);
});

test('player facing follows movement', () => {
  const p = makePlayer({ angle: 0 });
  for(let i=0;i<20;i++) stepPlayer(p, {mx:1,mz:0,sprint:false}, 0.05);
  // moving positive X should turn angle towards PI/2 (atan2(1,0)=PI/2)
  assert.ok(Math.abs(p.angle) > 0.1);
});

test('player state timers expire', () => {
  const p = makePlayer({ state:'kick', stateTimer:0.35 });
  stepPlayer(p, {mx:0,mz:0}, 0.2);
  assert.equal(p.state, 'kick');
  stepPlayer(p, {mx:0,mz:0}, 0.2);
  assert.equal(p.state, 'idle');
});

test('slide transitions to getup', () => {
  const p = makePlayer({ state:'slide', stateTimer:0.8 });
  stepPlayer(p, {mx:0,mz:0}, 0.5);
  assert.equal(p.state, 'slide');
  stepPlayer(p, {mx:0,mz:0}, 0.5);
  assert.equal(p.state, 'getup');
});

test('formatTime and clamp behave', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(65), '01:05');
  assert.equal(formatTime(90), '01:30');
  assert.equal(clamp(10,0,5),5);
  assert.equal(clamp(-1,0,5),0);
});

test('damp approaches target', () => {
  let v=0;
  for(let i=0;i<100;i++) v=damp(v,10,5,0.02);
  assert.ok(Math.abs(v-10)<0.1);
});

test('dist helper', () => {
  assert.equal(dist(0,0,3,4),5);
});
