// ── Streamer Life — main game ───────────────────────────────────────────────
import * as THREE from 'three';
import { World, HOUSE_ORIGIN } from './world.js';
import { Player } from './player.js';
import { PCDesktop } from './pc.js';
import { UI } from './ui.js';
import { Net } from './net.js';
import { NPCs } from './npc.js';
import { T } from './tex.js';
import { clamp, lerp, rnd, ri, pick, money, short, $, el } from './util.js';
import { HOUSES, PCS, GEAR, CARS, FOOD, CLOTHES, FURNITURE, GAMES, CHAT_LINES, DON_MSG, SPONSORS,
  COMPONENTS, CATS, compById, STREAM_QUALITY } from './data.js';

const SAVE_KEY = 'slm2_save';

const defaultSave = () => ({
  name: 'Streamer', money: 350, bank: 0, loan: 0,
  followers: 12, subs: 0, day: 1, time: 9 * 60,
  house: 1, houses: [1], cars: [], car: null, pc: 'pc0',
  gear: [], games: ['g1', 'g2'], clothes: ['c1'], furniture: [], sponsors: [],
  // PC build (Zamazor components)
  parts: ['cpu1', 'gpu1', 'ram1', 'mb1', 'hdd1', 'mon1', 'kb1', 'ms1', 'ch1', 'dsk1'],
  rig: { cpu: 'cpu1', gpu: 'gpu1', ram: 'ram1', mb: 'mb1', hdd: 'hdd1', monitor: 'mon1', kb: 'kb1', mouse: 'ms1', chair: 'ch1', desk: 'dsk1' },
  streamKey: String(Math.floor(100000 + Math.random() * 899999)),
  bitrate: 2500, fps: 30, quality: '480p', viruses: 0, antivirus: false, wallpaper: null,
  stats: { energy: 90, hunger: 80, hygiene: 85, mood: 75 },
  posts: [], mail: [], clips: 0, videos: 0, fridge: 2, fitness: 0,
  streams: 0, bestViewers: 0, totalEarned: 0, hoursStreamed: 0,
});

export class Game {
  constructor() {
    this.save = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') || defaultSave();
    this.settings = JSON.parse(localStorage.getItem('slm2_settings') || 'null') ||
      { sens: 1, fov: 78, quality: 'high', shadows: true, music: .4, sfx: .7, invertY: false, touch: 'ontouchstart' in window };
    this.stream = { live: false, viewers: 0, time: 0, hype: 1, earned: 0, newFollowers: 0, ui: null };
    this.insideHouse = 0;
    this.paused = false;
    this.mode = 'solo';
    this.clock = new THREE.Clock();
    this.migrate();
    this.ui = new UI(this);
    this.initThree();
    this.world = new World(this);
    this.scene.add(this.world.root);
    this.player = new Player(this);
    this.pc = new PCDesktop(this);
    this.net = new Net(this);
    this.scene.add(this.net.group);
    this.npcs = new NPCs(this);
    this.scene.add(this.npcs.group);
    this.bindInput();
    this.applySettings();
    this.spawnCars();
    this.applyFurniture();
    this.loop();
  }

