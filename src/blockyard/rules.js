// Browser-independent world data, save validation, and platformer physics.
export const SAVE_KEY = 'blockyard-cloud-hop-v1';
export const OUTFITS = {
  citrus: { name: 'Citrus club', shirt: '#b5e85e', cap: '#fd965e', pants: '#5064a7', bag: '#a48ce1' },
  ocean: { name: 'Ocean explorer', shirt: '#65c9cb', cap: '#f4f0dc', pants: '#384f78', bag: '#f6b35e' },
  berry: { name: 'Berry nice', shirt: '#ef94b3', cap: '#9b81da', pants: '#65558b', bag: '#f4d075' },
  electric: { name: 'Electric blue', shirt: '#6b9eea', cap: '#b9e674', pants: '#394b6b', bag: '#fb9266' },
};
export const STAGES = [
  { name: 'Sunny Square', short: 'The beginning', hint: 'Follow the coins. Space twice gives you a double jump.', x: 0, z: 3, y: 0, w: 20, d: 18, spawn: { x: 2.5, z: 4.5 }, color: '#a8d978' },
  { name: 'First steps', short: 'Find your feet', hint: 'Nice landing! Jump over the coral-red lava strips ahead.', x: 1, z: -25, y: 1.4, w: 10, d: 8, color: '#a9d98a' },
  { name: 'Hotfoot', short: 'Mind the lava', hint: 'The blue platforms move. Wait for one to come closer.', x: -9, z: -49, y: 2.8, w: 11, d: 9, color: '#a5d3b2' },
  { name: 'Cloud movers', short: 'Go with the flow', hint: 'The yellow spring launches you toward the high platform.', x: 6, z: -75, y: 4.2, w: 11, d: 9, color: '#a4d2df' },
  { name: 'Bounce garden', short: 'A little lift', hint: 'Jump over the pink spinner, then follow the gold arch.', x: 3, z: -101, y: 6.8, w: 11, d: 10, color: '#c2a7e0' },
  { name: 'Sky summit', short: 'You made it', hint: 'Walk through the gold arch to finish your adventure.', x: -8, z: -131, y: 9.4, w: 15, d: 12, color: '#c9df8f' },
];
const pad = (id, x, z, y, w = 4.5, d = 4, extra = {}) => ({ id, x, z, y, w, d, thickness: 1.05, kind: 'step', ...extra });
export const PLATFORM_DATA = [
  ...STAGES.map((s, stage) => ({ ...s, id: `island-${stage}`, kind: 'island', stage, thickness: 2.7 })),
  pad('step-1', -2, -9.5, .35, 5, 4), pad('step-2', 1.4, -15, .75, 4.7, 4), pad('step-3', -1.5, -20, 1.1, 4.5, 3.6),
  pad('step-4', -3.6, -31.3, 1.7, 5, 4.6), pad('lava-lane', -9, -38.6, 2.1, 10, 10, { kind: 'lava' }),
  pad('mover-1', -6, -57, 3.1, 4.8, 4.5, { kind: 'moving', amplitude: 2.4, speed: 1.1, phase: 0 }),
  pad('mover-2', .6, -63, 3.5, 4.8, 4.5, { kind: 'moving', amplitude: 2.1, speed: 1.2, phase: 1.6 }),
  pad('step-5', 5, -69, 3.8, 4.8, 4),
  pad('spring', 8, -83.3, 4.5, 5, 4.4, { kind: 'spring', bounce: true }),
  pad('high-step', 3, -92.1, 7.1, 5.7, 4.7),
  pad('spinner', -3, -113.1, 8.0, 12, 10, { kind: 'spinner' }),
  pad('step-6', -8, -123, 8.9, 5.5, 5),
];
export const LAVA = [-35.4, -38.5, -41.6].map((z, i) => ({ id: `lava-${i}`, x: -9, z, y: 2.12, w: 9.5, d: .8, h: .25 }));
export const SPINNER = { x: -3, z: -113.1, y: 8.55, length: 10.4, speed: 1.05, radius: .22 };
export const COINS = [
  [1.65, 1.9, 0], [1.0, -.6, 0], [-2, -9.5, .35], [1.4, -15, .75], [-1.5, -20, 1.1],
  [1, -25, 1.4], [3.8, -25, 1.4], [-3.6, -31.3, 1.7], [-9, -34.5, 2.1], [-9, -40, 3.2],
  [-9, -49, 2.8], [-12, -49, 2.8], [-6, -57, 3.1, 'mover-1'], [.6, -63, 3.5, 'mover-2'], [5, -69, 3.8],
  [6, -75, 4.2], [9, -75, 4.2], [8, -83.3, 4.5], [3, -92.1, 7.1],
  [3, -101, 6.8], [6, -101, 6.8], [-3, -111, 8], [-8, -123, 8.9], [-8, -131, 9.4],
].map(([x, z, y, platform], id) => ({ id, x, z, y: y + 1.4, platform }));
export const PLAYER = { radius: .35, height: 2.75, speed: 7.5, sprint: 10.5, jump: 10.5, gravity: 25, maxJumps: 2 };
export const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export const formatTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export function newSave() { return { version: 1, checkpoint: 0, collected: [], outfit: 'citrus', elapsed: 0, deaths: 0, best: null, won: false, started: false, sound: false, quality: 'high' }; }
export function sanitizeSave(value) {
  const clean = newSave();
  if (!value || value.version !== 1) return clean;
  const finite = (v, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  clean.checkpoint = clamp(Math.floor(finite(value.checkpoint)), 0, STAGES.length - 1);
  clean.collected = Array.isArray(value.collected) ? [...new Set(value.collected.filter(id => Number.isInteger(id) && id >= 0 && id < COINS.length))] : [];
  clean.outfit = Object.hasOwn(OUTFITS, value.outfit) ? value.outfit : 'citrus';
  clean.elapsed = clamp(finite(value.elapsed), 0, 604800); clean.deaths = clamp(Math.floor(finite(value.deaths)), 0, 99999);
  clean.best = Number.isFinite(value.best) && value.best > 0 ? clamp(value.best, 1, 604800) : null;
  clean.won = value.won === true && clean.checkpoint === STAGES.length - 1;
  clean.started = value.started === true;
  clean.sound = value.sound === true; clean.quality = value.quality === 'low' ? 'low' : 'high';
  return clean;
}
export function loadSave(storage) { try { return sanitizeSave(JSON.parse(storage.getItem(SAVE_KEY))); } catch { return newSave(); } }
export function writeSave(storage, state) { try { storage.setItem(SAVE_KEY, JSON.stringify(state)); return true; } catch { return false; } }
export function advanceCheckpoint(state, stage) {
  if (stage !== state.checkpoint + 1 || stage >= STAGES.length) return false;
  state.checkpoint = stage; return true;
}
export function collectCoin(state, id) {
  if (!Number.isInteger(id) || id < 0 || id >= COINS.length || state.collected.includes(id)) return false;
  state.collected.push(id); return true;
}
export function finishRun(state) {
  if (state.won || state.checkpoint !== STAGES.length - 1 || !state.started) return false;
  state.won = true;
  if (state.best === null || state.elapsed < state.best) state.best = Math.max(1, state.elapsed);
  return true;
}
export function spawnPoint(stage = 0) {
  const s = STAGES[clamp(stage, 0, STAGES.length - 1)];
  return { x: s.spawn?.x ?? s.x, y: s.y, z: s.spawn?.z ?? s.z + 1.3 };
}
export function createPlayer(stage = 0) {
  return { ...spawnPoint(stage), vx: 0, vy: 0, vz: 0, grounded: true, support: `island-${stage}`, jumps: 0, coyote: .13, jumpBuffer: 0, heading: .32 };
}
export function platformAt(platform, time) {
  return { ...platform, x: platform.x + (platform.amplitude ? Math.sin(time * platform.speed + platform.phase) * platform.amplitude : 0) };
}
export function overlapXZ(player, surface, radius = PLAYER.radius) {
  return Math.abs(player.x - surface.x) < surface.w / 2 + radius && Math.abs(player.z - surface.z) < surface.d / 2 + radius;
}
export function stepPlayer(player, input, platforms, dt) {
  dt = clamp(dt, 0, .05);
  const events = [];
  if (player.grounded) {
    const support = platforms.find(p => p.id === player.support);
    if (support) { player.x += support.dx || 0; player.z += support.dz || 0; }
    player.coyote = .13; player.jumps = 0;
  } else player.coyote = Math.max(0, player.coyote - dt);
  player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
  if (input.jump) player.jumpBuffer = .15;
  if (player.jumpBuffer > 0 && (player.grounded || player.coyote > 0 || player.jumps < PLAYER.maxJumps)) {
    const double = !player.grounded && player.coyote <= 0;
    player.vy = PLAYER.jump; player.grounded = false; player.support = null;
    player.jumps = double ? Math.max(1, player.jumps) + 1 : 1;
    player.coyote = 0; player.jumpBuffer = 0; events.push(double ? 'double-jump' : 'jump');
  }
  const length = Math.hypot(input.x || 0, input.z || 0), speed = input.sprint ? PLAYER.sprint : PLAYER.speed;
  const desiredX = length > 1 ? input.x / length : input.x || 0, desiredZ = length > 1 ? input.z / length : input.z || 0;
  const smoothing = 1 - Math.exp(-(player.grounded ? 20 : 11) * dt);
  player.vx += (desiredX * speed - player.vx) * smoothing; player.vz += (desiredZ * speed - player.vz) * smoothing;
  if (length > .05) player.heading = Math.atan2(desiredX, desiredZ);
  const old = { x: player.x, y: player.y, z: player.z };
  player.x += player.vx * dt; player.z += player.vz * dt;
  player.vy -= PLAYER.gravity * dt;
  const nextY = player.y + player.vy * dt;
  let landing = null;
  for (const surface of platforms) {
    if (!overlapXZ(player, surface)) continue;
    if (player.vy <= 0 && old.y >= surface.y - .06 && nextY <= surface.y) {
      if (!landing || surface.y > landing.y) landing = surface;
    }
    const bottom = surface.y - (surface.thickness ?? 1);
    if (player.vy > 0 && old.y + PLAYER.height <= bottom + .03 && nextY + PLAYER.height >= bottom) {
      player.vy = 0; player.y = bottom - PLAYER.height; events.push('head-bump');
    }
  }
  if (landing) {
    if (!player.grounded && player.vy < -3) events.push('land');
    player.y = landing.y; player.vy = 0; player.grounded = true; player.support = landing.id; player.jumps = 0;
    if (landing.bounce) { player.vy = 17.4; player.grounded = false; player.support = null; player.jumps = 1; player.coyote = 0; player.jumpBuffer = 0; events.push('bounce'); }
  } else {
    if (!events.includes('head-bump')) player.y = nextY;
    player.grounded = false; player.support = null;
  }
  // Solid sides: you cannot walk through floating blocks or decorative trunks.
  for (const surface of platforms) {
    const bottom = surface.y - (surface.thickness ?? 1);
    if (player.y >= surface.y - .08 || player.y + PLAYER.height <= bottom + .05 || !overlapXZ(player, surface)) continue;
    const px = surface.w / 2 + PLAYER.radius - Math.abs(player.x - surface.x), pz = surface.d / 2 + PLAYER.radius - Math.abs(player.z - surface.z);
    if (px < pz) { player.x += (player.x >= surface.x ? 1 : -1) * px; player.vx = 0; }
    else { player.z += (player.z >= surface.z ? 1 : -1) * pz; player.vz = 0; }
  }
  return events;
}
export function touchesHazard(player, time) {
  for (const lava of LAVA) if (overlapXZ(player, lava) && player.y < lava.y + lava.h && player.y + PLAYER.height > lava.y) return true;
  const angle = time * SPINNER.speed, dx = player.x - SPINNER.x, dz = player.z - SPINNER.z;
  const along = dx * Math.cos(angle) - dz * Math.sin(angle), across = dx * Math.sin(angle) + dz * Math.cos(angle);
  return Math.abs(along) < SPINNER.length / 2 + PLAYER.radius && Math.abs(across) < SPINNER.radius + PLAYER.radius && player.y < SPINNER.y + .25 && player.y + PLAYER.height > SPINNER.y - .25;
}
