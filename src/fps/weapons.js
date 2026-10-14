// ── WARFRONT · weapons: definitions, procedural viewmodels, firing logic ────
// Hitscan with falloff, bloom spread, per-weapon recoil pattern, ADS that truly
// lines the sight up with the camera.

import * as THREE from 'three';
import { clamp, lerp, damp, RNG, TAU } from './util.js';

const GUN = 0x2c2f33, POLY = 0x1e2022, STEEL = 0x55595e, WOOD = 0x6b4a2c;

export const WEAPONS = {
  m4: {
    name: 'M4 CARBINE', cls: 'assault', mode: 'auto', rpm: 780, dmg: 31, head: 2.5, leg: .72,
    mag: 30, reserve: 150, reload: 1.95, adsTime: .21, adsFov: .74, swap: .35,
    spread: { hip: 1.35, ads: .2, move: 2.4, fire: .26, max: 3.1, decay: 9 },
    falloff: [40, 80], minMul: .6, recoil: { v: .58, h: .17, kick: .05, snap: .85 },
    sound: 'rifle', speed: 1, unlock: 0,
    model: { body: GUN, len: .78, barrel: .3, handguard: 'quad', mag: 'curved', stock: 'buffer', sight: 'reddot', suppressor: true },
  },
  ak74: {
    name: 'AK-74', cls: 'assault', mode: 'auto', rpm: 620, dmg: 38, head: 2.6, leg: .7,
    mag: 30, reserve: 120, reload: 2.25, adsTime: .25, adsFov: .7, swap: .38,
    spread: { hip: 1.6, ads: .24, move: 2.8, fire: .38, max: 3.8, decay: 7.6 },
    falloff: [44, 86], minMul: .58, recoil: { v: .95, h: .3, kick: .075, snap: .7 },
    sound: 'ak', speed: .99, unlock: 0,
    model: { body: 0x35322e, len: .8, barrel: .34, handguard: 'wood', mag: 'curved', stock: 'wood', sight: 'iron' },
  },
  mp5: {
    name: 'MP5A3', cls: 'smg', mode: 'auto', rpm: 850, dmg: 24, head: 2.2, leg: .8,
    mag: 30, reserve: 180, reload: 1.75, adsTime: .17, adsFov: .78, swap: .28,
    spread: { hip: 1.95, ads: .28, move: 2.2, fire: .2, max: 3.2, decay: 10 },
    falloff: [24, 56], minMul: .5, recoil: { v: .38, h: .16, kick: .036, snap: 1 },
    sound: 'smg', speed: 1.05, unlock: 0,
    model: { body: POLY, len: .56, barrel: .18, handguard: 'slim', mag: 'straight', stock: 'solid', sight: 'iron' },
  },
  vector: {
    name: 'K1 VECTOR', cls: 'smg', mode: 'auto', rpm: 1180, dmg: 19, head: 2.2, leg: .82,
    mag: 33, reserve: 198, reload: 1.85, adsTime: .15, adsFov: .8, swap: .26,
    spread: { hip: 2.2, ads: .3, move: 2.0, fire: .16, max: 2.9, decay: 12 },
    falloff: [20, 48], minMul: .45, recoil: { v: .28, h: .2, kick: .028, snap: 1.15 },
    sound: 'smg', speed: 1.08, unlock: 1,
    model: { body: 0x3b3d40, len: .5, barrel: .12, handguard: 'slim', mag: 'straight', stock: 'fold', sight: 'reddot' },
  },
  m870: {
    name: 'M870 MCS', cls: 'shotgun', mode: 'pump', rpm: 78, dmg: 15, pellets: 8, head: 1.8, leg: .9,
    mag: 7, reserve: 42, reload: 1.05, perShell: true, adsTime: .24, adsFov: .74, swap: .4,
    spread: { hip: 5.2, ads: 3.5, move: 6.2, fire: 0, max: 6.2, decay: 4 },
    falloff: [13, 34], minMul: .22, recoil: { v: 1.9, h: .5, kick: .14, snap: .55 },
    sound: 'shotgun', speed: .98, unlock: 1,
    model: { body: 0x2a2724, len: .86, barrel: .42, handguard: 'pump', mag: 'none', stock: 'wood', sight: 'iron', ribbed: true },
  },
  saw: {
    name: 'M249 SAW', cls: 'lmg', mode: 'auto', rpm: 700, dmg: 33, head: 2.3, leg: .7,
    mag: 100, reserve: 200, reload: 4.4, adsTime: .38, adsFov: .66, swap: .55,
    spread: { hip: 2.4, ads: .42, move: 3.6, fire: .24, max: 4.2, decay: 6.5 },
    falloff: [46, 96], minMul: .62, recoil: { v: .74, h: .34, kick: .06, snap: .7 },
    sound: 'lmg', speed: .9, unlock: 4,
    model: { body: 0x2f3134, len: .92, barrel: .46, handguard: 'bipod', mag: 'box', stock: 'solid', sight: 'iron', suppressor: false },
  },
  sr25: {
    name: 'SR-25', cls: 'marksman', mode: 'semi', rpm: 210, dmg: 58, head: 2.6, leg: .75,
    mag: 10, reserve: 50, reload: 2.5, adsTime: .3, adsFov: .55, swap: .45,
    spread: { hip: 1.1, ads: .06, move: 3.2, fire: .9, max: 3.4, decay: 5 },
    falloff: [70, 140], minMul: .74, recoil: { v: 1.15, h: .22, kick: .09, snap: .6 },
    sound: 'dmr', speed: .96, unlock: 2,
    model: { body: 0x30322f, len: 1.02, barrel: .5, handguard: 'long', mag: 'curved', stock: 'buffer', sight: 'scope4' },
  },
  ax50: {
    name: 'AX-50', cls: 'sniper', mode: 'bolt', rpm: 48, dmg: 108, head: 1.6, leg: .6, pierce: true,
    mag: 5, reserve: 25, reload: 3.4, adsTime: .42, adsFov: .3, scope: true, swap: .6,
    spread: { hip: 2.4, ads: .02, move: 5, fire: 1.4, max: 5, decay: 3.6 },
    falloff: [140, 300], minMul: .85, recoil: { v: 2.6, h: .5, kick: .17, snap: .4 },
    sound: 'sniper', speed: .88, unlock: 3,
    model: { body: 0x27292b, len: 1.22, barrel: .72, handguard: 'bipod', mag: 'box', stock: 'bullpup', sight: 'scope8', muzzleBrake: true },
  },
  m1911: {
    name: 'M1911', cls: 'pistol', mode: 'semi', rpm: 420, dmg: 36, head: 2.4, leg: .8, secondary: true,
    mag: 12, reserve: 96, reload: 1.5, adsTime: .14, adsFov: .82, swap: .22,
    spread: { hip: 2.2, ads: .5, move: 2.4, fire: .5, max: 4.2, decay: 8 },
    falloff: [22, 52], minMul: .45, recoil: { v: .8, h: .3, kick: .05, snap: .95 },
    sound: 'pistol', speed: 1.06, unlock: 0,
    model: { body: 0x3a3c3f, len: .24, barrel: .06, handguard: 'none', mag: 'straight', stock: 'none', sight: 'iron' },
  },
  maxim: {
    name: 'MAXIM .44', cls: 'pistol', mode: 'semi', rpm: 150, dmg: 78, head: 2.2, leg: .8, secondary: true,
    mag: 6, reserve: 30, reload: 2.1, adsTime: .18, adsFov: .78, swap: .26,
    spread: { hip: 1.8, ads: .34, move: 2.2, fire: .8, max: 3.4, decay: 6 },
    falloff: [30, 70], minMul: .55, recoil: { v: 1.8, h: .4, kick: .11, snap: .6 },
    sound: 'hgrunt', speed: 1.03, unlock: 2,
    model: { body: 0x4a4d52, len: .4, barrel: .22, handguard: 'none', mag: 'straight', stock: 'none', sight: 'iron', long: true },
  },
};

