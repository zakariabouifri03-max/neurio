// ── 3D Procedural Builders for The Long Drive 3D ─────────────────────────────
import * as THREE from 'three';
import {
  CAR_BY_ID,
  ENGINES,
  RADIATORS,
  ITEM_DEFS,
} from './data.js';
import {
  rustMetalTexture,
  corrugatedTexture,
  stuccoWallTexture,
  palaceMarbleTexture,
  woodPlankTexture,
  carShadowTexture,
  dashGaugeTexture,
  licensePlateTexture,
  signTexture,
  letterPaperTexture,
  glowTexture,
} from './tex.js';
import { mulberry32, rand, pick, clamp } from './util.js';

// Shared Materials
const matDarkMetal = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.65, metalness: 0.6 });
const matChrome = new THREE.MeshStandardMaterial({ color: 0xdbe4ee, roughness: 0.18, metalness: 0.92 });
const matRubber = new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.88, metalness: 0.05 });
const matGlass = new THREE.MeshStandardMaterial({
  color: 0xa5d8ff,
  roughness: 0.12,
  metalness: 0.1,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
});
const matSeatVinyl = new THREE.MeshStandardMaterial({ color: 0x3b281e, roughness: 0.78, metalness: 0.05 });
const matDashPlastic = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.75, metalness: 0.15 });
const matCopper = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.35, metalness: 0.82 });
const matWood = new THREE.MeshStandardMaterial({ color: 0x7c5333, roughness: 0.85, metalness: 0.05 });

function tagInteractable(obj, info) {
  obj.traverse((c) => {
    c.userData.interact = info;
  });
  obj.userData.interact = info;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 3D ITEM & CAR PART BUILDER (World Loot, Trunk Cargo & 1st-Person Viewmodel)
// ══════════════════════════════════════════════════════════════════════════════
export function buildItemMesh(item) {
  const g = new THREE.Group();
  const id = item.defId;

  if (id === 'jerrycan_gas') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.52, metalness: 0.45 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.46, 0.34), bodyMat);
    body.position.y = 0.23;
    body.castShadow = true;
    g.add(body);
    // Cross indentation bars
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.28, 0.22), matDarkMetal);
    cross.position.y = 0.22;
    g.add(cross);
    // Handle & spout
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.20), bodyMat);
    handle.position.set(0, 0.49, -0.03);
    g.add(handle);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.09, 10), matChrome);
    spout.position.set(0, 0.49, 0.11);
    spout.rotation.x = 0.35;
    g.add(spout);
  } else if (id === 'oil_can') {
    const oilMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.45, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 0.24), oilMat);
    body.position.y = 0.16;
    body.castShadow = true;
    g.add(body);
    const label = new THREE.Mesh(
      new THREE.BoxGeometry(0.19, 0.14, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 })
    );
    label.position.y = 0.16;
    g.add(label);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 8), matDarkMetal);
    cap.position.set(0, 0.35, 0.06);
    g.add(cap);
  } else if (id === 'water_jug') {
    const jugMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.25,
      metalness: 0.05,
      transparent: true,
      opacity: 0.82,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.38, 12), jugMat);
    body.position.y = 0.19;
    body.castShadow = true;
    g.add(body);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.06, 10),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 })
    );
    cap.position.y = 0.41;
    g.add(cap);
  } else if (id === 'canteen') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4d5d3b, roughness: 0.65, metalness: 0.2 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.11, 0.24, 10), bodyMat);
    body.scale.set(1, 1, 0.65);
    body.position.y = 0.12;
    g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 8), matDarkMetal);
    cap.position.y = 0.26;
    g.add(cap);
  } else if (id === 'salami') {
    const sMat = new THREE.MeshStandardMaterial({ color: 0x88291c, roughness: 0.65 });
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 10), sMat);
    stick.rotation.z = Math.PI / 2;
    stick.position.y = 0.05;
    g.add(stick);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.048, 0.048, 0.08, 10),
      new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.7 })
    );
    band.rotation.z = Math.PI / 2;
    band.position.y = 0.05;
    g.add(band);
  } else if (id === 'beans') {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.16, 12), matChrome);
    can.position.y = 0.08;
    g.add(can);
    const lbl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.067, 0.067, 0.10, 12),
      new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.6 })
    );
    lbl.position.y = 0.08;
    g.add(lbl);
  } else if (id === 'chocolate') {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.03, 0.10),
      new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.5 })
    );
    bar.position.y = 0.02;
    g.add(bar);
    const wrap = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.034, 0.104),
      new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.3, metalness: 0.6 })
    );
    wrap.position.set(-0.02, 0.02, 0);
    g.add(wrap);
  } else if (id === 'soda') {
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.048, 0.24, 10),
      new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.2, metalness: 0.1 })
    );
    bottle.position.y = 0.12;
    g.add(bottle);
    const lbl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.049, 0.049, 0.07, 10),
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 })
    );
    lbl.position.y = 0.10;
    g.add(lbl);
  } else if (id === 'medkit') {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.18, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 })
    );
    box.position.y = 0.09;
    g.add(box);
    const crossMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 });
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.04), crossMat);
    c1.position.y = 0.185;
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.12), crossMat);
    c2.position.y = 0.185;
    g.add(c1, c2);
  } else if (id === 'repair_kit') {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.16, 0.20),
      new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.45, metalness: 0.5 })
    );
    box.position.y = 0.08;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.04), matChrome);
    handle.position.y = 0.18;
    const wrench = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.045), matChrome);
    wrench.position.set(0, 0.17, 0.05);
    wrench.rotation.y = 0.35;
    g.add(box, handle, wrench);
  } else if (id === 'wire_brush') {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.035, 0.28), matWood);
    handle.position.y = 0.04;
    g.add(handle);
    const bristles = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.04, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.7, metalness: 0.8 })
    );
    bristles.position.set(0, 0.015, 0.07);
    g.add(bristles);
  } else if (id === 'spray_paint') {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.22, 12), matChrome);
    can.position.y = 0.11;
    g.add(can);
    const capCol = item.paintHex || '#c94a38';
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.047, 0.047, 0.07, 12),
      new THREE.MeshStandardMaterial({ color: capCol, roughness: 0.3 })
    );
    cap.position.y = 0.24;
    g.add(cap);
  } else if (id === 'siphon_hose') {
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(0.14, 0.022, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.6 })
    );
    torus.rotation.x = Math.PI / 2;
    torus.position.y = 0.03;
    g.add(torus);
  } else if (id === 'revolver') {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, 0.24), matChrome);
    barrel.position.set(0, 0.12, 0.06);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.065, 8), matDarkMetal);
    cyl.rotation.x = Math.PI / 2;
    cyl.position.set(0, 0.11, -0.02);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.11, 0.05), matWood);
    grip.position.set(0, 0.05, -0.07);
    grip.rotation.x = -0.3;
    g.add(barrel, cyl, grip);
  } else if (id === 'binoculars') {
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.16, 10), matDarkMetal);
    b1.rotation.x = Math.PI / 2;
    b1.position.set(-0.045, 0.06, 0);
    const b2 = b1.clone();
    b2.position.x = 0.045;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.06), matDarkMetal);
    bridge.position.set(0, 0.06, 0);
    g.add(b1, b2, bridge);
  } else if (id === 'part_wheel') {
    const wg = buildWheelAssembly(0.34, item.condition ?? 0.85);
    wg.rotation.z = Math.PI / 2;
    wg.position.y = 0.14;
    g.add(wg);
  } else if (id === 'part_engine_std' || id === 'part_engine_i4' || id === 'part_engine_diesel' || id === 'part_engine_v8') {
    const engId = item.engineId || (id === 'part_engine_v8' ? 'eng_v8_5000' : id === 'part_engine_diesel' ? 'eng_diesel_6500' : id === 'part_engine_i4' ? 'eng_i4_1800' : 'eng_i4_1200');
    const eg = buildEngineBlockMesh(engId, item.condition ?? 0.85);
    eg.position.y = 0.22;
    g.add(eg);
  } else if (id === 'part_radiator_std' || id === 'part_radiator_heavy') {
    const isHeavy = id === 'part_radiator_heavy';
    const rg = buildRadiatorCoreMesh(isHeavy ? 'rad_heavy' : 'rad_std', item.condition ?? 0.85);
    rg.position.y = 0.22;
    g.add(rg);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), matWood);
    box.position.y = 0.12;
    g.add(box);
  }

  return g;
}

export function buildWheelAssembly(radius = 0.34, condition = 0.85) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.22, 18), matRubber);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);

  const rimMat = condition > 0.7 ? matChrome : matDarkMetal;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, 0.23, 14), rimMat);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.26, radius * 0.26, 0.25, 10), matChrome);
  cap.rotation.z = Math.PI / 2;
  g.add(cap);

  return g;
}

