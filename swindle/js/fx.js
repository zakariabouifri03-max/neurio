// ── pooled 3D particle FX: chips, sparks, smoke, rings, beams, floaters ──────
import * as THREE from 'three';

function dotTex(kind = 'dot') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, kind === 'ring' ? 20 : 0, 32, 32, 30);
  if (kind === 'ring') {
    g.strokeStyle = '#fff'; g.lineWidth = 7; g.beginPath(); g.arc(32, 32, 22, 0, 6.3); g.stroke();
    g.globalAlpha = 0.4; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 27, 0, 6.3); g.stroke();
  } else if (kind === 'smoke') {
    const grd2 = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd2.addColorStop(0, 'rgba(255,255,255,.5)'); grd2.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd2; g.fillRect(0, 0, 64, 64);
  } else {
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 30, 0, 6.3); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class PointSystem {
  constructor(scene, { max = 900, tex = 'dot', blending = THREE.AdditiveBlending, size = 1, gravity = -3.2, drag = 0.985, tone = 'add' } = {}) {
    this.max = max; this.gravity = gravity; this.drag = drag;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.sizeArr = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.base = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.sizeArr, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setDrawRange(0, max);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending,
      uniforms: { uTex: { value: dotTex(tex) }, uScale: { value: size * (window.innerHeight || 800) * 0.6 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC=aColor; vA=aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA);
          if (gl_FragColor.a < 0.01) discard; }`,
    });
    this.pts = new THREE.Points(g, this.mat);
    this.pts.frustumCulled = false;
    scene.add(this.pts);
    this.geo = g; this.cursor = 0; this.size0 = size;
    this._tmp = new THREE.Color();
    void tone;
  }
  spawn(x, y, z, vx, vy, vz, color, size, life) {
    const i = this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this._tmp.set(color);
    this.col[i * 3] = this._tmp.r; this.col[i * 3 + 1] = this._tmp.g; this.col[i * 3 + 2] = this._tmp.b;
    this.sizeArr[i] = size; this.base[i] = size; this.alpha[i] = 1; this.life[i] = life; this.maxLife[i] = life;
  }
  update(dt) {
    const p = this.pos, v = this.vel;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.pow(this.drag, dt * 60);
      v[i * 3] *= d; v[i * 3 + 2] *= d;
      v[i * 3 + 1] = v[i * 3 + 1] * d + this.gravity * dt;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (p[i * 3 + 1] < 0.03) { p[i * 3 + 1] = 0.03; v[i * 3 + 1] *= -0.34; v[i * 3] *= 0.7; v[i * 3 + 2] *= 0.7; }
      this.alpha[i] = k * k * (this.maxLife[i] > 0.9 ? 0.9 : 1);
      this.sizeArr[i] = this.base[i] * (0.35 + k * 0.75);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
  clear() { for (let i = 0; i < this.max; i++) { this.life[i] = 0; this.alpha[i] = 0; } this.geo.attributes.aAlpha.needsUpdate = true; }
}

export class FX {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.scale = { low: 0.35, medium: 0.65, high: 1, ultra: 1.5 }[quality] ?? 1;
    this.sparkPs = new PointSystem(scene, { max: 1200, gravity: -3.4, drag: 0.975 });
    this.chipPs = new PointSystem(scene, { max: 900, gravity: -9.4, drag: 0.992 });
    this.smokePs = new PointSystem(scene, { max: 500, tex: 'smoke', blending: THREE.NormalBlending, gravity: 0.55, drag: 0.94 });
    this.rings = [];
    this.beams = [];
    this.floaters = [];
    this.confettiOn = 0;
    this._tmp = new THREE.Vector3();
  }
  setQuality(q) { this.scale = { low: 0.35, medium: 0.65, high: 1, ultra: 1.5 }[q] ?? 1; }
  n(v) { return Math.max(1, Math.round(v * this.scale)); }

  spark(pos, { color = '#ffd23f', count = 22, speed = 3.2, size = 1, life = 0.7 } = {}) {
    for (let i = 0; i < this.n(count); i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.4 + Math.random() * 0.9);
      this.sparkPs.spawn(pos.x, pos.y, pos.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 1.4, Math.sin(a) * Math.cos(e) * s, color, size * (0.5 + Math.random()), life * (0.6 + Math.random() * 0.8));
    }
  }
  chips(pos, { count = 16, up = 4.4 } = {}) {
    for (let i = 0; i < this.n(count); i++) {
      const a = Math.random() * Math.PI * 2;
      this.chipPs.spawn(pos.x + (Math.random() - .5) * .2, pos.y, pos.z + (Math.random() - .5) * .2,
        Math.cos(a) * (0.6 + Math.random() * 1.6), up * (0.7 + Math.random() * 0.6), Math.sin(a) * (0.6 + Math.random() * 1.6),
        Math.random() < 0.25 ? '#fff2c0' : '#e9bd4a', 1, 1.6);
    }
  }
  smoke(pos, { color = '#42506b', count = 12 } = {}) {
    for (let i = 0; i < this.n(count); i++) {
      this.smokePs.spawn(pos.x + (Math.random() - .5) * .5, pos.y + Math.random() * .2, pos.z + (Math.random() - .5) * .5,
        (Math.random() - .5) * 0.5, 0.6 + Math.random(), (Math.random() - .5) * 0.5, color, 1.6 + Math.random() * 2, 1.4 + Math.random());
    }
  }
  ring(pos, { color = '#8ad6ff', r = 1.4, life = 0.6, y = 0.03 } = {}) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: dotTex('ring'), color: new THREE.Color(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, y, pos.z); m.scale.setScalar(0.4);
    m.userData = { t: 0, life, r };
    this.scene.add(m); this.rings.push(m);
  }
  beam(pos, { color = '#ffd9a0', life = 1.1, r = 0.6 } = {}) {
    const g = new THREE.CylinderGeometry(r * 0.35, r, 4.2, 18, 1, true);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(pos.x, 2.1, pos.z);
    m.userData = { t: 0, life };
    this.scene.add(m); this.beams.push(m);
  }
  float(pos, text, { color = '#fff', size = 1, life = 1.5, vy = 1.15 } = {}) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.font = `800 ${Math.round(62)}px Bungee, Impact, system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeStyle = 'rgba(6,10,16,.86)'; g.strokeText(text, 256, 68);
    g.fillStyle = color; g.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
    s.position.copy(pos); s.scale.set(1.9 * size, 0.48 * size, 1); s.renderOrder = 30;
    s.userData = { t: 0, life, vy, mat: s.material };
    this.scene.add(s); this.floaters.push(s);
  }
  confetti(ms = 3200) { this.confettiOn = ms / 1000; this._cf = 0; }
  clear() {
    this.sparkPs.clear(); this.chipPs.clear(); this.smokePs.clear();
    for (const a of [this.rings, this.beams, this.floaters]) for (const o of a) { this.scene.remove(o); o.geometry?.dispose?.(); o.material?.dispose?.(); }
    this.rings.length = this.beams.length = this.floaters.length = 0;
    this.confettiOn = 0;
  }
  update(dt, camPos) {
    this.sparkPs.update(dt); this.chipPs.update(dt); this.smokePs.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const m = this.rings[i]; m.userData.t += dt;
      const k = m.userData.t / m.userData.life;
      m.scale.setScalar(0.4 + k * m.userData.r * 3.4);
      m.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const m = this.beams[i]; m.userData.t += dt;
      const k = m.userData.t / m.userData.life;
      m.material.opacity = 0.45 * Math.sin(Math.min(1, k) * Math.PI);
      m.rotation.y += dt * 0.7;
      if (k >= 1) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); this.beams.splice(i, 1); }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const s = this.floaters[i]; s.userData.t += dt;
      const k = s.userData.t / s.userData.life;
      s.position.y += s.userData.vy * dt * (1 - k * 0.6);
      s.material.opacity = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      s.scale.multiplyScalar(1 + dt * 0.05);
      if (k >= 1) { this.scene.remove(s); s.material.map.dispose(); s.material.dispose(); this.floaters.splice(i, 1); }
    }
    if (this.confettiOn > 0) {
      this.confettiOn -= dt;
      this._cf -= dt;
      if (this._cf <= 0) {
        this._cf = 0.05;
        for (let i = 0; i < this.n(9); i++) {
          const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 5;
          const cols = ['#ffd23f', '#ff3d7f', '#39e6a0', '#5ad1ff', '#f28f4a', '#c78bff'];
          this.chipPs.spawn(camPos ? camPos.x + Math.cos(a) * r : Math.cos(a) * r, 4.3 + Math.random(), (camPos ? camPos.z : 0) + Math.sin(a) * r * 0.5,
            (Math.random() - .5) * 1.2, -0.4, (Math.random() - .5) * 1.2, cols[(Math.random() * cols.length) | 0], 1.4, 3.4);
        }
      }
    }
  }
}
