// MatchView: owns the three.js objects for one match and mirrors the simulation state each frame.
// The simulation is discrete (fixed step); the view damps positions toward it, which also hides
// the occasional one-frame kick flick so the ball never visibly teleports.
import * as THREE from 'three';
import { BALL } from '../config.js';
import { PlayerModel } from './playerModel.js';
import { ballTexture } from './arena.js';

const GK_KIT = ['#e9f56b', '#ff8fa3'];

export class MatchView {
  constructor(scene, match, q) {
    this.scene = scene;
    this.match = match;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.models = new Map();
    for (const team of match.teams) {
      for (const f of team.players) {
        const gkKit = GK_KIT[team.index];
        const pm = new PlayerModel(f, team.kit, { shadows: q.playerShadows, gkKit });
        this.group.add(pm.root);
        this.models.set(f.id, pm);
      }
    }
    // ball
    const tex = ballTexture(q.anisotropy);
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 20, 14),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 })
    );
    this.ball.castShadow = q.shadows;
    this.group.add(this.ball);
    this.ballVis = new THREE.Vector3(match.ball.pos.x, BALL.radius, match.ball.pos.z);
    this.ball.position.copy(this.ballVis);
    // ground shadow blob (cheap on every preset)
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(0,0,0,0.6)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const blobTex = new THREE.CanvasTexture(c);
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.group.add(this.blob);
    this.lastBall = { x: this.ballVis.x, z: this.ballVis.z };
  }

  // controlled: footballer currently under the human's control (or null)
  sync(dt, controlled) {
    const m = this.match;
    for (const team of m.teams) {
      for (const f of team.players) {
        const pm = this.models.get(f.id);
        if (pm) pm.update(dt, f === controlled);
      }
    }
    const b = m.ball.pos;
    const k = 1 - Math.exp(-dt * 42);
    const prevX = this.ballVis.x, prevZ = this.ballVis.z;
    this.ballVis.x += (b.x - this.ballVis.x) * k;
    this.ballVis.z += (b.z - this.ballVis.z) * k;
    const lift = Math.max(0, b.y) + BALL.radius;
    this.ballVis.y += (lift - this.ballVis.y) * k;
    this.ball.position.copy(this.ballVis);
    // roll: the ball turns about the axis perpendicular to its horizontal travel
    const dx = this.ballVis.x - prevX, dz = this.ballVis.z - prevZ;
    const travel = Math.hypot(dx, dz);
    if (travel > 1e-5) {
      this.ball.rotateOnWorldAxis(new THREE.Vector3(-dz / travel, 0, dx / travel), travel / BALL.radius);
    }
    const h = Math.max(0, this.ballVis.y - BALL.radius);
    const s = 0.22 * (1 - Math.min(1, h / 3));
    this.blob.position.set(this.ballVis.x, 0.02, this.ballVis.z);
    this.blob.scale.set(s + 0.1, s + 0.1, 1);
    this.blob.material.opacity = 0.35 + 0.4 * (1 - Math.min(1, h / 3));
    this.lastBall = { x: this.ballVis.x, z: this.ballVis.z };
    void h;
  }

  dispose() {
    for (const pm of this.models.values()) { pm.dispose(); this.group.remove(pm.root); }
    this.ball.geometry.dispose();
    this.ball.material.map.dispose();
    this.ball.material.dispose();
    this.blob.geometry.dispose();
    this.blob.material.map.dispose();
    this.blob.material.dispose();
    this.scene.remove(this.group);
  }
}
