// ── House interiors: starter room → mansion, desk setup, furniture slots ────
import * as THREE from 'three';
import { houseById, PARTS, partById } from './data.js';
import { TEX, posterTexture, signTexture, woodSidingTexture } from './tex.js';

export const CELL_X = (i) => 400 + i * 90;

const WALL_STYLE = {
  room:    { type: 'floral' },
  studio:  { type: 'paint', color: 0xaebfca },
  flat:    { type: 'paint', color: 0xcfc6b4 },
  villa:   { type: 'wood',  color: '#a8845c' },
  mansion: { type: 'paint', color: 0x6d7f72 },
};

export function slotLayout(w, d, nFloor, nWall) {
  const out = [];
  for (let i = 0; i < nFloor; i++) {
    const side = i % 4;
    const t = Math.floor(i / 4) * 1.9 - 1.5;
    if (side === 0) out.push({ kind: 'floor', x: -w / 2 + 1.1, z: t, rot: Math.PI / 2 });
    else if (side === 1) out.push({ kind: 'floor', x: w / 2 - 1.1, z: t + 0.8, rot: -Math.PI / 2 });
    else if (side === 2) out.push({ kind: 'floor', x: t + 1.2, z: -d / 2 + 1.1, rot: 0 });
    else out.push({ kind: 'floor', x: t - 0.6, z: d / 2 - 1.3, rot: Math.PI });
  }
  for (let i = 0; i < nWall; i++) {
    const side = i % 4;
    const t = (Math.floor(i / 4) % 3) * 2.2 - 2.2;
    if (side === 0) out.push({ kind: 'wall', x: -w / 2 + 0.08, z: t, rot: Math.PI / 2 });
    else if (side === 1) out.push({ kind: 'wall', x: w / 2 - 0.08, z: t + 1, rot: -Math.PI / 2 });
    else if (side === 2) out.push({ kind: 'wall', x: t, z: -d / 2 + 0.08, rot: 0 });
    else out.push({ kind: 'wall', x: t + 1, z: d / 2 - 0.08, rot: Math.PI });
  }
  return out;
}

export function buildFurniture(id) {
  const g = new THREE.Group();
  const std = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const add = (m, x, y, z) => { m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  if (id === 'plant') {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.3, 10), std(0x8a4a2a)), 0, 0.15, 0);
    add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), std(0x3f7a3a, 1)), 0, 0.62, 0);
  } else if (id === 'posterA' || id === 'posterB') {
    const t = posterTexture(id === 'posterA' ? '🎬' : '🎸', id === 'posterA' ? '#31465e' : '#4a2438');
    add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), new THREE.MeshBasicMaterial({ map: t })), 0, 1.6, 0.02);
  } else if (id === 'lamp') {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1.4, 8), std(0x2a2a2a)), 0, 0.7, 0);
    const shade = add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.36, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xf5e3b0, emissive: 0xffd98a, emissiveIntensity: 0.8, side: THREE.DoubleSide })), 0, 1.5, 0);
  } else if (id === 'rug') {
    add(new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), new THREE.MeshStandardMaterial({ color: 0x7a4fd8, roughness: 1 })), 0, 0.02, 0).rotation.x = -Math.PI / 2;
  } else if (id === 'shelf') {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 0.3), std(0x6b4a2a)), 0, 0.8, 0);
    for (let i = 0; i < 4; i++) add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.2), std([0xd8452f, 0x3f7fd8, 0xe8b53a, 0x4aa34a][i])), -0.45 + i * 0.3, 1.15, 0.02);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.24), std(0xd8b23a, 0.4)), 0.4, 0.5, 0.02);
  } else if (id === 'sofa') {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.8), std(0x4a6b8f)), 0, 0.3, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.25), std(0x40608a)), 0, 0.72, -0.3);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.8), std(0x40608a)), -0.85, 0.45, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.8), std(0x40608a)), 0.85, 0.45, 0);
  } else if (id === 'tv') {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.5), std(0x3a2a1a)), 0, 0.2, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.95, 0.06), new THREE.MeshStandardMaterial({ color: 0x101418, emissive: 0x2a5aa0, emissiveIntensity: 0.7 })), 0, 1.05, 0);
  } else if (id === 'neon') {
    const t = signTexture('ON AIR', '#180a24', '#ff4fd8');
    add(new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.4), new THREE.MeshBasicMaterial({ map: t })), 0, 1.8, 0.02);
  } else if (id === 'arcade') {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.7), std(0xd8452f)), 0, 0.75, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.05), new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0x40e0d0, emissiveIntensity: 0.9 })), 0, 1.2, 0.36).rotation.x = -0.35;
  } else if (id === 'disco') {
    add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), new THREE.MeshStandardMaterial({ color: 0xdde6ee, metalness: 0.95, roughness: 0.15, emissive: 0x8fe3ff, emissiveIntensity: 0.25 })), 0, 2.3, 0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4), std(0x333)), 0, 2.75, 0);
  } else if (id === 'goldpc') {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.9, 0.8), new THREE.MeshStandardMaterial({ color: 0xd8b23a, metalness: 1, roughness: 0.25 })), 0, 0.45, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0x40ff80, emissiveIntensity: 1.2 })), 0, 0.7, 0);
  }
  return g;
}