export function buildEngineBlockMesh(engineId = 'eng_i4_1200', condition = 0.85) {
  const g = new THREE.Group();
  const isV8 = engineId === 'eng_v8_5000';
  const isDiesel = engineId === 'eng_diesel_6500';
  const blockMat = new THREE.MeshStandardMaterial({
    color: isV8 ? 0xb91c1c : isDiesel ? 0x0369a1 : 0x475569,
    roughness: clamp(0.85 - condition * 0.45, 0.25, 0.9),
    metalness: 0.7,
  });

  // Main engine block
  const block = new THREE.Mesh(
    new THREE.BoxGeometry(isV8 ? 0.52 : isDiesel ? 0.48 : 0.36, isDiesel ? 0.42 : 0.36, isDiesel ? 0.62 : 0.52),
    blockMat
  );
  block.castShadow = true;
  g.add(block);

  if (isV8) {
    // Dual angled V8 cylinder banks + chrome air scoop
    const bankL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.48), matChrome);
    bankL.position.set(-0.18, 0.14, 0);
    bankL.rotation.z = 0.45;
    const bankR = bankL.clone();
    bankR.position.x = 0.18;
    bankR.rotation.z = -0.45;
    const scoop = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.11, 14), matChrome);
    scoop.position.set(0, 0.26, 0);
    g.add(bankL, bankR, scoop);
  } else if (isDiesel) {
    // Heavy 6-cylinder Bus Turbo-Diesel manifold & turbo snail
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.56), matChrome);
    cover.position.set(0, 0.24, 0);
    const turbo = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.14, 12), matChrome);
    turbo.rotation.z = Math.PI / 2;
    turbo.position.set(0.22, 0.18, 0.12);
    g.add(cover, turbo);
  } else {
    // Inline-4 valve cover + round air filter
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.10, 0.46), matChrome);
    cover.position.set(0, 0.22, 0);
    const airFilter = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 12), matDarkMetal);
    airFilter.position.set(0.08, 0.28, 0.04);
    g.add(cover, airFilter);
  }

  // Yellow/Orange Oil Filler Cap on top of engine
  const oilCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.038, 0.038, 0.05, 10),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3 })
  );
  oilCap.position.set(-0.06, 0.29, 0.16);
  oilCap.name = 'oilCap';
  g.add(oilCap);

  // Belt pulley at front (+Z)
  const pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), matDarkMetal);
  pulley.rotation.x = Math.PI / 2;
  pulley.position.set(0, -0.04, 0.28);
  g.add(pulley);

  return g;
}

