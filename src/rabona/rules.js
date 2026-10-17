export const PITCH_LENGTH = 70;
export const PITCH_WIDTH = 44;
export const GOAL_WIDTH = 7.32;
export const GOAL_HEIGHT = 2.44;
export const GOAL_DEPTH = 2.5;
export const BALL_RADIUS = 0.43;
export const PLAYER_RADIUS = 0.55;
export const TEAMS = {
  BLUE: { id: 'blue', name: 'BLUE', color: '#4a7bff', accent: '#7aa0ff', kit: 0x4a7bff },
  RED: { id: 'red', name: 'RED', color: '#ff4a4a', accent: '#ff7a7a', kit: 0xff4a4a },
};
export const GK_COLOR = 0xe8c24a;
export const MATCH_DURATION = 90; // seconds, quick match
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export const lerp = (a, b, t) => a + (b - a) * t;
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export function seeded(seed = 1337) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx*dx + dz*dz;
}
export function dist(ax, az, bx, bz) {
  return Math.hypot(ax-bx, az-bz);
}

// Ball physics
export function stepBall(ball, dt, pitch) {
  // gravity
  ball.vy -= 16.5 * dt;
  // drag
  const drag = 0.045;
  ball.vx *= (1 - drag * dt);
  ball.vy *= (1 - drag * dt * 0.3);
  ball.vz *= (1 - drag * dt);
  // integrate
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;

  // ground
  if (ball.y < BALL_RADIUS) {
    ball.y = BALL_RADIUS;
    if (ball.vy < 0) {
      ball.vy = -ball.vy * 0.62;
      ball.vx *= 0.92;
      ball.vz *= 0.92;
      if (Math.abs(ball.vy) < 0.8) ball.vy = 0;
    }
    // rolling friction
    const speed = Math.hypot(ball.vx, ball.vz);
    if (speed > 0.1) {
      const friction = 1.8 * dt;
      const factor = Math.max(0, 1 - friction / speed);
      ball.vx *= factor;
      ball.vz *= factor;
    } else {
      ball.vx *= 0.96;
      ball.vz *= 0.96;
    }
  }

  // pitch side walls (low invisible)
  const halfL = PITCH_LENGTH/2 + 1.2;
  const halfW = PITCH_WIDTH/2 + 1.2;
  // behind goals, allow ball to go in, but if outside goal width, bounce
  const isNearGoalLine = Math.abs(ball.x) > PITCH_LENGTH/2 - 0.5;
  if (isNearGoalLine) {
    // if not within goal mouth, bounce
    const withinGoalZ = Math.abs(ball.z) < GOAL_WIDTH/2 + BALL_RADIUS;
    const withinGoalY = ball.y < GOAL_HEIGHT + 0.2;
    if (!(withinGoalZ && withinGoalY)) {
      if (ball.x > halfL) { ball.x = halfL; ball.vx *= -0.7; }
      if (ball.x < -halfL) { ball.x = -halfL; ball.vx *= -0.7; }
    }
  } else {
    if (ball.x > halfL) { ball.x = halfL; ball.vx *= -0.7; }
    if (ball.x < -halfL) { ball.x = -halfL; ball.vx *= -0.7; }
  }
  if (ball.z > halfW) { ball.z = halfW; ball.vz *= -0.7; }
  if (ball.z < -halfW) { ball.z = -halfW; ball.vz *= -0.7; }

  // spin decay
  ball.spinX = damp(ball.spinX, 0, 1.2, dt);
  ball.spinY = damp(ball.spinY, 0, 1.2, dt);
  ball.spinZ = damp(ball.spinZ, 0, 1.2, dt);

  ball.rotationX += ball.spinX * dt;
  ball.rotationY += ball.spinY * dt;
  ball.rotationZ += ball.spinZ * dt;

  // ball rotation from rolling
  if (ball.y <= BALL_RADIUS + 0.05) {
    ball.rotationX += ball.vz * dt / BALL_RADIUS;
    ball.rotationZ -= ball.vx * dt / BALL_RADIUS;
  }
}