for (const k of Object.keys(WEAPONS)) { WEAPONS[k].id = k; WEAPONS[k].idKey = k; }

export const PRIMARY_ORDER = ['m4', 'mp5', 'ak74', 'vector', 'm870', 'sr25', 'ax50', 'saw'];
export const SECONDARY_ORDER = ['m1911', 'maxim'];

export const PERKS = {
  none: { name: 'NONE', note: 'No perk equipped — balanced kit.' },
  lightweight: { name: 'LIGHTWEIGHT', note: '+14% movement speed, longer sprint.' },
  doubletap: { name: 'DOUBLE-TAP', note: '−12% time between shots. Slower to aim.' },
  sleight: { name: 'SLEIGHT OF HAND', note: '−30% reload time, faster weapon swap.' },
  deadproof: { name: 'DEAD PROOF', note: 'Once per wave you survive a lethal hit at 25 HP.' },
  situational: { name: 'SITUATIONAL', note: '+1 armor plate per refill, faster plate use.' },
};

// ── viewmodel geometry ───────────────────────────────────────────────────────
function mkBox(w, h, d, x, y, z, mat, rot) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}
function mkCyl(r1, r2, len, x, y, z, mat, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/**
 * Build a stylised low-poly gun pointing down -Z.
 * Returns { group, muzzle, sightY, mag } — muzzle/sight are Object3D anchors.
 */
export function buildGun(spec, opts = {}) {
  const scale = opts.scale || 1;
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: spec.body ?? GUN, roughness: .48, metalness: .78 });
  const poly = new THREE.MeshStandardMaterial({ color: POLY, roughness: .82, metalness: .18 });
  const steel = new THREE.MeshStandardMaterial({ color: STEEL, roughness: .38, metalness: .92 });
  const wood = new THREE.MeshStandardMaterial({ color: WOOD, roughness: .8, metalness: .05 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0d1a22, roughness: .12, metalness: .5 });
  if (opts.tint) { metal.color.set(opts.tint); steel.color.set(opts.tint); }
  if (opts.camo === 'gold') { metal.metalness = .95; metal.roughness = .18; metal.color.set(0xd4a017); steel.color.set(0xf1c23c); }
  if (opts.camo === 'ghost') { metal.color.set(0x14161a); steel.color.set(0x22262b); }
  if (opts.camo === 'coyote') { metal.color.set(0x6b6353); steel.color.set(0x8a8171); }

  const L = spec.len;
  // receiver
  g.add(mkBox(.11, .15, L * .62, 0, 0, -L * .16, metal));
  // top rail
  g.add(mkBox(.055, .028, L * .58, 0, .088, -L * .16, poly));
  // barrel / handguard
  const bg = spec.handguard === 'none' ? null : spec.handguard;
  if (bg === 'quad' || bg === 'long') {
    const hl = bg === 'long' ? L * .46 : L * .34;
    g.add(mkBox(.1, .11, hl, 0, .005, -L * .47 - hl * .4, poly));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      g.add(mkBox(.018, .018, hl * .92, Math.cos(a) * .055, Math.sin(a) * .055, -L * .47 - hl * .4, metal));
    }
  } else if (bg === 'slim') {
    g.add(mkBox(.085, .085, L * .3, 0, 0, -L * .5, poly));
  } else if (bg === 'wood') {
    g.add(mkBox(.1, .1, L * .3, 0, -.02, -L * .48, wood));
  } else if (bg === 'pump') {
    g.add(mkBox(.115, .09, L * .22, 0, -.055, -L * .42, wood));
    g.userData.pump = g.children[g.children.length - 1];
  } else if (bg === 'bipod') {
    g.add(mkBox(.09, .09, L * .34, 0, 0, -L * .5, poly));
    const leg = mkBox(.02, .22, .02, 0, -.14, -L * .66, metal, [.4, 0, 0]);
    const leg2 = mkBox(.02, .22, .02, 0, -.14, -L * .66, metal, [-.4, 0, 0]);
    leg2.rotation.x = -0.4;
    g.add(leg, leg2);
  }
  const barrLen = spec.barrel || .2;
  g.add(mkCyl(.022, .022, barrLen, 0, .01, -L * .62 - (spec.handguard === 'long' ? L * .46 : L * .34) - barrLen * .45, steel, 8));
  // muzzle anchor at the very tip
  const muzzleZ = -L * .62 - (spec.handguard === 'long' ? L * .5 : L * .38) - barrLen * .95;
  if (spec.muzzleBrake) g.add(mkCyl(.05, .05, .13, 0, .01, muzzleZ - .04, metal, 8));
  if (spec.suppressor) { g.add(mkCyl(.045, .045, .26, 0, .01, muzzleZ - .08, poly, 10)); }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, .01, muzzleZ - (spec.suppressor ? .2 : .04));
  g.add(muzzle);

  // grip + trigger guard
  g.add(mkBox(.075, .2, .085, 0, -.16, L * .04, poly, [.24, 0, 0]));
  g.add(mkBox(.03, .03, .09, 0, -.075, L * .02, metal));
  // magazine
  if (spec.mag === 'curved') {
    g.add(mkBox(.07, .26, .1, 0, -.22, -L * .04, metal, [.16, 0, 0]));
    g.add(mkBox(.07, .16, .1, 0, -.4, -L * .09, metal, [.42, 0, 0]));
    g.userData.mag = g.children[g.children.length - 2];
  } else if (spec.mag === 'straight') {
    g.add(mkBox(.062, .28, .09, 0, -.22, -L * .02, spec.stock === 'none' ? metal : poly));
    g.userData.mag = g.children[g.children.length - 1];
  } else if (spec.mag === 'box') {
    g.add(mkBox(.14, .22, .2, 0, -.19, -L * .06, poly));
    g.userData.mag = g.children[g.children.length - 1];
  }
  // stock
  if (spec.stock === 'buffer') {
    g.add(mkBox(.06, .07, .2, 0, .02, L * .2, poly));
    g.add(mkBox(.085, .14, .09, 0, .0, L * .3, poly));
  } else if (spec.stock === 'solid') {
    g.add(mkBox(.05, .1, .3, 0, -.01, L * .22, poly));
    g.add(mkBox(.045, .16, .06, 0, -.04, L * .36, poly, [.3, 0, 0]));
  } else if (spec.stock === 'wood') {
    g.add(mkBox(.055, .11, .3, 0, -.02, L * .22, wood, [.06, 0, 0]));
  } else if (spec.stock === 'fold') {
    g.add(mkBox(.03, .09, .16, 0, .01, L * .16, poly));
  } else if (spec.stock === 'bullpup') {
    g.add(mkBox(.11, .16, .42, 0, -.02, L * .2, spec.body ?? GUN === GUN ? metal : poly));
    g.add(mkBox(.07, .07, .1, 0, -.14, L * .1, poly, [.24, 0, 0]));
  }
  // sights
  let sightY = .14;
  if (spec.sight === 'reddot') {
    g.add(mkBox(.07, .05, .07, 0, .12, -L * .18, poly));
    const led = new THREE.Mesh(new THREE.PlaneGeometry(.032, .032), new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: .9 }));
    led.position.set(0, .128, -L * .145);
    g.add(led);
    sightY = .128;
  } else if (spec.sight === 'iron') {
    g.add(mkBox(.018, .05, .02, 0, .115, -L * .5, metal));
    g.add(mkBox(.06, .016, .02, 0, .112, L * .02, metal));
    sightY = .118;
  } else if (spec.sight === 'scope4' || spec.sight === 'scope8') {
    const sl = spec.sight === 'scope8' ? .46 : .32;
    g.add(mkCyl(.062, .062, sl, 0, .15, -L * .16, poly, 12));
    g.add(mkCyl(.072, .072, .05, 0, .15, -L * .16 - sl * .5, metal, 12));
    g.add(mkCyl(.056, .056, .03, 0, .15, -L * .16 + sl * .5, glass, 12));
    g.add(mkBox(.03, .05, .03, 0, .1, -L * .16, metal));
    sightY = .15;
  }
  // hands (simple gloved blocks) so the gun reads in 3D
  if (!opts.noHands) {
    const skin = new THREE.MeshStandardMaterial({ color: opts.team === 'opfor' ? 0x4a4436 : 0x37413a, roughness: .95 });
    const front = mkBox(.09, .1, .12, 0, -.06, -L * .42, skin);
    front.rotation.z = .25; front.rotation.x = -.15;
    const rear = mkBox(.085, .11, .1, 0, -.13, L * .03, skin);
    rear.rotation.x = .25;
    g.add(front, rear);
    // forearms
    const fa = mkBox(.085, .085, .3, -.06, -.14, -L * .28, skin, [-.3, .35, 0]);
    g.add(fa);
  }

  g.userData.muzzle = muzzle;
  g.userData.sightY = sightY;
  g.userData.sightZ = -L * .62 - (spec.handguard === 'long' ? L * .46 : L * .34) - (spec.barrel || .2) * .5;
  g.userData.mag = g.userData.mag || null;
  g.userData.pump = g.userData.pump || null;
  g.scale.setScalar(scale);
  g.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 10; } });
  return g;
}

