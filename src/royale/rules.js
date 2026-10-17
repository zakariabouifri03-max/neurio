export const WORLD_RADIUS = 690;
export const DRIVER_COUNT = 12;
export const MAX_LEVEL = 8;
export const CARS = [
  { id: 'kaze', name: 'KAZE GT', family: 'JAPANESE STREET COUPE', drivetrain: 'AWD', speed: 47, acceleration: 13.8, handling: 7.6, offroad: .77, stats: [78, 80, 84, 68], description: 'Balanced on the road. Composed when the road runs out.' },
  { id: 'raid', name: 'RAID XR', family: 'RALLY-SPEC SPORT COUPE', drivetrain: 'AWD', speed: 43, acceleration: 14.8, handling: 8.5, offroad: .93, stats: [69, 86, 88, 96], description: 'Take the shortcut. Built for gravel, grass, and bad ideas.' },
  { id: 'vela', name: 'VELA RS', family: 'LIGHTWEIGHT GRAND TOURER', drivetrain: 'RWD', speed: 52, acceleration: 13.2, handling: 6.8, offroad: .65, stats: [92, 76, 73, 56], description: 'Find a straight. Leave everyone else in the rear-view.' },
];
export const PAINTS = [
  { name: 'Solar yellow', color: '#dfc153' }, { name: 'Racing vermilion', color: '#e66c4e' },
  { name: 'Glacier white', color: '#e5e9de' }, { name: 'Pacific blue', color: '#6babb7' },
  { name: 'Midnight', color: '#343e4c' }, { name: 'Sakura pink', color: '#dba5bb' },
];
export const RIVAL_NAMES = ['AKIRA', 'NOVA', 'KAI', 'ROOK', 'MILO', 'JUNO', 'ECHO', 'REI', 'SORA', 'FINN', 'LUX'];
export const PHASES = [
  { name: 'OPEN WORLD', start: 0, end: 65, from: 640, to: 640 },
  { name: 'ARENA CLOSING', start: 65, end: 115, from: 640, to: 450 },
  { name: 'ARENA CLOSING', start: 115, end: 165, from: 450, to: 290 },
  { name: 'FINAL CIRCLE', start: 165, end: 205, from: 290, to: 155 },
];
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export function seeded(seed = 4301) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  const flatten = clamp((r - 18) / 75, 0, 1);
  let h = (Math.sin(x / 130) * 5.2 + Math.sin(z / 135) * 4.7 + Math.sin((x + z) / 67) * 2.3) * flatten;
  h -= Math.exp(-((x + 407) ** 2 / 9500 + (z - 82) ** 2 / 6000)) * 9;
  return h;
}
export function zoneAt(elapsed) {
  const phase = PHASES.find(p => elapsed < p.end) || PHASES.at(-1);
  const amount = clamp((elapsed - phase.start) / (phase.end - phase.start), 0, 1);
  return { ...phase, index: PHASES.indexOf(phase), radius: phase.from + (phase.to - phase.from) * amount, remaining: Math.max(0, phase.end - elapsed) };
}
export function levelStats(carId, level) {
  const car = CARS.find(c => c.id === carId) || CARS[0];
  const l = clamp(level, 1, MAX_LEVEL) - 1;
  return { ...car, speed: car.speed + l * 4.1, acceleration: car.acceleration + l * 1.15, handling: car.handling + l * .13 };
}
export function exposureAfter(current, outside, dt, difficulty = 'casual') {
  return clamp(current + (outside ? (difficulty === 'challenger' ? 7.7 : 5.6) : -15) * dt, 0, 100);
}
export function formatTime(seconds) { const s = Math.max(0, Math.ceil(seconds)); return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`; }
export function findCollision(x, z, radius, obstacles) {
  for (const obstacle of obstacles) {
    const d = Math.hypot(x - obstacle.x, z - obstacle.z);
    if (d < radius + obstacle.radius) return { obstacle, distance: d, nx: d > .001 ? (x - obstacle.x) / d : 1, nz: d > .001 ? (z - obstacle.z) / d : 0 };
  }
  return null;
}
// Arcade drivetrain: a real longitudinal speed, inertial lateral velocity,
// speed-dependent steering, off-road traction, and a regenerative boost tank.
export function stepVehicle(vehicle, input, dt, road, stats, obstacles = []) {
  const speedAbs = Math.abs(vehicle.speed);
  const boosting = input.boost && input.gas && vehicle.boost > 1 && vehicle.speed > 6;
  const maxSpeed = stats.speed * (road ? 1 : stats.offroad) * (boosting ? 1.24 : 1);
  if (input.gas) { if (vehicle.speed < maxSpeed) vehicle.speed = Math.min(maxSpeed, vehicle.speed + stats.acceleration * (boosting ? 1.75 : 1) * dt); }
  else if (input.brake) vehicle.speed -= (vehicle.speed > 1 ? 31 : 9) * dt;
  else vehicle.speed = damp(vehicle.speed, 0, road ? .17 : .35, dt);
  if (input.brake && vehicle.speed < -12) vehicle.speed = -12;
  if (vehicle.speed > maxSpeed) vehicle.speed = damp(vehicle.speed, maxSpeed, 2.5, dt);
  vehicle.speed = clamp(vehicle.speed, -12, stats.speed * 1.27);
  if (input.drift) vehicle.speed = damp(vehicle.speed, 0, .32, dt);
  vehicle.steer = damp(vehicle.steer || 0, input.steer || 0, 8, dt);
  vehicle.angle -= vehicle.steer * vehicle.speed / 2.95 * .31 / (1 + speedAbs * .047) * (input.drift ? 1.5 : 1) * dt;
  const traction = input.drift ? 1.6 : road ? stats.handling : stats.handling * .62;
  vehicle.vx = damp(vehicle.vx, Math.sin(vehicle.angle) * vehicle.speed, traction, dt);
  vehicle.vz = damp(vehicle.vz, Math.cos(vehicle.angle) * vehicle.speed, traction, dt);
  let x = vehicle.x, z = vehicle.z, hit = null;
  // Substeps prevent a boosted car tunnelling through a narrow tree or post.
  const steps = Math.max(1, Math.ceil(Math.hypot(vehicle.vx, vehicle.vz) * dt / .8));
  for (let i = 0; i < steps; i++) {
    x += vehicle.vx * dt / steps; z += vehicle.vz * dt / steps;
    const contact = findCollision(x, z, 1.13, obstacles);
    if (contact) {
      hit = contact;
      const overlap = 1.15 + contact.obstacle.radius - contact.distance;
      x += contact.nx * overlap; z += contact.nz * overlap;
      const toward = vehicle.vx * contact.nx + vehicle.vz * contact.nz;
      if (toward < 0) { vehicle.vx -= contact.nx * toward * 1.25; vehicle.vz -= contact.nz * toward * 1.25; vehicle.speed *= .42; }
      vehicle.hit = .35;
    }
  }
  const length = Math.hypot(x, z);
  if (length > WORLD_RADIUS) { x *= WORLD_RADIUS / length; z *= WORLD_RADIUS / length; vehicle.speed *= .85; }
  vehicle.distance = (vehicle.distance || 0) + Math.hypot(x - vehicle.x, z - vehicle.z);
  vehicle.x = x; vehicle.z = z;
  vehicle.boost = clamp(vehicle.boost + (boosting ? -28 : 10) * dt, 0, 100);
  vehicle.boosting = boosting;
  return hit;
}