export function kickBall(ball, fromX, fromZ, targetX, targetZ, power, height = 2.2, curve = 0) {
  const dx = targetX - fromX;
  const dz = targetZ - fromZ;
  const len = Math.hypot(dx, dz) || 1;
  const nx = dx / len;
  const nz = dz / len;
  ball.vx = nx * power + (Math.random()-0.5)*0.6;
  ball.vz = nz * power + (Math.random()-0.5)*0.6;
  ball.vy = height + power * 0.08;
  ball.spinY = curve * 6;
  ball.spinX = -power * 0.15;
  ball.x += nx * 0.7;
  ball.z += nz * 0.7;
  ball.y = Math.max(ball.y, BALL_RADIUS + 0.1);
}

// Simple player movement physics
export function stepPlayer(player, input, dt, ball) {
  // input: {mx, mz} move direction -1..1, sprint, kick, slide, rabona
  const speedBase = player.isGoalkeeper ? 5.2 : 5.8;
  const sprintMult = input.sprint ? 1.45 : 1;
  const targetSpeed = speedBase * sprintMult;
  const accel = 22;

  // desired velocity
  const moveLen = Math.hypot(input.mx, input.mz);
  let desiredVx = 0, desiredVz = 0;
  if (moveLen > 0.01) {
    const n = moveLen > 1 ? 1/moveLen : 1;
    desiredVx = input.mx * n * targetSpeed;
    desiredVz = input.mz * n * targetSpeed;
  }

  // when falling / sliding / kicking, reduce control
  let control = 1;
  if (player.state === 'fall' || player.state === 'slide' || player.state === 'getup') control = 0.25;
  if (player.state === 'kick' || player.state === 'rabona') control = 0.35;

  player.vx = damp(player.vx, desiredVx, accel * control, dt);
  player.vz = damp(player.vz, desiredVz, accel * control, dt);

  // if has ball, slow down a bit
  if (player.hasBall) {
    player.vx *= 0.82;
    player.vz *= 0.82;
  }

  // integrate
  player.x += player.vx * dt;
  player.z += player.vz * dt;

  // pitch bounds for players (allow slightly outside)
  const halfL = PITCH_LENGTH/2 + 3;
  const halfW = PITCH_WIDTH/2 + 2.5;
  player.x = clamp(player.x, -halfL, halfL);
  player.z = clamp(player.z, -halfW, halfW);

  // facing angle
  if (moveLen > 0.15 && player.state !== 'fall' && player.state !== 'slide' && player.state !== 'getup') {
    const desiredAngle = Math.atan2(input.mx, input.mz);
    const delta = angleDelta(player.angle, desiredAngle);
    player.angle = damp(player.angle, player.angle + delta, 8, dt);
  } else if (ball) {
    // face ball if idle near ball
    const dx = ball.x - player.x;
    const dz = ball.z - player.z;
    if (Math.hypot(dx, dz) < 5 && player.state === 'idle') {
      const desiredAngle = Math.atan2(dx, dz);
      const delta = angleDelta(player.angle, desiredAngle);
      player.angle += delta * dt * 1.5;
    }
  }

  // state timers
  if (player.stateTimer > 0) {
    player.stateTimer -= dt;
    if (player.stateTimer <= 0) {
      if (player.state === 'kick' || player.state === 'rabona') {
        player.state = 'idle';
      } else if (player.state === 'slide') {
        player.state = 'getup';
        player.stateTimer = 0.6;
      } else if (player.state === 'fall') {
        player.state = 'getup';
        player.stateTimer = 0.7;
      } else if (player.state === 'getup') {
        player.state = 'idle';
      } else if (player.state === 'celebrate') {
        player.state = 'idle';
      }
    }
  }

  // auto transition idle/run
  if (player.state === 'idle' || player.state === 'run') {
    const speed = Math.hypot(player.vx, player.vz);
    if (speed > 0.6) player.state = 'run';
    else player.state = 'idle';
  }

  // update wobble spring
  player.wobbleX = damp(player.wobbleX, 0, 4, dt);
  player.wobbleZ = damp(player.wobbleZ, 0, 4, dt);
  player.wobbleY = damp(player.wobbleY, 0, 3, dt);

  // add movement wobble
  if (player.state === 'run') {
    player.wobbleX += Math.sin(player.runCycle * 2) * 0.02 * dt * 60;
  }

  player.runCycle += dt * Math.hypot(player.vx, player.vz) * 1.8;
}
