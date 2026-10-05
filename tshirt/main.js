/* NEURIO Tee Studio — app bootstrap, 3D scene & configurator UI */
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { buildTee, createStudioEnv, FABRICS, CHEST_Y, CHEST_Z } from './tee.js';
import { makeKnitBump, drawPrint, inkFor, makeBlobTexture, paintKnitSwatch, PRINTS } from './tex.js';

/* ═══════════════════════ state ═══════════════════════ */

const COLORS = [
  ['Carbon', '#1d1f24'], ['Chalk', '#e9e5da'], ['Slate', '#66707d'],
  ['Navy', '#20304f'], ['Forest', '#2c4a3b'], ['Burgundy', '#6e2637'],
  ['Rust', '#b0512c'], ['Sand', '#d6c39d'], ['Butter', '#e3cd67'],
  ['Sky', '#9fc3e6'], ['Lilac', '#b3a5d9'], ['Ocean', '#2e6f6c'],
];

const state = {
  color: COLORS[0][1], colorName: COLORS[0][0],
  print: 'none', printSize: 16,
  fabric: 'heavy', size: 'M', qty: 1,
};
let bagCount = 0;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ═══════════════════════ 3D scene ═══════════════════════ */

const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = createStudioEnv(renderer);

const camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
const TARGET = new THREE.Vector3(0, 33, 0);

scene.add(new THREE.HemisphereLight(0xf4efe6, 0xcdc6b8, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(60, 95, 75);
scene.add(key);
const rim = new THREE.DirectionalLight(0xdfe9ff, 0.85);
rim.position.set(-55, 60, -70);
scene.add(rim);

const tee = buildTee(makeKnitBump());
tee.group.position.y = 3.2;
scene.add(tee.group);

/* soft contact shadow */
const blob = new THREE.Mesh(
  new THREE.PlaneGeometry(130, 130).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: makeBlobTexture(), transparent: true, depthWrite: false })
);
blob.position.y = 0.05;
blob.renderOrder = -1;
scene.add(blob);

let decalMesh = null;

/* ═══════════════════════ orbit camera ═══════════════════════ */

class Orbit {
  constructor(dom) {
    this.dom = dom;
    this.cur = { r: 205, th: 0.55, ph: 1.21 };
    this.goal = { ...this.cur };
    this.auto = !reducedMotion;
    this.lastInput = -1e4;
    this.pts = new Map();
    this.pinch = 0;

    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.lastInput = perfNow();
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.pts.has(e.pointerId)) return;
      this.lastInput = perfNow();
      if (this.pts.size === 2) {
        const [a, b] = [...this.pts.values()];
        const prev = Math.hypot(a.x - b.x, a.y - b.y);
        this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a2, b2] = [...this.pts.values()];
        const now = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (prev > 0) this.goal.r = clampR(this.goal.r * (prev / now));
        return;
      }
      const p = this.pts.get(e.pointerId);
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      this.goal.th -= dx * 0.0052;
      this.goal.ph = clampPh(this.goal.ph - dy * 0.0042);
    });
    const up = (e) => { this.pts.delete(e.pointerId); };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.lastInput = perfNow();
      this.goal.r = clampR(this.goal.r * (1 + e.deltaY * 0.0011));
    }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  flyTo(preset) { Object.assign(this.goal, preset); this.lastInput = perfNow(); }
  update(dt, t) {
    if (this.auto && t - this.lastInput > 3.5) this.goal.th += dt * 0.14;
    const k = 1 - Math.exp(-dt * 7);
    this.cur.r += (this.goal.r - this.cur.r) * k;
    this.cur.th += (this.goal.th - this.cur.th) * k;
    this.cur.ph += (this.goal.ph - this.cur.ph) * k;
    const { r, th, ph } = this.cur;
    camera.position.set(
      TARGET.x + r * Math.sin(ph) * Math.sin(th),
      TARGET.y + r * Math.cos(ph),
      TARGET.z + r * Math.sin(ph) * Math.cos(th),
    );
    camera.lookAt(TARGET);
  }
}
const clampR = (r) => Math.min(330, Math.max(112, r));
const clampPh = (p) => Math.min(1.5, Math.max(0.22, p));
const perfNow = () => performance.now() / 1000;
const orbit = new Orbit(renderer.domElement);
orbit.flyTo({ r: 195, th: 0.18, ph: 1.22 });
orbit.cur = { r: 260, th: 1.1, ph: 1.05 }; // cinematic entry sweep

