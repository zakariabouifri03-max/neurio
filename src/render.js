/* ============================================================
   Botola 25 — render.js
   Three.js layer: stadium, players, ball, broadcast camera.
   The simulation lives in engine.js — this file only *draws* it.
   ============================================================ */

import * as THREE from '../vendor/three.module.js';
import { PITCH } from './data.js';
import { clamp, damp, lerp } from './util.js';
import { grassTexture, linesTexture, ballTexture, crowdTexture, adTexture, netTexture, shadowTexture } from './tex.js';

const PH = PITCH.HX, PW = PITCH.HZ;

/* ------------------------------------------------------------------ */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0b1220, 1);
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1024);
  scene.fog = new THREE.Fog(0x0a1024, 90, 210);

  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x2b3a22, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.35);
  sun.position.set(40, 70, 30);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8fb6ff, 0.35);
  fill.position.set(-50, 30, -40);
  scene.add(fill);
  return scene;
}

/* ------------------------------------------------------------------ */
/*  Stadium                                                            */
/* ------------------------------------------------------------------ */
export function buildStadium(scene) {
  const g = new THREE.Group();

  // surrounding ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 240),
    new THREE.MeshLambertMaterial({ color: 0x16351c })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  g.add(ground);

  // pitch
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH.L + 14, PITCH.W + 12),
    new THREE.MeshLambertMaterial({ map: grassTexture() })
  );
  pitch.rotation.x = -Math.PI / 2;
  g.add(pitch);

  // markings
  const lines = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH.L, PITCH.W),
    new THREE.MeshBasicMaterial({ map: linesTexture(), transparent: true, depthWrite: false })
  );
  lines.rotation.x = -Math.PI / 2;
  lines.position.y = 0.02;
  g.add(lines);

  // goals
  const postMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const netMat = new THREE.MeshLambertMaterial({
    map: netTexture(), transparent: true, side: THREE.DoubleSide, opacity: 0.85, depthWrite: false,
  });
  for (const sx of [-1, 1]) {
    const goal = new THREE.Group();
    const post = new THREE.CylinderGeometry(0.07, 0.07, PITCH.GOAL_H, 8);
    for (const pz of [-PITCH.GOAL_W / 2, PITCH.GOAL_W / 2]) {
      const m = new THREE.Mesh(post, postMat);
      m.position.set(0, PITCH.GOAL_H / 2, pz);
      goal.add(m);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, PITCH.GOAL_W, 8), postMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0, PITCH.GOAL_H, 0);
    goal.add(bar);
    // netting: back + two sides + roof
    const back = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.GOAL_W, PITCH.GOAL_H), netMat);
    back.position.set(-sx * PITCH.GOAL_D, PITCH.GOAL_H / 2, 0);
    back.rotation.y = Math.PI / 2;
    goal.add(back);
    for (const pz of [-PITCH.GOAL_W / 2, PITCH.GOAL_W / 2]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.GOAL_D, PITCH.GOAL_H), netMat);
      side.position.set(-sx * PITCH.GOAL_D / 2, PITCH.GOAL_H / 2, pz);
      goal.add(side);
    }
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.GOAL_D, PITCH.GOAL_W), netMat);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(-sx * PITCH.GOAL_D / 2, PITCH.GOAL_H, 0);
    goal.add(roof);
    goal.position.x = sx * PH;
    g.add(goal);
  }

  // corner flags
  const flagPole = new THREE.CylinderGeometry(0.04, 0.04, 1.5, 5);
  const flagMat = new THREE.MeshLambertMaterial({ color: 0xffd400 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = new THREE.Mesh(flagPole, postMat);
    p.position.set(sx * PH, 0.75, sz * PW);
    g.add(p);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28), flagMat);
    f.position.set(sx * PH - sx * 0.2, 1.35, sz * PW);
    f.rotation.y = Math.PI / 2;
    g.add(f);
  }

  // advertising boards all the way round
  const adMat = new THREE.MeshLambertMaterial({ map: adTexture() });
  const boardGeoLong = new THREE.BoxGeometry(PITCH.L + 22, 1.1, 0.25);
  const boardGeoShort = new THREE.BoxGeometry(0.25, 1.1, PITCH.W + 14);
  for (const sz of [-1, 1]) {
    const b = new THREE.Mesh(boardGeoLong, adMat);
    b.position.set(0, 0.55, sz * (PW + 5));
    g.add(b);
  }
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(boardGeoShort, adMat);
    b.position.set(sx * (PH + 8), 0.55, 0);
    g.add(b);
  }

  // stands + floodlights
  const standMat = new THREE.MeshLambertMaterial({ map: crowdTexture() });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x2b3444 });
  const mkStand = (w, d, x, z, ry) => {
    const s = new THREE.Group();
    const tier = new THREE.Mesh(new THREE.BoxGeometry(w, 12, d), standMat);
    tier.position.y = 5;
    s.add(tier);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 0.6, d + 3), roofMat);
    roof.position.set(0, 12, 0);
    s.add(roof);
    s.position.set(x, 0, z);
    s.rotation.y = ry;
    return s;
  };
  g.add(mkStand(PITCH.L + 40, 16, 0, -(PW + 22), 0));
  g.add(mkStand(PITCH.L + 40, 16, 0, (PW + 22), 0));
  g.add(mkStand(PITCH.W + 34, 16, -(PH + 24), 0, Math.PI / 2));
  g.add(mkStand(PITCH.W + 34, 16, (PH + 24), 0, Math.PI / 2));

  const pylonGeo = new THREE.CylinderGeometry(0.5, 0.9, 26, 6);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6d0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const py = new THREE.Mesh(pylonGeo, new THREE.MeshLambertMaterial({ color: 0x556070 }));
    py.position.set(sx * (PH + 20), 13, sz * (PW + 18));
    g.add(py);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.6), lampMat);
    lamp.position.set(sx * (PH + 20), 27, sz * (PW + 18));
    lamp.rotation.y = Math.atan2(-sx, -sz);
    g.add(lamp);
  }

  scene.add(g);
  return g;
}