export function buildRadiatorCoreMesh(radiatorId = 'rad_std', condition = 0.85) {
  const g = new THREE.Group();
  const isHeavy = radiatorId === 'rad_heavy';
  const coreMat = isHeavy
    ? matCopper
    : new THREE.MeshStandardMaterial({
        color: radiatorId === 'rad_rusty' ? 0x78350f : 0x334155,
        roughness: 0.75,
        metalness: 0.65,
      });

  const core = new THREE.Mesh(new THREE.BoxGeometry(isHeavy ? 0.68 : 0.56, 0.42, 0.09), coreMat);
  core.castShadow = true;
  g.add(core);

  const topTank = new THREE.Mesh(new THREE.BoxGeometry(isHeavy ? 0.70 : 0.58, 0.07, 0.11), matDarkMetal);
  topTank.position.y = 0.23;
  g.add(topTank);

  // Silver Radiator Pressure Cap on top
  const radCap = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.05, 10), matChrome);
  radCap.position.set(0, 0.28, 0);
  radCap.name = 'radCap';
  g.add(radCap);

  return g;
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. ARTICULATED 3D VEHICLE BUILDER (Doors, Hood, Trunk, Engine Bay, Cockpit)
// ══════════════════════════════════════════════════════════════════════════════
export function buildVehicle(carState) {
  const arch = CAR_BY_ID[carState.archId] || CAR_BY_ID.sedan;
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const W = arch.width;
  const L = arch.length;
  const cy = arch.chassisY;
  const cabH = arch.cabinHeight;
  const isBus = arch.id === 'bus' || arch.id === 'megabus';

  // ── Underbody Ambient Occlusion Contact Shadow ──
  const aoShadowMat = new THREE.MeshBasicMaterial({
    map: carShadowTexture(),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const aoShadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.42, L * 1.24), aoShadowMat);
  aoShadow.rotation.x = -Math.PI / 2;
  aoShadow.position.set(0, 0.03, 0);
  root.add(aoShadow);

  const paintMats = [];
  const makePaintMat = () => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(carState.paintHex || arch.defaultColor),
      map: rustMetalTexture(1 - (carState.condition ?? 0.65)),
      roughness: clamp(0.75 - (carState.condition ?? 0.65) * 0.48, 0.22, 0.85),
      metalness: clamp(0.18 + (carState.condition ?? 0.65) * 0.35, 0.15, 0.6),
    });
    paintMats.push(m);
    return m;
  };
  const bodyPaintMat = makePaintMat();

  // ── Underbody Frame & Floor Pan ──
  const floorPan = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.14, L * 0.94), matDarkMetal);
  floorPan.position.set(0, cy, 0);
  floorPan.castShadow = true;
  floorPan.receiveShadow = true;
  bodyGroup.add(floorPan);

  // ── Front Fenders (Left & Right of Engine Bay) ──
  const frontLen = L * 0.31;
  const frontZ = L * 0.5 - frontLen * 0.5;
  const fenderH = 0.50;

  const fenderL = new THREE.Mesh(new THREE.BoxGeometry(0.22, fenderH, frontLen), bodyPaintMat);
  fenderL.position.set(W * 0.5 - 0.11, cy + fenderH * 0.5 + 0.04, frontZ);
  fenderL.castShadow = true;
  const fenderR = fenderL.clone();
  fenderR.position.x = -(W * 0.5 - 0.11);
  bodyGroup.add(fenderL, fenderR);

  // Front Grille & Chrome Slat Bars
  const grille = new THREE.Mesh(new THREE.BoxGeometry(W - 0.12, 0.36, 0.10), matDarkMetal);
  grille.position.set(0, cy + 0.28, L * 0.5 - 0.04);
  bodyGroup.add(grille);
  for (let s = -2; s <= 2; s++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(W - 0.22, 0.025, 0.12), matChrome);
    slat.position.set(0, cy + 0.28 + s * 0.055, L * 0.5 - 0.035);
    bodyGroup.add(slat);
  }

  // Dual Exhaust Tailpipes at Rear (-Z)
  const exhL = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.36, 10), matChrome);
  exhL.rotation.x = Math.PI / 2;
  exhL.position.set(W * 0.28, cy - 0.03, -L * 0.5 - 0.06);
  const exhR = exhL.clone();
  exhR.position.x = -W * 0.28;
  bodyGroup.add(exhL, exhR);

  // Side Chrome Trim Molding Strips & Wing Mirrors
  const trimL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, L * 0.92), matChrome);
  trimL.position.set(W * 0.5 + 0.005, cy + 0.30, 0);
  const trimR = trimL.clone();
  trimR.position.x = -(W * 0.5 + 0.005);
  bodyGroup.add(trimL, trimR);

  // Chrome Bumpers
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, 0.13, 0.14), matChrome);
  frontBumper.position.set(0, cy + 0.08, L * 0.5 + 0.04);
  const rearBumper = frontBumper.clone();
  rearBumper.position.z = -(L * 0.5 + 0.04);
  bodyGroup.add(frontBumper, rearBumper);

  // License plates
  const plateMat = new THREE.MeshStandardMaterial({ map: licensePlateTexture('TLD-1979'), roughness: 0.4 });
  const plateF = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.02), plateMat);
  plateF.position.set(0, cy + 0.08, L * 0.5 + 0.115);
  const plateR = plateF.clone();
  plateR.position.z = -(L * 0.5 + 0.115);
  bodyGroup.add(plateF, plateR);

  // ── Rear Quarter Panels & Trunk Well ──
  const rearLen = arch.id === 'pickup' ? L * 0.38 : L * 0.28;
  const rearZ = -(L * 0.5 - rearLen * 0.5);
  const qPanelL = new THREE.Mesh(new THREE.BoxGeometry(0.20, fenderH, rearLen), bodyPaintMat);
  qPanelL.position.set(W * 0.5 - 0.10, cy + fenderH * 0.5 + 0.04, rearZ);
  qPanelL.castShadow = true;
  const qPanelR = qPanelL.clone();
  qPanelR.position.x = -(W * 0.5 - 0.10);
  const rearBackWall = new THREE.Mesh(new THREE.BoxGeometry(W - 0.12, fenderH * 0.85, 0.12), bodyPaintMat);
  rearBackWall.position.set(0, cy + fenderH * 0.42 + 0.04, -L * 0.5 + 0.06);
  bodyGroup.add(qPanelL, qPanelR, rearBackWall);

  // External Fuel Filler Cap on Rear-Left Quarter Panel
  const fuelCapMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.065, 0.04, 12),
    new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.35, metalness: 0.6 })
  );
  fuelCapMesh.rotation.z = Math.PI / 2;
  fuelCapMesh.position.set(W * 0.5 + 0.01, cy + 0.44, rearZ + 0.12);
  bodyGroup.add(fuelCapMesh);
  tagInteractable(fuelCapMesh, { type: 'car_fuel_cap', car: carState });

  // ── Cabin Pillars, Roof & Windshield ──
  const cabLen = L - frontLen - rearLen;
  const cabCenterZ = (L * 0.5 - frontLen) - cabLen * 0.5;
  const beltY = cy + fenderH + 0.04;
  const roofY = beltY + cabH;

  // Firewall between engine bay & cabin
  const firewall = new THREE.Mesh(new THREE.BoxGeometry(W - 0.16, fenderH + 0.08, 0.10), matDarkMetal);
  firewall.position.set(0, cy + fenderH * 0.5 + 0.04, L * 0.5 - frontLen);
  bodyGroup.add(firewall);

  // Roof panel
  const roofLen = isBus ? L * 0.94 : arch.id === 'pickup' || arch.id === 'truck' ? cabLen * 0.78 : cabLen * 0.86;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.11, roofLen), bodyPaintMat);
  roof.position.set(0, roofY, isBus ? 0 : cabCenterZ);
  roof.castShadow = true;
  bodyGroup.add(roof);

  // Side-View Wing Mirrors & Windshield Wipers
  const mirrorL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.06), matChrome);
  mirrorL.position.set(W * 0.5 + 0.08, beltY + 0.12, cabCenterZ + roofLen * 0.44);
  const mirrorR = mirrorL.clone();
  mirrorR.position.x = -(W * 0.5 + 0.08);
  bodyGroup.add(mirrorL, mirrorR);

  // ── Archetype-Specific 3D Sculpted Features (Buses, Muscle V8, Cargo Truck, Camper Van, Buggy) ──
  if (isBus) {
    const busSideH = 0.96;
    const sideWallL = new THREE.Mesh(new THREE.BoxGeometry(0.14, busSideH, L * 0.68), bodyPaintMat);
    sideWallL.position.set(W * 0.5 - 0.07, cy + busSideH * 0.5 + 0.04, -0.15);
    const sideWallR = sideWallL.clone();
    sideWallR.position.x = -(W * 0.5 - 0.07);
    bodyGroup.add(sideWallL, sideWallR);

    // Classic cream/white horizontal bus stripe + lower chrome skirt
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xfef9c3, roughness: 0.35 });
    const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, L * 0.95), stripeMat);
    stripeL.position.set(W * 0.5 - 0.06, cy + 0.72, 0);
    const stripeR = stripeL.clone();
    stripeR.position.x = -(W * 0.5 - 0.06);
    bodyGroup.add(stripeL, stripeR);

    // Panoramic bus side windows + window pillars
    const winStep = 1.25;
    for (let wz = -L * 0.36; wz <= L * 0.28; wz += winStep) {
      const winPillarL = new THREE.Mesh(new THREE.BoxGeometry(0.09, cabH, 0.12), bodyPaintMat);
      winPillarL.position.set(W * 0.46, beltY + cabH * 0.5, wz);
      const winPillarR = winPillarL.clone();
      winPillarR.position.x = -W * 0.46;
      const winGlassL = new THREE.Mesh(new THREE.BoxGeometry(0.03, cabH * 0.84, winStep - 0.16), matGlass);
      winGlassL.position.set(W * 0.46, beltY + cabH * 0.48, wz + winStep * 0.48);
      const winGlassR = winGlassL.clone();
      winGlassR.position.x = -W * 0.46;
      bodyGroup.add(winPillarL, winPillarR, winGlassL, winGlassR);
    }

    // Bus Rooftop AC Unit, Ventilation Hatches & Illuminated Destination Board
    const acPod = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.24, 2.2), matChrome);
    acPod.position.set(0, roofY + 0.14, 0);
    bodyGroup.add(acPod);
    for (const hz of [-L * 0.28, L * 0.28]) {
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.14, 0.78), matDarkMetal);
      hatch.position.set(0, roofY + 0.08, hz);
      bodyGroup.add(hatch);
    }
    const destLabel = arch.id === 'megabus' ? 'ROYAL LINER 5000KM' : '5000 KM EXPRESS';
    const destBoard = new THREE.Mesh(
      new THREE.BoxGeometry(1.75, 0.32, 0.08),
      new THREE.MeshStandardMaterial({
        map: signTexture(destLabel, '#0f172a', '#fde047'),
        emissive: new THREE.Color(0xfef08a),
        emissiveIntensity: 0.45,
      })
    );
    destBoard.position.set(0, roofY - 0.15, L * 0.47);
    bodyGroup.add(destBoard);

    // Passenger Seat Rows & Yellow Handrails inside the Bus
    for (let sz = -L * 0.32; sz <= L * 0.20; sz += 1.05) {
      const rowL = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.58, 0.48), matSeatVinyl);
      rowL.position.set(W * 0.27, cy + 0.44, sz);
      const rowR = rowL.clone();
      rowR.position.x = -W * 0.27;
      bodyGroup.add(rowL, rowR);
    }
  } else if (arch.id === 'muscle') {
    // Hood V8 Power-Scoop & Rear Aerodynamic Spoiler Wing
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.14, 0.75), matDarkMetal);
    scoop.position.set(0, beltY + 0.08, frontZ);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.06, 0.24), matDarkMetal);
    wing.position.set(0, beltY + 0.22, -L * 0.46);
    const strutL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.20, 0.12), matDarkMetal);
    strutL.position.set(W * 0.32, beltY + 0.12, -L * 0.46);
    const strutR = strutL.clone();
    strutR.position.x = -W * 0.32;
    bodyGroup.add(scoop, wing, strutL, strutR);
  } else if (arch.id === 'truck' || arch.id === 'pickup') {
    // Front Steel Bullbar, Cab Rollbar with Spotlights & Wooden Cargo Bed Sides
    const bullbar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.85, 0.42, 0.08), matDarkMetal);
    bullbar.position.set(0, cy + 0.32, L * 0.5 + 0.12);
    const rollbar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, W * 0.88, 10), matDarkMetal);
    rollbar.rotation.z = Math.PI / 2;
    rollbar.position.set(0, roofY + 0.14, cabCenterZ - roofLen * 0.45);
    const bedSideL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.38, rearLen * 0.92), matWood);
    bedSideL.position.set(W * 0.46, beltY + 0.18, rearZ);
    const bedSideR = bedSideL.clone();
    bedSideR.position.x = -W * 0.46;
    bodyGroup.add(bullbar, rollbar, bedSideL, bedSideR);
  } else if (arch.id === 'van') {
    // Rooftop Expedition Rack with Spare Wheel
    const rack = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.08, roofLen * 0.68), matDarkMetal);
    rack.position.set(0, roofY + 0.09, cabCenterZ - 0.2);
    const roofSpare = buildWheelAssembly(0.30, 0.9);
    roofSpare.rotation.z = Math.PI / 2;
    roofSpare.position.set(0, roofY + 0.22, cabCenterZ - 0.3);
    bodyGroup.add(rack, roofSpare);
  } else if (arch.id === 'buggy') {
    // Exposed Tubular Roll-Cage & Roof LED Lightbar
    const ledBar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.68, 0.08, 0.10), matChrome);
    ledBar.position.set(0, roofY + 0.08, cabCenterZ + roofLen * 0.45);
    bodyGroup.add(ledBar);
  }

  // 4 Cabin Pillars (A-pillars & C-pillars)
  const pillarGeo = new THREE.BoxGeometry(0.08, cabH + 0.06, 0.08);
  const pFL = new THREE.Mesh(pillarGeo, bodyPaintMat);
  pFL.position.set(W * 0.43, beltY + cabH * 0.5, cabCenterZ + roofLen * 0.48);
  const pFR = pFL.clone();
  pFR.position.x = -W * 0.43;
  const pRL = pFL.clone();
  pRL.position.z = cabCenterZ - roofLen * 0.48;
  const pRR = pFR.clone();
  pRR.position.z = cabCenterZ - roofLen * 0.48;
  bodyGroup.add(pFL, pFR, pRL, pRR);

  // Front & Rear Windshields
  const wsFront = new THREE.Mesh(new THREE.BoxGeometry(W * 0.84, cabH * 0.92, 0.03), matGlass);
  wsFront.position.set(0, beltY + cabH * 0.48, cabCenterZ + roofLen * 0.50);
  wsFront.rotation.x = -0.22;
  const wsRear = new THREE.Mesh(new THREE.BoxGeometry(W * 0.82, cabH * 0.88, 0.03), matGlass);
  wsRear.position.set(0, beltY + cabH * 0.48, cabCenterZ - roofLen * 0.50);
  wsRear.rotation.x = 0.20;
  bodyGroup.add(wsFront, wsRear);

  // ── Hinged Left & Right Doors ──
  // Note: Driver sits on Left side (+X in our car local coordinate system where +Z is forward, +X is Left, -X is Right)
  // Wait: in Three.js right-handed coords: if +Z is forward and +Y is up, then cross(up, forward) = (+X) is LEFT!
  // Let's verify: thumb = +X (Left), index = +Y (Up), middle = +Z (Forward). Yes! +X is Left (Driver's side), -X is Right (Passenger side).
  const doorLen = cabLen * 0.72;
  const doorH = fenderH;

  const doorLGroup = new THREE.Group();
  doorLGroup.position.set(W * 0.5 - 0.06, cy + 0.06, cabCenterZ + doorLen * 0.5); // hinge at front of door
  const doorLPanel = new THREE.Mesh(new THREE.BoxGeometry(0.09, doorH, doorLen), bodyPaintMat);
  doorLPanel.position.set(0, doorH * 0.5, -doorLen * 0.5);
  doorLPanel.castShadow = true;
  const doorLHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.14), matChrome);
  doorLHandle.position.set(0.05, doorH * 0.78, -doorLen * 0.82);
  const doorLFrame = new THREE.Mesh(new THREE.BoxGeometry(0.05, cabH * 0.86, doorLen * 0.92), matGlass);
  doorLFrame.position.set(-0.02, doorH + cabH * 0.42, -doorLen * 0.5);
  doorLGroup.add(doorLPanel, doorLHandle, doorLFrame);
  bodyGroup.add(doorLGroup);
  tagInteractable(doorLGroup, { type: 'car_door', side: 'L', car: carState });

  const doorRGroup = new THREE.Group();
  doorRGroup.position.set(-(W * 0.5 - 0.06), cy + 0.06, cabCenterZ + doorLen * 0.5);
  const doorRPanel = doorLPanel.clone();
  const doorRHandle = doorLHandle.clone();
  doorRHandle.position.x = -0.05;
  const doorRFrame = doorLFrame.clone();
  doorRGroup.add(doorRPanel, doorRHandle, doorRFrame);
  bodyGroup.add(doorRGroup);
  tagInteractable(doorRGroup, { type: 'car_door', side: 'R', car: carState });

  // ── Hinged Front Hood (Bonnet) ──
  const hoodGroup = new THREE.Group();
  // Hinge near windshield, lifts up from the front
  hoodGroup.position.set(0, beltY, L * 0.5 - frontLen + 0.05);
  const hoodPanel = new THREE.Mesh(new THREE.BoxGeometry(W - 0.36, 0.07, frontLen - 0.08), bodyPaintMat);
  hoodPanel.position.set(0, 0.02, (frontLen - 0.08) * 0.5);
  hoodPanel.castShadow = true;
  hoodGroup.add(hoodPanel);
  bodyGroup.add(hoodGroup);
  tagInteractable(hoodGroup, { type: 'car_hood', car: carState });

  // ── Hinged Rear Trunk Lid (Boot) ──
  const trunkGroup = new THREE.Group();
  trunkGroup.position.set(0, beltY, -(L * 0.5 - rearLen + 0.04));
  const trunkPanel = new THREE.Mesh(
    new THREE.BoxGeometry(W - 0.36, 0.07, rearLen - 0.08),
    arch.id === 'pickup' ? matWood : bodyPaintMat
  );
  trunkPanel.position.set(0, 0.02, -(rearLen - 0.08) * 0.5);
  trunkPanel.castShadow = true;
  trunkGroup.add(trunkPanel);
  bodyGroup.add(trunkGroup);
  tagInteractable(trunkGroup, { type: 'car_trunk', car: carState });

  // ── 3D Engine Bay (Under the Hood) ──
  const engineBay = new THREE.Group();
  engineBay.position.set(0, cy + 0.28, frontZ);
  bodyGroup.add(engineBay);

  const engineMount = new THREE.Group();
  engineMount.position.set(0, 0.02, -0.10);
  engineBay.add(engineMount);

  const radiatorMount = new THREE.Group();
  radiatorMount.position.set(0, 0.02, frontLen * 0.38);
  engineBay.add(radiatorMount);

  // 12V Car Battery in Engine Bay
  const batteryMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.20, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 })
  );
  batteryMesh.position.set(W * 0.24, 0.02, -0.16);
  engineBay.add(batteryMesh);

  // ── 3D Trunk Cargo Bay (6-8 Physical Mount Slots) ──
  const cargoMountGroup = new THREE.Group();
  cargoMountGroup.position.set(0, cy + 0.10, rearZ);
  bodyGroup.add(cargoMountGroup);

  // Invisible interactive hit-box inside the trunk floor so player can look at trunk bay and press [F]/[G] to stow
  const trunkBayHitbox = new THREE.Mesh(
    new THREE.BoxGeometry(W - 0.38, 0.34, rearLen - 0.16),
    new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.9 })
  );
  trunkBayHitbox.position.set(0, 0.05, 0);
  cargoMountGroup.add(trunkBayHitbox);
  tagInteractable(trunkBayHitbox, { type: 'car_trunk_bay', car: carState });

  // ── 3D Interior Cockpit (Seats, Dashboard, Gauges, Steering Wheel, Radio, Handbrake) ──
  const driverX = W * 0.23; // Left side (+X)
  const seatZ = cabCenterZ - 0.05;

  // Driver & Passenger Seats
  const makeSeat = (xPos, isDriver) => {
    const sg = new THREE.Group();
    sg.position.set(xPos, cy + 0.10, seatZ);
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.50), matSeatVinyl);
    cushion.position.y = 0.10;
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.11), matSeatVinyl);
    backrest.position.set(0, 0.42, -0.20);
    backrest.rotation.x = -0.12;
    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.09), matSeatVinyl);
    headrest.position.set(0, 0.76, -0.24);
    sg.add(cushion, backrest, headrest);
    if (isDriver) {
      tagInteractable(sg, { type: 'car_seat', car: carState });
    }
    return sg;
  };
  const seatDriver = makeSeat(driverX, true);
  const seatPass = makeSeat(-driverX, false);
  bodyGroup.add(seatDriver, seatPass);

  // Dashboard Beam
  const dashZ = cabCenterZ + cabLen * 0.36;
  const dashY = beltY - 0.05;
  const dash = new THREE.Mesh(new THREE.BoxGeometry(W - 0.20, 0.26, 0.34), matDashPlastic);
  dash.position.set(0, dashY, dashZ);
  bodyGroup.add(dash);

  // Illuminated Gauge Cluster on Driver's Side (+X)
  const gaugeTex = dashGaugeTexture();
  const gaugeFaceMat = new THREE.MeshStandardMaterial({
    map: gaugeTex,
    emissive: new THREE.Color(0xfffbeb),
    emissiveMap: gaugeTex,
    emissiveIntensity: 0.55,
    roughness: 0.3,
  });
  const gaugeCluster = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.20), gaugeFaceMat);
  // Face towards the driver (-Z direction, since driver looks toward +Z)
  gaugeCluster.rotation.y = Math.PI;
  gaugeCluster.position.set(driverX, dashY + 0.04, dashZ - 0.172);
  bodyGroup.add(gaugeCluster);

  // 3D Gauge Needles (Speed, Temp, Fuel)
  const makeNeedle = (offsetX, color = 0xef4444, len = 0.058) => {
    const pivot = new THREE.Group();
    // Note: in gaugeCluster's frame (facing -Z), left on texture is +X in world
    pivot.position.set(driverX + offsetX, dashY + 0.04, dashZ - 0.175);
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, len, 0.006),
      new THREE.MeshBasicMaterial({ color })
    );
    bar.position.y = len * 0.42;
    pivot.add(bar);
    bodyGroup.add(pivot);
    return pivot;
  };
  const dashNeedles = {
    speed: makeNeedle(0.105, 0xef4444, 0.062),
    temp: makeNeedle(-0.055, 0xfbbf24, 0.045),
    fuel: makeNeedle(-0.165, 0x38bdf8, 0.038),
  };

  // Interactive Car Radio in Center Console
  const radioMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.10, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: new THREE.Color(0x10b981),
      emissiveIntensity: 0.45,
      roughness: 0.35,
    })
  );
  radioMesh.position.set(0, dashY + 0.02, dashZ - 0.16);
  bodyGroup.add(radioMesh);
  tagInteractable(radioMesh, { type: 'car_radio', car: carState });

  // Steering Column & Rotating 3D Steering Wheel
  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(driverX, dashY + 0.03, dashZ - 0.30);
  steeringWheel.rotation.x = 0.32;
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.020, 10, 24), matRubber);
  const spokeH = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.028, 0.02), matChrome);
  const spokeV = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.17, 0.02), matChrome);
  spokeV.position.y = -0.08;
  const hornPad = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), matDashPlastic);
  hornPad.rotation.x = Math.PI / 2;
  steeringWheel.add(wheelRim, spokeH, spokeV, hornPad);
  bodyGroup.add(steeringWheel);
  tagInteractable(steeringWheel, { type: 'car_seat', car: carState });

  // Handbrake Lever & Gear Shifter between seats
  const handbrakeLever = new THREE.Group();
  handbrakeLever.position.set(0, cy + 0.16, seatZ + 0.12);
  const hbRod = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.32, 8), matDarkMetal);
  hbRod.rotation.x = Math.PI / 3;
  hbRod.position.set(0, 0.10, 0.10);
  handbrakeLever.add(hbRod);
  bodyGroup.add(handbrakeLever);

  // ── Headlights (Lenses, Volumetric Cones & Real SpotLight) + Taillights ──
  const headLampMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xfff6cc),
    emissiveIntensity: 0,
    roughness: 0.1,
  });
  const tailLampMat = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    emissive: new THREE.Color(0xef4444),
    emissiveIntensity: 0.15,
    roughness: 0.3,
  });

  const hlL = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14), headLampMat);
  hlL.rotation.x = Math.PI / 2;
  hlL.position.set(W * 0.35, cy + 0.32, L * 0.5 + 0.01);
  const hlR = hlL.clone();
  hlR.position.x = -W * 0.35;
  bodyGroup.add(hlL, hlR);

  // Volumetric light cones (visible when headlights are ON)
  const coneGeo = new THREE.ConeGeometry(1.6, 12.0, 16, 1, true);
  coneGeo.translate(0, -6.0, 0);
  coneGeo.rotateX(-Math.PI / 2);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xfff3c4,
    transparent: true,
    opacity: 0.11,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const beamL = new THREE.Mesh(coneGeo, coneMat);
  beamL.position.copy(hlL.position);
  beamL.visible = false;
  const beamR = beamL.clone();
  beamR.position.copy(hlR.position);
  beamR.visible = false;
  bodyGroup.add(beamL, beamR);

  // Real Three.js SpotLight for illuminating the dark desert road at night
  const headlightSpot = new THREE.SpotLight(0xfff4d2, 0, 95, Math.PI / 3.4, 0.48, 1.1);
  headlightSpot.position.set(0, cy + 0.45, L * 0.5 + 0.1);
  headlightSpot.target.position.set(0, cy - 0.3, L * 0.5 + 32);
  bodyGroup.add(headlightSpot);
  bodyGroup.add(headlightSpot.target);

  // Rear Taillights
  const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.11, 0.04), tailLampMat);
  tlL.position.set(W * 0.34, cy + 0.32, -L * 0.5 - 0.01);
  const tlR = tlL.clone();
  tlR.position.x = -W * 0.34;
  bodyGroup.add(tlL, tlR);

  // ── 4 Wheel Hubs & Detachable Tire Assemblies + Sculpted Wheel Arch Flares ──
  const wheelRadius = isBus ? 0.44 : arch.id === 'truck' ? 0.40 : 0.34;
  const halfWB = arch.wheelBase * 0.5;
  const halfTrack = arch.trackWidth * 0.5;
  const wheelCoords = [
    { x: halfTrack, y: wheelRadius, z: halfWB, idx: 0, label: 'Front-Left' },
    { x: -halfTrack, y: wheelRadius, z: halfWB, idx: 1, label: 'Front-Right' },
    { x: halfTrack, y: wheelRadius, z: -halfWB, idx: 2, label: 'Rear-Left' },
    { x: -halfTrack, y: wheelRadius, z: -halfWB, idx: 3, label: 'Rear-Right' },
  ];

  // Sculpted Wheel-Arch Fender Flares over each wheel
  for (const wc of wheelCoords) {
    const flare = new THREE.Mesh(
      new THREE.CylinderGeometry(wheelRadius + 0.08, wheelRadius + 0.08, 0.26, 14, 1, false, 0, Math.PI),
      matDarkMetal
    );
    flare.rotation.z = Math.PI / 2;
    flare.rotation.y = Math.PI / 2;
    flare.position.set(wc.x, wc.y + 0.02, wc.z);
    bodyGroup.add(flare);
  }

  const wheelHubs = wheelCoords.map((wc) => {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(wc.x, wc.y, wc.z);
    root.add(steerPivot);

    const spinGroup = new THREE.Group();
    steerPivot.add(spinGroup);

    // Brake disc rotor (always present even if wheel is detached)
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 12), matDarkMetal);
    rotor.rotation.z = Math.PI / 2;
    spinGroup.add(rotor);

    // Hitbox on hub so you can attach a wheel when empty
    const hubHitbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.62, 0.62),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    steerPivot.add(hubHitbox);
    tagInteractable(hubHitbox, { type: 'car_wheel', wheelIndex: wc.idx, label: wc.label, car: carState });

    return { steerPivot, spinGroup, tireMesh: null, wc };
  });

  // ── Helper to sync visual parts (Engine, Radiator, 4 Wheels, Trunk Cargo, Paint/Rust) ──
  const syncParts = () => {
    // Paint & Rust
    const rustTex = rustMetalTexture(1 - (carState.condition ?? 0.65));
    const col = new THREE.Color(carState.paintHex || arch.defaultColor);
    for (const m of paintMats) {
      m.color.copy(col);
      m.map = rustTex;
      m.roughness = clamp(0.75 - (carState.condition ?? 0.65) * 0.48, 0.22, 0.85);
      m.metalness = clamp(0.18 + (carState.condition ?? 0.65) * 0.35, 0.15, 0.6);
      m.needsUpdate = true;
    }

    // Engine Block in Engine Bay
    while (engineMount.children.length) engineMount.remove(engineMount.children[0]);
    if (carState.engineId) {
      const em = buildEngineBlockMesh(carState.engineId, carState.engineCondition ?? 0.8);
      tagInteractable(em, { type: 'car_engine', car: carState });
      engineMount.add(em);
    } else {
      // Empty engine bay hitbox so player can install an engine
      const emptyBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.38, 0.52),
        new THREE.MeshBasicMaterial({ color: 0x334155, wireframe: true, transparent: true, opacity: 0.25 })
      );
      tagInteractable(emptyBox, { type: 'car_engine', car: carState });
      engineMount.add(emptyBox);
    }

    // Radiator in Engine Bay
    while (radiatorMount.children.length) radiatorMount.remove(radiatorMount.children[0]);
    if (carState.radiatorId) {
      const rm = buildRadiatorCoreMesh(carState.radiatorId, carState.radiatorCondition ?? 0.8);
      tagInteractable(rm, { type: 'car_radiator', car: carState });
      radiatorMount.add(rm);
    } else {
      const emptyRad = new THREE.Mesh(
        new THREE.BoxGeometry(0.60, 0.42, 0.14),
        new THREE.MeshBasicMaterial({ color: 0x334155, wireframe: true, transparent: true, opacity: 0.25 })
      );
      tagInteractable(emptyRad, { type: 'car_radiator', car: carState });
      radiatorMount.add(emptyRad);
    }

    // 4 Wheels
    wheelHubs.forEach((wh, idx) => {
      if (wh.tireMesh) {
        wh.spinGroup.remove(wh.tireMesh);
        wh.tireMesh = null;
      }
      const wState = carState.wheels[idx];
      if (wState && wState.installed) {
        const wm = buildWheelAssembly(wheelRadius, wState.condition ?? 0.85);
        tagInteractable(wm, { type: 'car_wheel', wheelIndex: idx, label: wh.wc.label, car: carState });
        wh.spinGroup.add(wm);
        wh.tireMesh = wm;
      }
    });

    // Trunk Stowed Cargo Visuals
    // Keep index 0 (trunkBayHitbox), rebuild stowed items
    while (cargoMountGroup.children.length > 1) {
      cargoMountGroup.remove(cargoMountGroup.children[cargoMountGroup.children.length - 1]);
    }
    const trunkItems = carState.trunk || [];
    trunkItems.forEach((itm, idx) => {
      const im = buildItemMesh(itm);
      const colIdx = idx % 3;
      const rowIdx = Math.floor(idx / 3);
      im.position.set((colIdx - 1) * 0.38, 0.08, (rowIdx - 0.5) * 0.36);
      im.scale.setScalar(0.85);
      tagInteractable(im, { type: 'trunk_item', item: itm, trunkIndex: idx, car: carState });
      cargoMountGroup.add(im);
    });
  };

  const meshRefs = {
    root,
    bodyGroup,
    doorLGroup,
    doorRGroup,
    hoodGroup,
    trunkGroup,
    steeringWheel,
    dashNeedles,
    handbrakeLever,
    headLampMat,
    tailLampMat,
    headlightSpot,
    beamL,
    beamR,
    wheelHubs,
    syncParts,
  };

  carState.mesh = meshRefs;
  syncParts();
  return meshRefs;
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. STARTER HOUSE & GARAGE COMPOUND (0.0 KM — Mom's Letter, Workbench, Bed)
// ══════════════════════════════════════════════════════════════════════════════
export function buildStarterCompound() {
  const g = new THREE.Group();
  const stuccoMat = new THREE.MeshStandardMaterial({ map: stuccoWallTexture(), roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ map: corrugatedTexture(), roughness: 0.75, metalness: 0.35 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.92 });

  // Concrete foundation pad for house + garage + driveway apron
  const pad = new THREE.Mesh(new THREE.BoxGeometry(24, 0.16, 20), floorMat);
  pad.position.set(-16, 0.02, 10);
  pad.receiveShadow = true;
  g.add(pad);

  // Garage walls (open on +X side facing the highway so you can drive straight out!)
  // Center of garage: x = -14, z = 14 (width 10, depth 9, height 4.2)
  const garBack = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.2, 9.2), stuccoMat);
  garBack.position.set(-19, 2.1, 14);
  garBack.castShadow = true;
  garBack.receiveShadow = true;

  const garNorth = new THREE.Mesh(new THREE.BoxGeometry(10.2, 4.2, 0.35), stuccoMat);
  garNorth.position.set(-14, 2.1, 18.5);
  garNorth.castShadow = true;

  const garRoof = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.25, 9.8), roofMat);
  garRoof.position.set(-14, 4.3, 14);
  garRoof.rotation.z = 0.05;
  garRoof.castShadow = true;
  g.add(garBack, garNorth, garRoof);

  // Garage Workbench along North wall (x = -15, z = 17.6)
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.12, 1.1), matWood);
  benchTop.position.set(-15, 0.95, 17.6);
  benchTop.castShadow = true;
  const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 0.95), matDarkMetal);
  leg1.position.set(-17.3, 0.47, 17.6);
  const leg2 = leg1.clone();
  leg2.position.x = -12.7;
  g.add(benchTop, leg1, leg2);

  // Attached Living Quarters (South side of Garage: x = -15, z = 5.5, width 8, depth 8)
  const houseBack = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.8, 8.2), stuccoMat);
  houseBack.position.set(-19, 1.9, 5.5);
  const houseSouth = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.8, 0.35), stuccoMat);
  houseSouth.position.set(-15, 1.9, 1.5);
  const houseFront = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.8, 5.2), stuccoMat);
  houseFront.position.set(-11, 1.9, 4.0); // Leaves a 3m doorway opening at z = 6.6..9.5
  const houseRoof = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.25, 8.6), roofMat);
  houseRoof.position.set(-15, 3.9, 5.5);
  houseRoof.castShadow = true;
  g.add(houseBack, houseSouth, houseFront, houseRoof);

  // Kitchen Table with Mom's Letter (x = -15.2, z = 5.2)
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.09, 1.2), matWood);
  tableTop.position.set(-15.2, 0.82, 5.2);
  const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.82, 8), matWood);
  tableLeg.position.set(-15.2, 0.41, 5.2);
  g.add(tableTop, tableLeg);

  // Mom's Letter on the table!
  const letterMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.02, 0.44),
    new THREE.MeshStandardMaterial({ map: letterPaperTexture(), roughness: 0.6 })
  );
  letterMesh.position.set(-14.9, 0.88, 5.2);
  letterMesh.rotation.y = 0.25;
  g.add(letterMesh);
  tagInteractable(letterMesh, { type: 'mom_letter', name: "Mom's Letter (Read)" });

  // Bed in the corner of the house (x = -17.4, z = 3.2) — press [E] to sleep & advance time!
  const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 1.3), matWood);
  bedFrame.position.set(-17.4, 0.20, 3.0);
  const mattress = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.18, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.85 })
  );
  mattress.position.set(-17.4, 0.42, 3.0);
  const pillow = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.12, 0.9),
    new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.8 })
  );
  pillow.position.set(-18.1, 0.54, 3.0);
  const bedGroup = new THREE.Group();
  bedGroup.add(bedFrame, mattress, pillow);
  g.add(bedGroup);
  tagInteractable(bedGroup, { type: 'bed', name: 'Desert Cot (Rest 6 Hours & Heal)' });

  // Outdoor Water Well / Spigot at x = -9.5, z = 2.5 (infinite water source!)
  const wellGroup = buildWaterSpigot();
  wellGroup.position.set(-9.5, 0, 2.5);
  g.add(wellGroup);

  // Highway Direction Signpost at driveway exit (x = -5.8, z = 18.0) pointing NORTH (+Z)
  const signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 3.4, 8), matChrome);
  signPole.position.set(-5.8, 1.7, 18.0);
  const dirBoard = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.95, 0.10),
    new THREE.MeshStandardMaterial({
      map: signTexture('HIGHWAY NORTH ↑', '#155e3b', '#fef08a'),
      roughness: 0.4,
    })
  );
  dirBoard.position.set(-5.8, 3.1, 18.0);
  g.add(signPole, dirBoard);

  // Warm interior point light inside garage
  const garLight = new THREE.PointLight(0xffe4b5, 8, 18);
  garLight.position.set(-14, 3.8, 14);
  g.add(garLight);

  // Colliders list for simple AABB / cylinder collision
  const colliders = [
    { minX: -19.3, maxX: -18.6, minZ: 1.3, maxZ: 18.7 }, // West back wall
    { minX: -19.2, maxX: -9.0, minZ: 18.2, maxZ: 18.8 }, // North garage wall
    { minX: -19.2, maxX: -10.8, minZ: 1.2, maxZ: 1.8 },  // South house wall
    { minX: -11.3, maxX: -10.7, minZ: 1.4, maxZ: 6.6 },  // East house front wall
  ];

  return { group: g, colliders };
}

