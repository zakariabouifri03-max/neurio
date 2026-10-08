// PlayerModel: a low-poly original futsal player built from primitives.
// Kit colours come from the team's kit; the shirt number is drawn to a small canvas sprite.
// Animation is procedural: leg/arm swing from ground speed, lean while sliding, lying when down.
import * as THREE from 'three';
import { PLAYER } from '../config.js';

const SKIN = ['#f1c7a5', '#d9a57c', '#b07a52', '#8a5a3b', '#5b3a26', '#ffdcb8'];

function numberSprite(num, color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
  g.fillStyle = color;
  g.font = 'bold 82px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
}

export class PlayerModel {
  // f: Footballer, kit: { shirt, trim, shorts, socks }, opts: { shadows, gkKit }
  constructor(f, kit, opts = {}) {
    this.f = f;
    this.root = new THREE.Group();     // world placement and heading
    this.body = new THREE.Group();     // lean / lying pose
    this.root.add(this.body);
    this.phase = 0;
    this.lean = 0;
    this.down = 0;                     // 0 standing .. 1 lying
    const shadows = !!opts.shadows;
    const isGK = f.role === 'GK';
    const shirt = new THREE.MeshStandardMaterial({ color: isGK ? (opts.gkKit || '#e9f56b') : kit.shirt, roughness: 0.7 });
    const trim = new THREE.MeshStandardMaterial({ color: kit.trim, roughness: 0.7 });
    const shorts = new THREE.MeshStandardMaterial({ color: isGK ? '#2b2f36' : kit.shorts, roughness: 0.8 });
    const socks = new THREE.MeshStandardMaterial({ color: kit.socks, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN[f.id % SKIN.length], roughness: 0.6 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5 });
    this.materials = [shirt, trim, shorts, socks, skin, shoe];

    const add = (geo, mat, x, y, z, parent = this.body) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadows;
      parent.add(m);
      return m;
    };

    // torso (capsule) with a trim stripe at the collar
    this.torso = add(new THREE.CapsuleGeometry(0.2, 0.46, 4, 10), shirt, 0, 1.18, 0);
    add(new THREE.TorusGeometry(0.11, 0.025, 6, 12), trim, 0, 1.56, 0.02).rotation.x = Math.PI / 2;
    // head + a simple hair cap
    add(new THREE.SphereGeometry(0.13, 14, 10), skin, 0, 1.62, 0);
    add(new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: 0x1b1310, roughness: 0.9 }), 0, 1.64, -0.01);

    // arms: pivot at the shoulders
    this.arms = [-1, 1].map((side) => {
      const piv = new THREE.Group();
      piv.position.set(0.24 * side, 1.36, 0);
      this.body.add(piv);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.34, 3, 6), shirt);
      arm.position.y = -0.24;
      arm.castShadow = shadows;
      piv.add(arm);
      return piv;
    });

    // legs: hip pivots, shorts, socks, shoes
    this.legs = [-1, 1].map((side) => {
      const piv = new THREE.Group();
      piv.position.set(0.1 * side, 0.82, 0);
      this.body.add(piv);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.4, 8), shorts);
      thigh.position.y = -0.2;
      thigh.castShadow = shadows;
      piv.add(thigh);
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.4, 8), socks);
      sock.position.y = -0.6;
      sock.castShadow = shadows;
      piv.add(sock);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.26), shoe);
      foot.position.set(0, -0.84, 0.05);
      foot.castShadow = shadows;
      piv.add(foot);
      return piv;
    });

    // shirt number (sprite, always facing the camera)
    this.number = numberSprite(f.number, '#ffffff');
    this.number.position.set(0, 2.06, 0);
    this.number.scale.set(0.42, 0.42, 1);
    this.body.add(this.number);

    // ground ring: shows the human-controlled footballer
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.visible = false;
    this.root.add(this.ring);
  }

  // Sync the model to the footballer state. dt in seconds.
  update(dt, human) {
    const f = this.f;
    const vx = f.vel.x, vz = f.vel.z;
    const speed = Math.hypot(vx, vz);
    this.root.position.set(f.pos.x, 0, f.pos.z);
    // model faces +z locally; heading is atan2(z, x)
    this.root.rotation.y = Math.PI / 2 - f.heading;
    this.phase += dt * speed * 3.2;
    const swing = Math.min(1, speed / 6) * 0.7;
    this.legs[0].rotation.x = Math.sin(this.phase) * swing;
    this.legs[1].rotation.x = -Math.sin(this.phase) * swing;
    this.arms[0].rotation.x = -Math.sin(this.phase) * swing * 0.8;
    this.arms[1].rotation.x = Math.sin(this.phase) * swing * 0.8;
    const sliding = f.tackleT > 0 || f.diveT > 0 || f.isDown;
    const targetLean = sliding ? 0.9 : 0.06 * Math.min(1, speed / 6);
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 10);
    this.body.rotation.x = this.lean;
    const downTarget = f.isDown ? 1 : 0;
    this.down += (downTarget - this.down) * Math.min(1, dt * 8);
    this.body.position.y = -0.9 * this.down;
    this.body.rotation.z = (this.down * Math.PI) / 2;
    if (f.kickAnimT > 0) {
      this.arms[0].rotation.x = -0.5;
      this.arms[1].rotation.x = 0.5;
    }
    this.number.visible = !f.isDown || this.down < 0.6;
    this.ring.visible = !!human;
    this.root.visible = f.visible !== false && !f.sentOff;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}

export { PLAYER };
