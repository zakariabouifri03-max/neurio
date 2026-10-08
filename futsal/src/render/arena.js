// Arena: procedural futsal hall (floor + markings, boards, goals with nets, stands, crowd, lights).
// Everything is original: generic blue boards with a placeholder "NEURIO FUTSAL" text, no real
// club or sponsor branding, no real stadium.
import * as THREE from 'three';
import { PITCH } from '../config.js';

function canvasTexture(w, h, draw, aniso = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// World (x, z) -> canvas pixel for the floor texture (floor is 2L x 2W).
function floorTexture(aniso) {
  const L = PITCH.halfLength, W = PITCH.halfWidth;
  return canvasTexture(2048, 1024, (g, w, h) => {
    const sx = w / (2 * L), sy = h / (2 * W);
    const px = (x) => (x + L) * sx;
    const py = (z) => (z + W) * sy;
    // court: blue PVC-like surface with light wood tint in the middle
    g.fillStyle = '#2f6fb0';
    g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0.05)');
    grd.addColorStop(1, 'rgba(0,0,0,0.08)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f7f7f2';
    g.fillStyle = '#f7f7f2';
    g.lineWidth = 0.09 * sx;
    // outer boundary
    g.strokeRect(px(-L) + 4, py(-W) + 4, (2 * L) * sx - 8, (2 * W) * sy - 8);
    // halfway line and centre circle
    g.beginPath(); g.moveTo(px(0), py(-W)); g.lineTo(px(0), py(W)); g.stroke();
    g.beginPath(); g.arc(px(0), py(0), PITCH.centerCircle * sx, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(px(0), py(0), 0.12 * sx, 0, Math.PI * 2); g.fill();
    // goal areas: 6 m arcs centred on each goal line midpoint, and penalty marks
    for (const side of [-1, 1]) {
      g.beginPath();
      g.arc(px(side * L), py(0), 6 * sx, side > 0 ? Math.PI / 2 : -Math.PI / 2, side > 0 ? (3 * Math.PI) / 2 : Math.PI / 2, side > 0);
      g.stroke();
      g.beginPath(); g.arc(px(side * (L - 6)), py(0), 0.12 * sx, 0, Math.PI * 2); g.fill();
      // free-kick second mark at 10 m
      g.beginPath(); g.arc(px(side * (L - 10)), py(0), 0.12 * sx, 0, Math.PI * 2); g.fill();
      // goal-line stub marks
      g.beginPath(); g.moveTo(px(side * L), py(-PITCH.goalHalfWidth - 0.6)); g.lineTo(px(side * L), py(-PITCH.goalHalfWidth - 0.6) + 0.1); g.stroke();
    }
    // corner arcs
    for (const sx2 of [-1, 1]) for (const sz of [-1, 1]) {
      g.beginPath();
      const cx = px(sx2 * L), cy = py(sz * W);
      g.arc(cx, cy, 0.25 * sx, 0, Math.PI * 2);
      g.stroke();
    }
  }, aniso);
}

// Ball: white with dark patch spots (generic football-style texture, not a real brand).
export function ballTexture(aniso = 1) {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#f4f4ef';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d1d24';
    for (let i = 0; i < 12; i++) {
      const x = (i * 97) % w, y = 40 + ((i * 53) % (h - 80));
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + i;
        const px = x + Math.cos(a) * 18, py = y + Math.sin(a) * 18;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fill();
    }
  }, aniso);
}