// ── the PC desk setup (rebuilt when parts change) ──
export function buildSetup(parts) {
  const g = new THREE.Group();
  const std = (c, r = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const add = (m, x, y, z) => { m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };

  // desk
  const deskMat = std(parts.chair >= 3 ? 0x20262e : 0x7a5a36);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 0.8), deskMat), 0, 0.74, 0);
  [[-0.85, -0.35], [0.85, -0.35], [-0.85, 0.35], [0.85, 0.35]].forEach(([x, z]) => add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.74, 0.06), deskMat), x, 0.37, z));

  // chair by tier
  if (parts.chair >= 3) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.5), std(0x111418)), 0, 0.55, 0.75);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.12), std(0x111418)), 0, 1.1, 1.0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.45), std(0xd8452f)), 0, 0.62, 0.75);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), std(0x333)), 0, 0.28, 0.75);
  } else if (parts.chair >= 2) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), std(0x2a2f36)), 0, 0.5, 0.75);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.1), std(0x2a2f36)), 0, 0.95, 0.98);
  } else {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.42), std(0x8a6a42)), 0, 0.45, 0.75);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.08), std(0x8a6a42)), 0, 0.85, 0.95);
  }

  // monitor by tier
  const mw = parts.monitor >= 3 ? 1.25 : parts.monitor >= 2 ? 0.95 : 0.68;
  const mh = mw * 0.56;
  add(new THREE.Mesh(new THREE.BoxGeometry(mw, mh, 0.05), new THREE.MeshStandardMaterial({ color: 0x0c0e12, emissive: 0x3d6fd8, emissiveIntensity: 0.9 })), 0, 0.78 + mh / 2 + 0.12, -0.2);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.08), std(0x222)), 0, 0.84, -0.2);
  if (parts.monitor >= 3) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.04), new THREE.MeshStandardMaterial({ color: 0x0c0e12, emissive: 0x27407c, emissiveIntensity: 0.8 }));
    side.position.set(-0.95, 1.05, -0.15); side.rotation.y = 0.5; g.add(side);
  }

  // PC tower with RGB
  const tower = add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.55, 0.5), std(0x181c22, 0.4)), 0.75, 0.28, 0.1);
  if (parts.rgb >= 1) {
    const rgbMat = new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0xb44dff, emissiveIntensity: 1.6 });
    add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.45), rgbMat), 0.62, 0.28, 0.1);
    if (parts.rgb >= 2) {
      // wall panels
      for (let i = 0; i < 3; i++) {
        const p = add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.02), new THREE.MeshStandardMaterial({ color: 0x111, emissive: [0xff4fd8, 0x40e0d0, 0xe8b53a][i], emissiveIntensity: 1.4 })), -0.7 + i * 0.34, 1.7, -0.6);
        p.rotation.z = Math.PI / 4;
      }
    }
    if (parts.rgb >= 3) {
      const strip = new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0x40e0d0, emissiveIntensity: 2 });
      add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.03, 0.03), strip), 0, 0.72, -0.42);
      const strip2 = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.2, 0.03), strip), -1.1, 1.2, -0.5);
    }
  }

  // keyboard + mouse
  const kb = parts.keyboard >= 2 ? new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0xff4fd8, emissiveIntensity: 0.5 }) : std(0xd8d8d0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.15), kb), -0.05, 0.79, 0.15);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.1), std(0x222)), 0.3, 0.79, 0.15);

  // mic by tier
  if (parts.mic >= 1) {
    const micCol = parts.mic >= 3 ? 0x2a2a2a : parts.mic >= 2 ? 0x333 : 0x444;
    if (parts.mic >= 2) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.22, 10), std(micCol, 0.4)), -0.6, 1.05, 0.05);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), std(0x222)), -0.6, 0.85, 0.1).rotation.z = 0.5;
    } else {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.1), std(0x333)), -0.45, 1.02, 0.1);
    }
  }
  if (parts.webcam >= 1) add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.05), std(0x111)), 0, 0.78 + mh + 0.28, -0.18);
  return g;
}