function buildWaterSpigot() {
  const wg = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.52, 0.5, 10), matDarkMetal);
  base.position.y = 0.25;
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), matChrome);
  pipe.position.y = 0.85;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 8), matChrome);
  spout.rotation.z = Math.PI / 2;
  spout.position.set(0.16, 1.32, 0);
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.025, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 })
  );
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(0, 1.46, 0);
  wg.add(base, pipe, spout, wheel);
  tagInteractable(wg, { type: 'water_pump', name: 'Desert Well Spigot (Drink / Fill Water Container)' });
  return wg;
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. ROADSIDE POIs (Gas Station, Diner + Water Tower, Garage, Radio Tower)
// ══════════════════════════════════════════════════════════════════════════════
export function buildRoadsidePOI(poiDef, seed) {
  const r = mulberry32(seed);
  const g = new THREE.Group();
  const stuccoMat = new THREE.MeshStandardMaterial({ map: stuccoWallTexture(), roughness: 0.9 });
  const marbleMat = new THREE.MeshStandardMaterial({ map: palaceMarbleTexture(), roughness: 0.48, metalness: 0.12 });
  const woodWallMat = new THREE.MeshStandardMaterial({ map: woodPlankTexture(), roughness: 0.85 });
  const goldDomeMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.25, metalness: 0.78 });
  const roofMat = new THREE.MeshStandardMaterial({ map: corrugatedTexture(), roughness: 0.75, metalness: 0.35 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.92 });
  const colliders = [];
  const lootSpots = []; // local (x, y, z) coordinates where items spawn
  const archStyle = poiDef.archStyle || 'station';

  // Concrete / Stone Courtyard Apron Pad
  const padW = archStyle === 'palace' ? 24 : 19;
  const padD = archStyle === 'palace' ? 28 : 23;
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(padW, 0.16, padD),
    archStyle === 'palace' ? marbleMat : floorMat
  );
  pad.position.set(0, 0.02, 0);
  pad.receiveShadow = true;
  g.add(pad);

  // Tall Roadside Signpost near highway edge
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 6.8, 8), matDarkMetal);
  pole.position.set(-7.2, 3.4, 9.2);
  const signBg = archStyle === 'palace' ? '#78350f' : archStyle === 'house' ? '#1e3a8a' : '#991b1b';
  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 1.55, 0.18),
    new THREE.MeshStandardMaterial({
      map: signTexture(poiDef.signText, signBg, '#fef08a'),
      roughness: 0.4,
    })
  );
  signBoard.position.set(-7.2, 6.2, 9.2);
  g.add(pole, signBoard);

  // Optional Fuel Pump Island (for gas stations, bus depots, and royal palaces with private pumps)
  if (poiDef.hasFuelPump) {
    if (archStyle === 'station' || archStyle === 'depot') {
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.35, 10.5), roofMat);
      canopy.position.set(-2.8, 4.8, 0);
      canopy.castShadow = true;
      const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 4.8, 8), matChrome);
      p1.position.set(-2.8, 2.4, 3.8);
      const p2 = p1.clone();
      p2.position.z = -3.8;
      g.add(canopy, p1, p2);
    }

    const pumpGroup = new THREE.Group();
    pumpGroup.position.set(-2.8, 0, 0);
    const pumpBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 1.65, 0.95),
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.45, metalness: 0.3 })
    );
    pumpBody.position.y = 0.85;
    pumpBody.castShadow = true;
    const pumpDial = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.42, 0.65),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 })
    );
    pumpDial.position.y = 1.28;
    pumpGroup.add(pumpBody, pumpDial);
    g.add(pumpGroup);
    tagInteractable(pumpGroup, {
      type: 'fuel_pump',
      fuelLeft: Math.round(rand(r, 18, 45) * 10) / 10,
      name: archStyle === 'palace' ? 'Royal Courtyard Fuel Pump' : 'Vintage Gasoline Pump',
    });
  }

  // ── Architecture Style 1: DESERT PALACE / MANSION ('palace' — Qasr Al-Sahra) ──
  if (archStyle === 'palace') {
    const pW = 9.6, pD = 16.0, pH = 6.4;
    const backW = new THREE.Mesh(new THREE.BoxGeometry(0.45, pH, pD), marbleMat);
    backW.position.set(4.2 + pW * 0.5, pH * 0.5, 0);
    backW.castShadow = true;
    const northW = new THREE.Mesh(new THREE.BoxGeometry(pW, pH, 0.45), marbleMat);
    northW.position.set(4.2, pH * 0.5, pD * 0.5);
    const southW = northW.clone();
    southW.position.z = -pD * 0.5;
    const palaceRoof = new THREE.Mesh(new THREE.BoxGeometry(pW + 0.8, 0.42, pD + 0.8), marbleMat);
    palaceRoof.position.set(4.2, pH + 0.2, 0);
    palaceRoof.castShadow = true;
    g.add(backW, northW, southW, palaceRoof);

    // 4 Grand Marble Colonnade Pillars at the Front Entrance Portico
    for (const pz of [-5.8, -2.0, 2.0, 5.8]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, pH, 12), marbleMat);
      col.position.set(4.2 - pW * 0.46, pH * 0.5, pz);
      col.castShadow = true;
      g.add(col);
    }

    // Golden Central Royal Dome + 2 Corner Minaret Cupolas
    const mainDome = new THREE.Mesh(new THREE.SphereGeometry(2.8, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), goldDomeMat);
    mainDome.position.set(4.2, pH + 0.35, 0);
    mainDome.castShadow = true;
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.14, 1.8, 8), goldDomeMat);
    spire.position.set(4.2, pH + 3.4, 0);
    g.add(mainDome, spire);

    for (const cz of [-6.2, 6.2]) {
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 2.2, 12), marbleMat);
      turret.position.set(4.2 - pW * 0.35, pH + 1.1, cz);
      const smallDome = new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), goldDomeMat);
      smallDome.position.set(4.2 - pW * 0.35, pH + 2.1, cz);
      g.add(turret, smallDome);
    }

    // Crenellated Parapet Merlons along the Palace Roofline
    for (let mz = -7.2; mz <= 7.2; mz += 1.6) {
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.65, 0.72), marbleMat);
      merlon.position.set(4.2 - pW * 0.48, pH + 0.72, mz);
      g.add(merlon);
    }

    // Courtyard Marble Water Fountain (interactive clean water source!)
    const fountain = new THREE.Group();
    fountain.position.set(-1.5, 0, -5.2);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.4, 0.72, 14), marbleMat);
    basin.position.y = 0.36;
    const waterPool = new THREE.Mesh(
      new THREE.CylinderGeometry(1.38, 1.38, 0.12, 14),
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.15, metalness: 0.4 })
    );
    waterPool.position.y = 0.68;
    fountain.add(basin, waterPool, buildWaterSpigot());
    g.add(fountain);

    // Royal Banquet Table inside the Palace Hall
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.95, 9.5), matWood);
    table.position.set(6.4, 0.48, 0);
    table.castShadow = true;
    g.add(table);

    colliders.push(
      { minX: 4.2 + pW * 0.5 - 0.35, maxX: 4.2 + pW * 0.5 + 0.35, minZ: -pD * 0.5, maxZ: pD * 0.5 },
      { minX: 4.2 - pW * 0.5, maxX: 4.2 + pW * 0.5, minZ: pD * 0.5 - 0.35, maxZ: pD * 0.5 + 0.35 },
      { minX: 4.2 - pW * 0.5, maxX: 4.2 + pW * 0.5, minZ: -pD * 0.5 - 0.35, maxZ: -pD * 0.5 + 0.35 }
    );

    // Rich Palace Loot Spots (8 spots)
    lootSpots.push(
      { x: 6.3, y: 0.98, z: -3.6 },
      { x: 6.3, y: 0.98, z: -1.8 },
      { x: 6.3, y: 0.98, z: 0.0 },
      { x: 6.3, y: 0.98, z: 1.8 },
      { x: 6.3, y: 0.98, z: 3.6 },
      { x: 3.8, y: 0.12, z: -4.5 },
      { x: 3.8, y: 0.12, z: 0.0 },
      { x: 3.8, y: 0.12, z: 4.5 }
    );
  } else if (archStyle === 'house') {
    // ── Architecture Style 2: TWO-STORY DESERT HOUSE & WOODEN BARN ('house' — Dar) ──
    const hW = 7.4, hD = 10.5, hH = 5.4;
    const backW = new THREE.Mesh(new THREE.BoxGeometry(0.34, hH, hD), stuccoMat);
    backW.position.set(3.6 + hW * 0.5, hH * 0.5, -2.2);
    backW.castShadow = true;
    const northW = new THREE.Mesh(new THREE.BoxGeometry(hW, hH, 0.34), stuccoMat);
    northW.position.set(3.6, hH * 0.5, -2.2 + hD * 0.5);
    const southW = northW.clone();
    southW.position.z = -2.2 - hD * 0.5;
    // Pitched Gable Wooden Roof + Upper Balcony
    const roofSlope = new THREE.Mesh(new THREE.ConeGeometry(6.8, 2.2, 4), woodWallMat);
    roofSlope.rotation.y = Math.PI * 0.25;
    roofSlope.position.set(3.6, hH + 1.0, -2.2);
    roofSlope.castShadow = true;
    const balcony = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, hD * 0.88), woodWallMat);
    balcony.position.set(3.6 - hW * 0.45, 2.85, -2.2);
    g.add(backW, northW, southW, roofSlope, balcony);

    // Adjacent Rustic Timber Barn Shed (+Z side)
    const barn = new THREE.Mesh(new THREE.BoxGeometry(6.2, 3.8, 6.4), woodWallMat);
    barn.position.set(4.0, 1.9, 6.8);
    barn.castShadow = true;
    g.add(barn);

    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.92, 6.8), matWood);
    counter.position.set(5.6, 0.46, -2.2);
    g.add(counter);

    colliders.push(
      { minX: 3.6 + hW * 0.5 - 0.3, maxX: 3.6 + hW * 0.5 + 0.3, minZ: -2.2 - hD * 0.5, maxZ: -2.2 + hD * 0.5 },
      { minX: 3.6 - hW * 0.5, maxX: 3.6 + hW * 0.5, minZ: -2.2 + hD * 0.5 - 0.3, maxZ: -2.2 + hD * 0.5 + 0.3 },
      { minX: 3.6 - hW * 0.5, maxX: 3.6 + hW * 0.5, minZ: -2.2 - hD * 0.5 - 0.3, maxZ: -2.2 - hD * 0.5 + 0.3 }
    );

    lootSpots.push(
      { x: 5.5, y: 0.94, z: -4.6 },
      { x: 5.5, y: 0.94, z: -2.8 },
      { x: 5.5, y: 0.94, z: -1.0 },
      { x: 5.5, y: 0.94, z: 0.6 },
      { x: 3.2, y: 0.10, z: -4.2 },
      { x: 3.2, y: 0.10, z: 1.2 },
      { x: 0.4, y: 0.10, z: 6.5 }
    );
  } else if (archStyle === 'kasbah') {
    // ── Architecture Style 3: ANCIENT KASBAH WATCHTOWER & PALM OASIS ('kasbah') ──
    const kW = 7.8, kD = 11.2, kH = 4.5;
    const backW = new THREE.Mesh(new THREE.BoxGeometry(0.42, kH, kD), stuccoMat);
    backW.position.set(3.8 + kW * 0.5, kH * 0.5, 0);
    backW.castShadow = true;
    const northW = new THREE.Mesh(new THREE.BoxGeometry(kW, kH, 0.42), stuccoMat);
    northW.position.set(3.8, kH * 0.5, kD * 0.5);
    const southW = northW.clone();
    southW.position.z = -kD * 0.5;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(kW + 0.5, 0.32, kD + 0.5), stuccoMat);
    roof.position.set(3.8, kH + 0.15, 0);
    // Tall 12.5m Fortified Watchtower Bastion
    const tower = new THREE.Mesh(new THREE.BoxGeometry(3.8, 12.5, 3.8), stuccoMat);
    tower.position.set(5.5, 6.25, -4.8);
    tower.castShadow = true;
    g.add(backW, northW, southW, roof, tower);

    // Desert Oasis Palm Trees
    const palmLeafMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.75 });
    for (const [px, pz] of [[-4.8, -6.5], [-5.2, 5.5], [1.2, 8.2]]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 6.4, 8), woodWallMat);
      trunk.position.set(px, 3.2, pz);
      trunk.castShadow = true;
      g.add(trunk);
      for (let a = 0; a < 5; a++) {
        const frond = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.48), palmLeafMat);
        frond.position.set(px + Math.cos(a * 1.25) * 1.0, 6.3, pz + Math.sin(a * 1.25) * 1.0);
        frond.rotation.y = -a * 1.25;
        frond.rotation.z = -0.28;
        g.add(frond);
      }
    }

    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.92, 6.8), matWood);
    counter.position.set(5.6, 0.46, 0);
    g.add(counter);

    colliders.push(
      { minX: 3.8 + kW * 0.5 - 0.3, maxX: 3.8 + kW * 0.5 + 0.3, minZ: -kD * 0.5, maxZ: kD * 0.5 },
      { minX: 3.8 - kW * 0.5, maxX: 3.8 + kW * 0.5, minZ: kD * 0.5 - 0.3, maxZ: kD * 0.5 + 0.3 },
      { minX: 3.8 - kW * 0.5, maxX: 3.8 + kW * 0.5, minZ: -kD * 0.5 - 0.3, maxZ: -kD * 0.5 + 0.3 }
    );

    lootSpots.push(
      { x: 5.5, y: 0.94, z: -2.4 },
      { x: 5.5, y: 0.94, z: -0.8 },
      { x: 5.5, y: 0.94, z: 0.8 },
      { x: 5.5, y: 0.94, z: 2.4 },
      { x: 3.2, y: 0.10, z: -3.2 },
      { x: 3.2, y: 0.10, z: 3.2 }
    );
  } else {
    // ── Architecture Style 4 & 5: BUS DEPOT HANGAR / GAS STATION / SALVAGE GARAGE ──
    const bW = archStyle === 'depot' ? 8.6 : 7.2;
    const bD = archStyle === 'depot' ? 13.5 : 11.0;
    const bH = archStyle === 'depot' ? 5.6 : 3.8;
    const backW = new THREE.Mesh(new THREE.BoxGeometry(0.32, bH, bD), stuccoMat);
    backW.position.set(3.5 + bW * 0.5, bH * 0.5, 0);
    backW.castShadow = true;
    const northW = new THREE.Mesh(new THREE.BoxGeometry(bW, bH, 0.32), stuccoMat);
    northW.position.set(3.5, bH * 0.5, bD * 0.5);
    const southW = northW.clone();
    southW.position.z = -bD * 0.5;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(bW + 0.6, 0.28, bD + 0.6), roofMat);
    roof.position.set(3.5, bH + 0.1, 0);
    roof.castShadow = true;
    g.add(backW, northW, southW, roof);

    colliders.push(
      { minX: 3.5 + bW * 0.5 - 0.3, maxX: 3.5 + bW * 0.5 + 0.3, minZ: -bD * 0.5, maxZ: bD * 0.5 },
      { minX: 3.5 - bW * 0.5, maxX: 3.5 + bW * 0.5, minZ: bD * 0.5 - 0.3, maxZ: bD * 0.5 + 0.3 },
      { minX: 3.5 - bW * 0.5, maxX: 3.5 + bW * 0.5, minZ: -bD * 0.5 - 0.3, maxZ: -bD * 0.5 + 0.3 }
    );

    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.92, 6.8), matWood);
    counter.position.set(5.6, 0.46, 0);
    counter.castShadow = true;
    g.add(counter);

    lootSpots.push(
      { x: 5.5, y: 0.94, z: -2.4 },
      { x: 5.5, y: 0.94, z: -0.8 },
      { x: 5.5, y: 0.94, z: 0.8 },
      { x: 5.5, y: 0.94, z: 2.4 },
      { x: 3.2, y: 0.10, z: -3.5 },
      { x: 3.2, y: 0.10, z: 3.5 }
    );
  }

  // Optional Tall Water Tower
  if (poiDef.hasWaterTower) {
    const wt = new THREE.Group();
    wt.position.set(3.5, 0, -8.5);
    for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 9.5, 8), matDarkMetal);
      leg.position.set(lx, 4.75, lz);
      wt.add(leg);
    }
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 3.6, 14), roofMat);
    tank.position.y = 10.8;
    tank.castShadow = true;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.4, 14), roofMat);
    cone.position.y = 13.3;
    wt.add(tank, cone);

    const spigot = buildWaterSpigot();
    spigot.position.set(-1.8, 0, 0);
    wt.add(spigot);
    g.add(wt);
  }

  // Optional Tall Radio Relay Tower with blinking red beacon
  if (poiDef.hasRadioTower) {
    const rt = new THREE.Group();
    rt.position.set(4.5, 0, 8.5);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 1.1, 22, 6, 4, true),
      new THREE.MeshStandardMaterial({ color: 0xdc2626, wireframe: true })
    );
    mast.position.y = 11;
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff2222 })
    );
    beacon.position.y = 22.3;
    rt.add(mast, beacon);
    g.add(rt);
  }

  return { group: g, colliders, lootSpots };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. TELEPHONE POLES, MILEPOSTS, CACTI, BOULDERS & MUTANT DESERT HARES