/* ═══════════════════════ configurator → 3D ═══════════════════════ */

function applyColor() {
  const f = FABRICS[state.fabric];
  const c = new THREE.Color(state.color);
  if (f.tint) c.lerp(new THREE.Color(0x8a8f98), f.tint);
  tee.fabric.color.copy(c);
  paintKnitSwatch($('#knitCanvas'), '#' + c.getHexString());
  $$('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.hex === state.color));
  $('#colorName').textContent = state.colorName;
  applyPrint();
}

function applyFabric() {
  const f = FABRICS[state.fabric];
  const m = tee.fabric;
  m.roughness = f.roughness;
  m.sheen = f.sheen;
  m.sheenRoughness = f.sheenRoughness;
  m.bumpScale = f.bump;
  $$('.fabricCard').forEach((c) => c.classList.toggle('on', c.dataset.id === state.fabric));
  applyColor();
}

function applyPrint() {
  if (decalMesh) {
    tee.group.remove(decalMesh);
    decalMesh.geometry.dispose();
    decalMesh.material.map.dispose();
    decalMesh.material.dispose();
    decalMesh = null;
  }
  $$('.printTile').forEach((p) => p.classList.toggle('on', p.dataset.id === state.print));
  $('#printSizeWrap').classList.toggle('off', state.print === 'none');
  if (state.print === 'none') return;

  const ink = inkFor(state.color);
  const canvas = drawPrint(state.print, ink);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  /* Compute in tee-local space: DecalGeometry reads mesh.matrixWorld, so we
   * feed it a proxy mesh at the identity transform; the resulting geometry
   * then lives in the same local space as the body and bobs with the group. */
  const proxy = new THREE.Mesh(tee.meshes.body.geometry);
  const size = new THREE.Vector3(state.printSize, state.printSize, 14);
  const pos = new THREE.Vector3(0, CHEST_Y, CHEST_Z - 1.2);
  const geo = new DecalGeometry(proxy, pos, new THREE.Euler(0, 0, 0), size);
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, roughness: 0.88, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    depthWrite: false,
  });
  decalMesh = new THREE.Mesh(geo, mat);
  decalMesh.renderOrder = 3;
  tee.group.add(decalMesh);
}

/* ═══════════════════════ build the UI ═══════════════════════ */

