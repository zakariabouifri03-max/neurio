// ============================================================
// ep2/world.js — LAST CALL map: Salma's apartment, the route 9
// drive, and Owl's Nest Diner (13:30 AM to 2 miles of nothing).
// Built on the shared World base class.
// ============================================================
import * as THREE from 'three';
import { rand, canvasTex, speckle, AABB, lerp } from '../src/utils.js';
import { World, Door, Drawer, WALL_H } from '../src/world.js';

const CW = '#3a3f46';

export class WorldE2 extends World {
  buildMap() {
    this._buildMaterials();
    this._buildOwnTextures();
    this._buildGround();
    this._buildSky();
    this._buildApartment();
    this._buildRoad();
    this._buildDinerExt();
    this._buildDinerInt();
    this._buildBackAlley();
    this._buildDriveCar();
    this._buildThinkers();
    // power circuits
    this.breaker = { MAIN: true, DINING: true, KITCHEN: true, SIGN: false, fuseIn: true };
    this._powerFlag = true;
  }

  // ---------------- own texture bits ----------------
  _buildOwnTextures() {
    const T = this.T;
    // diner parapet neon
    T.dinerSign = canvasTex(512, 128, (c, w, h) => {
      c.fillStyle = '#0b0d12'; c.fillRect(0, 0, w, h);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = '#ff9a3d'; c.shadowBlur = 22;
      c.fillStyle = '#ffb35e'; c.font = 'bold 44px monospace';
      c.fillText("OWL'S NEST", w / 2, 40);
      c.shadowColor = '#4fc3f7'; c.fillStyle = '#7fd8ff'; c.font = 'bold 30px monospace';
      c.fillText('D I N E R', w / 2, 92);
      c.shadowBlur = 0;
    });
    // chalk menu board (English + Arabic)
    T.menuBoard = canvasTex(512, 256, (c, w, h) => {
      c.fillStyle = '#1c1e20'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#8a6a3a'; c.lineWidth = 6; c.strokeRect(4, 4, w - 8, h - 8);
      c.fillStyle = '#e8e4da'; c.textAlign = 'center';
      c.font = 'bold 26px monospace'; c.fillText('اسپشيال', 90, 40);
      c.font = 'bold 22px monospace'; c.fillText('SPECIALS', 150, 46);
      c.font = '18px monospace'; c.textAlign = 'left';
      const lines = [
        ['tagine oujda        52 d', 'طاجين وجدة'],
        ['merguez+frites        38 d', 'مرقاز + بطاطس'],
        ['harira zhona            18 d', 'الحريرة'],
        ['coffee? na                9 d', 'قهوة؟ لا'],
        ['tea na3na3                 8 d', 'أتاي'],
        ['mlawi sandwich 28', 'ملاوي'],
      ];
      lines.forEach(([en, ar], i) => {
        c.textAlign = 'left'; c.fillText(en, 26, 84 + i * 28);
        c.font = '18px monospace'; c.textAlign = 'right'; c.fillText(ar, w - 26, 84 + i * 28);
      });
    });
    // owl logo for pole sign
    T.owlLogo = canvasTex(128, 128, (c, w, h) => {
      c.fillStyle = '#0b0d12'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffb35e'; c.textAlign = 'center'; c.font = 'bold 90px monospace';
      c.fillText('☾', 64, 84);
      c.fillStyle = '#ffb35e'; c.beginPath(); c.arc(64, 62, 34, 0, 7); c.fill();
      c.fillStyle = '#0b0d12';
      c.beginPath(); c.arc(52, 56, 8, 0, 7); c.arc(76, 56, 8, 0, 7); c.fill();
      c.fillStyle = '#ffe9c9';
      c.beginPath(); c.arc(52, 56, 3, 0, 7); c.arc(76, 56, 3, 0, 7); c.fill();
      c.fillStyle = '#0b0d12'; c.beginPath(); c.moveTo(64, 62); c.lineTo(58, 74); c.lineTo(70, 74); c.fill();
      // ears
      c.fillStyle = '#ffb35e'; c.beginPath();
      c.moveTo(38, 40); c.lineTo(48, 28); c.lineTo(52, 42);
      c.moveTo(90, 40); c.lineTo(80, 28); c.lineTo(76, 42); c.fill();
    });
    // Arabic welcome mat
    T.matHome = canvasTex(128, 64, (c, w, h) => {
      c.fillStyle = '#4a3a2a'; c.fillRect(0, 0, w, h);
      speckle(c, w, h, 60, ['#3a2e20', '#5a4a34'], 2, 5);
      c.fillStyle = '#d8cdb4'; c.textAlign = 'center'; c.font = 'bold 22px monospace';
      c.fillText('مرحباً', w / 2, h / 2 + 8);
    });
    // cat face
    T.catFace = canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = '#22211f'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#d8b060';
      c.beginPath(); c.arc(20, 28, 6, 0, 7); c.arc(44, 28, 6, 0, 7); c.fill();
      c.fillStyle = '#22211f';
      c.beginPath(); c.arc(20, 28, 2.4, 0, 7); c.arc(44, 28, 2.4, 0, 7); c.fill();
      c.fillStyle = '#c98a6a'; c.beginPath(); c.moveTo(32, 36); c.lineTo(27, 42); c.lineTo(37, 42); c.fill();
    });
    // road lane dashes + parking stall texture
    T.roadStrip = canvasTex(64, 256, (c, w, h) => {
      c.fillStyle = '#20242a'; c.fillRect(0, 0, w, h);
      speckle(c, w, h, 180, ['#1b1f25', '#262b32'], 1, 3);
      c.fillStyle = '#b8a040';
      for (let y = 6; y < h; y += 64) c.fillRect(28, y, 8, 30);
    }, { repeat: [1, 30] });
    T.stall = canvasTex(128, 128, (c, w, h) => {
      c.fillStyle = '#20242a'; c.fillRect(0, 0, w, h);
      speckle(c, w, h, 120, ['#1b1f25', '#262b32'], 1, 3);
      c.strokeStyle = '#c9c2a8'; c.lineWidth = 3; c.strokeRect(6, 6, w - 12, h - 12);
    }, { repeat: [1, 1] });
    // freezer frost
    T.frost = canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = '#a8b8c0'; c.fillRect(0, 0, w, h);
      speckle(c, w, h, 90, ['#b8ccd6', '#96a8b4', '#d8ecf4'], 2, 6);
    });
    // chai menu coasters
    T.coaster = canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = '#c8b89a'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#8a2f2f'; c.textAlign = 'center'; c.font = 'bold 18px monospace';
      c.fillText('OWL', 32, 38);
    });
    // boss note (Arabic handwriting)
    T.noteAr = canvasTex(256, 192, (c, w, h) => {
      c.fillStyle = '#e8dfc4'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#d8cfae'; for (let y = 30; y < h; y += 26) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      c.fillStyle = '#2f2f4a'; c.font = '17px monospace'; c.textAlign = 'left';
      const ls = ['سلمى — القائمة على اللوح.', 'نوّل السواقيد قبل ١٢.', 'الضوء الخلفي محروق،', 'لسكلي ultor عليا.', 'الساعة ١١ ونص بنادم.', '— منير'];
      ls.forEach((t, i) => c.fillText(t, 14, 34 + i * 26));
    });
  }

  // ---------------- ground & sky ----------------
  _buildGround() {
    const M = this.M;
    // giant dirt base
    const g = new THREE.Mesh(new THREE.PlaneGeometry(600, 140), M.dirt);
    g.rotation.x = -Math.PI / 2; g.position.set(-110, -0.01, -12); g.receiveShadow = true;
    this.scene.add(g);
    this.addGroundCollider && this.addGroundCollider();
    // the road: z -22..-18, from x +16 to x -240
    const road = new THREE.Mesh(new THREE.PlaneGeometry(260, 4.6), M.asphalt);
    road.rotation.x = -Math.PI / 2; road.position.set(-112, 0.005, -20); road.receiveShadow = true;
    this.scene.add(road);
    // center dashes
    const dashes = new THREE.Mesh(new THREE.PlaneGeometry(260, 0.14), this.texMat(this.T.roadStrip));
    dashes.rotation.x = -Math.PI / 2; dashes.rotation.z = Math.PI / 2; dashes.position.set(-112, 0.012, -20);
    this.scene.add(dashes);
    // shoulders
    for (const s of [-25, -15]) {
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(260, 2.4), M.dirt);
      sh.rotation.x = -Math.PI / 2; sh.position.set(-112, 0.002, s); sh.receiveShadow = true;
      this.scene.add(sh);
    }
  }
  surfaceAt(x, z) {
    if (x > -4.2 && x < 4.2 && z > -2.2 && z < 6.2) return 'wood';      // apartment
    if (x > -214.4 && x < -199.6 && z > -2.2 && z < 6.2) return 'lino'; // diner
    if (z > -22.4 && z < -17.6) return 'asphalt';
    return 'dirt';
  }

  // ---------------- HOME ----------------
  _buildApartment() {
    const M = this.M, T = this.T;
    // building silhouette: flat at x -4..4, z -2..6 (a first-floor street-box)
    // walls
    this._roomShellE2(-4, 4, -2, 6, M.woodLight === undefined ? M.wallInt : M.wallInt, M.woodDark);
    // front door (south, enters stoop)
    const hd = new Door(this, 'home_door', -0.5, -1.98, { tex: T.door('#4a3a30'), label: 'Front door' });
    this.doors.set('home_door', hd);
    hd.setLocked(false);
    this.addInteract({
      id: 'home_door', meshes: [hd.mesh],
      label: () => hd.isOpen() ? 'Close the door' : 'Open the door',
      action: (G) => {
        if (!hd.isOpen()) { G.audio.doorCreak(true, { x: 0, y: 1.2, z: -2 }); hd.open(); G.story && G.story.hook('homeDoorOpen'); }
        else { G.audio.doorCreak(false, { x: 0, y: 1.2, z: -2 }); hd.close(); }
      },
    });
    // flat layout: living space (west) + kitchenette (east), small hall at door
    // rug + couch + floor lamp + tv
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), this.texMat(canvasTex(64, 64, (c, w, h) => { c.fillStyle = '#5a2f2a'; c.fillRect(0, 0, w, h); speckle(c, w, h, 80, ['#6a3a30', '#4a2622', '#7a443a'], 2, 4); }, { repeat: [3, 2] })));
    rug.rotation.x = -Math.PI / 2; rug.position.set(-1.6, 0.015, 2.2); rug.receiveShadow = true;
    this.scene.add(rug);
    // couch
    this.box(1.7, 0.5, 0.7, this.mat({ color: 0x4a3a3a }), -2.2, 0.25, 3.6, { collide: true, name: 'couch' });
    this.box(1.7, 0.45, 0.18, this.mat({ color: 0x4a3a3a }), -2.2, 0.72, 3.9, { name: 'couchback' });
    this.box(0.16, 0.62, 0.7, this.mat({ color: 0x4a3a3a }), -3.1, 0.31, 3.6, { collide: true, name: 'coucharm' });
    this.box(0.16, 0.62, 0.7, this.mat({ color: 0x4a3a3a }), -1.3, 0.31, 3.6, { collide: true, name: 'coucharm' });
    // tv stand + tv (playing static late movie feel)
    this.box(1.0, 0.5, 0.4, M.woodDark, -1.9, 0.25, 0.3, { collide: true, name: 'tvstand' });
    this.props.homeTv = this._tv(-1.9, 0.52, 0.3, 0);
    this.setTvNoise(this.props.homeTv, false);
    this.addInteract({
      id: 'home_tv', pos: new THREE.Vector3(-1.9, 1.0, 0.3), radius: 0.8,
      label: (G) => this.props.homeTv.userData.on ? 'Turn the TV off' : 'Turn the TV on',
      action: (G) => {
        const on = !this.props.homeTv.userData.on;
        this.setTvNoise(this.props.homeTv, on);
        if (on) G.audio.startStatic('hometv', { x: -1.9, y: 1.0, z: 0.3 }, 0.06); else G.audio.stopLoop('hometv');
        G.story && G.story.hook('homeTv', on);
      },
    });
    // floor lamp + ceiling light point
    const lampH = 2.0;
    const lpole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, lampH, 6), this.mat({ color: 0x6a5a40 }));
    lpole.position.set(-3.4, lampH / 2, 1.2); this.scene.add(lpole);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.22, 8, 1, true), this.emisMat(null, 0xffd9a8, 0.8));
    shade.material.color = new THREE.Color(0x402a18);
    shade.position.set(-3.4, lampH - 0.1, 1.2); this.scene.add(shade);
    this.addLight('home_lamp', -3.2, 1.6, 1.4, 0xffc890, 3.4, 8);
    this.addInteract({
      id: 'home_lamp_sw', pos: new THREE.Vector3(-3.4, 1.1, 1.2), radius: 0.7,
      label: () => this.lights.get('home_lamp').on ? 'Turn the lamp off' : 'Turn the lamp on',
      action: (G) => {
        const e = this.lights.get('home_lamp'); this.setLight('home_lamp', !e.on);
        G.audio.latch('switch', { x: -3.4, y: 1.1, z: 1.2 });
      },
    });
    // kitchenette: counter, fridge, stove, kettle, cat zone
    this.box(2.2, 0.9, 0.6, this.texMat(T.metalScratched = T.metalScratched || T.metal), 2.8, 0.45, 5.55, { collide: true, name: 'kcounter' });
    this.box(0.7, 1.7, 0.7, this.mat({ color: 0x8a8d92 }), 3.6, 0.85, 4.2, { collide: true, name: 'fridge' });
    this.addInteract({
      id: 'fridge', pos: new THREE.Vector3(3.6, 1.1, 4.2), radius: 0.8,
      label: () => 'Open the fridge',
      action: (G) => {
        G.audio.latch('locked', { x: 3.6, y: 1.1, z: 4.2 });
        G.ui.subtitle('SALMA', G.i18n ? G.i18n.S('Half a naner, juice for beetles, and mustard. Dinner planned.', 'نصف موزة، وعصير البنات، وصوص الخردل. عشاء رابح.') : 'Half a banana, juice, and mustard.', { thought: true, dur: 4 });
        G.story && G.story.hook('fridge');
      },
    });
    // stove + kettle
    this.box(0.7, 0.85, 0.6, this.mat({ color: 0x6a6d72 }), 0.8, 0.44, 5.55, { collide: true, name: 'stove' });
    this.props.kettle = this.box(0.16, 0.2, 0.16, this.mat({ color: 0xb8bcc2 }), 0.68, 1.0, 5.6, { name: 'kettle' });
    this.addInteract({
      id: 'kettle', meshes: [this.props.kettle],
      label: () => 'Cheat on coffee with tea',
      action: (G) => {
        G.audio.latch('switch', { x: 0.7, y: 1.0, z: 5.6 });
        G.story && G.story.hook('kettle');
      },
    });
    // coffee machine + mug (task: make coffee)
    this.box(0.26, 0.34, 0.24, this.mat({ color: 0x2a2a2e }), 2.25, 0.92 + 0.17, 5.6, { collide: true, name: 'coffee' });
    this.props.mug = this.box(0.08, 0.09, 0.08, this.mat({ color: 0xc94a4a }), 2.25, 1.0, 5.5, { name: 'mug' });
    this.addInteract({
      id: 'coffee', pos: new THREE.Vector3(2.25, 1.1, 5.55), radius: 0.75,
      label: () => 'Use the coffee machine',
      action: (G) => { G.story && G.story.hook('coffee'); },
    });
    // cat bowl + the cat
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.035, 8), this.mat({ color: 0x8a2f2f }));
    bowl.position.set(2.9, 0.018, 4.6); this.scene.add(bowl);
    this.props.catBowl = bowl;
    this.addInteract({
      id: 'catbowl', meshes: [bowl],
      label: () => "Fill Timo's bowl",
      action: (G) => { G.story && G.story.hook('catbowl'); },
    });
    const cat = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.3), this.mat({ color: 0x22211f }));
    body.position.y = 0.14;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.13), this.mat({ color: 0x22211f }));
    head.position.set(0, 0.24, 0.2);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.1), this.texMat(T.catFace));
    face.position.set(0, 0.24, 0.267);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.22), this.mat({ color: 0x22211f }));
    tail.position.set(0, 0.2, -0.24); tail.rotation.x = -0.6;
    cat.add(body, head, face, tail);
    cat.position.set(3.3, 0, 4.8); cat.rotation.y = -0.8;
    this.scene.add(cat);
    this.props.cat = cat;
    this.addInteract({
      id: 'cat', meshes: [body, head],
      label: () => 'Pet Timo',
      action: (G) => { G.story && G.story.hook('cat'); },
    });
    // window north w/ curtains + rain dots
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), M.glass);
    win.position.set(-1.4, 1.55, 5.99); win.rotation.y = Math.PI;
    this.scene.add(win);
    const rain = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), this.texMat(canvasTex(64, 64, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = 'rgba(120,140,160,.55)'; c.lineWidth = 1;
      for (let i = 0; i < 40; i++) { const x = rand(0, w), y = rand(0, h); c.beginPath(); c.moveTo(x, y); c.lineTo(x + 2, y + rand(4, 10)); c.stroke(); }
    }, { repeat: [1, 1] }), { transparent: true, opacity: 0.6 }));
    rain.position.set(-1.4, 1.55, 5.985); rain.rotation.y = Math.PI;
    this.scene.add(rain);
    this.props.rainWindow = rain;
    // keys + jacket on hooks by the door
    const hookB = this.box(0.5, 0.14, 0.03, M.woodDark, -0.95, 1.5, -1.9, { castShadow: false });
    const keyGrp = new THREE.Group();
    const kr = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 5, 10), this.mat({ color: 0xb0b0b0 }));
    keyGrp.add(kr); keyGrp.position.set(-0.98, 1.4, -1.87);
    this.scene.add(keyGrp);
    this.props.homeKeys = keyGrp;
    this.addInteract({
      id: 'homekeys', meshes: [keyGrp.children[0]],
      label: () => 'Take the keys',
      action: (G) => { G.story && G.story.hook('homeKeys'); },
    });
    const jacket = this.box(0.4, 0.62, 0.06, this.mat({ color: 0x2e3a44 }), -0.75, 1.2, -1.9, { name: 'jacket' });
    this.addInteract({
      id: 'jacket', meshes: [jacket],
      label: () => 'Take the jacket',
      action: (G) => { G.story && G.story.hook('jacket'); },
    });
    // boss's printed list note on kitchen counter
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.24), this.texMat(T.noteAr));
    note.rotation.x = -Math.PI / 2; note.rotation.z = -0.2; note.position.set(2.1, 0.912, 5.4);
    this.scene.add(note);
    this.props.bossNoteHome = note;
    this.addInteract({
      id: 'boss_note', meshes: [note],
      label: () => "Read Mounir's list",
      action: (G) => { G.story && G.story.hook('bossNoteHome'); },
    });
    // landing/stoop outside
    this.box(4.5, 0.12, 2.6, M.concrete, 0, 0.06, -3.4, { castShadow: false, name: 'stoop' });
    // neighbor facades (silhouettes) flanking the flat
    this.box(6, 5.6, 0.4, M.stucco, -7.2, 2.8, 6.2, { sight: false });
    this.box(6, 5.6, 0.4, M.stucco, 7.2, 2.8, 6.2, { sight: false });
    this.box(14, 5.6, 0.4, M.stucco, 0, 2.8, 6.2, { sight: false });
    // porch lamp over door
    this.glowSprite(T.glowDot, 0.0, 2.2, -2.3, 1.1, 0.3);
  }

  // helper: interior room shell (like ep1 _roomShell but as own-method, with south wall z0)
  _roomShellE2(x0, x1, z0, z1, wallMat, floorMat) {
    const M = this.M;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), floorMat || M.woodDark);
    floor.rotation.x = -Math.PI / 2; floor.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2); floor.receiveShadow = true;
    this.scene.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), M.ceiling);
    ceil.rotation.x = Math.PI / 2; ceil.position.set((x0 + x1) / 2, WALL_H, (z0 + z1) / 2);
    this.scene.add(ceil);
    // walls: exterior on outside, interior faces
    this.wallZ(z1, x0, x1, wallMat);      // north
    this.wallX(x0, z0, z1, wallMat);      // west
    this.wallX(x1, z0, z1, wallMat);      // east
    // south wall with door gap x -0.45..0.45
    const gL = [-0.48, 0.48];
    this.box(gL[0] - x0, WALL_H, 0.24, wallMat, (x0 + gL[0]) / 2, WALL_H / 2, z0, { collide: true, sight: true, name: 'wallS' });
    this.box(x1 - gL[1], WALL_H, 0.24, wallMat, (x1 + gL[1]) / 2, WALL_H / 2, z0, { collide: true, sight: true, name: 'wallS' });
    this.box(1.14, WALL_H - 2.05, 0.24, wallMat, 0, 2.05 + (WALL_H - 2.05) / 2, z0, { name: 'headerS' });
    this.box((x1 - x0) + 0.04, 3.0, 0.34, M.stucco, (x0 + x1) / 2, 1.5, z0 - 0.06, { castShadow: false });
  }

  // ---------------- THE ROAD = route 9 ----------------
  _buildRoad() {
    const T = this.T, M = this.M;
    this.trees = []; this.poles = [];
    // power poles + hanging lines on the north side (z = -17)
    for (let x = -10; x >= -230; x -= 22) {
      const pg = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 7, 6), this.mat({ color: 0x2a2018 }));
      pole.position.set(0, 3.5, 0); pole.castShadow = true;
      const cross = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.1), this.mat({ color: 0x2a2018 }));
      cross.position.set(0, 6.4, 0);
      pg.add(pole, cross);
      pg.position.set(x + rand(-2, 2), 0, -16.4);
      this.scene.add(pg);
      this.poles.push(pg);
    }
    // catenary sag lines (cheap: long thin boxes, slightly tilted)
    for (let x = -11; x >= -231; x -= 22) {
      const ln = new THREE.Mesh(new THREE.BoxGeometry(22.4, 0.015, 0.015), this.mat({ color: 0x0c0d10 }));
      ln.position.set(x - 11, 6.15 - 0.001, -16.4); ln.rotation.z = 0.045;
      this.scene.add(ln);
    }
    // street lamps (4 lit points along the way)
    const lampAt = (x) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 6.5, 6), this.mat({ color: 0x3a3f46 }));
      pole.position.set(x, 3.25, -16.9);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 0.12), this.mat({ color: 0x3a3f46 }));
      arm.position.set(x, 6.42, -17.7);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.18, 6), this.emisMat(null, 0xffb35e, 1.6));
      head.material.color = new THREE.Color(0x181410); head.position.set(x, 6.34, -18.5);
      this.scene.add(pole, arm, head);
      const l = this.addLight('lamp_' + x, x, 5.6, -18.8, 0xffb35e, 4.2, 14);
      this.flickers.push({ t: rand(0, 4), speed: 0.7 + Math.random(), eval: (t) => (Math.sin(t * 3.1 + x) > -0.93 ? 1 : 0.2), entry: this.lights.get('lamp_' + x) });
      this.glowSprite(T.glowDot, x, 6.3, -18.5, 2.2, 0.4);
    };
    lampAt(-16); lampAt(-84); lampAt(-148); lampAt(-196);
    // distant farm lights + red tower blink
    this.glowSprite(T.glowDot, 20, 1.6, -60, 3.2, 0.5);
    this.glowSprite(T.glowDotRed, -100, 24, -80, 1.8, 0.5);
    this.props.redTower = this.flickers.push({ t: 0, speed: 1, eval: () => (Math.sin(this.time * 2.2) > 0.7 ? 1 : 0.1), sprite: this.glowSprite(T.glowDotRed, -100, 24, -80, 2.4, 0.55), spriteBase: 0.55 });
    // billboard
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.6), this.texMat(canvasTex(256, 128, (c, w, h) => {
      c.fillStyle = '#11131a'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#d8cdb4'; c.textAlign = 'center'; c.font = 'bold 30px monospace';
      c.font = '26px monospace'; c.fillText('☾ OWL', w / 2, 42);
      c.font = '16px monospace'; c.fillText("next diner — 2 mi", w / 2, 78);
      c.fillText('عش البومة ينتظرك', w / 2, 102);
    })));
    bb.position.set(-58, 3.4, -25.5); bb.rotation.y = 0.3;
    const bp = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.6, 6), this.mat({ color: 0x3a3f46 }));
    bp.position.set(-58, 1.7, -25);
    this.scene.add(bb, bp);
    // bus shelter
    this.box(3.4, 2.3, 0.16, this.mat({ color: 0x3a4048 }), -122, 1.15, -16.2, { sight: true });
    this.box(3.6, 0.1, 1.6, this.mat({ color: 0x3a4048 }), -122, 2.34, -17.0);
    this.box(0.9, 0.4, 0.4, M.woodDark, -122, 0.2, -16.6, { collide: true, name: 'bench' });
    // trees north + south scatter (low-poly: trunk + 2 cones)
    const tree = (x, z, s = 1) => {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.2 * s, 5), this.mat({ color: 0x241a12 }));
      tr.position.set(x, 0.6 * s, z); tr.castShadow = true;
      const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.9 * s, 2.2 * s, 6), this.mat({ color: 0x14201a }));
      c1.position.set(x, 2.2 * s, z); c1.castShadow = true;
      const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.65 * s, 1.6 * s, 6), this.mat({ color: 0x16241c }));
      c2.position.set(x, 3.3 * s, z);
      const tg = new THREE.Group();
      tg.add(tr, c1, c2);
      tg.position.set(0, 0, 0);
      this.scene.add(tg);
      this.trees.push(tg);
      const b = { min: { x: x - 0.3, z: z - 0.3 }, max: { x: x + 0.3, z: z + 0.3 }, y0: 0, y1: 4, solid: true };
      this.colliders.push(b);
    };
    for (const t of [[-14, -26.5], [-36, -28], [-66, -27], [-96, -26.8], [-134, -28.4], [-170, -26.6], [-190, -28], [-226, -27], [-24, -14.6], [-58, -14.2], [-104, -15], [-158, -14.6]])
      tree(t[0], t[1], rand(0.85, 1.25));
  }

  // ---------------- DINER: exterior ----------------
  _buildDinerExt() {
    const T = this.T, M = this.M;
    // lot: x -222..-198, z -14..-2
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), M.asphalt);
    lot.rotation.x = -Math.PI / 2; lot.position.set(-211, 0.004, -8.4); lot.receiveShadow = true;
    this.scene.add(lot);
    // stall lines
    for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.2), this.texMat(T.stall));
      st.rotation.x = -Math.PI / 2; st.position.set(-219 + i * 3.2, 0.006, -8.4);
      this.scene.add(st);
    }
    // building shell x -214..-200, z -2..6 — front wall with big glass
    const x0 = -214, x1 = -200, z0 = -2, z1 = 6;
    // tall chrome base + glass band front
    this.box(x1 - x0, 0.8, 0.2, this.mat({ color: 0x8a8d92 }), (x0 + x1) / 2, 0.4, z0, { collide: true, sight: true, name: 'dbase' });
    this.box(x1 - x0, 0.6, 0.2, this.mat({ color: 0x6a6d72 }), (x0 + x1) / 2, 2.7, z0, { castShadow: true, name: 'dtop' });
    // glass panes between pillars
    const glassBand = (cx, w) => {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.75), M.glass);
      g.position.set(cx, 1.55, z0); this.scene.add(g);
    };
    // pillars
    const px = [x0, -211, -207, x1];
    px.forEach(px0 => this.box(0.16, 3, 0.24, this.mat({ color: 0x8a8d92 }), px0, 1.5, z0, { collide: true, sight: true, name: 'dpillar' }));
    glassBand(-213.5 + 0.55, 2.9); glassBand(-210, 3.8); glassBand(-208.5 + 0.6, 1.6); glassBand(-201, 1.6);
    // entrance double door x -207.5..-206.5
    const dd = new Door(this, 'diner_door', -207.5 + 0.0, z0 + 0.03, { w: 1.05, tex: T.door('#8a5a3a'), label: 'Diner door' });
    this.doors.set('diner_door', dd);
    this.addInteract({
      id: 'diner_door', meshes: [dd.mesh],
      label: (G) => dd.isOpen() ? 'Pull the door closed' : 'Push the door open',
      enabled: (G) => !G.player.hidden,
      action: (G) => {
        if (!dd.isOpen()) { G.audio.doorbellBuzz({ x: -207, y: 1.4, z: -2 }); G.audio.doorCreak(true, { x: -207, y: 1.2, z: -2 }, true); dd.open(); G.story && G.story.hook('dinerDoorOpen'); }
        else { G.audio.doorCreak(false, { x: -207, y: 1.2, z: -2 }); dd.close(); }
      },
    });
    // side + back walls
    this.wallX(x0, z0, z1, M.wallInt);
    this.wallX(x1, z0, z1, M.wallInt);
    this.wallZ(z1, x0, x1, M.wallInt);
    // roof + neon parapet sign
    this.box(x1 - x0 + 0.3, 0.16, z1 - z0 + 0.3, M.roof, (x0 + x1) / 2, 3.08, (z0 + z1) / 2, { castShadow: false });
    this.box(x1 - x0 + 0.4, 0.7, 0.14, M.stucco, (x0 + x1) / 2, 3.4, z0 - 0.02, { castShadow: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6), this.emisMat(T.dinerSign, 0xffb35e, 1.2));
    sign.position.set((x0 + x1) / 2, 3.9, z0 - 0.08);
    this.scene.add(sign);
    this.props.dinerSignMesh = sign;
    this.glowSprite(T.glowDot, (x0 + x1) / 2, 3.9, z0 - 0.3, 5.5, 0.42);
    // pole sign near the lot
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6.2, 6), this.mat({ color: 0x3a3f46 }));
    pole.position.set(-217.5, 3.1, -10);
    const owl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), this.emisMat(T.owlLogo, 0xffb35e, 1.0));
    owl.position.set(-217.5, 5.6, -10); owl.rotation.y = 0.15;
    this.scene.add(pole, owl);
    this.props.owlPole = { pole, owl };
    // porch light + lit interior spill
    this.glowSprite(T.glowDot, -207, 2.2, z0 - 0.3, 1.4, 0.35);
    this.addLight('diner_porch', -207.6, 2.3, -4.2, 0xffc890, 3.0, 9);
    this.props.porch = { x: -207, z: -4.2 };
    // payphone on the far east wall
    this.box(0.28, 0.5, 0.2, this.mat({ color: 0x2a4a6a }), -198.6, 1.45, -3.2, { collide: true, name: 'payphone' });
    this.props.payphone = new THREE.Vector3(-198.6, 1.4, -3.2);
    this.addInteract({
      id: 'payphone', pos: this.props.payphone.clone(), radius: 0.85,
      label: () => 'Use the payphone',
      action: (G) => { G.story && G.story.hook('payphone'); },
    });
    // parked cars: player car (gets moved here after the drive), trucker cab, black sedan (later)
    this.props.playerCarSpawn = new THREE.Vector3(-214.6, 0, -6.2);
    this.props.playerCar = this._car('teal', -214.6, -6.2, Math.PI / 2);
    const cab = this._car('cab', -217.5, -12.4, Math.PI / 2 + 0.06);
    cab.scale.setScalar(1.15);
    const old = this._car('old', -204.5, -12.6, -Math.PI / 2 + 0.05);
    this.props.blackSedan = this._car('black', -222, -6.5, Math.PI / 2);
    this.props.blackSedan.visible = false;
    // ICE vending / comptuer
    this.box(1.0, 1.3, 0.8, M.metal, -201.4, 0.65, -3.0, { collide: true, name: 'iceshred' });
    this.addInteract({
      id: 'ice', pos: new THREE.Vector3(-201.4, 1.1, -3.3), radius: 0.9,
      label: () => 'Shake ice for the machine',
      action: (G) => { G.story && G.story.hook('ice'); },
    });
    // car interact (endgame & drive)
    this.addInteract({
      id: 'playercar', pos: this.props.playerCar.position.clone(), radius: 1.6,
      label: (G) => (G.story && G.story.flags.driveReadyHome) ? 'Get in the car — drive' : (G.story && G.story.flags.carEscape ? 'UNLOCK YOUR CAR' : 'Your car'),
      action: (G) => { G.story && G.story.hook('carInteract'); },
    });
  }

  // ---------------- DINER: interior ----------------
  _buildDinerInt() {
    const T = this.T, M = this.M;
    // checker floor + walls already via shell; add floor overlay lino
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), M.linoleum);
    fl.rotation.x = -Math.PI / 2; fl.position.set(-207, 0.012, 2); fl.receiveShadow = true;
    this.scene.add(fl);
    // counter (south half of dining → kitchen partition behind it at z 2..3)
    // counter: x -212..-201 at z 2.4, top + base + stools
    this.box(11, 0.9, 0.6, this.mat({ color: 0xa8b8c0 }), -206.5, 0.45, 2.4, { collide: true, name: 'counter' });
    this.box(11, 0.08, 0.66, M.metal, -206.5, 0.94, 2.4, { name: 'countertop' });
    for (let i = 0; i < 5; i++) {
      const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.14, 0.55, 6), this.mat({ color: 0x6a6d72 }));
      sc.position.set(-210.5 + i * 2.2, 0.275, 1.85);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.09, 8), this.mat({ color: 0xa8322a }));
      st.position.set(-210.5 + i * 2.2, 0.6, 1.85);
      this.scene.add(sc, st);
    }
    // register on counter + drawer (with Mounir's spare fuse clue+money task)
    this.box(0.4, 0.26, 0.36, this.mat({ color: 0x2e2a26 }), -203.2, 1.11, 2.4, { name: 'register' });
    const regDrawer = new Drawer(this, 'register', -203.2, 0.86, 2.4, 0.34, 0.14, 0.3, T.metal, 'Register drawer');
    this.drawers.set('register', regDrawer);
    regDrawer.locked = true;
    // fuse inside register + coins
    const spareFuse = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 8), this.mat({ color: 0x8a6a3a }));
    spareFuse.position.set(-203.2, 0.92, 2.3); spareFuse.rotation.x = Math.PI / 2; spareFuse.visible = false;
    this.scene.add(spareFuse);
    this.props.spareFuse = spareFuse;
    this.addInteract({
      id: 'sparefuse', meshes: [spareFuse],
      label: () => 'Take the spare MAIN fuse',
      enabled: (G) => spareFuse.visible && !G.player.hasItem('fuse'),
      action: (G) => { spareFuse.visible = false; G.player.giveItem('fuse', { label: 'MAIN fuse' }); G.audio.latch('pickup'); G.story && G.story.hook('fuseTaken'); },
    });
    this.addInteract({
      id: 'register', meshes: [regDrawer.mesh],
      label: (G) => {
        if (regDrawer.locked) return (G.player.hasItem('cashkeys') ? 'Unlock the register' : 'Register (locked)');
        return regDrawer.target > 0.5 ? 'Close the register' : 'Count the register';
      },
      action: (G) => {
        if (regDrawer.locked) {
          if (G.player.hasItem('cashkeys')) { regDrawer.locked = false; G.audio.latch('unlock', { x: -203.2, y: 1, z: 2.4 }); G.story.hook('registerUnlocked'); }
          else { G.audio.latch('locked', { x: -203.2, y: 1, z: 2.4 }); G.story && G.story.hook('registerLocked'); }
          return;
        }
        G.audio.drawerSlide(regDrawer.target < 0.5, { x: -203.2, y: 0.9, z: 2.4 });
        regDrawer.toggle();
        G.story && G.story.hook(regDrawer.target > 0.5 ? 'registerOpen' : 'registerClose');
      },
    });
    // cash keys hanging under counter edge
    const ck = new THREE.Group();
    const ck1 = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 5, 10), this.mat({ color: 0xb0b0b0 }));
    ck.add(ck1); ck.position.set(-205.6, 0.86, 2.68);
    this.scene.add(ck);
    this.props.cashKeys = ck;
    this.addInteract({
      id: 'cashkeys', meshes: [ck.children[0]],
      label: () => 'Take the register keys',
      action: (G) => { G.story && G.story.hook('cashKeys'); },
    });
    // coffee pot + mugs on counter
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.2, 8), this.mat({ color: 0x2a2a2e }));
    pot.position.set(-208.4, 1.08, 2.4); this.scene.add(pot);
    this.box(0.2, 0.05, 0.16, this.mat({ color: 0xc94a4a }), -208.4, 0.99, 2.4, { name: 'potbase' });
    this.addInteract({
      id: 'pot', meshes: [pot],
      label: () => 'Top off the coffee pot (task)',
      action: (G) => { G.story && G.story.hook('coffeePot'); },
    });
    // booths: 2 along west wall + 2 small tables east
    const booth = (bz, north = false) => {
      const bx = -212.6;
      this.box(0.9, 0.95, 0.5, this.mat({ color: 0x8a2f2f }), bx - 0.75, 0.47, bz, { collide: true, name: 'booth' }); // seat
      this.box(0.16, 0.55, 0.5, this.mat({ color: 0x6a1f1f }), bx - 1.2, 0.75, bz, { name: 'boothback' });
      this.box(0.9, 0.06, 0.7, M.woodLight, bx, 0.72, bz, { name: 'boothTable' });
      this.box(0.08, 0.72, 0.08, this.mat({ color: 0x6a6d72 }), bx, 0.36, bz, { name: 'boothleg' });
    };
    booth(0.2); booth(1.6);
    this.props.booth1 = new THREE.Vector3(-213.3, 0.5, 0.2);
    this.props.booth2 = new THREE.Vector3(-213.3, 0.5, 1.6);
    const table = (tx, tz) => {
      this.box(0.8, 0.06, 0.8, M.woodLight, tx, 0.72, tz, { name: 'table' });
      this.box(0.08, 0.72, 0.08, this.mat({ color: 0x6a6d72 }), tx, 0.36, tz, { name: 'tableleg' });
      for (const [dx, dz] of [[0.55, 0], [-0.55, 0]]) {
        const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 8), this.mat({ color: 0x8a2f2f }));
        ch.position.set(tx + dx, 0.32, tz);
        const chl = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.1, 0.3, 6), this.mat({ color: 0x6a6d72 }));
        chl.position.set(tx + dx, 0.15, tz);
        this.scene.add(ch, chl);
        this.box(0.06, 0.5, 0.34, this.mat({ color: 0x6a1f1f }), tx + dx + (dx > 0 ? 0.1 : -0.1), 0.62, tz, { name: 'chairback' });
      }
    };
    table(-203.5, -0.5); table(-207.5, -0.8);
    this.props.tableE = new THREE.Vector3(-203.5, 0.4, -0.5);
    // jukebox (west wall, north end)
    const jb = new THREE.Group();
    const jbB = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, 0.5), this.mat({ color: 0x4a2020 }));
    jbB.position.y = 0.65;
    const jbT = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 10, 1, false, 0, Math.PI), this.mat({ color: 0x8a5a3a }));
    jbT.rotation.z = Math.PI / 2; jbT.position.set(0, 1.3, 0);
    const jbL = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), this.emisMat(null, 0xffd9a8, 1.2));
    jbL.material.color = new THREE.Color(0x201810); jbL.position.set(0, 0.85, 0.26);
    jb.add(jbB, jbT, jbL);
    jb.position.set(-213.5, 0, 3.85); jb.rotation.y = Math.PI / 4;
    this.scene.add(jb);
    this.props.jukebox = { grp: jb, lamp: jbL };
    this.addInteract({
      id: 'jukebox', meshes: [jbB],
      label: () => 'Look at the jukebox selections',
      action: (G) => { G.story && G.story.hook('jukebox'); },
    });
    // menu board above kitchen pass
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), this.texMat(T.menuBoard));
    board.position.set(-206, 2.0, 2.72); board.rotation.y = Math.PI;
    this.scene.add(board);
    // kitchen pass-through opening between dining & kitchen: counter ends at z 2.4; partition wall above
    this.box(11, 1.0, 0.14, M.wallInt, -206.5, 2.2 + 0.0, 2.9, { castShadow: false, name: 'passover' });
    // kitchen door at east end of counter
    const kd = new Door(this, 'kitchen_door', -200.9, 2.94, { w: 0.85, tex: T.door('#4a3a30'), label: 'Kitchen door', metalTeal: false });
    this.doors.set('kitchen_door', kd);
    this.addInteract({
      id: 'kitchen_door', meshes: [kd.mesh],
      label: () => kd.isOpen() ? 'Close the kitchen door' : 'Kitchen door',
      enabled: (G) => !G.player.hidden,
      action: (G) => {
        if (!kd.isOpen()) { G.audio.doorCreak(true, { x: -200.9, y: 1.2, z: 2.9 }); kd.open(); }
        else { G.audio.doorCreak(false, { x: -200.9, y: 1.2, z: 2.9 }); kd.close(); }
      },
    });
    // KITCHEN: grill + fryer + fridge + pantry + breaker + freezer alcove
    this.box(1.2, 0.9, 0.8, this.mat({ color: 0x6a6d72 }), -206.5, 0.45, 5.5, { collide: true, name: 'grill' });
    this.addInteract({
      id: 'grill', pos: new THREE.Vector3(-206.5, 1.0, 5.4), radius: 0.9,
      label: () => 'Scrape the grill (task)',
      action: (G) => { G.story && G.story.hook('grill'); },
    });
    // kitchen trash can (task: carry the bag to the back dumpster)
    const tcan = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.55, 8), this.mat({ color: 0x4a4d52 }));
    tcan.position.set(-204.3, 0.28, 5.5); this.scene.add(tcan);
    this.addInteract({
      id: 'trashcan', meshes: [tcan],
      label: (G) => (G.story && G.story.flags.trashbagTaken) ? null : 'Tie off the kitchen trash bag',
      action: (G) => { G.story && G.story.hook('trashcan'); },
    });
    this.box(0.8, 1.7, 0.75, this.mat({ color: 0x8a8d92 }), -203.8, 0.85, 5.6, { collide: true, name: 'fridge2' });
    // pantry: shelves along north wall
    for (let i = 0; i < 3; i++) this.box(2.4, 0.05, 0.5, M.woodLight, -209.5, 0.5 + i * 0.5, 5.7, { name: 'pshelf' });
    // cans to stock (task)
    this.props.canStock = [];
    for (let i = 0; i < 5; i++) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 8), this.mat({ color: pickColor() }));
      can.position.set(-210.4 + i * 0.22, 0.53, 5.68);
      this.scene.add(can);
      this.props.canStock.push(can);
    }
    // crates to restock shelves from (dining side task: stock 3 shelves)
    const crate = this.box(0.6, 0.4, 0.5, M.woodDark, -211.6, 0.2, 5.5, { name: 'crate1' });
    this.addInteract({
      id: 'crate', meshes: [crate],
      label: () => 'Take the restock crate',
      action: (G) => { G.story && G.story.hook('crate'); },
    });
    // freezer at SW of kitchen x -213.5..-211.5 z 3.9..6
    this.box(2.2, WALL_H, 0.12, M.metal, -212.5, WALL_H / 2, 3.95, { collide: true, sight: true, name: 'fwall' });
    this.box(0.9, WALL_H, 2.1, M.metal, -211.35 + 0.4, WALL_H / 2, 5.0, { collide: true, sight: true, name: 'fwallE' });
    const fd = new Door(this, 'freezer_door', -212.9, 3.97, { w: 0.95, h: 2.0, tex: T.door('#7a8a92'), label: 'Walk-in freezer', metalBig: true });
    this.doors.set('freezer_door', fd);
    // freezer interior: racks
    this.box(0.5, 2.0, 1.4, M.metal, -213.6, 1.0, 5.2, { collide: true, name: 'frack' });
    this.box(0.5, 0.5, 0.5, this.texMat(T.frost), -212.6, 0.25, 5.5, { name: 'meatbox' });
    const frost = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.0), this.texMat(T.frost));
    frost.position.set(-212.4, 1.0, 5.95); frost.rotation.y = Math.PI;
    this.scene.add(frost);
    // oat cream carton (chapter 4 objective)
    const cream = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.09), this.texMat(T.plate('CREAM', '#e8e4da', '#3a6a5a')));
    cream.position.set(-213.55, 1.24, 5.0);
    this.scene.add(cream);
    this.props.cream = cream;
    this.addInteract({
      id: 'cream', meshes: [cream],
      label: (G) => (G.story && G.story.flags.creamGot) ? null : 'Grab the oat cream',
      action: (G) => { G.story && G.story.hook('cream'); },
    });
    this.addInteract({
      id: 'freezer_door', meshes: [fd.mesh],
      label: (G) => {
        if (G.story && G.story.flags.freezerStuck && !G.player.hidden) return 'Freezer (STUCK — kick it)';
        return fd.isOpen() ? 'Close the freezer door' : 'Walk-in freezer';
      },
      enabled: (G) => !G.player.hidden,
      action: (G) => { G.story && G.story.hook('freezerDoor'); },
    });
    // hide spot inside freezer
    this.hideSpots.set('freezer', {
      id: 'freezer', eye: new THREE.Vector3(-212.5, 0.9, 5.0), exit: new THREE.Vector3(-212.5, 0, 3.2),
      door: 'freezer_door',
    });
    // pantry hide locker
    const plock = this.box(0.7, 1.9, 0.4, M.woodDark, -209.9, 0.95, 5.7, { collide: true, name: 'plocker' });
    this.addInteract({
      id: 'pantry_hide', meshes: [plock],
      label: () => 'Hide in the supply locker',
      enabled: (G) => G.story && G.story.flags.hidingUnlocked && !G.player.hidden,
      action: (G) => { G.player.hide('pantry'); },
    });
    this.hideSpots.set('pantry', {
      id: 'pantry', eye: new THREE.Vector3(-209.9, 0.8, 5.45), exit: new THREE.Vector3(-209.9, 0, 4.6),
    });
    // hide=freezer interact
    this.addInteract({
      id: 'freezer_hide', pos: new THREE.Vector3(-212.5, 0.8, 4.9), radius: 1.3,
      label: () => 'Hide in the freezer',
      enabled: (G) => G.story && G.story.flags.hidingUnlocked && !G.player.hidden,
      action: (G) => { G.player.hide('freezer'); },
    });
    // breaker box east wall (kitchen)
    this.box(0.45, 0.6, 0.16, M.metal, -200.15, 1.5, 4.4, { name: 'breakerbox' });
    this.props.breakerPos = new THREE.Vector3(-200.15, 1.5, 4.4);
    const levPos = (id, x) => {
      const lv = this.box(0.07, 0.16, 0.05, this.mat({ color: 0x8a8580 }), x, 1.55, 4.32, { castShadow: false });
      this.addInteract({
        id: 'sw_' + id, meshes: [lv],
        label: (G) => `${id} — ${this.breaker[id] ? 'ON' : 'OFF'}`,
        action: (G) => { G.story && G.story.hook('breaker', id); },
      });
    };
    levPos('MAIN', -200.3); levPos('DINING', -200.15); levPos('KITCHEN', -200.0); levPos('SIGN', -201.0);
    this.props.fuseSlotPos = new THREE.Vector3(-200.6, 1.28, 4.34);
    const fuseClip = this.box(0.12, 0.06, 0.04, this.mat({ color: 0xb8b8b8 }), -200.6, 1.28, 4.32, { castShadow: false });
    this.props.fuseMesh = fuseClip; fuseClip.visible = false;
    this.addInteract({
      id: 'fuseslot', pos: this.props.fuseSlotPos.clone(), radius: 0.5,
      label: (G) => this.breaker.fuseIn ? 'Main fuse — seated' : (G.player.hasItem('fuse') ? 'Insert the MAIN fuse' : 'Main fuse — MISSING'),
      action: (G) => { G.player.handsBusy ? null : G.story && G.story.hook('fuseSlot'); },
    });
    // back door (kitchen → alley)
    const bd = new Door(this, 'back_door', -210.4, 5.97, { w: 0.95, tex: T.door('#3f4a52'), label: 'Back door', metalBig: true });
    this.doors.set('back_door', bd);
    this.addInteract({
      id: 'back_door', meshes: [bd.mesh],
      label: (G) => bd.locked ? 'Back door (locked last order)' : (bd.isOpen() ? 'Close the back door' : 'Open the back door'),
      enabled: (G) => !G.player.hidden,
      action: (G) => {
        if (bd.locked) { G.audio.latch('locked', { x: -210.4, y: 1.2, z: 6 }); return G.story && G.story.hook('backLocked'); }
        if (!bd.isOpen()) { G.audio.doorCreak(true, { x: -210.4, y: 1.2, z: 6 }); bd.open(); G.story && G.story.hook('backDoorOpen'); }
        else { G.audio.doorCreak(false, { x: -210.4, y: 1.2, z: 6 }); bd.close(); }
      },
    });
    // dining brick lights + kitchen panel lights
    this.addLight('dining_a', -210, 2.5, 0.5, 0xffd9a8, 4.5, 10);
    this.addLight('dining_b', -204, 2.5, 0.4, 0xffd9a8, 4.0, 10);
    this.addLight('kitchen_l', -208, 2.5, 4.8, 0xd8e2da, 4.5, 9);
    this.flickers.push({ t: 0, speed: 1.3, eval: (t) => (Math.sin(t * 7.9) > -0.96 ? 1 : 0.3), entry: this.lights.get('kitchen_l') });
    this.addLight('sign_l', -207, 3.6, -3.2, 0xffb35e, 3.5, 12);
    // open/neon sign on the glass
    this.props.openSignMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), this.emisMat(T.openSign, 0x66ccff, 1.6));
    this.props.openSignMesh.position.set(-208.9, 1.8, -1.93);
    this.scene.add(this.props.openSignMesh);
    // welcome mat
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), this.texMat(T.matHome));
    wm.rotation.x = -Math.PI / 2; wm.position.set(-207, 0.015, -1.4);
    this.scene.add(wm);
    // handwritten note from Mounir on the counter (new shift list)
    const bl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.24), this.texMat(T.noteAr));
    bl.rotation.x = -Math.PI / 2; bl.position.set(-205.2, 0.955, 2.35);
    this.scene.add(bl);
    this.addInteract({
      id: 'boss_note_diner', meshes: [bl],
      label: () => "Read Mounir's shift note",
      action: (G) => { G.story && G.story.hook('bossNoteDiner'); },
    });
    this.props.dinerCenter = new THREE.Vector3(-207, 1.2, 1);
  }

  _car(kind, x, z, ry) {
    const M = this.M;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.55, 1.8), M.dusty || this.mat({ color: 0x35565a }));
    body.position.y = 0.5; body.castShadow = true;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.6), M.glass);
    cab.position.set(-0.2, 0.95, 0);
    const wheelAt = (wx, wz) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 10), this.mat({ color: 0x15161a }));
      w.rotation.x = Math.PI / 2; w.position.set(wx, 0.28, wz); g.add(w);
    };
    wheelAt(1.3, 0.85); wheelAt(1.3, -0.85); wheelAt(-1.3, 0.85); wheelAt(-1.3, -0.85);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 1.7), this.mat({ color: 0x1c1d20 }));
    front.position.set(2.0, 0.5, 0);
    g.add(body, cab, front);
    if (kind === 'cab') {
      body.material = this.mat({ color: 0x6a3a2a });
      const nose = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 1.8), this.mat({ color: 0x6a3a2a }));
      nose.position.set(2.6, 0.5, 0); nose.castShadow = true; g.add(nose);
    }
    if (kind === 'black') body.material = this.mat({ color: 0x101216 });
    if (kind === 'old') body.material = this.mat({ color: 0x4a4a42 });
    g.position.set(x, 0, z); g.rotation.y = ry;
    this.scene.add(g);
    // car collider
    const rad = Math.abs(Math.sin(ry)) > 0.5;
    const b = AABB.fromCenter(x, z, rad ? 1.9 : 4.2, rad ? 4.2 : 1.9, 0, 1.6);
    b.tag = 'car'; this.colliders.push(b);
    return g;
  }

  // ---------------- back alley ----------------
  _buildBackAlley() {
    const M = this.M, T = this.T;
    // dumpster
    this.box(1.8, 1.0, 1.0, this.mat({ color: 0x2c4a34 }), -212.5, 0.5, 8.8, { collide: true, name: 'dumpster' });
    const lid = this.box(1.85, 0.08, 1.05, this.mat({ color: 0x24402c }), -212.5, 1.06, 8.8, { name: 'dumpsterlid' });
    this.props.dumpsterLid = lid;
    this.addInteract({
      id: 'dumpster', pos: new THREE.Vector3(-212.5, 1.0, 8.4), radius: 1.2,
      label: () => 'Open the dumpster',
      action: (G) => { G.story && G.story.hook('dumpster'); },
    });
    // fence behind
    const f = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.0), M.chainlink);
    f.position.set(-207, 1.0, 10.2); f.rotation.y = Math.PI;
    this.scene.add(f);
    for (let i = 0; i < 5; i++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), this.mat({ color: 0x3a3f46 }));
      post.position.set(-215 + i * 4, 1.0, 10.2);
      this.scene.add(post);
    }
    // cat food bag + oil cans in alley
    this.box(0.4, 0.5, 0.3, M.woodDark, -214, 0.25, 6.8, { name: 'alleybox' });
  }

  // ---------------- the drive car rig (interior for the ride) ----------------
  _buildDriveCar() {
    const M = this.M;
    const g = new THREE.Group();
    // dashboard + wheel + wipers + mirrors + seats
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 0.5), this.mat({ color: 0x2c2f34 }));
    dash.position.set(0, 0.95, 0.55);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 6, 12), this.mat({ color: 0x1a1c1e }));
    wheel.rotation.x = Math.PI / 2.4; wheel.position.set(-0.35, 0.95, 0.2);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.4, 6), this.mat({ color: 0x1a1c1e }));
    col.rotation.x = Math.PI / 2.4; col.position.set(-0.35, 0.85, 0.35);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 0.9), this.mat({ color: 0x3a3f45 }));
    seat.position.set(0, 0.25, -0.35);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.14), this.mat({ color: 0x3a3f45 }));
    back.position.set(0, 0.65, -0.72);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 1.6), this.mat({ color: 0x24282c }));
    roof.position.set(0, 1.5, -0.1);
    const lpillar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.1), this.mat({ color: 0x24282c }));
    lpillar.position.set(-0.85, 1.0, 0.3);
    const rpillar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.1), this.mat({ color: 0x24282c }));
    rpillar.position.set(0.85, 1.0, 0.3);
    const wscreen = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.0), M.glass);
    wscreen.position.set(0, 1.05, 0.39); wscreen.rotation.x = 0.15;
    // vent + am radio + hanging dice
    const radio = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.08), this.mat({ color: 0x1c1e22 }));
    radio.position.set(0.2, 0.98, 0.56);
    const dice1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), this.mat({ color: 0xc94a4a }));
    dice1.position.set(0, 1.06, 0.3);
    const dice2 = dice1.clone(); dice2.position.set(0.02, 1.0, 0.32); dice2.rotation.z = 0.5;
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.02), this.mat({ color: 0x0d1116 }));
    mirror.position.set(0, 1.22, 0.3);
    g.add(dash, wheel, col, seat, back, roof, lpillar, rpillar, wscreen, radio, mirror, dice1, dice2);
    g.visible = false;
    this.scene.add(g);
    this.props.driveRig = g;
    this.props.driveWheel = wheel;
    this.props.driveRadio = radio;
    // headlights: cone spots for the ride (created on demand by story)
  }

  // ---------------- AI mobiliser ----------------
  _buildThinkers() {
    // flashlight on? nothing here; stalker patrol routes set by story.
    this.aiWaypoints = [
      { x: -222, z: -12 }, { x: -214, z: -14 }, { x: -200, z: -13 }, { x: -198, z: -4 },
      { x: -204, z: 6.5 }, { x: -213, z: 8 }, { x: -219, z: -4 }, { x: -208, z: -6.5 },
    ];
    this.interiorWaypoints = [
      { x: -211, z: 0.5 }, { x: -203, z: 0.5 }, { x: -206, z: 1.5 }, { x: -208, z: 4.5 }, { x: -204, z: 1.0 },
    ];
  }

  // ---------------- power map ----------------
  applyPowerMap() {
    const B = this.breaker;
    const mains = B.MAIN && B.fuseIn;
    this.setLight('dining_a', mains && B.DINING);
    this.setLight('dining_b', mains && B.DINING);
    this.setLight('kitchen_l', mains && B.KITCHEN);
    this.setLight('sign_l', mains && B.SIGN);
    this.setLight('diner_porch', mains);
    if (this.props.dinerSignMesh) {
      const on = mains && B.SIGN;
      this.props.dinerSignMesh.material.emissiveIntensity = on ? 1.2 : 0.04;
      this.props.openSignMesh && (this.props.openSignMesh.material.emissiveIntensity = on ? 1.6 : 0);
      this.props.owlPole && (this.props.owlPole.owl.material.emissiveIntensity = on ? 1.0 : 0.04);
    }
    this._powerFlag = mains;
    this.power = mains;
    this.G.story && this.G.story.hook('powerChanged', mains);
  }
  killPower() {
    this.breaker.MAIN = false;
    this.breaker.fuseIn = false;
    this.props.fuseMesh.visible = true;
    this.applyPowerMap();
  }
  restorePower() {
    this.breaker.MAIN = true;
    this.applyPowerMap();
  }
  _setup() {
    // nothing ep1-specific; generic fixups
  }

  // ep2-specific frame update — the base World.update is tailoured to the
  // ep1 motel (sign meshes, walkway lamps, CCTV); here we run the shared
  // machinery only, plus our own diner accents.
  update(dt) {
    this.time += dt;
    for (const d of this.doors.values()) d.update(dt);
    for (const d of this.drawers.values()) d.update(dt);
    // closet panels (shared shape)
    for (const k of Object.keys(this.props)) {
      if (!k.startsWith('closet_')) continue;
      const st = this.props[k];
      st.open01 = lerp(st.open01, st.target, 1 - Math.exp(-4.5 * dt));
      st.panel.position.z = st.z + st.open01 * st.w * 0.95;
      st.closed.solid = st.open01 < 0.7;
    }
    // flickers (street lamps, kitchen light, red tower sprite)
    for (const f of this.flickers) {
      f.t += dt * f.speed;
      const v = f.eval(f.t);
      if (f.entry) f.entry.light.intensity = f.entry.on ? f.entry.base * v : 0;
      if (f.mesh) f.mesh.material.emissiveIntensity = v * (f.emisBase || 1.4);
      if (f.sprite) f.sprite.material.opacity = f.spriteBase * v;
    }
    // tv noise
    if (this._tvTex) {
      this.tvDirty -= dt;
      if (this.tvDirty <= 0) {
        this.tvDirty = 0.12;
        const ctx = this._tvCtx;
        const img = ctx.createImageData(64, 48);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 90 + 20;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        this._tvTex.needsUpdate = true;
      }
    }
    // diner neon: slow pulse when powered & sign breaker on
    if (this.props.dinerSignMesh && this._powerFlag && this.breaker.SIGN) {
      const v = 0.94 + 0.06 * Math.sin(this.time * 3.1);
      this.props.dinerSignMesh.material.emissiveIntensity = 1.2 * v;
      this.props.openSignMesh && (this.props.openSignMesh.material.emissiveIntensity = 1.6 * v);
    }
    // triggers
    const p = this.G.player;
    if (p) {
      for (const t of this.triggers) {
        if (t.fired && t.once) continue;
        if (t.box.contains2D(p.pos.x, p.pos.z)) {
          t.fired = true;
          t.cb();
        }
      }
    }
    // wall clock (if this world placed one)
    if (this.props.clockMin && this.G.story) {
      const mins = this.G.story.clockMin;
      this.props.clockMin.rotation.z = -((mins % 60) / 60) * Math.PI * 2;
      this.props.clockHr.rotation.z = -(((mins / 60) % 12) / 12) * Math.PI * 2;
    }
  }
}

function pickColor() { const cs = [0x8a3a2a, 0x3a5a7a, 0x6a6a3a, 0x5a4a6a, 0x3a6a4a]; return cs[Math.floor(Math.random() * cs.length)]; }

// Door extra options (metalBig flag only affects sound tag via hooks; visual same)