  // ── three setup ────────────────────────────────────────────────────────
  initThree() {
    const canvas = $('c');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xaec6df, .0045);
    this.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, .08, 900);

    // sky dome
    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 20),
      new THREE.MeshBasicMaterial({ map: T.skyGradient(), side: THREE.BackSide, fog: false }));
    this.scene.add(sky); this.sky = sky;

    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x50483c, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d4, 2.0);
    this.sun.position.set(60, 90, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 260;
    this.scene.add(this.sun); this.scene.add(this.sun.target);

    addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    });
  }

  applySettings() {
    const s = this.settings;
    this.camera.fov = s.fov; this.camera.updateProjectionMatrix();
    this.renderer.shadowMap.enabled = s.shadows;
    this.renderer.setPixelRatio(s.quality === 'low' ? 0.7 : s.quality === 'med' ? Math.min(devicePixelRatio, 1.2) : Math.min(devicePixelRatio, 2));
    this.scene.traverse(o => { if (o.isMesh) o.material.needsUpdate = true; });
    $('touch').classList.toggle('on', !!s.touch);
    localStorage.setItem('slm2_settings', JSON.stringify(s));
  }

  // ── cars in world ──────────────────────────────────────────────────────
  spawnCars() {
    this.carMeshes = {};
    const s = this.save;
    for (const def of CARS) {
      const c = this.buildCar(def);
      c.visible = false;
      c.position.set(-52 + CARS.indexOf(def) * 7, 0, -58);
      this.scene.add(c);
      this.carMeshes[def.id] = c;
    }
    this.refreshCars();
  }
  refreshCars() {
    for (const id in this.carMeshes) this.carMeshes[id].visible = this.save.cars.includes(id);
  }
  buildCar(def) {
    const g = new THREE.Group();
    const m = (c, met = .6, r = .3) => new THREE.MeshStandardMaterial({ color: c, metalness: met, roughness: r });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1, 2), m(def.color));
    body.position.y = .85; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, .85, 1.85), m(0x1b2733, .3, .15));
    cab.position.set(-.2, 1.6, 0); g.add(cab);
    for (const [x, z] of [[1.4, 1.02], [1.4, -1.02], [-1.4, 1.02], [-1.4, -1.02]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, .32, 16), m(0x111317, .1, .95));
      w.rotation.x = Math.PI / 2; w.position.set(x, .45, z); w.userData.wheel = true; g.add(w);
    }
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(.12, .25, .5), new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xfff0b0, emissiveIntensity: 1 }));
      h.position.set(2.2, .95, s * .6); g.add(h);
      const t = new THREE.Mesh(new THREE.BoxGeometry(.1, .2, .45), new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2010, emissiveIntensity: .8 }));
      t.position.set(-2.2, .95, s * .6); g.add(t);
    }
    // ── cockpit interior (visible in first-person driving) ──────────────
    const dark = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: .8, side: THREE.DoubleSide });
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.9, .42, .55), dark(0x1a1d24));
    dash.position.set(.55, 1.3, 0); g.add(dash);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(.26, .045, 10, 22), dark(0x23262c));
    wheel.position.set(.22, 1.3, -.42); wheel.rotation.y = Math.PI / 2; wheel.rotation.x = .5;
    g.add(wheel);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(.04, .24, .03), dark(0x2a2e36));
      spoke.position.set(0, 0, 0); spoke.rotation.z = i * 2.1; wheel.add(spoke);
    }
    const cluster = new THREE.Mesh(new THREE.BoxGeometry(.5, .2, .04),
      new THREE.MeshStandardMaterial({ color: 0x0a1018, emissive: 0x16304a, emissiveIntensity: .8 }));
    cluster.position.set(.3, 1.44, -.42); cluster.rotation.y = Math.PI / 2; g.add(cluster);
    const seatM = dark(0x2b2f38);
    for (const sz of [-.42, .42]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(.5, .12, .52), seatM);
      seat.position.set(-.1, 1.05, sz); g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(.12, .66, .5), seatM);
      back.position.set(-.42, 1.35, sz); g.add(back);
    }
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(.5, .13, .05), dark(0x12151a));
    mirror.position.set(.7, 1.78, 0); g.add(mirror);

    g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
    g.userData = { topSpeed: def.speed, id: def.id, wheelMesh: wheel };
    return g;
  }

  applyFurniture() {
    // show owned decor inside the current house
    const s = this.save;
    for (const id of [1, 2, 3]) {
      const host = this.houseFurniture?.[id];
      if (!host) continue;
      host.children.filter(c => c.userData.decor).forEach(c => host.remove(c));
      s.furniture.forEach((fid, i) => {
        const def = FURNITURE.find(f => f.id === fid); if (!def) return;
        const g = new THREE.Group(); g.userData.decor = true;
        const col = new THREE.Color().setHSL((i * .17) % 1, .7, .5);
        const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: .45, roughness: .4 });
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, .5), m);
        b.position.set(-4 + i * 1.8, 1.3, -(id === 1 ? 3.9 : id === 2 ? 5.9 : 8.4) + .4);
        g.add(b);
        host.add(g);
      });
    }
  }

  // ── flow ───────────────────────────────────────────────────────────────
  startGame(mode, cont = false, net = null) {
    this.mode = mode;
    if (!cont) { this.save = defaultSave(); this.sync(); }
    this.ui.hideMenu();
    this.insideHouse = 0;
    this.player.pos.set(-60, 0, -55);
    this.refreshCars(); this.applyFurniture();
    if (mode === 'multi' && net) this.net.connect(net.srv, net.room, this.save.name);
    this.toast('👋 Salam ' + this.save.name + '! Enter your house (🚪) and start streaming.');
    this.grabMouse();
  }

  enterHouse(id) {
    if (!this.save.houses.includes(id)) {
      const h = HOUSES.find(x => x.id === id);
      return this.ui.openPanel('🏠 ' + h.name, `<p>${h.desc}</p><div class="cPrice big">${money(h.price)}</div>
        <button class="btn big" id="buyH">BUY THIS HOUSE</button>`, () => {
        $('buyH').onclick = () => {
          if (!this.spend(h.price)) return;
          this.save.houses.push(id); this.save.house = id; this.sync();
          this.ui.closePanel(); this.toast('🎉 New house unlocked!'); this.enterHouse(id);
        };
      });
    }
    this.save.house = id;
    this.insideHouse = id;
    const o = HOUSE_ORIGIN[id];
    const d = id === 1 ? 9 : id === 2 ? 13 : 18;
    this.player.pos.set(o.x, 0, o.z + d / 2 - 2);
    this.player.yaw = Math.PI;
    this.scene.fog.density = .0001;
    this.grabMouse();
  }
  exitHouse() {
    const id = this.insideHouse;
    this.insideHouse = 0;
    const plots = { 1: [-60, -70], 2: [0, -70], 3: [60, -70] };
    const sizes = { 1: 9, 2: 12, 3: 17 };
    this.player.pos.set(plots[id][0], 0, plots[id][1] + sizes[id] / 2 + 3);
    this.scene.fog.density = .0045;
  }

  openShop(kind) { this.ui.shop(kind); }
  openPC() { this.pc.show(); this.releaseMouse(); }
  closePC() { this.pc.hide(); this.grabMouse(); }

  // ── economy helpers ────────────────────────────────────────────────────
  spend(n) {
    if (this.save.money < n) { this.toast('❌ Not enough money — ' + money(n) + ' needed'); return false; }
    this.save.money -= n; this.sync(); return true;
  }
  earn(n) { this.save.money += n; this.save.totalEarned += n; this.sync(); }
  loanMax() { return Math.round(5000 + this.save.followers * 12 + this.save.totalEarned * .15); }

  buy(kind, it) {
    const s = this.save;
    if (!this.spend(it.price)) return false;
    if (kind === 'pc') s.pc = it.id;
    else if (kind === 'gear') { s.gear = s.gear.filter(g => GEAR.find(x => x.id === g)?.slot !== it.slot); s.gear.push(it.id); }
    else if (kind === 'car') { s.cars.push(it.id); this.refreshCars(); }
    else if (kind === 'furn') { s.furniture.push(it.id); this.applyFurniture(); }
    else if (kind === 'clothes') s.clothes.push(it.id);
    else if (kind === 'part') { s.parts.push(it.id); this.autoInstall(it.id); }
    this.toast(`${it.icon} Bought ${it.name}`);
    this.sync(); return true;
  }

  migrate() {
    const s = this.save, d = defaultSave();
    for (const k in d) if (s[k] === undefined) s[k] = d[k];
    if (!s.rig || typeof s.rig !== 'object') s.rig = d.rig;
    for (const k in d.rig) if (s.rig[k] === undefined && d.rig[k]) s.rig[k] = d.rig[k];
    if (!Array.isArray(s.parts)) s.parts = d.parts;
  }

  /** sum of installed core components (cpu/gpu/ram/mb/hdd + small bonuses) */
  pcPower() {
    const s = this.save;
    let core = 0, missing = false;
    for (const c of CATS) {
      const inst = compById(s.rig[c.id]);
      if (c.core && !inst) missing = true;
      core += inst?.perf || 0;
    }
    if (missing) core = Math.max(0, core * .35);               // incomplete build = unstable
    const virus = 1 - Math.min(.6, (s.viruses || 0) * .12);
    return Math.max(1, Math.round(core * virus));
  }
  /** stream quality from monitor / mic / cam / light / router */
  gearQuality() {
    const s = this.save;
    let q = 0;
    for (const c of CATS) q += compById(s.rig[c.id])?.qual || 0;
    return 1 + q * .8;
  }
  maxQuality() {
    const p = this.pcPower();
    return [...STREAM_QUALITY].reverse().find(q => q.need <= p) || STREAM_QUALITY[0];
  }
  maxBitrate() { return Math.round(1500 + this.gearQuality() * 1400); }
  qualityMult() { return (STREAM_QUALITY.find(q => q.id === this.save.quality) || STREAM_QUALITY[0]).mult; }
  autoInstall(id) {
    const c = compById(id); if (!c) return;
    const cur = compById(this.save.rig[c.cat]);
    if (!cur || (c.perf + c.qual) >= (cur.perf + cur.qual)) this.save.rig[c.cat] = id;
  }
  decorBonus() { return this.save.furniture.reduce((a, id) => a + (FURNITURE.find(f => f.id === id)?.viewers || 0), 0); }
  styleBonus() { return 1 + this.save.clothes.reduce((a, id) => a + (CLOTHES.find(c => c.id === id)?.style || 0), 0) * .01; }
  level() { return Math.max(1, Math.floor(Math.log10(Math.max(10, this.save.followers)) * 4)); }
  passiveIncome() { return Math.round(this.save.videos * 35 + this.save.subs * 2.5); }

  estimateViewers(type, game, qualityId) {
    const s = this.save;
    const base = 6 + Math.pow(s.followers, .78) * .55;
    const hype = (game?.hype || 1) * (type?.mult || 1);
    const q = (this.pcPower() * .6 + this.gearQuality() * .9) / 6 + .6;
    const houseB = HOUSES.find(h => h.id === s.house)?.viewerBonus || 1;
    const mood = .6 + s.stats.mood / 160;
    const qm = (STREAM_QUALITY.find(x => x.id === (qualityId || s.quality)) || STREAM_QUALITY[0]).mult;
    return Math.max(1, Math.round(base * hype * q * houseB * mood * qm * (1 + this.decorBonus()) * this.styleBonus()));
  }

  startStream(type, game, title) {
    this.stream = {
      live: true, viewers: 0, target: this.estimateViewers(type, game), time: 0, hype: 1,
      earned: 0, newFollowers: 0, type, game, title: title || 'LIVE', ui: this.stream.ui, chatT: 0, donT: 0,
    };
    this.save.streams++;
    this.toast('🔴 You are LIVE!');
  }

  streamAction(kind) {
    const st = this.stream; if (!st.live) return;
    if (kind === 'hype') { st.hype = Math.min(3, st.hype + .22); this.addStat('energy', -2); this.addStat('mood', -1); this.chatBurst('KEKW 😂', 4); }
    if (kind === 'read') { const f = Math.round(st.viewers * .08) + 2; this.save.followers += f; st.newFollowers += f; this.chatBurst('he said my name!! 🥹', 3); }
    if (kind === 'raid') { st.viewers *= 1.12; st.target *= 1.08; this.chatBurst('raid incoming 📢', 3); }
  }

  chatBurst(line, n) {
    for (let i = 0; i < n; i++) this.pushChat(pick(CHAT_LINES));
    this.pushChat(line);
  }
  pushChat(msg, cls = '') {
    const name = pick(['xX_amine_Xx', 'noor_22', 'simo', 'GamerDZ', 'tanja_boy', 'kawtar', 'mehdi_tv', 'anonymous', 'najwa', 'rayan7']);
    this.pc.pushChatLine(`<b style="color:hsl(${(name.length * 47) % 360},70%,65%)">${name}</b> ${msg}`, cls);
  }

  endStream() {
    const st = this.stream;
    if (!st.live) return;
    const hrs = st.time / 60;
    this.save.hoursStreamed = (this.save.hoursStreamed || 0) + hrs;
    this.save.clips += Math.max(0, Math.floor(hrs * 1.5));
    const sponsorPay = this.save.sponsors.reduce((a, id) => a + (SPONSORS.find(s => s.id === id)?.pay || 0), 0) * Math.min(1, hrs / 2);
    this.earn(sponsorPay);
    this.toast(`⏹️ Stream ended · ${money(st.earned + sponsorPay)} · +${short(st.newFollowers)} followers`);
    this.stream = { live: false, viewers: 0, ui: null, hype: 1, earned: 0, newFollowers: 0, time: 0 };
  }

  tickStream(dt) {
    const st = this.stream; if (!st.live) return;
    const s = this.save;
    const gm = dt * this.timeScale(); // game minutes
    st.time += gm;
    st.hype = Math.max(.6, st.hype - dt * .035);
    const target = st.target * st.hype * (s.stats.energy > 25 ? 1 : .5);
    st.viewers = lerp(st.viewers, target * rnd(1.08, .92), 1 - Math.pow(.25, dt));
    s.bestViewers = Math.max(s.bestViewers, Math.round(st.viewers));

    // money: ads + bits
    const inc = st.viewers * dt * .022 * (1 + this.gearQuality() * .02);
    st.earned += inc; this.earn(inc);

    // followers
    const f = st.viewers * dt * .02;
    s.followers += f; st.newFollowers += f;
    // subs
    if (Math.random() < dt * st.viewers * .0012) { s.subs++; this.pushChat('just subscribed! ⭐', 'sub'); }

    // chat flow
    st.chatT -= dt;
    if (st.chatT <= 0) { st.chatT = clamp(2.2 / Math.max(1, Math.log10(st.viewers + 2) * 2), .12, 2); this.pushChat(pick(CHAT_LINES)); }
    st.donT -= dt;
    if (st.donT <= 0) {
      st.donT = rnd(45, 14) / Math.max(.5, Math.log10(st.viewers + 10));
      const amt = Math.round(rnd(60, 2) * (1 + Math.log10(st.viewers + 10)));
      this.earn(amt); st.earned += amt;
      this.pushChat(`💸 donated ${money(amt)} — "${pick(DON_MSG)}"`, 'don');
    }
    // needs drain faster while live
    this.addStat('energy', -dt * .55);
    this.addStat('mood', -dt * .18);

    if (st.ui) {
      st.ui.v.textContent = short(st.viewers);
      st.ui.f.textContent = short(st.newFollowers);
      st.ui.m.textContent = money(st.earned);
      st.ui.t.textContent = `${Math.floor(st.time / 60)}:${String(Math.floor(st.time % 60)).padStart(2, '0')}`;
      st.ui.h.textContent = Math.round(st.hype * 100) + '%';
    }
    if (s.stats.energy <= 0) { this.toast('😵 You passed out on stream!'); this.endStream(); this.sleep(true); }
  }

  // ── needs / time ───────────────────────────────────────────────────────
  addStat(k, v) { const st = this.save.stats; st[k] = clamp(st[k] + v, 0, 100); }
  timeScale() { return 1.0; } // 1 real second = 1 game minute

  clockString() {
    const t = this.save.time % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  }
  advanceTime(hours) {
    this.save.time += hours * 60;
    while (this.save.time >= 1440) { this.save.time -= 1440; this.newDay(); }
  }
  newDay() {
    const s = this.save;
    s.day++;
    s.bank = Math.round(s.bank * 1.02);
    s.loan = Math.round(s.loan * 1.05);
    const passive = this.passiveIncome();
    if (passive) { this.earn(passive); s.mail.push({ from: 'StreamerHub', subj: 'Daily payout', body: `You earned ${money(passive)} from subs & videos.` }); }
    const bills = Math.round(60 + s.houses.reduce((a, h) => a + h * 90, 0));
    s.money -= bills;
    if (!s.antivirus && Math.random() < .35) { s.viruses++; this.toast('🦠 Your PC caught a virus — run the Virus Scanner'); }
    this.toast(`🌅 Day ${s.day} · payout ${money(passive)} · bills -${money(bills)}`);
    this.sync();
  }

  sleep(forced = false) {
    const s = this.save;
    const hrs = forced ? 10 : 8;
    this.advanceTime(hrs);
    this.addStat('energy', 100); this.addStat('mood', 15); this.addStat('hunger', -25); this.addStat('hygiene', -15);
    this.toast('😴 Slept ' + hrs + ' hours');
    this.sync();
  }
  eat() {
    const s = this.save;
    if ((s.fridge || 0) <= 0) return this.toast('🧊 Fridge empty — buy food at the Supermarket');
    s.fridge--; this.addStat('hunger', 42); this.addStat('mood', 6); this.advanceTime(.5);
    this.toast('🍽️ Ate something good'); this.sync();
  }
  shower() { this.addStat('hygiene', 100); this.addStat('mood', 8); this.advanceTime(.5); this.toast('🚿 Fresh!'); this.sync(); }
  relax() { this.addStat('mood', 22); this.addStat('energy', 8); this.advanceTime(1.5); this.toast('📺 Relaxed'); this.sync(); }

  // ── input ──────────────────────────────────────────────────────────────
  bindInput() {
    const p = this.player, canvas = $('c');
    addEventListener('keydown', e => {
      if (e.code === 'Enter' && this.mode === 'multi' && !this.pc.open) { this.chatInput(); return; }
      p.keys[e.code] = true;
      if (e.code === 'KeyE') this.tryInteract();
      if (e.code === 'KeyF') this.tryCar();
      if (e.code === 'KeyV' && this.player.inCar) {
        this.player.firstPersonCar = !this.player.firstPersonCar;
        this.toast(this.player.firstPersonCar ? '🎥 Cockpit view' : '🎥 Chase view');
      }
      if (e.code === 'Tab') { e.preventDefault(); $('map').classList.toggle('on'); }
      if (e.code === 'Escape') {
        if (this.pc.open) this.closePC();
        else if ($('panel').classList.contains('on')) this.ui.closePanel();
        else if (!this.ui.menu.classList.contains('on')) this.setPaused(!this.paused);
      }
    });
    addEventListener('keyup', e => { p.keys[e.code] = false; });
    canvas.addEventListener('click', () => { if (!this.paused && !this.pc.open && !this.ui.menu.classList.contains('on')) this.grabMouse(); });
    addEventListener('mousemove', e => {
      if (document.pointerLockElement !== canvas) return;
      const s = this.settings.sens * .0022;
      p.look.x += e.movementX * s;
      p.look.y += e.movementY * s * (this.settings.invertY ? -1 : 1);
    });
    // touch
    this.bindTouch();
  }
  grabMouse() { if (!('ontouchstart' in window)) $('c').requestPointerLock?.(); }
  releaseMouse() { document.exitPointerLock?.(); }

  bindTouch() {
    const p = this.player;
    const stick = $('stick'), knob = $('knob');
    let sid = null, cx = 0, cy = 0;
    stick.addEventListener('touchstart', e => { const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
    addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) {
          const dx = clamp((t.clientX - cx) / 55, -1, 1), dy = clamp((t.clientY - cy) / 55, -1, 1);
          p.move.x = dx; p.move.y = -dy;
          knob.style.transform = `translate(${dx * 38}px,${dy * 38}px)`;
        } else if (t.identifier === this.lookId) {
          const s = this.settings.sens * .004;
          p.look.x += (t.clientX - this.lx) * s; p.look.y += (t.clientY - this.ly) * s * (this.settings.invertY ? -1 : 1);
          this.lx = t.clientX; this.ly = t.clientY;
        }
      }
    }, { passive: false });
    addEventListener('touchend', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) { sid = null; p.move.x = p.move.y = 0; knob.style.transform = ''; }
        if (t.identifier === this.lookId) this.lookId = null;
      }
    });
    $('c').addEventListener('touchstart', e => {
      const t = e.changedTouches[0];
      if (t.clientX > innerWidth * .35) { this.lookId = t.identifier; this.lx = t.clientX; this.ly = t.clientY; }
    }, { passive: true });
    $('tE').onclick = () => this.tryInteract();
    $('tF').onclick = () => this.tryCar();
    $('tRun').ontouchstart = () => { p.sprinting = true; };
    $('tRun').ontouchend = () => { p.sprinting = false; };
    $('tPause').onclick = () => this.setPaused(!this.paused);
  }

  chatInput() {
    const i = $('mpInput');
    i.classList.add('on'); i.focus();
    this.releaseMouse();
    i.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (i.value.trim()) this.net.chat(i.value.trim());
        i.value = ''; i.classList.remove('on'); i.blur(); this.grabMouse();
      } else if (e.key === 'Escape') { i.value = ''; i.classList.remove('on'); i.blur(); this.grabMouse(); }
    };
  }

  tryInteract() {
    if (this.paused || this.pc.open) return;
    const near = this.nearest();
    if (near) near.fn();
  }
  tryCar() {
    const p = this.player;
    if (p.inCar) return p.exitCar();
    if (this.insideHouse) return;
    let best = null, bd = 4.5;
    for (const id in this.carMeshes) {
      const c = this.carMeshes[id]; if (!c.visible) continue;
      const d = c.position.distanceTo(p.pos);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) p.enterCar(best);
    else if (this.save.cars.length === 0) this.toast('🚗 You have no car — buy one at the Car Dealer');
  }
  nearest() {
    const p = this.player.pos;
    let best = null, bd = 1e9;
    for (const it of this.world.interactables) {
      if (it.houseId && it.houseId !== (this.insideHouse || it.houseId)) { }
      const d = it.pos.distanceTo(p);
      if (d < it.r && d < bd) {
        // interior interactables only when inside matching house
        const interior = it.pos.z > 900;
        if (interior && !this.insideHouse) continue;
        if (interior && Math.abs(it.pos.z - (900 + this.insideHouse * 100)) > 60) continue;
        if (!interior && this.insideHouse) continue;
        bd = d; best = it;
      }
    }
    return best;
  }

  setPaused(v) {
    this.paused = v;
    this.ui.pause(v);
    if (v) this.releaseMouse(); else this.grabMouse();
  }

  toast(m) { this.ui.toast(m); }
  sync() { this.ui.updateHUD(); if (this.pc.open) this.pc.refreshBar(); this.saveSoon(); }
  saveSoon() { clearTimeout(this._st); this._st = setTimeout(() => this.saveNow(), 800); }
  saveNow() { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); }

  // ── day/night visuals ──────────────────────────────────────────────────
  updateSky() {
    const t = (this.save.time % 1440) / 1440;      // 0..1
    const sunA = (t - .25) * Math.PI * 2;
    const h = Math.sin(sunA);
    this.sun.position.set(Math.cos(sunA) * 120, Math.max(-20, h * 130), 50);
    this.sun.target.position.set(this.player.pos.x, 0, this.player.pos.z);
    this.sun.intensity = clamp(h * 2.4, 0, 2.4);
    const night = clamp(-h * 1.4 + .25, 0, 1);
    this.hemi.intensity = lerp(1.1, .25, night);
    const dayCol = new THREE.Color(0xaec6df), nightCol = new THREE.Color(0x0a1026);
    const c = dayCol.clone().lerp(nightCol, night);
    this.scene.fog.color.copy(c);
    this.sky.material.color.copy(new THREE.Color(0xffffff).lerp(new THREE.Color(0x1a2342), night));
    this.renderer.toneMappingExposure = lerp(1.1, .75, night);
    for (const l of this.world.cityLights) l.material.emissiveIntensity = night > .35 ? 1.6 : 0;
  }

  // ── main loop ──────────────────────────────────────────────────────────
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(.05, this.clock.getDelta());
    if (!this.paused && !this.ui.menu.classList.contains('on')) {
      if (!this.pc.open) this.player.update(dt);
      this.advanceTime(dt * this.timeScale() / 60);
      // needs decay
      this.addStat('hunger', -dt * .35);
      this.addStat('hygiene', -dt * .22);
      this.addStat('energy', -dt * (this.pc.open ? .25 : .18));
      if (this.save.stats.hunger < 12 || this.save.stats.hygiene < 12) this.addStat('mood', -dt * .3);
      this.tickStream(dt);
      this.net.update(dt, this.player);
      this.npcs.update(dt, this.player);
      this.updateSky();
      // interaction prompt
      const n = this.nearest();
      this.ui.prompt(n ? n.label : (this.player.inCar ? '' : null));
      if (this.player.inCar) this.ui.carHud(Math.abs(this.player.carSpeed || 0) * 3.6);
      else this.ui.carHud(null);
      this._hudT = (this._hudT || 0) + dt;
      if (this._hudT > .2) { this._hudT = 0; this.ui.updateHUD(); }
      this._saveT = (this._saveT || 0) + dt;
      if (this._saveT > 20) { this._saveT = 0; this.saveNow(); }
    }
    this.player.applyCamera(this.camera);
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
