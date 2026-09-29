// ═════════════════════════════════════════════════════════════════════════════
// THE GILDED ALIBI — one compact, highly-dressed multiplayer room.
// Octagonal deal table, eight chairs, a wall-sized reveal screen, lockers, a
// side bar, props you can poke, and lighting that does most of the acting.
// ═════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, carpetTex, wallTex, woodTex, plasterTex, neonSignTex, posterTex, clockTex, lockerTex, terrazzoTex, ScreenCanvas } from './tex.js';
import { mulberry32 } from '../../shared/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function std(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: o.rough ?? 0.7,
    metalness: o.metal ?? 0.04,
    emissive: new THREE.Color(o.emis || '#000000'),
    emissiveIntensity: o.emisI ?? 1,
    map: o.map || null,
    transparent: (o.op ?? 1) < 1, opacity: o.op ?? 1,
    side: o.side || THREE.FrontSide,
    flatShading: !!o.flat,
  });
}
function put(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  parent.add(m); return m;
}
function softBox(w, h, d, r = 0.4, seg = 1) {
  const g = new THREE.SphereGeometry(0.5, 14 * seg + 6, 10 * seg + 6);
  const p = g.attributes.position; const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.set(p.getX(i), p.getY(i), p.getZ(i));
    const l = n.length() || 1e-5; n.divideScalar(l);
    const boxR = 0.5 / Math.max(1e-4, Math.abs(n.x), Math.abs(n.y), Math.abs(n.z));
    const k = boxR * (1 - r) + 0.5 * r;
    p.setXYZ(i, n.x * k * w, n.y * k * h, n.z * k * d);
  }
  g.computeVertexNormals();
  return g;
}

export const SEATS = 8;
export function seatTransform(i) {
  const a = (i / SEATS) * Math.PI * 2 + Math.PI / SEATS;
  return { pos: V(Math.sin(a) * 2.85, 0, Math.cos(a) * 2.85), rotY: a + Math.PI };
}
export const LOBBY_SPOTS = Array.from({ length: SEATS }, (_, i) => {
  const a = (i / SEATS) * Math.PI * 2 + Math.PI / SEATS;
  return V(Math.sin(a) * 4.5, 0, Math.cos(a) * 4.5);
});

export class Room3D {
  constructor(quality = 'high') {
    this.scene = new THREE.Scene();
    this.quality = quality;
    this.groups = {};
    this.seatMeshes = [];
    this.time = 0;
    this.pickables = [];
    this.build();
  }

  // ── build everything ────────────────────────────────────────────────────────
  build() {
    const S = this.scene;
    S.background = new THREE.Color('#08131b');
    S.fog = new THREE.FogExp2(0x08131b, 0.028);

    this.tex = {
      carpet: carpetTex(), wall: wallTex(), wood: woodTex(3), wood2: woodTex(11),
      plaster: plasterTex(), terrazzo: terrazzoTex(),
    };

    this.floor();
    this.walls();
    this.ceiling();
    this.lights();
    this.table();
    this.chairs();
    this.lockers();
    this.bar();
    this.screenWall();
    this.neon();
    this.decor();
    this.board();      // the game-state props that live on the table
    this.dust();
  }

  floor() {
    const g = new THREE.Group();
    const wood = std('#4a2f21', { rough: 0.55, map: this.tex.wood2 });
    const f = put(g, new THREE.PlaneGeometry(22, 20), wood, 0, 0, 0, -Math.PI / 2);
    f.receiveShadow = true;
    const rug = put(g, new THREE.CircleGeometry(5.4, 40), std('#5d1f2a', { rough: 0.95, map: this.tex.carpet }), 0, 0.012, 0, -Math.PI / 2);
    rug.receiveShadow = true;
    const ring = put(g, new THREE.RingGeometry(5.4, 5.75, 44), std('#c8a05a', { rough: 0.4, metal: 0.6 }), 0, 0.014, 0, -Math.PI / 2);
    void ring;
    this.scene.add(g); this.groups.floor = g;
  }

