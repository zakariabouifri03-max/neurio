// particles.js — pooled GPU particle systems (spray, smoke, fire, dust, rain, debris)
import * as THREE from 'three';
import { clamp, lerp, rand, mulberry32, TAU } from './util.js';

function softTexture(size = 64, kind = 'soft') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (kind === 'soft') {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else if (kind === 'smoke') {
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else if (kind === 'drop') {
    x.clearRect(0, 0, size, size);
    x.fillStyle = 'rgba(255,255,255,0.9)';
    x.fillRect(size * 0.42, 0, size * 0.16, size);
  } else {
    x.clearRect(0, 0, size, size);
    x.fillStyle = '#ffffff';
    x.beginPath(); x.arc(size / 2, size / 2, size * 0.32, 0, TAU); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

const P_VERT = /* glsl */`
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vCol;
varying float vA;
uniform float uScale;
void main(){
  vCol = aColor; vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;
const P_FRAG = /* glsl */`
uniform sampler2D uTex;
varying vec3 vCol;
varying float vA;
void main(){
  vec4 t = texture2D(uTex, gl_PointCoord);
  float a = t.a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * (t.rgb), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const P_VERT_CAMERA_ALIGNED = P_VERT; // alias for readability

class Pool {
  constructor(scene, { max = 800, texture, blending = THREE.NormalBlending, gravity = -9.8, drag = 0.4, sizeScale = 620 } = {}) {
    this.max = max; this.count = 0;
    this.gravity = gravity; this.drag = drag;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.colA = new Float32Array(max * 3);
    this.colB = new Float32Array(max * 3);
    this.alpha0 = new Float32Array(max);
    this.alpha1 = new Float32Array(max);
    this.buoy = new Float32Array(max);
    this.aSize = new Float32Array(max);
    this.aColor = new Float32Array(max * 3);
    this.aAlpha = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: P_VERT, fragmentShader: P_FRAG, transparent: true, depthWrite: false,
      blending, uniforms: { uTex: { value: texture }, uScale: { value: sizeScale } }, fog: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, { life = 1, size = 1, sizeEnd = null, color = [1, 1, 1], colorEnd = null, alpha = 1, alphaEnd = 0, buoy = 0, grow = 0 } = {}) {
    let i = this.count;
    if (i >= this.max) {
      // recycle the oldest
      i = (this._rr = ((this._rr || 0) + 1) % this.max);
    } else this.count++;
    const p = i * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = size; this.size1[i] = sizeEnd === null ? size : sizeEnd;
    this.grow[i] = grow;
    this.colA[p] = color[0]; this.colA[p + 1] = color[1]; this.colA[p + 2] = color[2];
    const ce = colorEnd || color;
    this.colB[p] = ce[0]; this.colB[p + 1] = ce[1]; this.colB[p + 2] = ce[2];
    this.alpha0[i] = alpha; this.alpha1[i] = alphaEnd;
    this.buoy[i] = buoy;
    return i;
  }
  update(dt, waterYFn) {
    // NOTE: `count` shrinks while we iterate (swap-remove), so the live count must be
    // re-read every step — capturing it once caused an infinite loop on dense bursts.
    for (let i = 0; i < this.count;) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove: pull the last live particle into this slot and re-test it
        const j = this.count - 1;
        if (i !== j) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[j * 3 + k];
            this.vel[i * 3 + k] = this.vel[j * 3 + k];
            this.colA[i * 3 + k] = this.colA[j * 3 + k];
            this.colB[i * 3 + k] = this.colB[j * 3 + k];
          }
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
          this.size0[i] = this.size0[j]; this.size1[i] = this.size1[j]; this.grow[i] = this.grow[j];
          this.alpha0[i] = this.alpha0[j]; this.alpha1[i] = this.alpha1[j]; this.buoy[i] = this.buoy[j];
        }
        this.count--;
        continue;
      }
      const p = i * 3;
      // physics
      this.vel[p + 1] += this.gravity * dt;
      const d = Math.exp(-this.drag * dt);
      this.vel[p] *= d; this.vel[p + 1] *= d; this.vel[p + 2] *= d;
      if (this.buoy[i] > 0 && waterYFn) {
        const wy = waterYFn(this.pos[p], this.pos[p + 2]);
        if (this.pos[p + 1] < wy) {
          this.vel[p + 1] += this.buoy[i] * dt * (wy - this.pos[p + 1]) * 2.0;
          this.vel[p + 1] *= 0.92;
        }
      }
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.aSize[i] = lerp(this.size0[i], this.size1[i], t) * (1 + this.grow[i] * t);
      this.aAlpha[i] = lerp(this.alpha0[i], this.alpha1[i], t);
      this.aColor[p] = lerp(this.colA[p], this.colB[p], t);
      this.aColor[p + 1] = lerp(this.colA[p + 1], this.colB[p + 1], t);
      this.aColor[p + 2] = lerp(this.colA[p + 2], this.colB[p + 2], t);
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}

/* -------------------------------------------------------------- rain shader */
const RAIN_VERT = /* glsl */`
attribute float aSeed;
uniform float uTime, uIntensity, uBoxSize;
uniform vec3 uCam;
varying float vA;
void main(){
  vec3 p = position;
  float speed = 22.0 + aSeed * 14.0;
  float t = mod(uTime * speed + aSeed * 300.0, uBoxSize);
  p.y = uCam.y + uBoxSize * 0.5 - t;
  p.x += sin(aSeed * 12.0 + uTime * 0.7) * 1.2 - uIntensity * 3.0;
  p.z += cos(aSeed * 9.0 + uTime * 0.5) * 1.2;
  p.x = mod(p.x - uCam.x + uBoxSize * 0.5, uBoxSize) + uCam.x - uBoxSize * 0.5;
  p.z = mod(p.z - uCam.z + uBoxSize * 0.5, uBoxSize) + uCam.z - uBoxSize * 0.5;
  vA = uIntensity * (0.35 + 0.65 * step(0.15, aSeed));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;
const RAIN_FRAG = /* glsl */`
varying float vA;
uniform vec3 uColor;
void main(){
  gl_FragColor = vec4(uColor, vA * 0.5);
  if (vA < 0.01) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class FX {
  constructor(scene, quality = 'high', renderer = null) {
    this.scene = scene;
    this.quality = quality;
    const q = quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1;
    this.spray = new Pool(scene, { max: Math.round(2600 * q), texture: softTexture(64, 'soft'), blending: THREE.NormalBlending, gravity: -13, drag: 1.2, sizeScale: 900 });
    this.smokePool = new Pool(scene, { max: Math.round(900 * q), texture: softTexture(64, 'smoke'), blending: THREE.NormalBlending, gravity: 1.1, drag: 0.7, sizeScale: 900 });
    this.fire = new Pool(scene, { max: Math.round(700 * q), texture: softTexture(64, 'soft'), blending: THREE.AdditiveBlending, gravity: 2.6, drag: 1.4, sizeScale: 700 });
    this.dust = new Pool(scene, { max: Math.round(900 * q), texture: softTexture(64, 'smoke'), blending: THREE.NormalBlending, gravity: -0.6, drag: 0.9, sizeScale: 1100 });
    this.debris = new Pool(scene, { max: Math.round(600 * q), texture: softTexture(32, 'dot'), blending: THREE.NormalBlending, gravity: -16, drag: 0.12, sizeScale: 420 });
    this.spark = new Pool(scene, { max: Math.round(500 * q), texture: softTexture(32, 'soft'), blending: THREE.AdditiveBlending, gravity: -8, drag: 0.6, sizeScale: 300 });
    this.bubble = new Pool(scene, { max: Math.round(400 * q), texture: softTexture(32, 'soft'), blending: THREE.NormalBlending, gravity: 2.0, drag: 1.0, sizeScale: 500 });

    // ---- rain ----
    const N = quality === 'low' ? 1200 : quality === 'medium' ? 2600 : 4200;
    const rng = mulberry32(77);
    const rp = new Float32Array(N * 3), rs = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      rp[i * 3] = (rng() - 0.5) * 90;
      rp[i * 3 + 1] = rng() * 60;
      rp[i * 3 + 2] = (rng() - 0.5) * 90;
      rs[i] = rng();
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(rs, 1));
    rg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uIntensity: { value: 0 }, uBoxSize: { value: 70 },
        uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(0.72, 0.78, 0.88) },
      }, fog: false,
    });
    this.rain = new THREE.Points(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 14;
    this.rain.visible = false;
    scene.add(this.rain);
    this.rng = mulberry32(3131);
    this.emitters = [];
  }

  /* ---------------------------------------------------------- convenience */
  waveSpray(x, y, z, power = 1) {
    const rng = this.rng;
    const n = Math.round(clamp(power * 4, 1, 14) * (this.quality === 'low' ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      this.spray.emit(x + (rng() - 0.5) * 6, y + rng() * 2, z + (rng() - 0.5) * 6,
        (rng() - 0.5) * 8, 3 + rng() * 11 * power, (rng() - 0.5) * 8,
        { life: 1.2 + rng() * 1.4, size: 0.5 + rng() * 1.4, sizeEnd: 2.4 + rng() * 3, color: [0.92, 0.96, 1.0], alpha: 0.75, alphaEnd: 0, drag: 1.4 });
    }
  }
  splash(x, y, z, power = 1) {
    const rng = this.rng;
    for (let i = 0; i < 10 * power; i++) {
      this.spray.emit(x, y + 0.2, z, (rng() - 0.5) * 3 * power, 2.5 + rng() * 4 * power, (rng() - 0.5) * 3 * power,
        { life: 0.5 + rng() * 0.6, size: 0.28 + rng() * 0.4, sizeEnd: 1.4, color: [0.9, 0.95, 1], alpha: 0.8, alphaEnd: 0 });
    }
  }
  mist(x, y, z, spread = 6, n = 3) {
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      this.spray.emit(x + (rng() - 0.5) * spread, y + rng() * spread * 0.5, z + (rng() - 0.5) * spread,
        (rng() - 0.5) * 1.2, 0.6 + rng() * 1.6, (rng() - 0.5) * 1.2,
        { life: 2.2 + rng() * 2, size: 1.6 + rng() * 2.6, sizeEnd: 5 + rng() * 5, color: [0.93, 0.96, 1], alpha: 0.3, alphaEnd: 0 });
    }
  }
  smoke(x, y, z, power = 1, color = [0.24, 0.23, 0.22]) {
    const rng = this.rng;
    for (let i = 0; i < 2 * power; i++) {
      this.smokePool.emit(x + (rng() - 0.5) * 1.2, y, z + (rng() - 0.5) * 1.2,
        (rng() - 0.5) * 0.6, 1.1 + rng() * 1.4, (rng() - 0.5) * 0.6,
        { life: 2.5 + rng() * 3, size: 1.2, sizeEnd: 7 + rng() * 6, color, alpha: 0.5, alphaEnd: 0 });
    }
  }
  dustBurst(x, y, z, power = 1, color = [0.62, 0.56, 0.46]) {
    const rng = this.rng;
    for (let i = 0; i < 14 * power; i++) {
      this.dust.emit(x + (rng() - 0.5) * 3, y + rng() * 1.5, z + (rng() - 0.5) * 3,
        (rng() - 0.5) * 6 * power, 1 + rng() * 4 * power, (rng() - 0.5) * 6 * power,
        { life: 1.4 + rng() * 2.2, size: 1.2, sizeEnd: 8 + rng() * 8, color, alpha: 0.55, alphaEnd: 0 });
    }
  }
  fireAt(x, y, z, power = 1) {
    const rng = this.rng;
    for (let i = 0; i < 2 * power; i++) {
      this.fire.emit(x + (rng() - 0.5) * 0.5, y + 0.1, z + (rng() - 0.5) * 0.5,
        (rng() - 0.5) * 0.6, 1.6 + rng() * 1.6, (rng() - 0.5) * 0.6,
        { life: 0.5 + rng() * 0.7, size: 0.7 + rng() * 0.7, sizeEnd: 0.15, color: [1.0, 0.62, 0.18], colorEnd: [0.9, 0.18, 0.03], alpha: 0.9, alphaEnd: 0 });
    }
  }
  sparks(x, y, z, n = 8, color = [1.0, 0.8, 0.35]) {
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      this.spark.emit(x, y, z, (rng() - 0.5) * 6, 1 + rng() * 5, (rng() - 0.5) * 6,
        { life: 0.4 + rng() * 0.7, size: 0.14, sizeEnd: 0.03, color, alpha: 1, alphaEnd: 0 });
    }
  }
  debrisBurst(x, y, z, n = 10, color = [0.5, 0.46, 0.4]) {
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      this.debris.emit(x, y, z, (rng() - 0.5) * 9, 2 + rng() * 7, (rng() - 0.5) * 9,
        { life: 1.5 + rng() * 2, size: 0.2 + rng() * 0.4, color, alpha: 1, alphaEnd: 0.2, buoy: 0.4 });
    }
  }
  blood(x, y, z, n = 6) {
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      this.debris.emit(x, y, z, (rng() - 0.5) * 3, 1 + rng() * 2, (rng() - 0.5) * 3,
        { life: 0.6 + rng() * 0.6, size: 0.14 + rng() * 0.2, color: [0.42, 0.04, 0.04], alpha: 0.9, alphaEnd: 0.1 });
    }
  }
  bubbles(x, y, z, n = 4) {
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      this.bubble.emit(x + (rng() - 0.5) * 0.5, y, z + (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.4, 0.8 + rng() * 0.8, (rng() - 0.5) * 0.4,
        { life: 1.2 + rng(), size: 0.08 + rng() * 0.12, sizeEnd: 0.3 + rng() * 0.2, color: [0.8, 0.9, 1.0], alpha: 0.5, alphaEnd: 0 });
    }
  }
  addEmitter(fn) { this.emitters.push(fn); }

  setRain(intensity) {
    this.rainMat.uniforms.uIntensity.value = intensity;
    this.rain.visible = intensity > 0.02;
  }

  update(dt, camera, waterYFn) {
    const anyLive = () => this.spray.count || this.smokePool.count || this.fire.count || this.dust.count || this.debris.count || this.spark.count || this.bubble.count;
    if (anyLive()) {
      this.spray.update(dt, waterYFn);
      this.smokePool.update(dt, waterYFn);
      this.fire.update(dt, waterYFn);
      this.dust.update(dt, waterYFn);
      this.debris.update(dt, waterYFn);
      this.spark.update(dt, waterYFn);
      this.bubble.update(dt, waterYFn);
    }
    for (const e of this.emitters) e(dt, this);
    this.rainMat.uniforms.uTime.value += dt;
    this.rainMat.uniforms.uCam.value.copy(camera.position);
  }
  setQualityScale(v) {
    this.spray.mat.uniforms.uScale.value = 900 * v;
  }
}