// ══════════════════════════════════════════════════════════════════════════════
export function buildTelephonePole() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 7.8, 8), matWood);
  pole.position.y = 3.9;
  pole.castShadow = true;
  const crossArm = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 0.14), matWood);
  crossArm.position.y = 7.2;
  const insL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), matGlass);
  insL.position.set(-0.78, 7.34, 0);
  const insR = insL.clone();
  insR.position.x = 0.78;
  g.add(pole, crossArm, insL, insR);
  return g;
}

export function buildMilepost(km) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.6, 0.10), matChrome);
  post.position.y = 0.8;
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.48, 0.06),
    new THREE.MeshStandardMaterial({
      map: signTexture(`${km} KM`, '#155e3b', '#ffffff'),
      roughness: 0.4,
    })
  );
  sign.position.y = 1.45;
  g.add(post, sign);
  return g;
}

const matCactus = new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.85 });
export function buildCactus(seed) {
  const r = mulberry32(seed);
  const g = new THREE.Group();
  const h = 1.8 + r() * 2.2;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, h, 8), matCactus);
  trunk.position.y = h * 0.5;
  trunk.castShadow = true;
  g.add(trunk);

  if (r() > 0.2) {
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, h * 0.45, 8), matCactus);
    armL.position.set(0.32, h * 0.58, 0);
    const jointL = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.22), matCactus);
    jointL.position.set(0.18, h * 0.38, 0);
    g.add(armL, jointL);
  }
  if (r() > 0.35) {
    const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, h * 0.38, 8), matCactus);
    armR.position.set(-0.32, h * 0.65, 0);
    const jointR = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.22), matCactus);
    jointR.position.set(-0.18, h * 0.48, 0);
    g.add(armR, jointR);
  }
  return g;
}