function buildUI() {
  /* camera presets (also used by print selection) */
  const views = {
    front: { th: 0.0, ph: 1.22, r: 195 },
    back: { th: Math.PI, ph: 1.2, r: 195 },
    side: { th: -1.32, ph: 1.24, r: 185 },
    detail: { th: 0.28, ph: 1.06, r: 122 },
  };

  /* color swatches */
  const swWrap = $('#swatches');
  COLORS.forEach(([name, hex]) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = hex;
    b.dataset.hex = hex;
    b.title = name;
    b.setAttribute('aria-label', `Color ${name}`);
    b.onclick = () => { state.color = hex; state.colorName = name; applyColor(); };
    swWrap.appendChild(b);
  });
  const custom = document.createElement('label');
  custom.className = 'swatch custom';
  custom.title = 'Custom color';
  custom.innerHTML = '<span>+</span><input type="color" value="#4a5568">';
  custom.querySelector('input').addEventListener('input', (e) => {
    state.color = e.target.value;
    state.colorName = 'Custom';
    applyColor();
  });
  swWrap.appendChild(custom);

  /* prints */
  const prWrap = $('#prints');
  PRINTS.forEach(({ id, name }) => {
    const b = document.createElement('button');
    b.className = 'printTile';
    b.dataset.id = id;
    b.title = name;
    if (id === 'none') {
      b.innerHTML = '<span class="noPrint">∅</span>';
    } else {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const g = c.getContext('2d');
      g.fillStyle = '#f0ede5';
      g.fillRect(0, 0, 96, 96);
      g.drawImage(drawPrint(id, '#15171c'), 10, 10, 76, 76);
      b.appendChild(c);
    }
    const em = document.createElement('em');
    em.textContent = name;
    b.appendChild(em);
    b.onclick = () => {
      state.print = id;
      applyPrint();
      if (id !== 'none') orbit.flyTo(views.front);
    };
    prWrap.appendChild(b);
  });

  $('#printSize').addEventListener('input', (e) => {
    state.printSize = +e.target.value;
    $('#printSizeVal').textContent = state.printSize + ' cm';
    applyPrint();
  });

  /* fabric */
  $$('.fabricCard').forEach((c) => {
    c.onclick = () => { state.fabric = c.dataset.id; applyFabric(); };
  });

  /* sizes */
  $$('.sizePill').forEach((p) => {
    p.onclick = () => {
      state.size = p.dataset.size;
      $$('.sizePill').forEach((x) => x.classList.toggle('on', x === p));
    };
  });

  /* qty */
  const updateTotal = () => { $('#total').textContent = 32 * state.qty; };
  $('#qtyMinus').onclick = () => { state.qty = Math.max(1, state.qty - 1); $('#qtyVal').textContent = state.qty; updateTotal(); };
  $('#qtyPlus').onclick = () => { state.qty = Math.min(9, state.qty + 1); $('#qtyVal').textContent = state.qty; updateTotal(); };
  updateTotal();

  /* bag */
  $('#addBag').onclick = () => {
    bagCount += state.qty;
    $('#bagCount').textContent = bagCount;
    $('#bagCount').classList.add('pop');
    setTimeout(() => $('#bagCount').classList.remove('pop'), 450);
    toast(`Added to bag — Classic Tee · ${state.size} · ${state.colorName} ×${state.qty}`);
  };
  $('#bagBtn').onclick = () => {
    toast(bagCount ? `Your bag: ${bagCount} item${bagCount > 1 ? 's' : ''} · checkout is a demo ✨` : 'Your bag is empty — pick a color and hit “Add to bag”.');
  };

  /* view presets + autorotate */
  $$('.viewBtn').forEach((b) => { b.onclick = () => orbit.flyTo(views[b.dataset.view]); });
  const autoBtn = $('#autoBtn');
  autoBtn.classList.toggle('on', orbit.auto);
  autoBtn.onclick = () => { orbit.auto = !orbit.auto; autoBtn.classList.toggle('on', orbit.auto); };
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ═══════════════════════ misc page life ═══════════════════════ */

const io = new IntersectionObserver((ents) => {
  ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.12 });
$$('.reveal').forEach((el) => io.observe(el));

function boot() {
  buildUI();
  applyFabric();
  setTimeout(() => $('#loader')?.classList.add('done'), 350);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/* redraw the wordmark print once the display font is ready */
if (document.fonts?.ready) {
  document.fonts.ready.then(() => { if (state.print === 'word') applyPrint(); });
}

/* ═══════════════════════ render loop ═══════════════════════ */

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  orbit.update(dt, t);
  if (!reducedMotion) {
    const bob = Math.sin(t * 0.7) * 0.7;
    tee.group.position.y = 3.2 + bob;
    tee.group.rotation.z = Math.sin(t * 0.5) * 0.006;
    const s = 1 - bob * 0.022;
    blob.scale.set(s, 1, s);
    blob.material.opacity = 0.92 - bob * 0.05;
  }
  renderer.render(scene, camera);
});