// ── controller ───────────────────────────────────────────────────────────────
export class Guns {
  constructor(game) {
    this.game = game;
    this.rng = new RNG(4242);
    this.cam = game.camera;
    this.state = {};         // per weapon id: {mag, reserve}
    this.current = 'm4';
    this.vm = null;
    this.vmScale = .86;
    // the viewmodel lives in its own scene, rendered after the world with a
    // depth clear so a rifle can never poke through a wall
    this.vmRoot = game.vmRoot;
    this.vmGroup = new THREE.Group();
    this.vmRoot.add(this.vmGroup);
    this.ads = 0;            // 0..1 blend
    this.bloom = 0;
    this.nextShot = 0;
    this.reloadT = 0;
    this.reloadTotal = 0;
    this.swapT = 0;
    this.recoilRot = new THREE.Vector2();
    this.kick = 0;
    this.lastFire = -9;
    this.shotIndex = 0;
    this.scopeActive = false;
    this.preferAdsKey = false;
  }

  init(ids) {
    this.loadout = ids;
    for (const id of ids) if (!this.state[id]) this.newAmmo(id);
    this.equip(ids[0], true);
  }
  newAmmo(id) {
    const w = WEAPONS[id];
    this.state[id] = { mag: w.mag, reserve: w.reserve };
  }
  refitAll() { for (const id of Object.keys(this.state)) this.newAmmo(id); }

