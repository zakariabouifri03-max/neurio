// ── online multiplayer client (WebSocket) ──────────────────────────────────
import * as THREE from 'three';
import { el, $ } from './util.js';

export class Net {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.id = null;
    this.peers = new Map();   // id -> {mesh, label, target, data}
    this.group = new THREE.Group();
    this.connected = false;
    this.lastSend = 0;
  }

  connect(url, room, name) {
    try { this.ws = new WebSocket(url); } catch (e) { return this.fail(e.message); }
    this.room = room; this.name = name;
    this.ws.onopen = () => {
      this.connected = true;
      this.send({ t: 'join', room, name });
      this.game.toast('🌍 Connected — online!');
      $('mpBar').classList.add('on');
    };
    this.ws.onmessage = (e) => this.onMsg(JSON.parse(e.data));
    this.ws.onclose = () => { this.connected = false; this.game.toast('🔌 Disconnected'); $('mpBar').classList.remove('on'); this.clear(); };
    this.ws.onerror = () => this.fail('cannot reach server');
  }
  fail(m) { this.game.toast('❌ Multiplayer: ' + m + ' — playing solo'); }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  onMsg(m) {
    if (m.t === 'welcome') { this.id = m.id; this.updateCount(m.count); }
    else if (m.t === 'state') {
      for (const p of m.players) {
        if (p.id === this.id) continue;
        let peer = this.peers.get(p.id);
        if (!peer) peer = this.addPeer(p);
        peer.target.set(p.x, p.y, p.z);
        peer.yaw = p.r; peer.inside = p.h; peer.car = p.c;
        peer.mesh.visible = (p.h || 0) === (this.game.insideHouse || 0);
      }
      for (const [id, peer] of this.peers) if (!m.players.find(p => p.id === id)) { this.group.remove(peer.mesh); this.peers.delete(id); }
      this.updateCount(m.players.length);
    }
    else if (m.t === 'chat') this.chatLine(m.name, m.msg);
    else if (m.t === 'sys') this.chatLine('', m.msg, true);
  }

  updateCount(n) { const e = $('mpCount'); if (e) e.textContent = n; }

  addPeer(p) {
    const g = new THREE.Group();
    const skin = new THREE.Color().setHSL(.08, .4, .55);
    const shirt = new THREE.Color().setHSL(Math.random(), .6, .5);
    const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: .8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.32, .75, 4, 10), m(shirt)); body.position.y = 1.05; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.26, 16, 12), m(skin)); head.position.y = 1.75; g.add(head);
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(.17, .6, 4, 8), m(0x2b3440));
    legs.position.y = .45; g.add(legs);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .55, 4, 8), m(shirt));
      arm.position.set(s * .45, 1.1, 0); g.add(arm);
    }
    g.traverse(o => { o.castShadow = true; });
    // name tag
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const cx = cv.getContext('2d'); cx.fillStyle = 'rgba(0,0,0,.6)'; cx.fillRect(0, 0, 256, 64);
    cx.fillStyle = '#fff'; cx.font = 'bold 32px sans-serif'; cx.textAlign = 'center'; cx.fillText(p.name || 'player', 128, 42);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    tag.scale.set(1.6, .4, 1); tag.position.y = 2.25; g.add(tag);
    this.group.add(g);
    const peer = { mesh: g, target: new THREE.Vector3(p.x, p.y, p.z), yaw: 0, name: p.name };
    this.peers.set(p.id, peer);
    return peer;
  }

  clear() { for (const [, p] of this.peers) this.group.remove(p.mesh); this.peers.clear(); }

  update(dt, player) {
    for (const [, p] of this.peers) {
      p.mesh.position.lerp(p.target, 1 - Math.pow(.001, dt));
      p.mesh.rotation.y += ((p.yaw - p.mesh.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 10);
    }
    const now = performance.now();
    if (this.connected && now - this.lastSend > 60) {
      this.lastSend = now;
      this.send({
        t: 'pos', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2),
        r: +player.yaw.toFixed(2), h: this.game.insideHouse || 0, c: player.inCar ? 1 : 0,
      });
    }
  }

  chat(msg) { this.send({ t: 'chat', msg: msg.slice(0, 160) }); }

  chatLine(name, msg, sys = false) {
    const host = $('mpChat');
    host.appendChild(el('div', 'mpMsg' + (sys ? ' sys' : ''), sys ? msg : `<b>${name}:</b> ${msg.replace(/</g, '&lt;')}`));
    while (host.children.length > 30) host.firstChild.remove();
    host.scrollTop = host.scrollHeight;
  }
}