// ── full interior ──
export function makeInterior(houseId) {
  const house = houseById(houseId);
  const idx = ['room', 'studio', 'flat', 'villa', 'mansion'].indexOf(houseId);
  const [w, d] = house.size;
  const h = houseId === 'mansion' ? 4.2 : 3;
  const ox = CELL_X(idx);
  const g = new THREE.Group();
  g.position.set(ox, 0, 0);
  const interact = [];

  const style = WALL_STYLE[houseId];
  let wallMat;
  if (style.type === 'floral') wallMat = new THREE.MeshStandardMaterial({ map: TEX.wallpaper, roughness: 0.95 });
  else if (style.type === 'wood') wallMat = new THREE.MeshStandardMaterial({ map: woodSidingTexture(style.color), roughness: 0.9 });
  else wallMat = new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.95 });
  const floorMat = houseId === 'room' ? new THREE.MeshStandardMaterial({ map: TEX.carpet, roughness: 1 }) : new THREE.MeshStandardMaterial({ map: TEX.woodFloor, roughness: 0.8 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = h; g.add(ceil);
  const mkWall = (ww, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, h), wallMat);
    m.position.set(x, h / 2, z); m.rotation.y = ry; m.receiveShadow = true; g.add(m);
  };
  mkWall(w, 0, -d / 2, 0);
  mkWall(w, 0, d / 2, Math.PI);
  mkWall(d, -w / 2, 0, Math.PI / 2);
  mkWall(d, w / 2, 0, -Math.PI / 2);

  // door (exit) on +z wall
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2, 0.1), new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.8 }));
  door.position.set(w / 4, 1, d / 2 - 0.04); g.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshStandardMaterial({ color: 0xd8b23a, metalness: 0.8 }));
  knob.position.set(w / 4 + 0.35, 1, d / 2 - 0.1); g.add(knob);
  interact.push({ id: 'exit', icon: '🚪', label: 'Go outside', x: ox + w / 4, z: d / 2 - 0.8, r: 1.6 });

  // fake window on -z wall
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), new THREE.MeshBasicMaterial({ color: 0x9fc6d8 }));
  win.position.set(-w / 4, 1.7, -d / 2 + 0.03); g.add(win);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.35, 0.06), new THREE.MeshStandardMaterial({ color: 0xe8e8e0 }));
  frame.position.set(-w / 4, 1.7, -d / 2 + 0.01); g.add(frame);

  // ceiling light
  const lampGlow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), new THREE.MeshBasicMaterial({ color: 0xfff2d0 }));
  lampGlow.rotation.x = Math.PI / 2; lampGlow.position.y = h - 0.02; g.add(lampGlow);
  const light = new THREE.PointLight(0xffe6b8, 22, 18, 1.8);
  light.position.set(0, h - 0.4, 0); g.add(light);
  if (houseId === 'mansion') {
    const chand = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd8b23a, metalness: 1, roughness: 0.2, emissive: 0xffd98a, emissiveIntensity: 0.7 }));
    chand.position.set(0, h - 0.8, 0); g.add(chand);
  }

  // desk zone (-z wall, right side)
  const deskX = w / 2 - 1.6, deskZ = -d / 2 + 0.7;
  const setup = buildSetup({ mic: 0, webcam: 0, cpu: 1, gpu: 1, ram: 1, monitor: 1, keyboard: 1, chair: 1, rgb: 0 });
  setup.position.set(deskX, 0, deskZ);
  g.add(setup);
  interact.push({ id: 'pc', icon: '💻', label: 'Use PC', x: ox + deskX, z: deskZ + 1.1, r: 1.8 });

  // bed (-x side)
  const bedX = -w / 2 + 1.1, bedZ = -d / 2 + 1.3;
  const bed = new THREE.Group();
  const bm = new THREE.MeshStandardMaterial({ color: 0x6b4a2a });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 2), bm); base.position.y = 0.2; bed.add(base);
  const mat2 = new THREE.Mesh(new THREE.BoxGeometry(1, 0.18, 1.9), new THREE.MeshStandardMaterial({ color: 0xd8d0c0 })); mat2.position.y = 0.44; bed.add(mat2);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, 1.1), new THREE.MeshStandardMaterial({ color: 0x3f7fd8 })); blanket.position.set(0, 0.5, -0.35); bed.add(blanket);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.4), new THREE.MeshStandardMaterial({ color: 0xf0f0e8 })); pillow.position.set(0, 0.56, 0.7); bed.add(pillow);
  const headb = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.1), bm); headb.position.set(0, 0.6, 1); bed.add(headb);
  bed.position.set(bedX, 0, bedZ);
  bed.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  g.add(bed);
  interact.push({ id: 'bed', icon: '🛏️', label: 'Sleep until morning', x: ox + bedX + 1, z: bedZ, r: 1.7 });

  // fridge (+x wall near door)
  const frX = w / 2 - 0.5, frZ = d / 2 - 1.4;
  const fridge = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.7), new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.4, metalness: 0.3 }));
  fridge.position.set(frX, 0.8, frZ); fridge.castShadow = true; g.add(fridge);
  interact.push({ id: 'fridge', icon: '🍔', label: 'Eat something', x: ox + frX - 0.7, z: frZ, r: 1.6 });

  // furniture slots
  const slotCounts = { room: [2, 2], studio: [4, 4], flat: [6, 6], villa: [8, 8], mansion: [11, 11] };
  const slots = slotLayout(w, d, ...slotCounts[houseId]);
  const placedGroup = new THREE.Group();
  g.add(placedGroup);

  const interior = {
    id: houseId, group: g, interact, slots, ox,
    deskSit: { x: ox + deskX, z: deskZ + 0.9, yaw: Math.PI }, // sit facing -z
    refreshSetup(parts) {
      g.remove(setupRef.current);
      const ns = buildSetup(parts);
      ns.position.set(deskX, 0, deskZ);
      g.add(ns);
      setupRef.current = ns;
    },
    refreshFurniture(placedMap) {
      placedGroup.clear();
      slots.forEach((s, i) => {
        const itemId = placedMap[i];
        if (!itemId) return;
        const m = buildFurniture(itemId);
        m.position.set(s.x, 0, s.z);
        m.rotation.y = s.rot;
        placedGroup.add(m);
      });
    },
  };
  const setupRef = { current: setup };
  return interior;
}