  def(id = this.current) { return WEAPONS[id]; }
  ammo() { return this.state[this.current]; }

  equip(id, instant) {
    if (!this.state[id]) this.newAmmo(id);
    this.current = id;
    this.reloadT = 0;
    this.bloom = 0;
    this.buildVm();
    this.swapT = instant ? 0 : this.def().swap * (this.game.perk === 'sleight' ? .65 : 1);
    this.ads = 0;
    this.game.hud.flashWeapon(this.def());
    this.game.audio.swap(instant);
  }
  cycle(dir) {
    const list = this.loadout;
    const i = (list.indexOf(this.current) + dir + list.length) % list.length;
    if (list[i] !== this.current && this.swapT <= 0) this.equip(list[i]);
  }

  buildVm() {
    while (this.vmGroup.children.length) this.vmGroup.remove(this.vmGroup.children[0]);
    const d = this.def();
    const camo = this.game.camoFor ? this.game.camoFor(this.current) : null;
    const g = buildGun(d.model, { camo, tint: d.teamTint, scale: this.vmScale });
    this.vmGroup.add(g);
    this.vm = g;
    // muzzle flash sprite
    const flashMat = new THREE.MeshBasicMaterial({
      map: (() => {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const x = c.getContext('2d');
        const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,255,235,1)'); gr.addColorStop(.3, 'rgba(255,196,92,.9)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
        x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
        x.globalAlpha = .85; x.fillStyle = 'rgba(255,235,180,.9)';
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          x.save(); x.translate(32, 32); x.rotate(a); x.fillRect(-3, 6, 6, 26); x.restore();
        }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })(),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(.5, .5), flashMat);
    flash.position.copy(g.userData.muzzle.position);
    flash.visible = false;
    flash.renderOrder = 12;
    g.add(flash);
    this.flash = flash;
    this.flashT = 0;
  }

  // ── firing ──────────────────────────────────────────────────────────────
  get canFire() {
    return this.swapT <= 0 && this.reloadT <= 0 && this.game.state === 'play' && !this.game.player.dead;
  }

  tryFire(now) {
    if (!this.canFire) return false;
    if (now < this.nextShot) return false;
    const a = this.ammo();
    if (a.mag <= 0) { this.autoReload(); return false; }
    const d = this.def();
    const perk = this.game.perk === 'doubletap' ? .88 : 1;
    const gap = (60 / d.rpm) * perk;
    this.nextShot = now + gap;
    a.mag--;
    this.shotIndex++;
    this.bloom = Math.min(d.spread.max, this.bloom + d.spread.fire);
    this.lastFire = now;

    // direction: camera forward, jittered by spread cone
    const cam = this.cam;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const spreadDeg = this.currentSpread();
    const shots = d.pellets || 1;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    this.game._shotHits = 0;
    const muzzleW = this.vm ? this.vm.userData.muzzle.getWorldPosition(new THREE.Vector3()) : origin.clone().addScaledVector(fwd, .5);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    for (let i = 0; i < shots; i++) {
      const ang = this.rng.next() * TAU;
      const rad = Math.sqrt(this.rng.next()) * (spreadDeg * Math.PI / 180);
      const dir = fwd.clone()
        .addScaledVector(right, Math.cos(ang) * rad)
        .addScaledVector(up, Math.sin(ang) * rad)
        .normalize();
      this.game.shoot(origin, dir, d, { fromPlayer: true, muzzle: muzzleW, pellet: i });
    }

    // recoil + view kick
    const rec = d.recoil;
    const ramp = Math.min(1, this.shotIndex / (d.mode === 'auto' ? 7 : 2));
    const vy = rec.v * (0.45 + ramp * .75) * (this.ads > .6 ? .72 : 1);
    const vx = rec.h * (this.rng.next() - .5) * 2.2 * (0.5 + ramp);
    this.game.player.applyRecoil(vy * .0125, vx * .0125);
    this.recoilRot.y += vx * .5;
    this.recoilRot.x += vy * .55;
    this.kick = Math.min(.9, this.kick + rec.kick * 5.5);

    // fx + audio
    if (this.vm) {
      this.flash.visible = true;
      this.flash.rotation.z = this.rng.range(0, TAU);
      this.flash.scale.setScalar(.7 + this.rng.next() * .7);
      this.flashT = d.mode === 'auto' ? .035 : .06;
    }
    this.game.fx.muzzleFlash(muzzleW, fwd, d.cls === 'sniper' || d.cls === 'lmg' ? 1.6 : 1);
    this.game.fx.shell(muzzleW, right, up);
    this.game.audio.shot(d.sound, 0, this.ads > .5);
    this.game.fx.shakeAdd(d.mode === 'bolt' ? .16 : .05);
    if (d.sound === 'shotgun') this.game.fx.shakeAdd(.08);

    // accuracy bookkeeping (one "shot" per trigger pull)
    const st = this.game.player.stats;
    st.shots++;
    if (this.game._shotHits > 0) st.hits++;

    // pump / bolt handling
    if (d.mode === 'pump' || d.mode === 'bolt') this.swapAnim = .32;
    if (a.mag === 0) this.autoReload();
    return true;
  }

  currentSpread() {
    const d = this.def();
    const p = this.game.player;
    const mv = Math.min(1, p.speed2D / 7);
    const base = lerp(d.spread.hip, d.spread.ads, this.ads);
    const air = p.grounded ? 0 : d.spread.move * .8;
    return clamp(base + this.bloom + mv * d.spread.move * (1 - this.ads * .6) + air + (p.crouch ? -base * .18 : 0), d.spread.ads * .5, 9);
  }

  autoReload() {
    const a = this.ammo();
    if (a.mag >= this.def().mag || a.reserve <= 0) return;
    this.startReload();
  }
  startReload() {
    if (this.reloadT > 0) return;
    if (this.swapT > 0 || this.game.state !== 'play' || this.game.player.dead) return;
    const d = this.def();
    const a = this.ammo();
    if (a.mag >= d.mag || a.reserve <= 0) return;
    const t = d.reload * (this.game.perk === 'sleight' ? .7 : 1);
    this.reloadT = this.reloadTotal = t;
    this.game.audio.reloadStart(d);
    this.game.hud.reloadPulse(t);
  }

  update(dt, now, input) {
    const d = this.def();
    // swap
    if (this.swapT > 0) this.swapT = Math.max(0, this.swapT - dt);
    if (this.swapAnim > 0) this.swapAnim = Math.max(0, this.swapAnim - dt);
    // reload
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const a = this.ammo();
        const need = d.mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
        this.reloadT = 0;
        this.game.audio.reloadEnd(d);
      }
    }
    // bloom decay
    if (now - this.lastFire > .1) this.bloom = Math.max(0, this.bloom - d.spread.decay * dt * (1 + this.ads * 1.4));
    // ads blend
    const wantAds = (input.ads || this.preferAdsKey) && this.swapT <= 0 && this.reloadT <= 0 && !(this.game.player.sprinting && this.ads < .3);
    this.ads = damp(this.ads, wantAds ? 1 : 0, wantAds ? 1 / Math.max(.05, d.adsTime * .55) : 11, dt);
    if (this.ads < .02) this.ads = 0;
    this.scopeActive = !!(d.scope && this.ads > .75);
    if (this.vmGroup) this.vmGroup.visible = !this.scopeActive && this.game.state !== 'menu';
    // recoil spring recovery
    this.recoilRot.x = damp(this.recoilRot.x, 0, 9, dt);
    this.recoilRot.y = damp(this.recoilRot.y, 0, 7.5, dt);
    this.kick = damp(this.kick, 0, 13, dt);
    // viewmodel transform
    if (this.vm) {
      const p = this.game.player;
      const bob = p.grounded ? Math.sin(p.bobPhase) * .012 * (0.4 + p.speed2D / 8) : 0;
      const bob2 = p.grounded ? Math.cos(p.bobPhase * 2) * .008 * (0.4 + p.speed2D / 8) : 0;
      const hipX = .17, hipY = -.155, hipZ = -.34;
      const sightY = (this.vm.userData.sightY || .13) * this.vmScale;
      const adsX = 0, adsY = -sightY + .006, adsZ = -.3;
      let x = lerp(hipX, adsX, this.ads) + bob;
      let y = lerp(hipY, adsY, this.ads) + bob2 + this.kick * .012;
      let z = lerp(hipZ, adsZ, this.ads) + this.kick * .055;
      if (this.swapT > 0) {
        const k = Math.sin(clamp(this.swapT / Math.max(.001, d.swap), 0, 1) * Math.PI);
        y -= k * .3; z += k * .12;
      }
      if (this.reloadT > 0) {
        const k = Math.sin(clamp(1 - this.reloadT / this.reloadTotal, 0, 1) * Math.PI);
        y -= k * .22; x += k * .05; this.vm.rotation.x = k * .55; this.vm.rotation.z = k * .2;
      } else if (this.swapAnim > 0) {
        const k = Math.sin(clamp(this.swapAnim / .32, 0, 1) * Math.PI);
        if (d.mode === 'pump') { if (this.vm.userData.pump) this.vm.userData.pump.position.z = -d.model.len * .42 - k * .11; }
        this.vm.rotation.x = -k * .12;
      } else {
        this.vm.rotation.x = damp(this.vm.rotation.x, -this.kick * .09, 14, dt);
        this.vm.rotation.z = damp(this.vm.rotation.z, 0, 12, dt);
      }
      this.vm.position.set(x, y, z);
      this.vm.rotation.y = damp(this.vm.rotation.y, (1 - this.ads) * .07 - p.strafe * .03, 10, dt);
      // sway from mouse velocity
      this.vm.rotation.y += clamp(-p.lookRateX * .5, -.09, .09);
      this.vm.rotation.x += clamp(-p.lookRateY * .5, -.07, .07);
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0 && this.flash) this.flash.visible = false;
    }
  }

  fovMult() {
    const d = this.def();
    return lerp(1, d.adsFov, this.ads * (d.scope ? 1 : .9));
  }
}

export const damageAt = (d, dist) => {
  const [a, b] = d.falloff;
  if (dist <= a) return d.dmg;
  if (dist >= b) return d.dmg * d.minMul;
  return lerp(d.dmg, d.dmg * d.minMul, (dist - a) / (b - a));
};
