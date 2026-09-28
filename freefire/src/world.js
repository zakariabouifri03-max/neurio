// ── BOOYAH FIRE — three.js world: terrain, water, sky, towns, props, zone ────
// Built once per match from the simulation's island data so collision and
// visuals can never disagree. Everything static is merged into a handful of
// meshes (terrain + 2 prop batches + water + sky) → very few draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bindThree, skyTex, zoneTex, glooTex, grassTex } from './tex.js';

bindThree(THREE);
export { THREE };

const C = (hex) => new THREE.Color(hex);

function paint(geo, hex, jitter = 0) {
  const col = C(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = jitter ? (Math.random() - 0.5) * jitter : 0;
    arr[i * 3] = Math.min(1, Math.max(0, col.r + j));
    arr[i * 3 + 1] = Math.min(1, Math.max(0, col.g + j));
    arr[i * 3 + 2] = Math.min(1, Math.max(0, col.b + j));
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}

function box(w, h, d, x, y, z, rot, hex, jitter = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  paint(g, hex, jitter);
  const m = new THREE.Matrix4().makeRotationY(rot || 0).setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
}

function cyl(rt, rb, h, seg, x, y, z, hex, rotZ = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  paint(g, hex);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  return g;
}

function ico(r, detail, x, y, z, hex, sx = 1, sy = 1, sz = 1, rotY = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  paint(g, hex, 0.04);
  const m = new THREE.Matrix4()
    .makeRotationY(rotY)
    .scale(new THREE.Vector3(sx, sy, sz))
    .setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
}

export class World {
  constructor(island, theme, opts = {}) {
    this.island = island;
    this.theme = theme;
    this.lowQ = !!opts.lowQ;
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.t = 0;

    this._buildSky();
    this._buildTerrain();
    this._buildWater();
    this._buildProps();
    this._buildZoneWall();
    this._buildLights();
  }

  // ── sky dome + sun ──────────────────────────────────────────────────────
  _buildSky() {
    const th = this.theme;
    const tex = skyTex(th.sky[0], th.sky[1], th.sky[2]);
    const geo = new THREE.SphereGeometry(1500, 24, 14);
    const mat = new THREE.MeshBasicMaterial({ map: tex || null, color: tex ? 0xffffff : C(th.sky[1]), side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -10;
    this.group.add(this.sky);

    // sun / moon disc
    const sunCol = C(th.sun);
    const sunMat = new THREE.MeshBasicMaterial({ color: sunCol, fog: false, transparent: true, opacity: 0.9 });
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(26, 12, 8), sunMat);
    this.sunDisc.position.set(-420, 520, -900);
    this.group.add(this.sunDisc);
  }

  // ── terrain mesh straight from the sim heightfield ─────────────────────
  _buildTerrain() {
    const isl = this.island, N = isl.N, size = isl.size, th = this.theme;
    const geo = new THREE.PlaneGeometry(size, size, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let r = 0; r <= N; r++) {
      for (let i = 0; i <= N; i++) {
        const k = r * (N + 1) + i;
        pos.setY(k, isl.hmap[k]);
      }
    }
    pos.needsUpdate = true;

    // vertex colours: water bed → sand → grass → rock → peak, plus fields & dirt
    const col = new Float32Array(pos.count * 3);
    const sand = C(th.sand), grass = C(th.grass), rock = C(th.rock), water = C(th.water);
    const deep = C('#123a52'), snow = C('#f2f6fb'), dirt = C('#a98a63');
    const tmp = new THREE.Color();
    const hmap = isl.hmap;
    for (let r = 0; r <= N; r++) {
      for (let i = 0; i <= N; i++) {
        const k = r * (N + 1) + i;
        const h = hmap[k];
        const x = (i / N - 0.5) * size, z = (r / N - 0.5) * size;
        // slope from the neighbours
        const hx = Math.abs(hmap[r * (N + 1) + Math.min(N, i + 1)] - hmap[r * (N + 1) + Math.max(0, i - 1)]);
        const hz = Math.abs(hmap[Math.min(N, r + 1) * (N + 1) + i] - hmap[Math.max(0, r - 1) * (N + 1) + i]);
        const slope = Math.max(hx, hz) / (2 * (size / N));
        if (h <= 0.15) tmp.copy(deep).lerp(water, 0.5);
        else if (h < 1.6) tmp.copy(sand);
        else if (h < 9) tmp.copy(sand).lerp(grass, Math.min(1, (h - 1.6) / 5));
        else if (h < 22) tmp.copy(grass);
        else if (h < 34) tmp.copy(grass).lerp(rock, Math.min(1, (h - 22) / 10));
        else tmp.copy(rock).lerp(snow, Math.min(1, (h - 34) / 14));
        if (h > 1.6 && h < 30 && slope > 0.52) tmp.lerp(rock, Math.min(0.75, (slope - 0.52) * 1.6));
        // town pads & roads → packed dirt
        for (const t of isl.towns) {
          const d = Math.hypot(x - t.x, z - t.z);
          if (d < t.radius + 5) { tmp.lerp(dirt, Math.min(0.92, (1 - d / (t.radius + 5)) * 1.5)); break; }
        }
        for (const rd of isl.roads) {
          const d = Math.hypot(x - rd.x, z - rd.z);
          if (d < rd.r + 1.4) { tmp.lerp(dirt, 0.35); break; }
        }
        col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
      }
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.terrain.name = 'terrain';
    this.group.add(this.terrain);
  }

  _buildWater() {
    const isl = this.island, th = this.theme;
    const geo = new THREE.PlaneGeometry(isl.size * 2.4, isl.size * 2.4, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: C(th.water), transparent: true, opacity: 0.86 });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = 0.08;
    this.water.name = 'water';
    this.group.add(this.water);
  }

  // ── buildings / trees / rocks, merged per material ──────────────────────
  _buildProps() {
    const th = this.theme;
    const solid = [];       // opaque structures
    const foliage = [];     // trees (flat shaded)
    const rockCol = C(th.rock);
    const wallCol = C('#cfc7b4');

    for (const p of this.island.props) {
      switch (p.type) {
        case 'house': {
          const w = p.w, d = p.d, h = p.h || p.hh * 2;
          const body = wallCol.clone().offsetHSL(0, 0, ((p.seed || 0.5) - 0.5) * 0.16);
          solid.push(box(w, h, d, p.x, p.y + h / 2, p.z, p.rot, '#' + body.getHexString()));
          // flat roof + parapet
          solid.push(box(w * 1.08, 0.36, d * 1.08, p.x, p.y + h + 0.18, p.z, p.rot, '#8d8478'));
          solid.push(box(w * 1.08, 0.22, d * 0.14, p.x, p.y + h + 0.5, p.z + d * 0.47, p.rot, '#7d7468'));
          // door + windows
          const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
          solid.push(box(1.1, 2.0, 0.16, p.x + fx * (d / 2), p.y + 1, p.z + fz * (d / 2), p.rot, '#4a3b2c'));
          solid.push(box(1.5, 1.1, 0.14, p.x + fx * (d / 2) - fz * (w * 0.28), p.y + h * 0.62, p.z + fz * (d / 2) + fx * (w * 0.28), p.rot, '#8fd6ef'));
          solid.push(box(1.5, 1.1, 0.14, p.x + fx * (d / 2) + fz * (w * 0.28), p.y + h * 0.62, p.z + fz * (d / 2) - fx * (w * 0.28), p.rot, '#8fd6ef'));
          break;
        }
        case 'tower': {
          const hh = p.hh;
          solid.push(box(1.1, hh * 2, 1.1, p.x - p.hw * 0.75, p.y + hh, p.z - p.hd * 0.75, p.rot, '#9aa0a6'));
          solid.push(box(1.1, hh * 2, 1.1, p.x + p.hw * 0.75, p.y + hh, p.z - p.hd * 0.75, p.rot, '#9aa0a6'));
          solid.push(box(1.1, hh * 2, 1.1, p.x - p.hw * 0.75, p.y + hh, p.z + p.hd * 0.75, p.rot, '#9aa0a6'));
          solid.push(box(1.1, hh * 2, 1.1, p.x + p.hw * 0.75, p.y + hh, p.z + p.hd * 0.75, p.rot, '#9aa0a6'));
          solid.push(box(p.hw * 2.2, 0.5, p.hd * 2.2, p.x, p.y + hh * 2, p.z, p.rot, '#7f8790'));
          solid.push(box(p.hw * 1.5, 2.6, p.hd * 1.5, p.x, p.y + hh * 2 + 1.5, p.z, p.rot, '#8d949c'));
          break;
        }
        case 'container': {
          const hue = (p.rot * 57) % 360;
          const c = new THREE.Color().setHSL(hue / 360, 0.45, 0.45);
          solid.push(box(p.hw * 2, p.hh * 2, p.hd * 2, p.x, p.y + p.hh, p.z, p.rot, '#' + c.getHexString()));
          solid.push(box(p.hw * 2.04, 0.16, p.hd * 2.04, p.x, p.y + p.hh * 2 - 0.08, p.z, p.rot, '#6b7280'));
          break;
        }
        case 'wall': {
          solid.push(box(p.hw * 2, p.hh * 2, p.hd * 2, p.x, p.y + p.hh, p.z, p.rot, '#bfb6a4'));
          solid.push(box(p.hw * 2.06, 0.2, p.hd * 2.6, p.x, p.y + p.hh * 2, p.z, p.rot, '#9c9382'));
          break;
        }
        case 'crate': {
          solid.push(box(p.hw * 2, p.hh * 2, p.hd * 2, p.x, p.y + p.hh, p.z, p.rot, '#b98a4e', 0.05));
          solid.push(box(p.hw * 2.04, 0.14, p.hd * 0.3, p.x, p.y + p.hh, p.z, p.rot, '#8d6432'));
          break;
        }
        case 'rock': {
          const s = p.size;
          solid.push(ico(s, s > 1.6 ? 1 : 0, p.x, p.y + s * 0.42, p.z, '#' + rockCol.getHexString(), 1.1, s * 0.7, 0.9, p.rot));
          break;
        }
        case 'tree': {
          const s = p.size || 1;
          const trunk = cyl(0.18 * s, 0.26 * s, 2.6 * s, 5, p.x, p.y + 1.3 * s, p.z, '#6b4b2a');
          foliage.push(trunk);
          const leafy = th.tree > 1.3 ? 'pine' : th.sand && th.grass === '#a89550' ? 'cactus' : 'round';
          if (leafy === 'pine') {
            foliage.push(cyl(0.05, 1.5 * s, 1.8 * s, 7, p.x, p.y + 2.9 * s, p.z, '#2f5d34'));
            foliage.push(cyl(0.05, 1.15 * s, 1.6 * s, 7, p.x, p.y + 4.0 * s, p.z, '#356a3a'));
            foliage.push(cyl(0.05, 0.8 * s, 1.4 * s, 7, p.x, p.y + 5.0 * s, p.z, '#3b7540'));
          } else if (leafy === 'cactus') {
            foliage.push(cyl(0.3 * s, 0.34 * s, 2.6 * s, 6, p.x, p.y + 2.4 * s, p.z, '#4f7a43'));
            foliage.push(cyl(0.16 * s, 0.18 * s, 1.1 * s, 5, p.x + 0.5 * s, p.y + 2.3 * s, p.z, '#4f7a43', 1.35));
            foliage.push(cyl(0.16 * s, 0.18 * s, 1.0 * s, 5, p.x - 0.5 * s, p.y + 2.6 * s, p.z, '#4f7a43', -1.3));
          } else {
            foliage.push(ico(1.5 * s, 0, p.x, p.y + 3.1 * s, p.z,
              th.id === 'jungle' ? '#2f7a3a' : th.id === 'stardust' ? '#2a4a58' : '#3d8a3f', 1.35, 0.95, 1.25, p.rot));
            foliage.push(ico(1.0 * s, 0, p.x + 0.7 * s, p.y + 3.7 * s, p.z - 0.4 * s, '#4a9a45', 1, 0.8, 1, p.rot));
          }
          break;
        }
        default: break;
      }
    }

    // three's merge needs a uniform attribute layout → normalise to non-indexed
    const merge = (list) => {
      if (!list.length) return null;
      const geos = list.map((g) => {
        const ng = g.index ? g.toNonIndexed() : g;
        if (ng !== g) g.dispose();
        return ng;
      });
      const out = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      return out;
    };
    const solidGeo = merge(solid);
    if (solidGeo) {
      const m = new THREE.Mesh(solidGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.castShadow = !this.lowQ;
      m.receiveShadow = true;
      m.name = 'structures';
      this.group.add(m);
      this.structures = m;
    }
    const folGeo = merge(foliage);
    if (folGeo) {
      const m = new THREE.Mesh(folGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      m.castShadow = !this.lowQ;
      m.name = 'foliage';
      this.group.add(m);
      this.foliage = m;
    }
    // ground detail decals: faint grass patches (single texture, blended)
    const decalTex = grassTex();
    if (decalTex) {
      const g = new THREE.PlaneGeometry(this.island.size, this.island.size);
      g.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshLambertMaterial({ map: decalTex, transparent: true, opacity: 0.22, depthWrite: false });
      decalTex.wrapS = decalTex.wrapT = THREE.RepeatWrapping;
      decalTex.repeat.set(10, 10);
      const decal = new THREE.Mesh(g, mat);
      decal.position.y = 0.22;
      decal.renderOrder = 1;
      this.group.add(decal);
      this.decal = decal;
    }
  }

  _buildZoneWall() {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true);
    const tex = zoneTex();
    if (tex) { tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(28, 1); }
    const mat = new THREE.MeshBasicMaterial({
      map: tex || null, color: tex ? 0xffffff : 0x66d9ff, transparent: true, opacity: 0.32,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
    this.zoneWall = new THREE.Mesh(geo, mat);
    this.zoneWall.renderOrder = 5;
    this.zoneWall.name = 'zoneWall';
    this.group.add(this.zoneWall);
    // ground ring marker
    const ringGeo = new THREE.RingGeometry(0.985, 1, 96);
    ringGeo.rotateX(-Math.PI / 2);
    this.zoneRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.zoneRing.renderOrder = 6;
    this.group.add(this.zoneRing);
  }

  _buildLights() {
    const th = this.theme;
    const hemi = new THREE.HemisphereLight(C(th.sky[1]), C(th.grass), th.id === 'stardust' ? 0.55 : 0.85);
    this.group.add(hemi);
    const sun = new THREE.DirectionalLight(C(th.sun), th.id === 'stardust' ? 0.9 : 1.5);
    sun.position.set(90, 150, 60);
    sun.castShadow = !this.lowQ;
    if (sun.shadow) {
      sun.shadow.mapSize.set(this.lowQ ? 1024 : 2048, this.lowQ ? 1024 : 2048);
      const cam = sun.shadow.camera;
      cam.left = -80; cam.right = 80; cam.top = 80; cam.bottom = -80; cam.near = 1; cam.far = 420;
      sun.shadow.bias = -0.0012;
      sun.shadow.normalBias = 0.03;
    }
    this.sun = sun;
    this.hemi = hemi;
    this.group.add(sun);
    this.group.add(sun.target);
  }

  // ── per-frame: follow the camera with sky/sun, animate water + zone wall ──
  update(dt, camera, zone) {
    this.t += dt;
    if (camera) {
      this.sky.position.set(camera.position.x, 0, camera.position.z);
      this.sunDisc.position.set(camera.position.x - 420, 520, camera.position.z - 900);
      // move the shadow frustum with the player for crisp nearby shadows
      if (this.sun) {
        const off = { x: 70, y: 130, z: 50 };
        this.sun.target.position.set(camera.position.x + 8, 0, camera.position.z + 6);
        this.sun.position.set(camera.position.x + off.x, off.y, camera.position.z + off.z);
      }
    }
    if (this.water) this.water.position.y = 0.06 + Math.sin(this.t * 0.55) * 0.07;
    if (zone && this.zoneWall) {
      const seg = 22;
      this.zoneWall.scale.set(zone.r, seg, zone.r);
      this.zoneWall.position.set(zone.x, seg / 2, zone.z);
      this.zoneWall.material.opacity = zone.dps > 0 ? 0.34 + Math.sin(this.t * 2.2) * 0.06 : 0.24;
      this.zoneRing.scale.set(zone.r, 1, zone.r);
      this.zoneRing.position.set(zone.x, 0.35, zone.z);
      this.zoneRing.material.opacity = zone.dps > 0 ? 0.5 + Math.sin(this.t * 3) * 0.12 : 0.35;
      // only show the wall when it's actually shrinking or hurting
      this.zoneWall.visible = true;
      this.zoneRing.visible = true;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }
}

// ── treasure-crate (airdrop) mesh, built on demand ──────────────────────────
export function makeAirdropCrate() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 1.3, 1.7),
    new THREE.MeshLambertMaterial({ color: 0xd9a12c })
  );
  body.position.y = 0.65;
  body.castShadow = true;
  g.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 1.8), new THREE.MeshLambertMaterial({ color: 0x8a5f14 }));
  lid.position.y = 1.36;
  g.add(lid);
  const flag = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
  flag.position.set(0.7, 2.1, 0);
  g.add(flag);
  const chute = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xe4572e, side: THREE.DoubleSide })
  );
  chute.position.y = 4.6;
  chute.scale.y = 0.8;
  g.add(chute);
  g.userData.chute = chute;
  return g;
}

export function makeGlooWall() {
  const tex = glooTex();
  const mat = new THREE.MeshLambertMaterial({
    map: tex || null, color: tex ? 0xffffff : 0x9fdcff, transparent: true, opacity: 0.86, side: THREE.DoubleSide,
  });
  const geo = new THREE.BoxGeometry(2.9, 2.7, 0.35);
  geo.translate(0, 1.35, 0);            // base sits on the ground → scaling shrinks upward
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false;
  return m;
}
