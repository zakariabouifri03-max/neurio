// The CPU and GPU use the same wave coefficients. Floating objects never bob on
// an unrelated animation while the visible ocean moves underneath them.
export const SEA_STATES = {
  calm: { label: 'Calm lagoon', strength: 0.28, description: 'A gentle ripple' },
  rolling: { label: 'Rolling swells', strength: 0.85, description: 'A steady sea breeze' },
  rough: { label: 'Open ocean', strength: 1.45, description: 'Fresh wind · whitecaps' },
};
export const ISLANDS = [
  { id: 'palmwood', name: 'Palmwood Cove', x: -20, z: -32, radius: 14, seed: 17, cabin: true },
  { id: 'castaway', name: 'Castaway Key', x: -91, z: -57, radius: 11, seed: 28, cabin: false },
  { id: 'twinpalms', name: 'Twin Palms', x: 61, z: -105, radius: 15, seed: 97, cabin: false },
];
export const WAVES = [
  { x: 0.94, z: 0.342, amplitude: 0.36, length: 19.0, speed: 1.02, phase: 1.3 },
  { x: -0.435, z: 0.9, amplitude: 0.18, length: 10.4, speed: 1.31, phase: 0.6 },
  { x: 0.66, z: -0.751, amplitude: 0.085, length: 5.7, speed: 1.74, phase: 2.5 },
  { x: -0.81, z: -0.586, amplitude: 0.038, length: 2.8, speed: 2.1, phase: 4.1 },
];
const TAU = Math.PI * 2;
export const smoothstep = (low, high, n) => { const t = Math.max(0, Math.min(1, (n - low) / (high - low))); return t * t * (3 - 2 * t); };

export function coastDistance(x, z, island) {
  const dx = (x - island.x) / 1.15, dz = (z - island.z) / .88;
  const angle = Math.atan2(dz, dx);
  const edge = island.radius * (1 + .045 * Math.sin(angle * 3 + island.seed) + .035 * Math.cos(angle * 5 - island.seed));
  return Math.hypot(dx, dz) - edge;
}
export function waveAt(x, z, time, strength = .85, out = {}) {
  let height = 0, dx = 0, dz = 0, crest = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const wave = WAVES[i], k = TAU / wave.length;
    const phase = k * (wave.x * x + wave.z * z) - time * wave.speed + wave.phase;
    const a = wave.amplitude * strength;
    height += a * (Math.sin(phase) + .17 * Math.sin(phase * 2));
    const derivative = a * k * (Math.cos(phase) + .34 * Math.cos(phase * 2));
    dx += derivative * wave.x; dz += derivative * wave.z;
    if (i < 2) crest += Math.max(0, Math.sin(phase)) * (i ? .3 : .7);
  }
  let shore = Infinity;
  for (const island of ISLANDS) shore = Math.min(shore, coastDistance(x, z, island));
  const damping = .12 + .88 * smoothstep(0, 5, shore);
  out.height = height * damping; out.dx = dx * damping; out.dz = dz * damping; out.crest = crest;
  return out;
}
export function raftSurface(x, z, time, strength = .85, out = {}) {
  const h = waveAt(x, z, time, strength).height;
  const left = waveAt(x - 2.5, z, time, strength).height, right = waveAt(x + 2.5, z, time, strength).height;
  const back = waveAt(x, z - 2.5, time, strength).height, front = waveAt(x, z + 2.5, time, strength).height;
  out.height = (h * 2 + left + right + back + front) / 6;
  out.dx = (right - left) / 5; out.dz = (front - back) / 5;
  return out;
}
export function surfaceAt(x, z, time, travel, strength, raft, radius = 4.5, out = {}) {
  waveAt(x + travel.x, z + travel.z, time, strength, out);
  const blend = smoothstep(radius, radius + 3.5, Math.hypot(x, z));
  const plane = raft.height + raft.dx * x + raft.dz * z;
  out.height = plane * (1 - blend) + out.height * blend;
  out.dx = raft.dx * (1 - blend) + out.dx * blend;
  out.dz = raft.dz * (1 - blend) + out.dz * blend;
  return out;
}
export function safeWaterPosition(travel) {
  const result = { x: travel.x, z: travel.z };
  // Migrate only stranded saves; valid close-to-shore positions must not jump
  // backwards on every reload. The same irregular coast is used for navigation.
  for (const island of ISLANDS) {
    if (coastDistance(result.x, result.z, island) >= 4.6) continue;
    const dx = result.x - island.x, dz = result.z - island.z;
    const angle = Math.hypot(dx, dz) > .001 ? Math.atan2(dz, dx) : Math.PI / 2;
    const x = Math.cos(angle), z = Math.sin(angle);
    let low = 0, high = island.radius * 1.25 + 6;
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (coastDistance(island.x + x * mid, island.z + z * mid, island) < 5.1) low = mid;
      else high = mid;
    }
    result.x = island.x + x * high; result.z = island.z + z * high;
  }
  return result;
}

const f = n => Number(n).toFixed(7);
export const WAVE_GLSL = /* glsl */`
  uniform float uTime;
  uniform float uStrength;
  uniform vec2 uTravel;
  uniform vec4 uRaft;
  uniform vec4 uIslands[3];
  float coast(vec2 p, vec4 island) {
    vec2 d = (p - island.xy) / vec2(1.15, .88);
    float a = atan(d.y, d.x);
    return length(d) - island.z * (1. + .045 * sin(a * 3. + island.w) + .035 * cos(a * 5. - island.w));
  }
  float shoreDistance(vec2 p) { return min(coast(p, uIslands[0]), min(coast(p, uIslands[1]), coast(p, uIslands[2]))); }
  vec4 waveField(vec2 p) {
    vec4 result = vec4(0.);
    ${WAVES.map((wave, i) => `{
      vec2 d = vec2(${f(wave.x)}, ${f(wave.z)});
      float k = ${f(TAU / wave.length)};
      float phase = k * dot(d, p) - uTime * ${f(wave.speed)} + ${f(wave.phase)};
      float a = ${f(wave.amplitude)} * uStrength;
      result.x += a * (sin(phase) + .17 * sin(2. * phase));
      result.yz += d * a * k * (cos(phase) + .34 * cos(phase * 2.));
      ${i < 2 ? `result.w += max(0., sin(phase)) * ${i ? '.3' : '.7'};` : ''}
    }`).join('\n')}
    float damping = .12 + .88 * smoothstep(0., 5., shoreDistance(p));
    result.xyz *= damping;
    return result;
  }
  vec4 surface(vec2 local) {
    vec4 wave = waveField(local + uTravel);
    float blend = smoothstep(uRaft.w, uRaft.w + 3.5, length(local));
    float plane = uRaft.x + dot(uRaft.yz, local);
    return vec4(mix(plane, wave.x, blend), mix(uRaft.yz, wave.yz, blend), wave.w * blend);
  }
`;