/* ------------------------------------------------------------------ */
/*  Players                                                            */
/* ------------------------------------------------------------------ */
const GEO = {};
function geos() {
  if (GEO.torso) return GEO;
  GEO.torso = new THREE.CapsuleGeometry(0.21, 0.4, 3, 10);
  GEO.head = new THREE.SphereGeometry(0.145, 10, 8);
  GEO.limb = new THREE.BoxGeometry(0.1, 0.44, 0.1);
  GEO.limb.translate(0, -0.22, 0);         // pivot at the top
  GEO.leg = new THREE.BoxGeometry(0.13, 0.55, 0.13);
  GEO.leg.translate(0, -0.275, 0);
  GEO.shorts = new THREE.BoxGeometry(0.34, 0.22, 0.24);
  GEO.shadow = new THREE.CircleGeometry(0.46, 12);
  return GEO;
}

export function createTeamMaterials(club) {
  return {
    shirt: new THREE.MeshLambertMaterial({ color: club.c1 }),
    trim: new THREE.MeshLambertMaterial({ color: club.c2 }),
    gk: new THREE.MeshLambertMaterial({ color: club.gk }),
  };
}

export function createPlayerMesh(mats, data, shadowTex) {
  const G = geos();
  const grp = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: data.skin });
  const hair = new THREE.MeshLambertMaterial({ color: data.hair });
  const isGK = data.role === 'GK';
  const shirt = isGK ? mats.gk : mats.shirt;
  const shorts = isGK ? mats.gk : mats.trim;

  const torso = new THREE.Mesh(G.torso, shirt);
  torso.position.y = 1.08;
  grp.add(torso);

  const hip = new THREE.Mesh(G.shorts, shorts);
  hip.position.y = 0.83;
  grp.add(hip);

  const head = new THREE.Mesh(G.head, skin);
  head.position.y = 1.47;
  grp.add(head);
  const cap = new THREE.Mesh(G.head, hair);
  cap.scale.set(1.03, 0.85, 1.03);
  cap.position.y = 1.51;
  grp.add(cap);

  const armL = new THREE.Mesh(G.limb, skin);
  armL.position.set(-0.27, 1.28, 0);
  grp.add(armL);
  const armR = new THREE.Mesh(G.limb, skin);
  armR.position.set(0.27, 1.28, 0);
  grp.add(armR);

  const legL = new THREE.Mesh(G.leg, skin);
  legL.position.set(-0.1, 0.82, 0);
  grp.add(legL);
  const legR = new THREE.Mesh(G.leg, skin);
  legR.position.set(0.1, 0.82, 0);
  grp.add(legR);

  const shadow = new THREE.Mesh(G.shadow, new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, depthWrite: false, opacity: 0.75,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  grp.add(shadow);

  // ring shown under the player you are controlling
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.72, 20),
    new THREE.MeshBasicMaterial({ color: 0x35e08a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.visible = false;
  grp.add(ring);

  return { grp, torso, head, cap, armL, armR, legL, legR, shadow, hip, ring };
}

export function createBallMesh() {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(PITCH.BALL_R + 0.03, 16, 12),
    new THREE.MeshLambertMaterial({ map: ballTexture() })
  );
  const shadow = new THREE.Mesh(geos().shadow, new THREE.MeshBasicMaterial({
    map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.6,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.setScalar(0.5);
  return { mesh: m, shadow };
}

/* ------------------------------------------------------------------ */
/*  Per-frame sync                                                     */
/* ------------------------------------------------------------------ */
export function syncPlayer(rig, pl, active, dt) {
  const g = rig.grp;
  g.position.set(pl.p.x, 0, pl.p.z);
  g.rotation.y = Math.atan2(Math.cos(pl.face), Math.sin(pl.face));

  const sp = Math.hypot(pl.v.x, pl.v.z);
  const t = pl.anim;
  const amp = clamp(sp / 7, 0, 1.25);

  if (pl.state === 'dive') {
    // keeper stretching: whole body tips over sideways
    const k = clamp(pl.diveT * 2.2, 0, 1);
    g.rotation.z = -1.25 * k * Math.sign(pl.v.z || 1);
    g.position.y = 0.35 * k;
    rig.legL.rotation.x = -0.4; rig.legR.rotation.x = 0.2;
    rig.armL.rotation.x = -2.4 * k; rig.armR.rotation.x = -2.4 * k;
  } else if (pl.state === 'celebrate') {
    g.rotation.z = 0;
    g.position.y = Math.abs(Math.sin(t * 0.9)) * 0.35;
    rig.armL.rotation.x = -2.9; rig.armR.rotation.x = -2.9;
    rig.legL.rotation.x = Math.sin(t) * 0.5; rig.legR.rotation.x = -Math.sin(t) * 0.5;
  } else {
    g.rotation.z = damp(g.rotation.z, 0, 12, dt);
    g.position.y = damp(g.position.y, 0, 12, dt);
    const sw = Math.sin(t) * (0.55 + amp * 0.65);
    rig.legL.rotation.x = sw;
    rig.legR.rotation.x = -sw;
    rig.armL.rotation.x = -sw * 0.8;
    rig.armR.rotation.x = sw * 0.8;
    if (pl.state === 'kick') {
      rig.legR.rotation.x = -1.15 * clamp(pl.kickT * 3.2, 0, 1);
      rig.armL.rotation.x = -1.0;
    }
    // bob while running
    g.position.y += Math.abs(Math.sin(t)) * 0.045 * amp;
  }

  // the player you control gets a ring
  if (rig.ring) rig.ring.visible = active;
}

export function syncBall(rig, ball) {
  rig.mesh.position.set(ball.p.x, ball.p.y, ball.p.z);
  rig.mesh.rotation.z -= ball.spin * 0.02;
  rig.mesh.rotation.x += 0.01;
  const k = clamp(1 - ball.p.y / 6, 0.35, 1);
  rig.shadow.position.set(ball.p.x, 0.03, ball.p.z);
  rig.shadow.scale.setScalar(0.5 * k);
  rig.shadow.material.opacity = 0.6 * k;
}

/* ------------------------------------------------------------------ */
/*  Broadcast camera                                                   */
/* ------------------------------------------------------------------ */
export function createCamera() {
  const cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 400);
  cam.position.set(-30, 16, 12);
  cam.lookAt(0, 0, 0);
  return cam;
}

const camState = { x: 0, z: 0, tx: 0, tz: 0, zoom: 26, shake: 0 };

export function updateCamera(cam, m, dt, w, h) {
  cam.aspect = w / h;
  cam.updateProjectionMatrix();

  const b = m.ball;
  const dir = m.human >= 0 ? m.teams[m.human].dir : m.teams[0].dir;

  // look a little ahead of the ball, in the direction we are attacking
  const lead = clamp(b.v.x * 0.28, -9, 9);
  const focusX = b.p.x + lead * 0.7;
  const focusZ = clamp(b.p.z * 0.55, -16, 16);

  camState.tx = damp(camState.tx, focusX, 3.4, dt);
  camState.tz = damp(camState.tz, focusZ, 3.0, dt);

  // pull back when a shot flies, push in for a goal
  let zoom = 25;
  if (m.state === 'goal') zoom = 30;
  else if (Math.hypot(b.v.x, b.v.z) > 20) zoom = 27.5;
  camState.zoom = damp(camState.zoom, zoom, 2.4, dt);

  const behind = camState.zoom;
  const px = camState.tx - behind * dir;
  const pz = camState.tz + 9.5;
  const py = 14.5 + (m.state === 'goal' ? 2.5 : 0);

  cam.position.x = damp(cam.position.x, px, 5.5, dt);
  cam.position.y = damp(cam.position.y, py, 4.5, dt);
  cam.position.z = damp(cam.position.z, pz, 5.5, dt);

  const lookX = camState.tx + 9 * dir;
  const lookZ = camState.tz * 0.75;
  camState.x = damp(camState.x, lookX, 6, dt);
  camState.z = damp(camState.z, lookZ, 6, dt);
  cam.lookAt(camState.x, 1.1, camState.z);

  // a small thump on goals
  if (m.goalFlash) { camState.shake = 0.5; m.goalFlash = 0; }
  if (camState.shake > 0) {
    camState.shake = Math.max(0, camState.shake - dt * 1.6);
    cam.position.y += Math.sin(performance.now() * 0.05) * camState.shake * 0.5;
  }
}

/* screen-space → world-space for the joystick: the camera looks down ±X */
export function joystickToWorld(jx, jy, dir) {
  // forward on screen = attacking direction; right on screen = +Z when dir>0
  const fx = jy * dir;
  const fz = jx * dir;
  const l = Math.hypot(fx, fz) || 1;
  return { x: fx / l, z: fz / l, mag: Math.min(1, l) };
}

export { THREE, lerp };
