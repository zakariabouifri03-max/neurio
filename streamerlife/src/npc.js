// ── town NPCs: pedestrians walking the sidewalks ───────────────────────────
import * as THREE from 'three';
import { rnd, pick, ri } from './util.js';
import { NPC_NAMES } from './data.js';

const ROADS = [-120, -60, 0, 60, 120];

export class NPCs {
  constructor(game, count = 26) {
    this.game = game;
    this.group = new THREE.Group();
    this.list = [];
    for (let i = 0; i < count; i++) this.spawn();
  }

  body() {
    const g = new THREE.Group();
    const skinH = [0.07, 0.08, 0.09][ri(0, 2)];
    const skin = new THREE.Color().setHSL(skinH, rnd(.45, .25), rnd(.62, .32));
    const shirt = new THREE.Color().setHSL(Math.random(), rnd(.7, .3), rnd(.6, .25));
    const pants = new THREE.Color().setHSL(rnd(.7, .55), .3, rnd(.4, .15));
    const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: .85 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.3, .68, 4, 10), m(shirt));
    torso.position.y = 1.08; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.25, 14, 10), m(skin));
    head.position.y = 1.74; g.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(.26, 12, 8, 0, Math.PI * 2, 0, 1.2),
      m(new THREE.Color().setHSL(.08, .5, rnd(.3, .05))));
    hair.position.y = 1.78; g.add(hair);

    const legs = [];
    for (const sx of [-.14, .14]) {
      const l = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .52, 4, 8), m(pants));
      l.position.set(sx, .44, 0); g.add(l); legs.push(l);
    }
    const arms = [];
    for (const sx of [-.42, .42]) {
      const a = new THREE.Mesh(new THREE.CapsuleGeometry(.1, .5, 4, 8), m(shirt));
      a.position.set(sx, 1.12, 0); g.add(a); arms.push(a);
    }
    g.traverse(o => { o.castShadow = true; });
    return { g, legs, arms };
  }

  spawn() {
    const { g, legs, arms } = this.body();
    const horiz = Math.random() < .5;
    const road = pick(ROADS), side = Math.random() < .5 ? 8.5 : -8.5;
    const along = rnd(170, -170);
    const pos = horiz ? new THREE.Vector3(along, 0, road + side) : new THREE.Vector3(road + side, 0, along);
    g.position.copy(pos);
    const dir = Math.random() < .5 ? 1 : -1;
    const npc = {
      g, legs, arms, horiz, dir, speed: rnd(1.9, 1.0), phase: Math.random() * 6,
      name: pick(NPC_NAMES), talk: 0,
    };
    g.rotation.y = horiz ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    this.group.add(g);
    this.list.push(npc);
  }

  update(dt, player) {
    for (const n of this.list) {
      const p = n.g.position;
      if (n.horiz) p.x += n.dir * n.speed * dt; else p.z += n.dir * n.speed * dt;
      const axis = n.horiz ? p.x : p.z;
      if (axis > 180 || axis < -180) {
        n.dir *= -1;
        n.g.rotation.y = n.horiz ? (n.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (n.dir > 0 ? 0 : Math.PI);
      }
      // walk animation
      n.phase += dt * n.speed * 4.4;
      const sw = Math.sin(n.phase) * .45;
      n.legs[0].rotation.x = sw; n.legs[1].rotation.x = -sw;
      n.arms[0].rotation.x = -sw * .8; n.arms[1].rotation.x = sw * .8;
      n.g.position.y = Math.abs(Math.sin(n.phase)) * .04;
      // hide when the player is inside a house (far away interior)
      n.g.visible = !this.game.insideHouse;
    }
  }
}
