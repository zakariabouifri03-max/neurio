// ═══════════════════════════════════════════════════════════════════════════
//  DÉCOR — everything that makes the world feel alive:
//   • torches (merged sticks + animated additive flame billboards)
//   • campfire embers + night fireflies (GPU points with custom shaders)
//   • wind-animated instanced grass tufts and flowers
//   • beacon beam from the watch tower
//   • procedural glow sprite used by every flame
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeBoxes } from './sky.js';
import { mulberry32, clamp } from '../util.js';

// ── radial glow sprite ──────────────────────────────────────────────────────
export function glowTexture(size = 64, core = 'rgba(255,246,214,1)', mid = 'rgba(255,168,58,0.55)') {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, core);
  grd.addColorStop(0.28, mid);
  grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── grass tuft / petal textures for the instanced scatter ───────────────────
function tuftTexture(seed = 11) {
  const S = 32;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  const rnd = mulberry32(seed);
  for (let b = 0; b < 9; b++) {
    const x0 = 3 + rnd() * 26, h = 12 + rnd() * 18, lean = (rnd() - 0.5) * 12;
    g.strokeStyle = `rgba(${58 + rnd() * 40 | 0},${126 + rnd() * 66 | 0},${48 + rnd() * 30 | 0},1)`;
    g.lineWidth = 1.6 + rnd();
    g.beginPath();
    g.moveTo(x0, S);
    g.quadraticCurveTo(x0 + lean * 0.4, S - h * 0.6, x0 + lean, S - h);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  return t;
}

function flowerTexture(kind, seed = 5) {
  const S = 32;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  const rnd = mulberry32(seed);
  for (let b = 0; b < 3; b++) {
    const x0 = 10 + b * 6 + rnd() * 3, h = 14 + rnd() * 8;
    g.strokeStyle = '#3f7d33'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x0, S); g.lineTo(x0 + (rnd() - 0.5) * 3, S - h); g.stroke();
    g.fillStyle = '#4e9140';
    g.beginPath(); g.ellipse(x0 - 3, S - h * 0.5, 3.4, 1.6, -0.5, 0, Math.PI * 2); g.fill();
  }
  const heads = [[12, 12], [19, 15], [25, 11]];
  for (const [hx, hy] of heads) {
    if (kind === 'poppy') {
      g.fillStyle = '#c62d24';
      for (let p = 0; p < 6; p++) {
        const a = p / 6 * Math.PI * 2;
        g.beginPath(); g.ellipse(hx + Math.cos(a) * 2.6, hy + Math.sin(a) * 2.6, 2.6, 2.1, a, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#2a2018'; g.beginPath(); g.arc(hx, hy, 1.5, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = '#f5d534';
      g.beginPath(); g.arc(hx, hy, 3.1, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffe97a'; g.beginPath(); g.arc(hx - 0.7, hy - 0.7, 1.5, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── wind injection for instanced foliage ────────────────────────────────────
function makeWindMaterial(tex, opts = {}) {
  const uniforms = { uTime: { value: 0 }, uWind: { value: opts.wind ?? 0.14 } };
  const mat = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0,
    color: opts.color ?? 0xffffff, transparent: false,
  });
  mat.customProgramCacheKey = () => 'wind' + (opts.key || '');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uWind = uniforms.uWind;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
      vec3 transformed3 = vec3( transformed );
      #ifdef USE_INSTANCING
        vec4 wPos = instanceMatrix * vec4( transformed3, 1.0 );
        float sway = clamp(uv.y, 0.0, 1.0);
        sway *= sway;
        float ph = wPos.x * 0.24 + wPos.z * 0.19;
        transformed3.x += sin( uTime * 1.7 + ph ) * uWind * sway;
        transformed3.z += cos( uTime * 1.31 + ph * 1.27 ) * uWind * 0.72 * sway;
        transformed3.y += sin( uTime * 2.3 + ph ) * uWind * 0.16 * sway;
      #endif
      vec4 mvPosition = vec4( transformed3, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
    `);
  };
  mat.userData.uniforms = uniforms;
  return mat;
}

// cross-plane geometry (two quads at 45°, like Minecraft's flora)
function crossGeometry(w = 1, h = 1) {
  const geos = [];
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    const p = new THREE.PlaneGeometry(w, h);
    p.rotateY(rot);
    p.translate(0, h / 2, 0);
    geos.push(p);
  }
  const merged = mergePlanes(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}

function mergePlanes(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) { vc += g.attributes.position.count; ic += g.index.count; }
  const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  const idx = new Uint16Array(ic);
  let vo = 0, io = 0, uo = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
export class Decor {
  constructor(scene, T, E, opts = {}) {
    this.scene = scene;
    this.T = T;
    this.group = new THREE.Group();
    this.group.name = 'decor';
    scene.add(this.group);
    this.glow = glowTexture();
    this.flames = [];
    this.time = 0;
    this.enabled = true;

    this._buildTorches(E.torches || []);
    this._buildBeams(E.beacons || []);
    this._buildEmbers(E.campfires || []);
    this._buildFireflies(opts.fireflies ?? 190);
    this._buildFoliage(opts.grass ?? 5200, opts.flowers ?? 900);
  }

  // ── torches ──────────────────────────────────────────────────────────────
  _buildTorches(list) {
    if (!list.length) return;
    const stick = new THREE.BoxGeometry(0.13, 0.5, 0.13);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.95, metalness: 0 });
    const parts = [];
    for (const t of list) {
      const g = stick.clone();
      g.translate(t.x + 0.5, t.y + 0.25, t.z + 0.5);
      parts.push(g);
    }
    const merged = mergeBoxes(parts);
    parts.forEach((p) => p.dispose());
    const sticks = new THREE.Mesh(merged, woodMat);
    sticks.castShadow = true; sticks.receiveShadow = true;
    sticks.name = 'torchSticks';
    this.group.add(sticks);
    stick.dispose();

    const flameMat = new THREE.SpriteMaterial({
      map: this.glow, color: 0xffb454, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    });
    for (const t of list) {
      const s = new THREE.Sprite(flameMat.clone());
      s.position.set(t.x + 0.5, t.y + 0.56, t.z + 0.5);
      s.scale.setScalar(0.55);
      s.renderOrder = 5;
      s.userData.phase = Math.random() * 10;
      s.userData.baseY = t.y + 0.56;
      this.group.add(s);
      this.flames.push(s);
    }
  }

  // ── beacon beams ─────────────────────────────────────────────────────────
  _buildBeams(list) {
    this.beams = [];
    for (const b of list) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        color: 0xbfe8ff, transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
      });
      for (let i = 0; i < 9; i++) {
        const s = 0.86 - i * 0.055;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(s, 9, s), mat);
        seg.position.set(b.x, b.y + 4.5 + i * 9, b.z);
        seg.renderOrder = 6;
        g.add(seg);
      }
      this.group.add(g);
      this.beams.push({ g, mat });
    }
  }

  // ── campfire embers ──────────────────────────────────────────────────────
  _buildEmbers(fires) {
    this.embers = [];
    const tex = glowTexture(32, 'rgba(255,236,190,1)', 'rgba(255,120,30,0.6)');
    for (const f of fires) {
      const N = 130;
      const pos = new Float32Array(N * 3), seed = new Float32Array(N), size = new Float32Array(N);
      const state = [];
      const rnd = mulberry32(Math.floor(f.x * 31 + f.z * 7));
      for (let i = 0; i < N; i++) {
        state.push({ life: rnd() * 2.4, max: 1.4 + rnd() * 1.8, vx: (rnd() - 0.5) * 0.5, vz: (rnd() - 0.5) * 0.5, vy: 0.9 + rnd() * 1.5 });
        seed[i] = rnd() * 100; size[i] = 5 + rnd() * 9;
        pos[i * 3] = f.x; pos[i * 3 + 1] = f.y; pos[i * 3 + 2] = f.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uTex: { value: tex }, uScale: { value: 300 } },
        vertexShader: /* glsl */`
          attribute float aSeed; attribute float aSize;
          uniform float uTime; uniform float uScale;
          varying float vFade;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vFade = 0.35 + 0.65 * abs(sin(uTime * 3.0 + aSeed));
            gl_PointSize = aSize * uScale / max(0.001, -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */`
          uniform sampler2D uTex; varying float vFade;
          void main() {
            vec4 t = texture2D(uTex, gl_PointCoord);
            gl_FragColor = vec4(t.rgb * (0.7 + vFade * 0.9), t.a * vFade);
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = 7;
      this.group.add(pts);
      this.embers.push({ pts, state, origin: f, N, pos, attr: g.attributes.position });
    }
  }

  // ── fireflies ────────────────────────────────────────────────────────────
  _buildFireflies(count) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const size = new Float32Array(count);
    const home = [];
    const rnd = mulberry32(9182);
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 40) {
      const x = Math.round((rnd() * 2 - 1) * 50), z = Math.round((rnd() * 2 - 1) * 50);
      const y = this.T.surface(x, z);
      if (y <= this.T.SEA + 1) continue;
      home.push({ x: x + rnd(), y: y + 0.6 + rnd() * 2.6, z: z + rnd(), r: 2 + rnd() * 5, s: 0.2 + rnd() * 0.5, p: rnd() * 20 });
      seed[placed] = rnd() * 100; size[placed] = 4 + rnd() * 5;
      pos[placed * 3] = x; pos[placed * 3 + 1] = y; pos[placed * 3 + 2] = z;
      placed++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const tex = glowTexture(32, 'rgba(230,255,190,1)', 'rgba(170,240,90,0.5)');
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uTex: { value: tex }, uScale: { value: 260 }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aSeed; attribute float aSize;
        uniform float uTime; uniform float uScale;
        varying float vBlink;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float b = sin(uTime * 1.7 + aSeed) * 0.5 + 0.5;
          vBlink = pow(b, 3.0);
          gl_PointSize = aSize * (0.55 + vBlink * 0.75) * uScale / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uTex; uniform float uOpacity; varying float vBlink;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          float a = t.a * vBlink * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(t.rgb * (0.6 + vBlink), a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    });
    this.fireflies = new THREE.Points(g, m);
    this.fireflies.frustumCulled = false;
    this.fireflies.renderOrder = 7;
    this.group.add(this.fireflies);
    this._ff = { home, pos, attr: g.attributes.position, mat: m, rnd };
  }

  // ── instanced wind-blown grass + flowers ─────────────────────────────────
  _buildFoliage(grassCount, flowerCount) {
    const geo = crossGeometry(0.86, 0.62);
    const tuft = tuftTexture(21);
    const mat = makeWindMaterial(tuft, { key: 'grass', wind: 0.13 });
    this.grassMat = mat;
    const inst = new THREE.InstancedMesh(geo, mat, grassCount);
    inst.castShadow = false; inst.receiveShadow = true;
    inst.name = 'grassTufts';
    const rnd = mulberry32(777);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const v = new THREE.Vector3(), sc = new THREE.Vector3();
    let placed = 0, guard = 0;
    while (placed < grassCount && guard++ < grassCount * 12) {
      const x = (rnd() * 2 - 1) * 54, z = (rnd() * 2 - 1) * 54;
      const ix = Math.round(x), iz = Math.round(z);
      if (Math.hypot(ix, iz) > 54) continue;
      const y = this.T.surface(ix, iz);
      if (y <= this.T.SEA + 1) continue;
      if (this.T.world.get(ix, y, iz) !== 0) continue;           // occupied by a voxel plant
      const s = 0.62 + rnd() * 0.85;
      e.set(0, rnd() * Math.PI * 2, 0); q.setFromEuler(e);
      v.set(x, y - 0.06, z); sc.set(s, s * (0.8 + rnd() * 0.5), s);
      m4.compose(v, q, sc);
      inst.setMatrixAt(placed++, m4);
      const tint = 0.78 + rnd() * 0.4;
      inst.setColorAt(placed - 1, new THREE.Color(tint * 0.92, tint, tint * 0.86));
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.group.add(inst);
    this.grass = inst;

    // flowers
    const fgeo = crossGeometry(0.72, 0.66);
    const poppyTex = flowerTexture('poppy', 3);
    const dandTex = flowerTexture('dandelion', 8);
    this.flowers = [];
    for (const [tex, key] of [[poppyTex, 'poppy'], [dandTex, 'dand']]) {
      const fm = makeWindMaterial(tex, { key, wind: 0.09 });
      const inst2 = new THREE.InstancedMesh(fgeo, fm, flowerCount / 2);
      inst2.castShadow = false; inst2.receiveShadow = true;
      inst2.name = 'flowers_' + key;
      const rr = mulberry32(key === 'poppy' ? 31 : 97);
      let p2 = 0, g2 = 0;
      while (p2 < flowerCount / 2 && g2++ < flowerCount * 8) {
        const x = (rr() * 2 - 1) * 50, z = (rr() * 2 - 1) * 50;
        const ix = Math.round(x), iz = Math.round(z);
        const y = this.T.surface(ix, iz);
        if (y <= this.T.SEA + 1 || y > this.T.SEA + 24) continue;
        if (this.T.world.get(ix, y, iz) !== 0) continue;
        const s = 0.8 + rr() * 0.5;
        e.set(0, rr() * Math.PI * 2, 0); q.setFromEuler(e);
        v.set(x, y - 0.05, z); sc.set(s, s, s);
        m4.compose(v, q, sc);
        inst2.setMatrixAt(p2++, m4);
      }
      inst2.count = p2;
      inst2.instanceMatrix.needsUpdate = true;
      this.group.add(inst2);
      this.flowers.push({ inst: inst2, mat: fm });
    }
  }

  update(dt, ctx) {
    if (!this.enabled) return;
    this.time += dt;
    const t = this.time;
    const night = ctx.night ?? 0;

    // flames flicker
    for (const f of this.flames) {
      const k = 0.82 + 0.22 * Math.sin(t * 11 + f.userData.phase) + 0.1 * Math.sin(t * 23.7 + f.userData.phase * 2);
      f.scale.set(0.5 * k, 0.62 * k, 1);
      f.position.y = f.userData.baseY + Math.sin(t * 7 + f.userData.phase) * 0.012;
      f.material.opacity = 0.55 + 0.45 * clamp(night * 1.2, 0, 1);
      f.material.color.setHSL(0.08 + 0.02 * Math.sin(t * 9 + f.userData.phase), 1, 0.62);
    }
    // beacon beams glow at night
    for (const b of this.beams) {
      b.mat.opacity = 0.05 + night * (0.16 + 0.05 * Math.sin(t * 1.6));
      b.g.rotation.y = t * 0.12;
    }
    // embers
    for (const e of this.embers) {
      for (let i = 0; i < e.N; i++) {
        const s = e.state[i];
        s.life += dt;
        if (s.life > s.max) {
          s.life = 0; s.max = 1.3 + Math.random() * 1.9;
          s.vx = (Math.random() - 0.5) * 0.6; s.vz = (Math.random() - 0.5) * 0.6; s.vy = 0.8 + Math.random() * 1.6;
          e.pos[i * 3] = e.origin.x + (Math.random() - 0.5) * 0.6;
          e.pos[i * 3 + 1] = e.origin.y;
          e.pos[i * 3 + 2] = e.origin.z + (Math.random() - 0.5) * 0.6;
        }
        const lt = s.life / s.max;
        e.pos[i * 3] += (s.vx + Math.sin(t * 2.1 + i) * 0.35) * dt;
        e.pos[i * 3 + 1] += s.vy * (1 - lt * 0.5) * dt;
        e.pos[i * 3 + 2] += (s.vz + Math.cos(t * 1.7 + i * 0.7) * 0.35) * dt;
      }
      e.attr.needsUpdate = true;
      e.pts.material.uniforms.uTime.value = t;
      e.pts.material.uniforms.uScale.value = ctx.pxScale ?? 300;
    }
    // fireflies drift around their home and only show at night
    const ff = this._ff;
    if (ff) {
      ff.mat.uniforms.uOpacity.value = clamp((night - 0.25) * 1.6, 0, 1);
      ff.mat.uniforms.uTime.value = t;
      ff.mat.uniforms.uScale.value = ctx.pxScale ?? 260;
      for (let i = 0; i < ff.home.length; i++) {
        const h = ff.home[i];
        ff.pos[i * 3] = h.x + Math.sin(t * h.s + h.p) * h.r;
        ff.pos[i * 3 + 1] = h.y + Math.sin(t * h.s * 1.7 + h.p * 2) * 0.9;
        ff.pos[i * 3 + 2] = h.z + Math.cos(t * h.s * 0.83 + h.p) * h.r;
      }
      ff.attr.needsUpdate = true;
    }
    // wind uniforms
    const gust = 0.1 + 0.07 * Math.sin(t * 0.31) + 0.04 * Math.sin(t * 0.97);
    if (this.grassMat) this.grassMat.userData.uniforms.uTime.value = t;
    if (this.grassMat) this.grassMat.userData.uniforms.uWind.value = gust;
    for (const f of this.flowers) {
      f.mat.userData.uniforms.uTime.value = t;
      f.mat.userData.uniforms.uWind.value = gust * 0.7;
    }
  }

  setVisible(v) {
    this.enabled = v;
    this.group.visible = v;
  }
}