export function buildArena(scene, q, opts = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const L = PITCH.halfLength, W = PITCH.halfWidth;

  // floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * L, 2 * W),
    new THREE.MeshStandardMaterial({ map: floorTexture(q.anisotropy), roughness: 0.75, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = q.shadows;
  group.add(floor);

  // hall surround (outside the playing area, slightly darker)
  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * L + 24, 2 * W + 20),
    new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.9 })
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.01;
  surround.receiveShadow = q.shadows;
  group.add(surround);

  // ad boards: 0.6 m high, dark blue with light panels
  const boardTex = canvasTexture(1024, 64, (g, w, h) => {
    g.fillStyle = '#16325c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#ffd166' : '#e8f1ff';
      g.fillRect(i * (w / 8) + 10, 10, w / 8 - 20, h - 20);
      g.fillStyle = '#16325c';
      g.font = 'bold 26px sans-serif';
      g.textAlign = 'center';
      g.fillText(i % 2 ? 'NEURIO' : 'FUTSAL', i * (w / 8) + w / 16, h / 2 + 9);
    }
  }, q.anisotropy);
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.5 });
  const bh = PITCH.boardHeight;
  const addBoard = (len, x, z, rotY) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, bh, 0.2), boardMat);
    m.position.set(x, bh / 2, z);
    m.rotation.y = rotY;
    m.castShadow = q.shadows;
    m.receiveShadow = q.shadows;
    group.add(m);
  };
  addBoard(2 * L + 0.4, 0, W + 0.1, 0);
  addBoard(2 * L + 0.4, 0, -W - 0.1, 0);
  addBoard(2 * W + 0.4, L + 0.1, 0, Math.PI / 2);
  addBoard(2 * W + 0.4, -L - 0.1, 0, Math.PI / 2);

  // goals: white frames with dark nets
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.35, metalness: 0.1 });
  const netMat = new THREE.LineBasicMaterial({ color: 0xd6dde6, transparent: true, opacity: 0.55 });
  for (const side of [-1, 1]) {
    const gx = side * L;
    const hw = PITCH.goalHalfWidth, gh = PITCH.goalHeight, gd = PITCH.goalDepth;
    const post = (y, z) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 10), frameMat);
      m.position.set(gx, 0, 0);
      if (y === null) { m.scale.y = 2 * hw; m.rotation.x = Math.PI / 2; m.position.set(gx, gh, 0); }
      else { m.scale.y = gh; m.position.set(gx, gh / 2, z); }
      m.castShadow = q.shadows;
      group.add(m);
    };
    post(0, hw);
    post(0, -hw);
    post(null, 0);
    // back frame (for depth)
    const back = (y0, z0) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), frameMat);
      m.position.set(gx + side * gd, gh / 2, z0);
      m.scale.y = gh;
      group.add(m);
    };
    back(0, hw); back(0, -hw);
    // net: lines on the back, roof and sides
    const pts = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const z = -hw + (2 * hw * i) / n;
      pts.push(gx, 0, z, gx + side * gd, 0, z);
      pts.push(gx, gh, z, gx + side * gd, gh, z);
      pts.push(gx + side * gd, 0, z, gx + side * gd, gh, z);
    }
    for (let j = 0; j <= 4; j++) {
      const y = (gh * j) / 4;
      pts.push(gx, y, -hw, gx, y, hw);
      pts.push(gx + side * gd, y, -hw, gx + side * gd, y, hw);
    }
    for (let i = 0; i <= 4; i++) {
      const z = -hw + (2 * hw * i) / 4;
      pts.push(gx, gh, z, gx + side * gd, gh, z);
    }
    for (let i = 0; i <= 4; i++) {
      const z = -hw + (2 * hw * i) / 4;
      pts.push(gx, 0, z, gx, gh, z);
    }
    for (let i = 0; i <= 4; i++) {
      const y = (gh * i) / 4;
      pts.push(gx + side * gd, y, -hw, gx + side * gd, y, hw);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(geo, netMat));
    // goal-net roof
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(2 * hw, gd), new THREE.MeshStandardMaterial({ color: 0x9aa7b8, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    roof.rotation.x = Math.PI / 2;
    roof.position.set(gx + (side * gd) / 2, gh, 0);
    group.add(roof);
  }

  // stands: stepped tiers stepping outward from the boards (tier t: top at y = 0.6 + 0.6 t)
  const standMat = new THREE.MeshStandardMaterial({ color: 0x2a3446, roughness: 0.9 });
  const tiers = 5;
  const TIER_H = 0.6, TIER_D = 1.1, BASE = 2.5;   // stand starts 2.5 m off the boards
  const stands = [
    // side, along-axis length, fixed-axis offset sign
    { axis: 'z', sign: 1, len: 2 * L + 8 },
    { axis: 'z', sign: -1, len: 2 * L + 8 },
    { axis: 'x', sign: 1, len: 2 * W + 8 },
    { axis: 'x', sign: -1, len: 2 * W + 8 },
  ];
  const edge = (st, t) => (st.axis === 'z' ? W : L) + BASE + t * TIER_D + TIER_D / 2;
  for (const st of stands) {
    for (let t = 0; t < tiers; t++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(st.axis === 'z' ? st.len : TIER_D, TIER_H, st.axis === 'z' ? TIER_D : st.len), standMat);
      const e = edge(st, t) * st.sign;
      m.position.set(st.axis === 'z' ? 0 : e, t * TIER_H + TIER_H / 2, st.axis === 'z' ? e : 0);
      m.receiveShadow = q.shadows;
      group.add(m);
    }
  }
  // no opaque roof: it would sit between the camera and the pitch (open hall, dark sky)

  // crowd: many small figures in kit-like colours, one InstancedMesh (cheap draw calls)
  const crowdCount = q.crowd;
  const figGeo = new THREE.BoxGeometry(0.42, 0.7, 0.36);
  const figMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const crowd = new THREE.InstancedMesh(figGeo, figMat, crowdCount);
  const dummy = new THREE.Object3D();
  const palette = ['#e63946', '#f1faee', '#1d3557', '#f4a261', '#2a9d8f', '#ffd166', '#8ecae6', '#6d597a', '#ffffff', '#e76f51'].map((c) => new THREE.Color(c));
  let seed = 98765;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < crowdCount; i++) {
    const st = stands[Math.floor(rnd() * stands.length)];
    const t = Math.floor(rnd() * tiers);
    const y = (t + 1) * TIER_H + 0.35;                       // standing on the tier top
    const along = (rnd() * 2 - 1) * (st.axis === 'z' ? L + 3.2 : W + 3.2);
    const across = edge(st, t) * st.sign + (rnd() - 0.5) * (TIER_D * 0.7);
    const x = st.axis === 'z' ? along : across;
    const z = st.axis === 'z' ? across : along;
    const ry = st.axis === 'z' ? (st.sign > 0 ? Math.PI : 0) : (st.sign > 0 ? -Math.PI / 2 : Math.PI / 2);
    let y2 = y;
    dummy.position.set(x, y2, z);
    dummy.rotation.set(0, ry, 0);
    dummy.updateMatrix();
    crowd.setMatrixAt(i, dummy.matrix);
    crowd.setColorAt(i, palette[Math.floor(rnd() * palette.length)]);
  }
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.castShadow = false;
  group.add(crowd);

  // lights: ambient + a sky-like hemisphere, overhead spots, and one shadow-casting key light
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x1a2330, 0.9);
  group.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(-8, 16, 6);
  key.castShadow = q.shadows;
  if (q.shadows) {
    key.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    key.shadow.camera.left = -26; key.shadow.camera.right = 26;
    key.shadow.camera.top = 16; key.shadow.camera.bottom = -16;
    key.shadow.camera.near = 1; key.shadow.camera.far = 60;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
  }
  group.add(key);
  group.add(key.target);
  key.target.position.set(0, 0, 0);
  const spotPositions = [[-12, 8], [12, 8], [-12, -8], [12, -8], [0, 8], [0, -8]];
  const spotLights = [];
  for (let i = 0; i < q.spots; i++) {
    const [x, z] = spotPositions[i];
    const s = new THREE.SpotLight(0xfff4e0, 60, 40, 0.9, 0.6, 1.2);
    s.position.set(x, PITCH.ceiling - 0.5, z);
    s.target.position.set(x * 0.4, 0, z * 0.4);
    group.add(s);
    group.add(s.target);
    spotLights.push(s);
  }
  // lamp fixtures (glowing panels on the roof)
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  for (const [x, z] of spotPositions.slice(0, q.spots)) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 1.1), lampMat);
    lamp.position.set(x, PITCH.ceiling - 0.05, z);
    group.add(lamp);
  }

  if (q.fog) scene.fog = new THREE.Fog(0x0c111a, 60, 140);
  else scene.fog = null;
  scene.background = new THREE.Color(0x0c111a);

  return { group, crowd, key, spotLights, hemi };
}