  walls() {
    const g = new THREE.Group();
    const wallM = std('#14323f', { rough: 0.85, map: this.tex.wall });
    const H = 4.6, W = 22, D = 20;
    const mk = (w, h, x, y, z, ry) => { const m = put(g, new THREE.PlaneGeometry(w, h), wallM, x, y, z); m.rotation.y = ry; m.receiveShadow = true; return m; };
    mk(W, H, 0, H / 2, -D / 2, 0);
    mk(W, H, 0, H / 2, D / 2, Math.PI);
    mk(D, H, -W / 2, H / 2, 0, Math.PI / 2);
    mk(D, H, W / 2, H / 2, 0, -Math.PI / 2);
    // skirting + cornice in brass
    const brass = std('#c9a15a', { rough: 0.3, metal: 0.75 });
    for (const [z, x, w] of [[-D / 2 + 0.06, 0, W], [D / 2 - 0.06, 0, W]]) {
      put(g, new THREE.BoxGeometry(w, 0.24, 0.1), brass, x, 0.12, z);
      put(g, new THREE.BoxGeometry(w, 0.14, 0.16), brass, x, H - 0.5, z);
    }
    for (const [x, z, d] of [[-W / 2 + 0.06, 0, D], [W / 2 - 0.06, 0, D]]) {
      put(g, new THREE.BoxGeometry(0.1, 0.24, d), brass, x, 0.12, z);
      put(g, new THREE.BoxGeometry(0.16, 0.14, d), brass, x, H - 0.5, z);
    }
    // door (south-east) with a private sign
    const doorG = new THREE.Group();
    put(doorG, softBox(1.5, 2.6, 0.16, 0.1), std('#5b3a24', { rough: 0.6, map: this.tex.wood }), 0, 1.3, 0);
    put(doorG, new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), std('#e0c476', { rough: .25, metal: .85 }), 0.5, 1.15, 0.14, 0, 0, Math.PI / 2);
    const sign = put(doorG, new THREE.PlaneGeometry(0.7, 0.28), new THREE.MeshStandardMaterial({ map: posterTex('notice'), roughness: .9 }), 0, 2.05, 0.1);
    void sign;
    doorG.position.set(8.4, 0, 9.94); doorG.rotation.y = Math.PI;
    g.add(doorG);
    this.scene.add(g); this.groups.walls = g;
  }

  ceiling() {
    const g = new THREE.Group();
    const H = 4.6;
    const p = put(g, new THREE.PlaneGeometry(22, 20), std('#0f2431', { rough: 0.95, map: this.tex.plaster }), 0, H, 0, Math.PI / 2);
    p.receiveShadow = false;
    const beamM = std('#16303d', { rough: 0.8 });
    for (let i = -3; i <= 3; i++) put(g, new THREE.BoxGeometry(0.22, 0.2, 20), beamM, i * 3, H - 0.12, 0);
    for (let i = -2; i <= 2; i++) put(g, new THREE.BoxGeometry(22, 0.14, 0.2), beamM, 0, H - 0.24, i * 4);
    this.scene.add(g); this.groups.ceiling = g;
  }

  lights() {
    const q = PRESETS[this.quality] || PRESETS.high;
    const S = this.scene;
    this.l = {};
    this.l.hemi = new THREE.HemisphereLight(0x9fc7e8, 0x3a2118, 0.42); S.add(this.l.hemi);
    this.l.key = new THREE.SpotLight(0xffe3b6, q.keyI, 26, 0.86, 0.42, 1.3);
    this.l.key.position.set(0.6, 4.3, 1.0);
    this.l.key.target.position.set(0, 0.8, 0);
    this.l.key.castShadow = !!q.shadow;
    if (q.shadow) {
      this.l.key.shadow.mapSize.set(q.shadow, q.shadow);
      this.l.key.shadow.camera.near = 1; this.l.key.shadow.camera.far = 14;
      this.l.key.shadow.bias = -0.0016; this.l.key.shadow.normalBias = 0.03;
      this.l.key.shadow.radius = 3;
    }
    S.add(this.l.key, this.l.key.target);

    this.l.screen = new THREE.RectAreaLight ? null : null;
    this.l.fill = new THREE.PointLight(0x7fd2ff, q.fillI, 16, 2); this.l.fill.position.set(0, 2.7, -8.2); S.add(this.l.fill);
    this.l.rose = new THREE.SpotLight(0xff5f8f, q.rimI, 22, 0.9, 0.6, 1.6); this.l.rose.position.set(-8.6, 3.9, 6.4); this.l.rose.target.position.set(0, 1, 0); S.add(this.l.rose, this.l.rose.target);
    this.l.teal = new THREE.SpotLight(0x39e6a0, q.rimI * 0.8, 22, 0.9, 0.6, 1.6); this.l.teal.position.set(8.6, 3.9, -5.4); this.l.teal.target.position.set(0, 1, 0); S.add(this.l.teal, this.l.teal.target);
    this.l.bar = new THREE.PointLight(0xffb45c, q.barI, 9, 2); this.l.bar.position.set(7.6, 2.3, 3.4); S.add(this.l.bar);
    this.l.neon = new THREE.PointLight(0xff8a3c, q.barI * 0.8, 10, 2); this.l.neon.position.set(0, 3.5, -9.2); S.add(this.l.neon);

    // practicals: three pendants over the table
    this.pendants = [];
    const brass = std('#c9a15a', { rough: 0.3, metal: 0.8 });
    const shade = std('#1b3540', { rough: 0.5, metal: 0.3, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const grp = new THREE.Group();
      const r = 1.35;
      put(grp, new THREE.CylinderGeometry(0.012, 0.012, 1.5, 6), brass, 0, 3.75, 0);
      const sh = put(grp, new THREE.ConeGeometry(0.3, 0.3, 20, 1, true), shade, 0, 3.0, 0, Math.PI, 0, 0);
      void sh;
      const bulb = put(grp, new THREE.SphereGeometry(0.075, 12, 10), std('#fff0c8', { emis: '#ffd68a', emisI: 3.2, rough: 0.2 }), 0, 2.94, 0);
      const pl = new THREE.PointLight(0xffd9a0, q.pendantI, 6.5, 2); pl.position.set(0, 2.9, 0);
      grp.add(pl);
      grp.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
      grp.userData = { bulb, pl, phase: i * 2.1 };
      this.scene.add(grp); this.pendants.push(grp);
    }
  }

  table() {
    const g = new THREE.Group();
    const wood = std('#4b2c1d', { rough: 0.42, map: this.tex.wood, metal: 0.06 });
    const brass = std('#d0a95e', { rough: 0.26, metal: 0.82 });
    const felt = std('#12433a', { rough: 0.98 });
    const top = put(g, new THREE.CylinderGeometry(2.3, 2.3, 0.16, 8), wood, 0, 0.98, 0);
    top.receiveShadow = true; top.castShadow = true;
    const inlay = put(g, new THREE.CylinderGeometry(1.92, 1.92, 0.03, 8), felt, 0, 1.075, 0);
    inlay.receiveShadow = true;
    const rim = put(g, new THREE.TorusGeometry(2.28, 0.045, 8, 8), brass, 0, 0.98, 0);
    rim.rotation.x = Math.PI / 2; rim.rotation.z = Math.PI / 8;
    // pedestal
    put(g, new THREE.CylinderGeometry(0.34, 0.5, 0.9, 10), wood, 0, 0.47, 0).castShadow = true;
    put(g, new THREE.CylinderGeometry(1.0, 1.1, 0.14, 10), brass, 0, 0.07, 0);
    // engraved octagon motifs on the apron
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      put(g, new THREE.BoxGeometry(0.5, 0.05, 0.03), brass, Math.sin(a) * 2.1, 0.9, Math.cos(a) * 2.1, 0, a, 0);
    }
    // chip trays at each seat
    for (let i = 0; i < SEATS; i++) {
      const s = seatTransform(i);
      const t = new THREE.Group();
      const tray = put(t, softBox(0.66, 0.05, 0.4, 0.4), std('#2b2f3d', { rough: 0.6 }), 0, 0, 0);
      void tray;
      t.position.copy(s.pos).setY(1.1).multiplyScalar(0.72);
      t.rotation.y = s.rotY;
      g.add(t);
    }
    this.groups.trays = g.children.slice(-SEATS);
    this.scene.add(g);
    this.groups.table = g;

    // the pot column in the middle: a light dish + floating number handled by fx
    const dish = put(this.scene, new THREE.CylinderGeometry(0.62, 0.7, 0.06, 24), std('#c8a05a', { rough: .28, metal: .8 }), 0, 1.1, 0);
    void dish;
    this.potDish = dish;
  }

  chairs() {
    const g = new THREE.Group();
    const frame = std('#b9903f', { rough: 0.3, metal: 0.7 });
    const seatM = std('#7e2233', { rough: 0.9 });
    this.seatMeshes = [];
    for (let i = 0; i < SEATS; i++) {
      const s = seatTransform(i);
      const ch = new THREE.Group();
      const seat = put(ch, softBox(0.66, 0.12, 0.62, 0.45), seatM, 0, 0.52, 0);
      seat.castShadow = true;
      const back = put(ch, softBox(0.62, 0.62, 0.1, 0.4), seatM, 0, 0.9, -0.28, -0.14, 0, 0);
      void back;
      for (const [sx, sz] of [[-0.25, -0.24], [0.25, -0.24], [-0.25, 0.24], [0.25, 0.24]]) {
        put(ch, new THREE.CylinderGeometry(0.032, 0.026, 0.52, 8), frame, sx, 0.26, sz);
      }
      // a small brass plate with the seat number
      put(ch, new THREE.BoxGeometry(0.18, 0.06, 0.02), frame, 0, 1.2, -0.3);
      ch.position.copy(s.pos); ch.rotation.y = s.rotY + Math.PI;
      g.add(ch); this.seatMeshes.push(ch);
    }
    this.scene.add(g); this.groups.chairs = g;
  }

  lockers() {
    const g = new THREE.Group();
    const body = std('#2c4957', { rough: 0.62, metal: 0.2 });
    const brass = std('#c9a15a', { rough: 0.3, metal: 0.8 });
    for (let i = 0; i < 6; i++) {
      const l = new THREE.Group();
      put(l, new THREE.BoxGeometry(0.86, 2.3, 0.6), body, 0, 1.15, 0).castShadow = true;
      put(l, new THREE.PlaneGeometry(0.76, 2.14), new THREE.MeshStandardMaterial({ map: lockerTex(i + 1), roughness: 0.6, metalness: 0.25 }), 0, 1.16, 0.31);
      put(l, new THREE.BoxGeometry(0.1, 0.04, 0.06), brass, 0.28, 1.1, 0.33);
      for (let v = 0; v < 3; v++) put(l, new THREE.BoxGeometry(0.4, 0.02, 0.02), brass, 0, 2.0 - v * 0.08, 0.31);
      l.position.set(-10.6 + 0.02, 0, -3.4 + i * 0.92);
      l.rotation.y = Math.PI / 2;
      g.add(l);
      // stuff spilling out of two of them
      if (i === 1) {
        const hat = put(g, new THREE.CylinderGeometry(0.2, 0.22, 0.16, 12), std('#443022', { rough: .8 }), -10.1, 0.1, -2.5);
        hat.rotation.z = 1.2;
      }
      if (i === 3) put(g, new THREE.CylinderGeometry(0.16, 0.18, 0.5, 12), std('#6b4a2c', { rough: .7 }), -10.0, 0.25, -1.3, 0.4, 0, 0.2);
    }
    this.scene.add(g); this.groups.lockers = g;
  }

  bar() {
    const g = new THREE.Group();
    const wood = std('#3f2718', { rough: 0.5, map: this.tex.wood });
    const top = std('#d8d2c0', { rough: 0.16, metal: 0.1, map: this.tex.terrazzo });
    const brass = std('#c9a15a', { rough: 0.3, metal: 0.8 });
    put(g, softBox(3.4, 1.05, 1.0, 0.14), wood, 8.4, 0.52, 3.2).castShadow = true;
    put(g, softBox(3.7, 0.12, 1.25, 0.4), top, 8.4, 1.1, 3.2);
    // back shelf with bottles
    put(g, new THREE.BoxGeometry(2.8, 0.08, 0.5), wood, 9.6, 2.0, 3.2);
    put(g, new THREE.BoxGeometry(2.8, 0.08, 0.5), wood, 9.6, 2.6, 3.2);
    const glassCols = ['#4fbf9a', '#e0a23c', '#c4553f', '#7ec8e8', '#b98ad6'];
    const r = mulberry32(5);
    const bottles = [];
    for (let row = 0; row < 2; row++) for (let i = 0; i < 9; i++) {
      const b = new THREE.Group();
      put(b, new THREE.CylinderGeometry(0.075, 0.085, 0.34, 10), std(glassCols[(r() * 5) | 0], { rough: 0.15, metal: 0.1, op: 0.9 }), 0, 0.17, 0);
      put(b, new THREE.CylinderGeometry(0.026, 0.04, 0.16, 8), std(glassCols[(r() * 5) | 0], { rough: 0.15 }), 0, 0.42, 0);
      b.position.set(8.6 + i * 0.24, row ? 2.64 : 2.04, 3.2);
      g.add(b); bottles.push(b);
    }
    // tip jar (interactive)
    const jar = new THREE.Group();
    put(jar, new THREE.CylinderGeometry(0.16, 0.14, 0.28, 14), std('#bfe6ff', { rough: 0.06, metal: 0.1, op: 0.42 }), 0, 0.14, 0);
    put(jar, new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12), std('#ffd23f', { rough: .3, metal: .6 }), 0, 0.1, 0);
    jar.position.set(8.0, 1.16, 3.0);
    jar.userData.pick = 'tip';
    g.add(jar); this.pickables.push(jar);
    this.tipJar = jar;
    // stools
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Group();
      put(st, new THREE.CylinderGeometry(0.22, 0.22, 0.08, 14), std('#7e2233', { rough: .9 }), 0, 0.72, 0);
      put(st, new THREE.CylinderGeometry(0.04, 0.05, 0.72, 10), brass, 0, 0.36, 0);
      put(st, new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12), brass, 0, 0.03, 0);
      st.position.set(7.0 + i * 0.9, 0, 4.3);
      g.add(st);
    }
    this.scene.add(g); this.groups.bar = g;
  }

  screenWall() {
    const g = new THREE.Group();
    const W = 6.4, H = 3.6;
    const frameM = std('#0a1218', { rough: 0.35, metal: 0.5 });
    put(g, softBox(W + 0.5, H + 0.5, 0.24, 0.1), frameM, 0, 2.5, -9.72).castShadow = false;
    this.screen = new ScreenCanvas(1152, 648);
    const scrMat = new THREE.MeshStandardMaterial({
      map: this.screen.tex, emissive: new THREE.Color('#ffffff'), emissiveMap: this.screen.tex,
      emissiveIntensity: 1.25, roughness: 0.42, metalness: 0.0,
    });
    const scr = put(g, new THREE.PlaneGeometry(W, H), scrMat, 0, 2.5, -9.58);
    this.screenMesh = scr;
    // glow bleed onto the wall + a light that matches the screen
    this.screenLight = new THREE.PointLight(0x86c8ff, 12, 12, 2);
    this.screenLight.position.set(0, 2.6, -8.4);
    g.add(this.screenLight);
    // brass corner brackets
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      put(g, new THREE.BoxGeometry(0.3, 0.3, 0.06), std('#c9a15a', { rough: .3, metal: .8 }), sx * (W / 2 + 0.06), 2.5 + sy * (H / 2 + 0.06), -9.55);
    }
    this.scene.add(g); this.groups.screen = g;
  }

  neon() {
    const g = new THREE.Group();
    const t = neonSignTex();
    const plane = put(g, new THREE.PlaneGeometry(6.6, 2.06), new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 3.72, -9.5);
    this.neonPlane = plane;
    // a second, dimmer sign on the east wall
    const t2 = neonSignTex('DEALS FINAL', 'FRIENDS OPTIONAL');
    const p2 = put(g, new THREE.PlaneGeometry(4.4, 1.37), new THREE.MeshBasicMaterial({ map: t2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 10.85, 3.0, 0.2, 0, -Math.PI / 2, 0);
    void p2;
    const tubeM = std('#ff9c2e', { emis: '#ff7a18', emisI: 2.4, rough: 0.4 });
    // tube outline around the big sign
    const shape = new THREE.Shape();
    shape.moveTo(-3.4, -1.1); shape.lineTo(3.4, -1.1); shape.lineTo(3.4, 1.1); shape.lineTo(-3.4, 1.1); shape.lineTo(-3.4, -1.1);
    const pts = shape.getPoints(48).map((p) => new THREE.Vector3(p.x, p.y, 0));
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const tube = put(g, new THREE.TubeGeometry(curve, 80, 0.028, 6, true), tubeM, 0, 3.72, -9.44);
    void tube;
    this.neonTube = tubeM;
    this.scene.add(g); this.groups.neon = g;
  }

  decor() {
    const g = new THREE.Group();
    const brass = std('#c9a15a', { rough: 0.3, metal: 0.8 });
    // posters on the west wall
    for (const [i, kind] of ['refunds', 'markets', 'witness'].entries()) {
      const p = put(g, new THREE.PlaneGeometry(1.1, 1.38), new THREE.MeshStandardMaterial({ map: posterTex(kind), roughness: 0.95 }), -10.8 + 0.02, 2.1, 2.6 + i * 1.6, 0, Math.PI / 2, 0);
      void p;
      put(g, new THREE.BoxGeometry(0.04, 1.5, 1.22), std('#2a1c12', { rough: .6 }), -10.79, 2.1, 2.6 + i * 1.6, 0, 0, 0);
    }
    // wall clock
    put(g, new THREE.CylinderGeometry(0.5, 0.5, 0.08, 26), std('#2b1f16', { rough: .6 }), 0, 0, 0);
    const clockG = new THREE.Group();
    put(clockG, new THREE.CylinderGeometry(0.52, 0.52, 0.1, 26), std('#3a2718', { rough: .6 }), 0, 0, 0, Math.PI / 2, 0, 0);
    put(clockG, new THREE.CircleGeometry(0.44, 26), new THREE.MeshStandardMaterial({ map: clockTex(), roughness: .9 }), 0, 0, 0.06);
    const handH = put(clockG, new THREE.BoxGeometry(0.03, 0.24, 0.012), std('#22262f'), 0, 0.12, 0.08);
    const handM = put(clockG, new THREE.BoxGeometry(0.024, 0.36, 0.012), std('#22262f'), 0, 0.18, 0.075);
    const handPivotH = new THREE.Group(); handPivotH.add(handH); handPivotH.position.z = 0;
    const handPivotM = new THREE.Group(); handPivotM.add(handM);
    clockG.add(handPivotH, handPivotM);
    clockG.position.set(0, 3.3, -9.5);
    this.clockHands = { h: handPivotH, m: handPivotM };
    g.add(clockG);
    // plants
    for (const [x, z, s] of [[-8.6, 7.4, 1.25], [9.6, -6.6, 1], [-4.4, -8.6, 0.85]]) {
      const pl = new THREE.Group();
      put(pl, new THREE.CylinderGeometry(0.34 * s, 0.26 * s, 0.5 * s, 14), std('#a2543a', { rough: .85 }), 0, 0.25 * s, 0);
      put(pl, new THREE.CylinderGeometry(0.3 * s, 0.3 * s, 0.06, 14), std('#2a1b14', { rough: 1 }), 0, 0.5 * s, 0);
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2;
        const leaf = put(pl, new THREE.ConeGeometry(0.1 * s, 0.9 * s, 6), std(i % 2 ? '#2f7d4f' : '#3f9a5c', { rough: .8 }), Math.sin(a) * 0.16 * s, 0.85 * s, Math.cos(a) * 0.16 * s, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
        void leaf;
      }
      pl.position.set(x, 0, z);
      g.add(pl);
    }
    // hat stand with a trench coat
    const stand = new THREE.Group();
    put(stand, new THREE.CylinderGeometry(0.035, 0.05, 1.8, 10), brass, 0, 0.9, 0);
    put(stand, new THREE.CylinderGeometry(0.22, 0.24, 0.05, 14), brass, 0, 0.03, 0);
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; put(stand, new THREE.CylinderGeometry(0.02, 0.03, 0.24, 6), brass, Math.sin(a) * 0.14, 1.78, Math.cos(a) * 0.14, 0.6, 0, -0.6); }
    const coat = put(stand, softBox(0.5, 1.0, 0.32, 0.5), std('#8b6b3f', { rough: .9 }), 0.02, 1.15, 0.05);
    void coat;
    stand.position.set(-9.2, 0, 8.2);
    g.add(stand);
    // crate stack + beach-ball-ish globe for colour
    const crate = std('#6b4a2c', { rough: .85 });
    for (let i = 0; i < 3; i++) {
      const c = put(g, softBox(0.9, 0.5, 0.7, 0.16), crate, -8.2 + (i % 2) * 0.3, 0.26 + i * 0.5, -6.6, 0, i * 0.6, 0);
      c.castShadow = true;
    }
    put(g, new THREE.SphereGeometry(0.34, 18, 14), std('#e05545', { rough: .5, metal: .1 }), -7.0, 0.34, -5.7);
    // "wet floor" cone, because of course
    put(g, new THREE.ConeGeometry(0.28, 0.62, 4), std('#ffcf3f', { rough: .7, emis: '#7a5a00', emisI: .2 }), 3.4, 0.31, 7.6, 0, 0.5, 0);
    // jukebox (interactive)
    const jb = new THREE.Group();
    put(jb, softBox(1.1, 1.3, 0.6, 0.3), std('#5d2f22', { rough: .5, metal: .1 }), 0, 0.65, 0);
    put(jb, new THREE.CylinderGeometry(0.36, 0.36, 0.06, 20), std('#ffb45c', { emis: '#ff8a2e', emisI: 1.6, rough: .4 }), 0, 1.05, 0.3, Math.PI / 2, 0, 0);
    for (let i = 0; i < 5; i++) put(jb, new THREE.BoxGeometry(0.12, 0.06, 0.04), std('#f4e7c8', { emis: '#e8c07a', emisI: 1 }), -0.3 + i * 0.15, 0.5, 0.31);
    jb.position.set(-9.6, 0, 4.6); jb.rotation.y = 0.5;
    jb.userData.pick = 'juke';
    g.add(jb); this.pickables.push(jb); this.juke = jb;
    this.scene.add(g); this.groups.decor = g;
  }

  // ── the game-state dressing on the table ────────────────────────────────────
  board() {
    const g = new THREE.Group();
    g.position.y = 1.1;
    this.groups.board = g;
    this.boardGroups = {};
    const caseMat = () => std('#7a4a26', { rough: .6, metal: .05 });
    const brass = std('#d0a95e', { rough: .3, metal: .8 });

    const mk = (name, build) => { const o = new THREE.Group(); build(o); o.visible = false; g.add(o); this.boardGroups[name] = o; return o; };

    mk('cases', (o) => {
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Group();
        put(c, softBox(0.38, 0.2, 0.28, 0.3), caseMat(), 0, 0.1, 0);
        put(c, new THREE.BoxGeometry(0.4, 0.03, 0.3), brass, 0, 0.2, 0);
        put(c, new THREE.TorusGeometry(0.05, 0.012, 6, 10), brass, 0, 0.24, 0, Math.PI / 2);
        const a = (i / 6) * Math.PI * 2;
        c.position.set(Math.sin(a) * 1.25, 0, Math.cos(a) * 1.25);
        c.rotation.y = a + Math.PI;
        c.userData.label = String.fromCharCode(65 + i);
        o.add(c);
      }
    });
    mk('cards', (o) => {
      const back = std('#6b2233', { rough: .8 });
      const face = std('#f2ead6', { rough: .85 });
      for (let i = 0; i < 5; i++) {
        const c = new THREE.Group();
        put(c, new THREE.BoxGeometry(0.3, 0.012, 0.42), face, 0, 0, 0);
        put(c, new THREE.BoxGeometry(0.26, 0.014, 0.38), back, 0, 0.006, 0);
        const a = (i / 5) * Math.PI * 2;
        c.position.set(Math.sin(a) * 1.0, 0.01, Math.cos(a) * 1.0);
        c.rotation.y = a;
        o.add(c);
      }
    });
    mk('tiles', (o) => {
      for (let i = 0; i < 5; i++) {
        const t = put(o, softBox(0.5, 0.06, 0.5, 0.25), std(i % 2 ? '#2f5b6b' : '#3b6b7a', { rough: .5, metal: .15 }), (i - 2) * 0.62, 0.03, 0);
        void t;
      }
    });
    mk('vault', (o) => {
      const dial = put(o, new THREE.CylinderGeometry(0.5, 0.5, 0.1, 30), std('#8d93a8', { rough: .3, metal: .8 }), 0, 0.06, 0);
      void dial;
      put(o, new THREE.BoxGeometry(0.08, 0.12, 0.36), std('#ffd23f', { rough: .3, metal: .6, emis: '#7a5a00', emisI: .6 }), 0, 0.12, 0.18);
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; put(o, new THREE.BoxGeometry(0.03, 0.03, 0.06), std('#22262f'), Math.sin(a) * 0.4, 0.12, Math.cos(a) * 0.4, 0, a, 0); }
      o.userData.dial = o.children[0];
    });
    mk('parcel', (o) => {
      const p = put(o, softBox(0.5, 0.34, 0.4, 0.2), std('#a8814f', { rough: .9 }), 0, 0.2, 0);
      void p;
      put(o, new THREE.BoxGeometry(0.52, 0.05, 0.06), std('#c33a3a', { rough: .7 }), 0, 0.2, 0);
      put(o, new THREE.BoxGeometry(0.06, 0.05, 0.42), std('#c33a3a', { rough: .7 }), 0, 0.2, 0);
      o.userData.p = o.children[0];
    });
    mk('hammer', (o) => {
      put(o, new THREE.CylinderGeometry(0.028, 0.032, 0.4, 10), std('#6b4a2c', { rough: .7 }), 0, 0.2, 0, 0.4, 0, 0.4);
      put(o, softBox(0.22, 0.1, 0.12, 0.3), std('#3a2718', { rough: .6 }), 0.2, 0.36, 0, 0, 0, 0.4);
    });
    mk('button', (o) => {
      put(o, new THREE.CylinderGeometry(0.3, 0.34, 0.08, 20), std('#2b2f3d', { rough: .6 }), 0, 0.04, 0);
      const b = put(o, new THREE.SphereGeometry(0.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), std('#e0322f', { rough: .35, metal: .1, emis: '#7a0e0e', emisI: .5 }), 0, 0.06, 0);
      o.userData.b = b;
    });
    mk('fall', (o) => {
      put(o, new THREE.BoxGeometry(1.4, 0.1, 1.0), std('#3a2718', { rough: .8 }), 0, 0.3, 0);
      for (const s of [-1, 1]) put(o, new THREE.CylinderGeometry(0.04, 0.05, 0.3, 8), brass, s * 0.55, 0.15, 0);
    });
    // the pot: a stack that grows/shrinks with the round pot, plus coins
    const pot = new THREE.Group();
    this.potCoins = [];
    for (let i = 0; i < 26; i++) {
      const c = put(pot, new THREE.CylinderGeometry(0.09, 0.09, 0.022, 14), std(i % 3 === 0 ? '#ffd23f' : '#e5c06a', { rough: .3, metal: .75 }), (Math.random() - .5) * 0.12, 0.02 + i * 0.024, (Math.random() - .5) * 0.12, 0, Math.random() * 3, 0);
      this.potCoins.push(c);
      c.visible = i < 6;
    }
    g.add(pot); this.boardGroups.pot = pot;

    // per-seat "decision card" markers
    this.markers = [];
    for (let i = 0; i < SEATS; i++) {
      const m = new THREE.Group();
      const card = put(m, softBox(0.42, 0.02, 0.3, 0.2), std('#f2ead6', { rough: .85 }), 0, 0.01, 0);
      void card;
      const pip = put(m, new THREE.SphereGeometry(0.05, 10, 8), std('#39e6a0', { emis: '#1e8a63', emisI: 1.2, rough: .4 }), 0, 0.06, 0);
      void pip;
      const s = seatTransform(i);
      m.position.copy(s.pos).setY(1.11).multiplyScalar(0.74);
      m.rotation.y = s.rotY;
      m.userData = { pip };
      g.add(m); this.markers[i] = m;
    }
    this.scene.add(g);
  }

  dust() {
    const n = Math.round(700 * (PRESETS[this.quality]?.dust ?? 1));
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    const r = mulberry32(31);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (r() - 0.5) * 17; pos[i * 3 + 1] = r() * 4.1 + 0.2; pos[i * 3 + 2] = (r() - 0.5) * 15;
      seed[i] = r();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uCol: { value: new THREE.Color('#ffdca8') } },
      vertexShader: `attribute float aSeed; uniform float uT; varying float vA;
        void main(){ vec3 p = position;
          p.y = mod(p.y + uT * (0.05 + aSeed*0.09) + aSeed*4.0, 4.2) + 0.15;
          p.x += sin(uT*0.25 + aSeed*9.0)*0.22; p.z += cos(uT*0.21 + aSeed*7.0)*0.22;
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          gl_PointSize = (1.4 + aSeed*2.6) * (10.0 / -mv.z);
          vA = 0.25 + aSeed*0.5;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uCol; varying float vA;
        void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5,0.0,length(d));
          gl_FragColor = vec4(uCol, a*vA*0.5); }`,
    });
    this.dustPts = new THREE.Points(geo, m);
    this.dustPts.frustumCulled = false;
    this.scene.add(this.dustPts);
  }

  // ── public: per-frame ────────────────────────────────────────────────────────
  update(dt, state = {}) {
    this.time += dt;
    if (this.dustPts) this.dustPts.material.uniforms.uT.value = this.time;
    // pendant flicker + gentle sway
    for (const p of this.pendants) {
      const f = 0.9 + Math.sin(this.time * 7 + p.userData.phase) * 0.03 + Math.sin(this.time * 23 + p.userData.phase) * 0.015;
      p.userData.pl.intensity = (PRESETS[this.quality]?.pendantI ?? 2.4) * f * (this.lampBoost || 1);
      p.userData.bulb.material.emissiveIntensity = 2.6 * f;
      p.rotation.z = Math.sin(this.time * 0.7 + p.userData.phase) * 0.008;
    }
    // neon breathing
    if (this.neonTube) {
      const n = 1.9 + Math.sin(this.time * 2.2) * 0.35 + (Math.random() < 0.01 ? -1.1 : 0);
      this.neonTube.emissiveIntensity = n;
      this.neonPlane.material.opacity = 0.86 + Math.sin(this.time * 2.2) * 0.1;
    }
    if (this.screenLight) this.screenLight.intensity = 8 + (this._screenPulse || 0) + Math.sin(this.time * 1.7) * 1.2;
    if (this.clockHands) {
      const d = new Date();
      this.clockHands.m.rotation.z = -(d.getMinutes() / 60) * Math.PI * 2;
      this.clockHands.h.rotation.z = -(((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2;
    }
    if (this.tipJar) this.tipJar.position.y = 1.16 + Math.sin(this.time * 1.6) * 0.004;
    // board state
    const bg = this.boardGroups;
    for (const k of Object.keys(bg)) bg[k].visible = false;
    const board = state.board || 'none';
    if (bg[board]) {
      bg[board].visible = true;
      bg[board].rotation.y += (state.boardSpin || 0) * dt;
      if (board === 'vault' && bg.vault.userData.dial) bg.vault.userData.dial.rotation.y = state.dial || 0;
      if (board === 'button' && bg.button.userData.b) bg.button.userData.b.scale.y = 1 - (state.press || 0) * 0.45;
      if (board === 'parcel' && bg.parcel.userData.p) {
        const p = bg.parcel.userData.p;
        p.position.y = 0.2 + Math.sin(this.time * 3) * 0.02;
      }
    }
    if (bg.pot) {
      const target = Math.round(state.pot || 0);
      bg.pot.visible = target > 0;
      const want = Math.min(26, Math.max(0, Math.round(target / 45)));
      for (let i = 0; i < 26; i++) {
        const c = this.potCoins[i];
        c.visible = i < want;
        const y = 0.02 + i * 0.024;
        c.position.y += (y - c.position.y) * Math.min(1, dt * 6);
        c.rotation.y += dt * 0.2;
      }
    }
    if (bg.cases) for (const c of bg.cases.children) {
      const hi = state.highlightCase === c.userData.label;
      c.position.y += ((hi ? 0.16 : 0) - c.position.y) * Math.min(1, dt * 6);
      c.scale.setScalar(hi ? 1.12 : 1);
    }
    if (this.juke) this.juke.children[0].material.emissiveIntensity = 0.2 + (1 + Math.sin(this.time * 3)) * 0.3;
  }

  setBoard(name, opts = {}) { this._board = name; Object.assign(this._boardOpts = this._boardOpts || {}, opts); }
  get boardName() { return this._board; }

  /** screen painter: fn(ctx, w, h, t) */
  drawScreen(fn) {
    const g = this.screen.ctx;
    g.save();
    fn(g, this.screen.w, this.screen.h, this.time);
    g.restore();
    this.screen.push();
  }
  screenPulse(v) { this._screenPulse = v; }

  // ── quality switching ────────────────────────────────────────────────────────
  setQuality(q) {
    const prev = this.quality;
    this.quality = q;
    const p = PRESETS[q] || PRESETS.high;
    const L = this.l;
    if (L.key) {
      L.key.castShadow = !!p.shadow;
      if (p.shadow) { L.key.shadow.mapSize.set(p.shadow, p.shadow); L.key.shadow.needsUpdate = true; }
    }
    L.hemi.intensity = 0.42 * p.lightScale;
    L.fill.intensity = p.fillI; L.rose.intensity = p.rimI; L.teal.intensity = p.rimI * 0.8;
    L.bar.intensity = p.barI; L.neon.intensity = p.barI * 0.8;
    for (const pd of this.pendants) pd.userData.pl.intensity = p.pendantI;
    if (this.dustPts) {
      const cnt = Math.round(700 * (p.dust ?? 1));
      this.dustPts.geometry.setDrawRange(0, cnt);
    }
    if (this.scene.fog) this.scene.fog.density = q === 'low' ? 0.036 : 0.028;
    return prev !== q;
  }

  /** walk collision: keep bodies out of the table, the bar and the walls */
  collide(x, z) {
    const nx = Math.max(-10.2, Math.min(10.2, x));
    const nz = Math.max(-8.6, Math.min(8.8, z));
    const d = Math.hypot(nx, nz);
    let cx = nx, cz = nz;
    if (d < 2.75) {
      if (d < 0.001) { cx = 0; cz = 2.75; }
      else { cx = (nx / d) * 2.75; cz = (nz / d) * 2.75; }
    }
    // bar block
    if (cx > 6.4 && cz > 2.1 && cz < 4.6) cz = 2.1;
    if (cx > 6.4 && cz < -5.0 && cz > -7.4) { /* tank area, walkable */ }
    // locker block
    if (cx < -9.5) cx = -9.5;
    return { x: cx, z: cz };
  }
}

export const PRESETS = {
  low: { shadow: 0, keyI: 55, fillI: 6, rimI: 10, barI: 5, pendantI: 1.8, lightScale: 0.8, dust: 0.25, dpr: 0.72, bloom: false, parts: 0.35, postScale: 0.62 },
  medium: { shadow: 1024, keyI: 68, fillI: 8, rimI: 16, barI: 7, pendantI: 2.2, lightScale: 1, dust: 0.6, dpr: 1, bloom: true, parts: 0.65, postScale: 0.8 },
  high: { shadow: 2048, keyI: 78, fillI: 10, rimI: 22, barI: 9, pendantI: 2.6, lightScale: 1.05, dust: 1, dpr: 1.6, bloom: true, parts: 1, postScale: 1 },
  ultra: { shadow: 2048, keyI: 84, fillI: 12, rimI: 26, barI: 10, pendantI: 2.9, lightScale: 1.12, dust: 1.5, dpr: 2, bloom: true, parts: 1.6, postScale: 1.05 },
};

// ── camera rig: always frames the table, punches in on the person acting ──────
export class CameraRig {
  constructor(cam, room) {
    this.cam = cam; this.room = room;
    this.target = new THREE.Vector3(0, 1.15, 0);
    this.want = this.target.clone();
    this.dist = 13.2; this.wantDist = 13.2;
    this.az = Math.PI; this.wantAz = Math.PI;
    this.pol = 0.62; this.wantPol = 0.62;
    this.fov = 34; this.wantFov = 34;
    this.shake = 0; this.flash = 0;
    this.lookAtMe = null;
  }
  focus(v, zoom = 1) {
    if (v) { this.want.copy(v); this.want.y = Math.max(0.9, v.y + 0.5); }
    else this.want.set(0, 1.15, 0);
    this.wantDist = (v ? 7.4 : 13.2) / zoom;
  }
  frame(points, opts = {}) {
    // fit all living bodies plus the table into view
    if (!points.length) return;
    const box = new THREE.Box3();
    for (const p of points) box.expandByPoint(p);
    box.expandByPoint(new THREE.Vector3(-2.4, 0, -2.4));
    box.expandByPoint(new THREE.Vector3(2.4, 1.4, 2.4));
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const rad = Math.max(3.2, Math.hypot(s.x, s.z) * 0.62);
    this.want.set(c.x, Math.max(1.0, c.y + 0.25), c.z);
    this.wantDist = rad * (opts.tight ? 2.05 : 2.62);
    this.wantFov = opts.flat ? 30 : 34;
  }
  kick(a = 1) { this.shake = Math.min(1.4, this.shake + a); }
  update(dt, quality = 'high') {
    const k = Math.min(1, dt * (this.fast ? 9 : 3.1));
    this.target.lerp(this.want, k);
    this.dist += (this.wantDist - this.dist) * k;
    this.az += (this.wantAz - this.az) * k;
    this.pol += (this.wantPol - this.pol) * k;
    this.fov += (this.wantFov - this.fov) * k;
    const c = this.cam;
    if (c.fov !== this.fov) { c.fov = this.fov; c.updateProjectionMatrix(); }
    const horiz = Math.cos(this.pol) * this.dist;
    let x = this.target.x + Math.sin(this.az) * horiz;
    let z = this.target.z + Math.cos(this.az) * horiz;
    let y = this.target.y + Math.sin(this.pol) * this.dist;
    if (this.shake > 0.001 && quality !== 'low') {
      const t = performance.now() * 0.045;
      const a = this.shake * 0.24;
      x += Math.sin(t * 1.7) * a; y += Math.sin(t * 2.3 + 1) * a * 0.7; z += Math.cos(t * 1.9) * a * 0.4;
      this.shake *= Math.pow(0.0025, dt);
    } else this.shake = 0;
    c.position.set(x, Math.max(1.3, y), z);
    c.lookAt(this.target);
    c.updateMatrixWorld();
  }
}