const matRock = new THREE.MeshStandardMaterial({ color: 0x9a7b56, roughness: 0.92 });
export function buildBoulder(seed) {
  const r = mulberry32(seed);
  const sz = 0.7 + r() * 1.9;
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(sz, 1), matRock);
  m.scale.set(1 + r() * 0.5, 0.55 + r() * 0.45, 1 + r() * 0.5);
  m.position.y = sz * 0.32;
  m.rotation.y = r() * Math.PI * 2;
  m.castShadow = true;
  m.receiveShadow = true;
  return { mesh: m, radius: sz * 0.9 };
}

// Mutant Desert Hare (Hostile / Targetable pest in The Long Drive)
const matFur = new THREE.MeshStandardMaterial({ color: 0x786856, roughness: 0.9 });
const matRedEye = new THREE.MeshBasicMaterial({ color: 0xff1111 });
export function buildDesertHare() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.44), matFur);
  body.position.y = 0.18;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.20, 0.22), matFur);
  head.position.set(0, 0.30, 0.22);
  const earL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.05), matFur);
  earL.position.set(0.06, 0.48, 0.18);
  earL.rotation.x = -0.2;
  const earR = earL.clone();
  earR.position.x = -0.06;
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), matRedEye);
  eyeL.position.set(0.08, 0.33, 0.33);
  const eyeR = eyeL.clone();
  eyeR.position.x = -0.08;
  g.add(body, head, earL, earR, eyeL, eyeR);
  return g;
}
