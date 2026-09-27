// ============================================================
// world2.js — mixin methods for World: office, laundry, guest
// rooms, lot props, CCTV, and every interactable in the game.
// ============================================================
import * as THREE from 'three';
import { AABB, rand, pick } from './utils.js';
import { Door, Drawer, WALL_H, EXT_H } from './world.js';

export function applyWorldMixins(World) {

  // ---------------------------------------------------------
  // OFFICE — x∈[3,15], z∈[0,5.6]
  // ---------------------------------------------------------
  World.prototype._buildOffice = function () {
    const T = this.T, M = this.M, G = this.G;
    this._roomShell(3, 15, M.carpet, M.wallInt);

    // counter (front desk) across x 5.5..9.8 at z 2.3 w/ knee hole
    const cm = M.woodDark;
    this.box(4.3, 0.12, 0.62, cm, 7.65, 1.06, 2.3, { name: 'countertop' });
    this.box(0.62, 1.0, 0.6, cm, 5.6, 0.5, 2.3, { collide: true, name: 'counter' });
    this.box(0.62, 1.0, 0.6, cm, 9.7, 0.5, 2.3, { collide: true, name: 'counter' });
    this.box(4.3, 0.28, 0.6, cm, 7.65, 0.86, 2.3, { name: 'countertop-under' });
    // side return of counter back to wall
    this.box(0.6, 1.0, 1.6, cm, 9.7, 0.5, 3.4, { collide: true, name: 'counter-ret' });
    // hide spot under counter
    this.hideSpots.set('counter', {
      id: 'counter', eye: new THREE.Vector3(7.6, 0.82, 2.9),
      stand: new THREE.Vector3(7.6, 0, 2.9), exit: new THREE.Vector3(7.6, 0, 1.4),
    });
    this.addInteract({
      id: 'hide_counter', pos: new THREE.Vector3(7.6, 0.9, 2.0), radius: 1.1,
      label: () => 'Hide under the counter',
      enabled: (G) => G.story && G.story.flags.hidingUnlocked && !G.player.hidden,
      action: (G) => G.player.hide('counter'),
    });

    // cash register w/ sliding drawer
    this.box(0.52, 0.34, 0.4, M.metal, 9.1, 1.29, 2.42, { name: 'register' });
    const regDrawer = new Drawer(this, 'register', 9.1, 1.13, 2.3, 0.42, 0.1, 0.34, this.T.woodDark, 'Register drawer');
    regDrawer.locked = true;
    this.drawers.set('register', regDrawer);
    // fuse inside the register (visible when open — finale quest item)
    const fuse = this._fuseMesh(9.1, 1.2, 2.02);
    fuse.visible = false;
    this.props.fuseMesh = fuse;
    this.addInteract({
      id: 'register', meshes: [regDrawer.mesh],
      label: (G) => {
        if (regDrawer.locked) return G.player.hasItem('registerkey') ? 'Unlock the register drawer' : 'Register drawer (locked)';
        return regDrawer.target > 0.5 ? 'Close the register drawer' : 'Open the register drawer';
      },
      action: (G) => {
        if (regDrawer.locked) {
          if (G.player.hasItem('registerkey')) {
            regDrawer.locked = false; G.audio.latch('unlock', { x: 9.1, y: 1.1, z: 2.3 });
            G.ui.subtitle('DANA', 'Marco hides the good stuff in here. Spare fuses, emergency cash.', { thought: true });
          } else { G.audio.latch('locked', { x: 9.1, y: 1.1, z: 2.3 }); return; }
        } else { G.audio.drawerSlide(regDrawer.target < 0.5, { x: 9.1, y: 1.1, z: 2.3 }); }
        regDrawer.toggle();
        G.story && G.story.hook('registerOpened');
      },
    });
    this.addInteract({
      id: 'fuse', pos: new THREE.Vector3(9.1, 1.2, 2.05), radius: 0.5,
      label: () => 'Take the 50A main fuse',
      enabled: (G) => !regDrawer.locked && regDrawer.open01 > 0.6 && fuse.visible && !G.player.hasItem('fuse'),
      action: (G) => {
        fuse.visible = false;
        G.player.giveItem('fuse', { label: '50A fuse' });
        G.audio.latch('pickup');
        G.story && G.story.hook('fuseTaken');
      },
    });

    // ledger (sign-in book)
    const ledger = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.38), this.texMat(T.ledger));
    ledger.rotation.x = -Math.PI / 2; ledger.rotation.z = -0.15; ledger.position.set(8.35, 1.125, 2.32);
    this.scene.add(ledger);
    this.addInteract({
      id: 'ledger', meshes: [ledger],
      label: (G) => G.story && G.story.flags.signedIn ? 'The night ledger' : 'Sign the night ledger',
      action: (G) => { G.story && G.story.hook('ledger'); },
    });

    // Marco's note
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.26), this.texMat(T.note(['DANA — back by 7. Darla', 'needs me. You know the', 'drill. Ask nothing, open', 'for no one after one.', '            — MARCO'])));
    note.rotation.x = -Math.PI / 2; note.rotation.z = 0.3; note.position.set(6.3, 1.122, 2.3);
    this.scene.add(note);
    this.props.marcoNote = note;
    this.addInteract({
      id: 'note', meshes: [note],
      label: () => "Read Marco's note",
      action: (G) => { G.audio.latch('paper'); G.story && G.story.hook('note'); },
    });

    // office landline phone (rings during the night)
    const phBase = this.box(0.24, 0.09, 0.18, this.mat({ color: 0x8a2f2f }), 5.95, 1.17, 2.45, { name: 'phone' });
    const handset = this.box(0.22, 0.05, 0.06, this.mat({ color: 0x8a2f2f }), 5.95, 1.24, 2.45, { name: 'handset' });
    this.props.officeHandset = handset;
    this.addInteract({
      id: 'officephone', meshes: [phBase, handset],
      label: () => 'Answer the office phone',
      enabled: (G) => !!(G.story && G.story.flags.phoneRinging),
      action: (G) => { G.story && G.story.hook('answerOffice'); },
    });

    // CCTV monitor + VCR
    const monBody = this.box(0.66, 0.5, 0.44, this.mat({ color: 0x2a2926 }), 5.55, 1.42, 2.6, { name: 'cctv' });
    monBody.rotation.y = -0.5;
    // screen material assigned in _buildCCTV
    const vcr = this.box(0.4, 0.09, 0.3, this.mat({ color: 0x1c1c1c }), 6.25, 1.17, 2.5, { name: 'vcr' });
    this.props.vcrLed = this.glowSprite(T.glowDotRed, 6.12, 1.2, 2.34, 0.12, 0.8);
    this.addInteract({
      id: 'cctv', meshes: [monBody],
      label: () => 'Check the cameras',
      action: (G) => { G.story && G.story.hook('cctv'); },
    });

    // desk lamp (real light, casts shadows)
    this._lampOn(9.45, 1.12, 2.5);
    const lampLight = this.addLight('officeLamp', 9.4, 1.62, 2.45, 0xffc884, 6, 9, { shadow: true });
    this.addInteract({
      id: 'officelamp', pos: new THREE.Vector3(9.45, 1.35, 2.5), radius: 0.6,
      label: (G) => this.lights.get('officeLamp').on ? 'Turn off the desk lamp' : 'Turn on the desk lamp',
      action: (G) => {
        const e = this.lights.get('officeLamp'); this.setLight('officeLamp', !e.on);
        G.audio.latch('switch', { x: 9.45, y: 1.3, z: 2.5 });
      },
    });

    // spin chair
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.44), this.mat({ color: 0x51372b }));
    seat.position.y = 0.5;
    const backr = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.08), this.mat({ color: 0x51372b }));
    backr.position.set(0, 0.82, 0.2);
    chair.add(seat, backr);
    chair.position.set(7.6, 0, 3.3); chair.rotation.y = 2.6;
    chair.traverse(m => { m.castShadow = true; });
    this.scene.add(chair);
    this.props.chair = chair;
    this.colliders.push(Object.assign(AABB.fromCenter(7.6, 3.3, 0.5, 0.5, 0, 0.9), { tag: 'chair' }));

    // key rack on back wall behind counter
    const rack = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.5), this.texMat(T.plate('KEYS — DO NOT REMOVE', '#3a2c1c', '#cbb98a')));
    rack.position.set(7.6, 1.9, 5.58); rack.rotation.y = Math.PI;
    this.scene.add(rack);
    // decorative keys + two pickups
    for (let i = 0; i < 5; i++) {
      const k = this.box(0.03, 0.09, 0.012, this.mat({ color: 0x9a938a }), 7.05 + i * 0.28, 1.7, 5.56, { castShadow: false });
      k.rotation.z = rand(-0.24, 0.24);
    }
    const masterKey = this.box(0.04, 1.0, 0.02, this.mat({ color: 0xc9b24a }), 7.05, 1.7, 5.53, { castShadow: false });
    masterKey.scale.y = 0.1;
    const cashKey = this.box(0.04, 0.1, 0.02, this.mat({ color: 0xb04848 }), 7.62, 1.7, 5.53, { castShadow: false });
    this.props.masterKeyMesh = masterKey;
    this.props.cashKeyMesh = cashKey;
    this.addInteract({
      id: 'masterkey', meshes: [masterKey], pos: new THREE.Vector3(7.05, 1.7, 5.53), radius: 0.6,
      label: () => 'Take the MASTER key',
      enabled: (G) => !G.player.hasItem('masterkey'),
      action: (G) => {
        masterKey.visible = false;
        G.player.giveItem('masterkey', { label: 'Master key' });
        G.audio.latch('key', { x: 7, y: 1.7, z: 5.5 });
        G.ui.subtitle('DANA', 'Master key. Opens every room. Which nobody should have to say out loud.', { thought: true });
      },
    });
    this.addInteract({
      id: 'registerkey', meshes: [cashKey], pos: new THREE.Vector3(7.62, 1.7, 5.53), radius: 0.6,
      label: () => 'Take the register key',
      enabled: (G) => !G.player.hasItem('registerkey'),
      action: (G) => {
        cashKey.visible = false;
        G.player.giveItem('registerkey', { label: 'Register key' });
        G.audio.latch('key', { x: 7.6, y: 1.7, z: 5.5 });
      },
    });

    // cork board (flavor + lore)
    const cork = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.1), this.texMat(T.cork));
    cork.position.set(3.13, 1.7, 3.4); cork.rotation.y = Math.PI / 2;
    this.scene.add(cork);
    this.addInteract({
      id: 'cork', meshes: [cork],
      label: () => 'Look at the corkboard',
      action: (G) => {
        G.audio.latch('paper');
        const lines = [
          ['DANA', 'Polaroids of the pool before they filled it in. Marco with a fish. An ICE price list from 1989.'],
          ['DANA', 'Someone wrote "Rm9" on one of the notes. The Starview only has eight rooms.'],
        ];
        G.ui.subtitle(...(G.story && G.story.flags.cork2 ? lines[1] : lines[0]), { thought: true });
        if (G.story) G.story.flags.cork2 = true;
      },
    });

    // couch + side table + standing lamp (east wall)
    const couch = new THREE.Group();
    const cmat = this.mat({ color: 0x4a3a2a });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.4, 0.8), cmat); base.position.y = 0.2;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 0.22), cmat); back.position.set(0, 0.65, 0.29);
    const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.8), cmat); arm1.position.set(-0.85, 0.45, 0);
    const arm2 = arm1.clone(); arm2.position.x = 0.85;
    couch.add(base, back, arm1, arm2);
    couch.position.set(14.4, 0, 3.2); couch.rotation.y = -Math.PI / 2;
    couch.traverse(m => { m.castShadow = true; m.receiveShadow = true; });
    this.scene.add(couch);
    this.colliders.push(Object.assign(AABB.fromCenter(14.4, 3.2, 0.9, 2.0, 0, 0.8), { tag: 'couch' }));
    // trash bag beside couch (task)
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 6), this.mat({ color: 0x14161a }));
    bag.scale.set(1, 1.2, 1); bag.position.set(13.9, 0.34, 4.9); bag.castShadow = true;
    this.scene.add(bag);
    this.props.trashBag = bag;
    this.addInteract({
      id: 'trashbag', meshes: [bag],
      label: () => 'Take the trash bag',
      enabled: (G) => !!(G.story && G.story.flags.taskTrash) && !G.player.hasItem('trashbag') && !G.story.flags.trashDone,
      action: (G) => {
        bag.visible = false;
        G.player.giveItem('trashbag', { label: 'Trash bag' });
        G.audio.latch('paper', { x: 13.9, y: 0.4, z: 4.9 });
      },
    });

    // filing cabinet (2 drawers)
    this.box(0.55, 1.25, 0.5, M.metal, 13.9, 0.625, 5.3, { collide: true, name: 'filecab' });
    const file = new Drawer(this, 'filetop', 13.9, 0.95, 5.28, 0.45, 0.22, 0.44, T.metal, 'Filing drawer');
    this.drawers.set('filetop', file);
    this.addInteract({
      id: 'filetop', meshes: [file.mesh],
      label: () => file.target > 0.5 ? 'Close the filing drawer' : 'Open the filing drawer',
      action: (G) => {
        G.audio.drawerSlide(file.target < 0.5, { x: 13.9, y: 0.9, z: 5.3 });
        file.toggle();
        if (file.target > 0.5 && !G.story.flags.fileSeen) {
          G.story.flags.fileSeen = true;
          G.ui.subtitle('DANA', 'Registration cards going back years. 1994: "VALE, R. — ROOM 4 — cash." And again, 1999. And 2007. Same handwriting.', { thought: true });
        }
      },
    });

    // soda bottle (throwable)
    const bottle = new THREE.Group();
    const bb = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.16, 8), this.mat({ color: 0x3a6ea8 }));
    const bn = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.05, 8), this.mat({ color: 0x3a6ea8 }));
    bn.position.y = 0.1;
    bottle.add(bb, bn);
    bottle.position.set(8.0, 1.21, 2.5);
    this.scene.add(bottle);
    this.props.bottle = bottle;
    this.addInteract({
      id: 'bottle', meshes: [bottle.children[0]],
      label: () => 'Pick up the soda bottle',
      enabled: (G) => !G.player.hasItem('bottle') && !G.story.flags.bottleThrown,
      action: (G) => {
        bottle.visible = false;
        G.player.giveItem('bottle', { label: 'Soda bottle', throwable: true });
        G.audio.latch('pickup');
      },
    });

    // your car keys
    const keys = new THREE.Group();
    const kr = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12), this.mat({ color: 0xb0b0b0 }));
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.01), this.mat({ color: 0x222 }));
    kb.position.y = -0.06;
    keys.add(kr, kb);
    keys.position.set(8.7, 1.14, 2.42); keys.rotation.x = Math.PI / 2;
    this.scene.add(keys);
    this.props.carKeys = keys;
    this.addInteract({
      id: 'carkeys', meshes: [keys.children[0], keys.children[1]],
      label: () => 'Take your car keys',
      enabled: (G) => !G.player.hasItem('carkeys'),
      action: (G) => {
        keys.visible = false;
        G.player.giveItem('carkeys', { label: 'Car keys' });
        G.audio.latch('key');
        G.story && G.story.hook('carKeysTaken');
      },
    });

    // office blinds (front window) + OPEN neon + VACANCY flip sign
    const blinds = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), this.texMat(T.blinds, { side: THREE.DoubleSide }));
    blinds.position.set(11, 1.55, 0.14);
    this.scene.add(blinds);
    this.props.officeBlinds = blinds;
    blinds.visible = true;
    this.addInteract({
      id: 'blinds', meshes: [blinds],
      label: () => blinds.visible ? 'Open the blinds' : 'Close the blinds',
      action: (G) => {
        blinds.visible = !blinds.visible;
        G.audio.latch('switch', { x: 11, y: 1.5, z: 0.2 });
      },
    });
    const openN = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.36), this.emisMat(T.openSign, 0x66ccff, 1.6));
    openN.position.set(8.8, 1.7, 0.08);
    this.scene.add(openN);
    this.props.openSignMesh = openN;
    const vac = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.48), this.emisMat(T.vacancy, 0xff5544, 1.5));
    vac.position.set(12.4, 1.62, 0.08);
    this.scene.add(vac);
    this.props.vacancyMesh = vac;
    this.glowSprite(T.glowDot, 8.8, 1.7, 0.2, 1.3, 0.32);
    this.glowSprite(T.glowDotRed, 12.4, 1.62, 0.2, 1.6, 0.36);

    // wall clock (animated)
    const clock = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), this.texMat(T.plate('', '#ddd6c4', '#ddd6c4')));
    this.scene.add(face);
    const hr = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.11, 0.008), this.mat({ color: 0x222222 }));
    hr.position.set(0, 0.03, 0.005);
    const mn = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.17, 0.008), this.mat({ color: 0x222222 }));
    mn.position.set(0, 0.05, 0.006);
    clock.add(hr, mn);
    clock.position.set(12, 2.1, 5.57); clock.rotation.y = Math.PI;
    face.position.copy(clock.position); face.rotation.y = Math.PI;
    this.scene.add(clock);
    this.props.clockHr = hr; this.props.clockMin = mn;

    // office door (front, x 3.6..4.6) + bolt
    const odoor = new Door(this, 'office', 3.6, 0.02, { tex: T.door('#4a3a30'), label: 'Office door' });
    this.doors.set('office', odoor);
    this.addInteract({
      id: 'door_office', meshes: [odoor.mesh],
      label: () => odoor.locked ? 'Office door (bolted)' : (odoor.isOpen() ? 'Close the office door' : 'Open the office door'),
      enabled: (G) => !G.player.hidden,
      action: (G) => {
        if (odoor.locked) { G.audio.latch('locked', { x: 4.1, y: 1.2, z: 0 }); G.ui.subtitle('DANA', "Bolted. Good. Stay bolted.", { thought: true }); return; }
        if (!odoor.isOpen()) { G.audio.doorCreak(true, { x: 4.1, y: 1.2, z: 0 }); odoor.open(); G.story && G.story.hook('officeDoorOpened'); }
        else { G.audio.doorCreak(false, { x: 4.1, y: 1.2, z: 0 }); odoor.close(); }
      },
    });
    // door bell (chimes when opened) handled by story hook
    const bolt = this.box(0.06, 0.14, 0.04, this.mat({ color: 0x8a8580 }), 3.8, 1.55, 0.12, { name: 'bolt' });
    this.addInteract({
      id: 'bolt', meshes: [bolt],
      label: (G) => G.story && G.story.flags.officeLocked ? 'Slide the bolt open' : 'Slide the bolt shut',
      action: (G) => {
        const locked = !(G.story && G.story.flags.officeLocked);
        if (G.story) { G.story.flags.officeLocked = locked; G.story.hook(locked ? 'bolted' : 'unbolted'); }
        odoor.setLocked(locked);
        G.audio.latch('bolt', { x: 3.8, y: 1.5, z: 0.1 });
      },
    });

    // "STAFF ONLY" supply shelf west wall + towels stack (fills towel task too? no, towels in laundry)
    for (let i = 0; i < 3; i++) this.box(0.8, 0.04, 0.3, M.woodLight, 3.3, 0.7 + i * 0.45, 2.2, { name: 'shelf' });
    this.box(0.2, 0.12, 0.24, this.M.pillow, 3.35, 1.5, 2.15, { castShadow: false });

    this.props.officeCenter = new THREE.Vector3(9, 1.3, 3);
  };

  // ---------------------------------------------------------
  // LAUNDRY — x∈[-3,3], z∈[0,5.6]
  // ---------------------------------------------------------
  World.prototype._buildLaundry = function () {
    const T = this.T, M = this.M;
    this._roomShell(-3, 3, M.linoleum, M.wallInt);
    // fluorescent tube
    const flor = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.14), this.emisMat(null, 0xdfe8ff, 1.2));
    flor.material.color = new THREE.Color(0x14161c);
    flor.position.set(0, WALL_H - 0.06, 2.6);
    this.scene.add(flor);
    this.props.laundryTube = flor;
    const lLight = this.addLight('laundry', 0, WALL_H - 0.25, 2.6, 0xcfd8ec, 4.5, 9);
    this.flickers.push({ t: 0, speed: 1.1, eval: (t) => (Math.sin(t * 6.3) > -0.96 ? 1 : 0.25), entry: lLight === null ? null : this.lights.get('laundry'), mesh: flor, emisBase: 1.2 });

    // 3 washers (left wall) — front faces +x
    for (let i = 0; i < 3; i++) {
      const wx = -2.55, wz = 1.0 + i * 1.15;
      const wm = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.95, 0.95), this.texMat(T.washer));
      wm.position.set(wx, 0.475, wz);
      wm.rotation.y = Math.PI / 2;
      wm.castShadow = true; wm.receiveShadow = true;
      this.scene.add(wm);
      this.colliders.push(Object.assign(AABB.fromCenter(wx, wz, 0.8, 1.0, 0, 0.95), { tag: 'washer' }));
      this.props['washer' + (i + 1)] = wm;
    }
    this.addInteract({
      id: 'washer3', pos: new THREE.Vector3(-2.45, 0.6, 3.3), radius: 0.9,
      label: () => 'Open the washer',
      action: (G) => {
        G.audio.latch('drawer', { x: -2.4, y: 0.6, z: 3.3 });
        G.ui.subtitle('DANA', "Someone's clothes are still in here. Warm. The load should've finished hours ago.", { thought: true });
      },
    });

    // 2 dryers + folding table (right wall)
    for (let i = 0; i < 2; i++) {
      const wx = 2.55, wz = 1.2 + i * 1.15;
      const wm = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.95, 0.95), this.texMat(T.washer));
      wm.position.set(wx, 0.475, wz);
      wm.rotation.y = Math.PI / 2;
      wm.castShadow = true;
      this.scene.add(wm);
      this.colliders.push(Object.assign(AABB.fromCenter(wx, wz, 0.8, 1.0, 0, 0.95), { tag: 'dryer' }));
    }
    this.box(0.9, 0.9, 2.2, M.woodLight, 2.55, 0.45, 4.0, { collide: true, name: 'foldtable' });
    // towel basket on the table
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.45), this.mat({ color: 0x8a7a4a }));
    basket.position.set(2.5, 1.02, 3.6);
    this.scene.add(basket);
    for (let i = 0; i < 3; i++) this.box(0.5, 0.08, 0.35, M.pillow, 2.5, 1.18 + i * 0.075, 3.6, { castShadow: false });
    this.props.basket = basket;
    this.addInteract({
      id: 'towels', meshes: [basket],
      label: () => 'Take the folded towels',
      enabled: (G) => !!(G.story && G.story.flags.taskTowels) && !G.player.hasItem('towels') && !G.story.flags.towelsDelivered,
      action: (G) => {
        basket.visible = false;
        G.player.giveItem('towels', { label: 'Folded towels' });
        G.audio.latch('paper', { x: 2.5, y: 1.1, z: 3.6 });
        G.ui.subtitle('DANA', 'One, two, three towels. Room 4, coming up.', { thought: true });
      },
    });

    // detergent shelf
    for (let i = 0; i < 2; i++) this.box(1.2, 0.04, 0.28, M.woodLight, -1.8, 1.4 + i * 0.4, 5.35, { name: 'shelf' });
    for (let i = 0; i < 5; i++) this.box(0.16, rand(0.18, 0.3), 0.2, this.mat({ color: pick([0x7a2f2f, 0x2f5f7a, 0x7a6f2f]) }), -2.25 + i * 0.26, 1.56, 5.35, { castShadow: false });

    // mop & bucket corner
    const mop = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 6), M.woodLight);
    mop.position.set(2.8, 0.75, 5.25); mop.rotation.z = 0.16;
    this.scene.add(mop);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.3, 9), this.mat({ color: 0x3a5a7a }));
    bucket.position.set(2.5, 0.15, 5.3);
    this.scene.add(bucket);
    this.props.mop = mop;

    // BREAKER PANEL (back wall)
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.12), this.texMat(T.panel));
    panel.position.set(1.3, 1.5, 5.52);
    this.scene.add(panel);
    this.props.panel = panel;
    this.breaker = { LOT: true, SIGN: false, ROOMS: true, OFFICE: true, MAIN: true, fuseIn: true };
    const swDefs = [
      ['LOT', -0.23, 0.12], ['SIGN', -0.23, -0.06], ['ROOMS', -0.23, -0.24], ['OFFICE', -0.23, -0.42],
    ];
    this.breakerMeshes = {};
    const pGroup = new THREE.Group();
    pGroup.position.copy(panel.position);
    pGroup.rotation.y = 0;
    for (const [name, ox, oy] of swDefs) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.05), this.mat({ color: 0x1c1c20 }));
      sw.position.set(1.3 + ox, 1.5 + oy + 0.34, 5.44);
      this.scene.add(sw);
      this.breakerMeshes[name] = sw;
      this.addInteract({
        id: 'sw_' + name, meshes: [sw],
        label: () => `${name} breaker — ${this.breaker[name] ? 'ON' : 'OFF'}`,
        enabled: (G) => this.breaker.MAIN && this.breaker.fuseIn,
        action: (G) => {
          this.breaker[name] = !this.breaker[name];
          G.audio.breakerChunk({ x: 1.3, y: 1.5, z: 5.4 });
          this.applyPowerMap();
          G.story && G.story.hook('breaker', name);
        },
      });
    }
    // main lever + fuse slot
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.06), this.mat({ color: 0xa02020 }));
    lever.position.set(1.62, 1.55, 5.44);
    this.scene.add(lever);
    this.breakerMeshes.MAIN = lever;
    this.addInteract({
      id: 'sw_MAIN', meshes: [lever],
      label: (G) => {
        if (!this.breaker.fuseIn) return 'Main breaker — dead (fuse missing)';
        return this.breaker.MAIN ? 'Main breaker — ON' : 'Main breaker — OFF';
      },
      action: (G) => {
        if (!this.breaker.fuseIn) {
          G.audio.latch('locked', { x: 1.3, y: 1.5, z: 5.4 });
          G.ui.subtitle('DANA', 'The lever just wobbles. The main fuse is GONE — he took it with him.', { thought: true });
          G.story && G.story.hook('mainNoFuse');
          return;
        }
        this.breaker.MAIN = !this.breaker.MAIN;
        G.audio.breakerChunk({ x: 1.3, y: 1.5, z: 5.4 }, true);
        if (!this.breaker.MAIN) G.audio.powerDown(); else G.audio.powerUp();
        this.applyPowerMap();
        G.story && G.story.hook('mainBreaker', this.breaker.MAIN);
      },
    });
    this.addInteract({
      id: 'fuseslot', pos: new THREE.Vector3(1.47, 1.28, 5.44), radius: 0.5,
      label: (G) => this.breaker.fuseIn ? 'Main fuse (50A) — seated' : (G.player.hasItem('fuse') ? 'Insert the 50A fuse' : 'Main fuse — MISSING'),
      action: (G) => {
        if (this.breaker.fuseIn) { G.ui.subtitle('DANA', 'The big ceramic fuse. Don’t lick that.', { thought: true }); return; }
        if (!G.player.hasItem('fuse')) {
          G.ui.subtitle('DANA', 'Empty clips. He took the fuse — Marco keeps spares in the register drawer back at the office.', { thought: true, dur: 5 });
          G.story && G.story.hook('needFuse');
          return;
        }
        this.breaker.fuseIn = true;
        G.player.takeItem('fuse');
        G.audio.latch('unlock', { x: 1.4, y: 1.3, z: 5.4 });
        G.story && G.story.hook('fuseInserted');
      },
    });

    // laundry double door (one usable leaf at x=0, glass pane)
    const ldoor = new Door(this, 'laundry', -0.55, 0.02, { w: 1.05, tex: T.door('#3f4a52'), label: 'Laundry door' });
    this.doors.set('laundry', ldoor);
    this.addInteract({
      id: 'door_laundry', meshes: [ldoor.mesh],
      label: () => ldoor.isOpen() ? 'Close the laundry door' : 'Open the laundry door',
      enabled: (G) => !G.player.hidden,
      action: (G) => {
        if (!ldoor.isOpen()) { G.audio.doorCreak(true, { x: 0, y: 1.2, z: 0 }); ldoor.open(); }
        else { G.audio.doorCreak(false, { x: 0, y: 1.2, z: 0 }); ldoor.close(); }
      },
    });

    // back window (blinds half open — scares happen here)
    this.box(0.9, 1.0, 0.24, M.wallInt, 1.0, 0.5, 5.6, { name: 'lwinwall' });
    this.box(0.9, WALL_H - 2.1, 0.24, M.wallInt, 1.0, 2.1 + (WALL_H - 2.1) / 2, 5.6 + 0.001);
    const lb = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.05), this.M.glass);
    lb.position.set(1.0, 1.55, 5.46); lb.rotation.y = Math.PI; // face the room
    this.scene.add(lb);
    const lBlinds = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.05), this.texMat(T.blinds, { side: THREE.DoubleSide, transparent: true, alphaTest: 0.35 }));
    lBlinds.position.set(1.0, 1.55, 5.52); lBlinds.rotation.y = Math.PI;
    this.scene.add(lBlinds);
    this.props.laundryWindow = new THREE.Vector3(1.0, 1.55, 5.60);
    this.props.laundryWinMesh = lb;
    this.props.backWindowPos = new THREE.Vector3(1.0, 1.45, 6.4);
    this.addInteract({
      id: 'lwindow', meshes: [lb],
      label: (G) => G.story && G.story.flags.carEscape ? 'CLIMB OUT THE WINDOW' : 'The window (painted shut)',
      action: (G) => {
        const F = G.story.flags;
        if (!F.carEscape) {
          G.audio.latch('locked', { x: 1, y: 1.5, z: 5.6 });
          G.ui.subtitle('DANA', 'Painted shut since the seventies. Good. Nothing gets in, nothing gets out — wait.', { thought: true });
          return;
        }
        if (F.wentWindow) return;
        F.wentWindow = true;
        G.audio.doorSlam({ x: 1, y: 1.4, z: 5.6 }, 0.8);
        G.effects.flash(0x000000, 0.9);
        G.effects.shake(0.7);
        G.player.pos.set(1.0, 0, 6.7);
        G.player.yaw = Math.PI * 0.5;
        G.ui.subtitle('DANA', 'The sash gives way under my whole weight. Gravel. ALLEY. The car — around the office side.', { thought: true, dur: 5 });
        G.ui.setObjective('Around the corner — YOUR CAR.');
        G.story && G.story.hook('wentWindow');
      },
    });

    // door chime spots: laundry vent hum
    this.props.laundryCenter = new THREE.Vector3(0, 1.3, 3);
  };

  // ---------------------------------------------------------
  // GUEST ROOMS 2–6 (+ boarded 7)
  // ---------------------------------------------------------
  World.prototype._buildRooms = function () {
    const T = this.T, M = this.M, G = this.G;

    // cx = door CENTER (matches the facade gaps)
    const mkDoor = (id, cx, color, num, locked) => {
      const x = cx;
      const d = new Door(this, id, cx - 0.48, 0.02, { tex: T.door(color, num), label: `Room ${num} door`, locked });
      this.doors.set(id, d);
      this.addInteract({
        id: 'door_' + id, meshes: [d.mesh],
        label: (G) => {
          if (d.locked) {
            if (G.player && G.player.hasItem('masterkey') && G.story && G.story.flags.masterUnlockOk) return `Unlock Room ${num} (master key)`;
            return `Room ${num} door (locked)`;
          }
          return d.isOpen() ? `Close Room ${num} door` : `Open Room ${num} door`;
        },
        enabled: (G) => !G.player.hidden,
        action: (G) => {
          if (d.locked) {
            if (G.player.hasItem('masterkey') && G.story && G.story.flags.masterUnlockOk) {
              d.setLocked(false); G.audio.latch('unlock', { x, y: 1.2, z: 0 });
              G.story.hook('roomUnlocked', id);
            } else {
              G.audio.latch('locked', { x, y: 1.2, z: 0 });
              G.story && G.story.hook('knockLocked', id);
            }
            return;
          }
          if (!d.isOpen()) { G.audio.doorCreak(true, { x, y: 1.2, z: 0 }); d.open(); G.story && G.story.hook('roomOpened', id); }
          else { G.audio.doorCreak(false, { x, y: 1.2, z: 0 }); d.close(); G.story && G.story.hook('roomClosed', id); }
        },
      });
      return d;
    };

    mkDoor('r2', -6.0, '#3f6a62', 2, true);
    mkDoor('r3', -12.0, '#3f6a62', 3, true);
    mkDoor('r4', -18.0, '#3f6a62', 4, true);
    mkDoor('r5', -24.0, '#3f6a62', 5, true);
    mkDoor('r6', -30.0, '#3f6a62', 6, true);

    // boarded room 7 door
    const d7 = new Door(this, 'r7', -36.48, 0.02, { tex: T.door('#5a4a3a', 7), locked: true });
    this.doors.set('r7', d7);
    for (let i = 0; i < 3; i++) {
      const plank = this.box(1.15, 0.14, 0.05, M.woodDark, -36, 0.7 + i * 0.55, -0.06, { castShadow: false });
      plank.rotation.z = rand(-0.1, 0.1);
    }
    this.addInteract({
      id: 'door_r7', meshes: [d7.mesh],
      label: () => 'Room 7 — BOARDED',
      action: (G) => {
        G.audio.latch('locked', { x: -36, y: 1.2, z: 0 });
        G.ui.subtitle('DANA', 'Room 7. Boarded up before I was born. Marco says the smell never left.', { thought: true });
        G.story && G.story.hook('sawRoom7');
      },
    });

    // -------------- shared room interior builder --------------
    const roomInterior = (x0, roomId, { messy = false, bible = false } = {}) => {
      this._roomShell(x0, x0 + 6, M.carpet, M.wallpaper);
      const cx = x0 + 3;
      this._bed(cx - 1.1, 4.4);
      this._nightstand(cx - 2.25, 4.6);
      this._lampOn(cx - 2.25, 0.55, 4.6);
      this._dresser(cx + 1.9, 2.6, Math.PI / 2, true);
      this.props['tv_' + roomId] = this.props._lastTv;
      // ceiling fixture (dead hemisphere look)
      const fix = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), this.emisMat(null, 0xffd9a8, 0.9));
      fix.material.color = new THREE.Color(0x181512);
      fix.position.set(cx, WALL_H - 0.02, 2.8); fix.rotation.x = Math.PI;
      this.scene.add(fix);
      // wall art
      const art = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), this.texMat(T.plate('', '#3a4030', '#3a4030')));
      art.position.set(cx + 0.5, 1.9, 5.58); art.rotation.y = Math.PI;
      this.scene.add(art);
      if (bible) { const b = this.box(0.2, 0.04, 0.14, this.mat({ color: 0x2a1f2e }), cx - 2.25, 0.6, 4.5, { castShadow: false }); b.rotation.y = 0.3; }
      return cx;
    };

    // ---- Room 2: Mrs. Abernathy (locked; warm light + TV murmur)
    {
      const cx = roomInterior(-9, 'r2');
      this._windowCurtains(-8.2, -6.5, 0, 'r2', { closed: true, lit: 0xffc890 });
      this._windowCurtains(-5.5, -3.8, 0, 'r2b', { closed: true, lit: 0xffc890 });
      this.props.r2GlowBed = true;
      this.lights.set('r2', { light: { intensity: 0 }, base: 0, on: true }); // virtual (window glow only)
    }

    // ---- Room 3: vacant, door found open, flickering bathroom
    {
      const cx = roomInterior(-15, 'r3', { bible: true });
      this._windowCurtains(-14.2, -12.5, 0, 'r3', { closed: false });
      this._windowCurtains(-11.5, -9.8, 0, 'r3b', { closed: false });
      // closet
      this._closet(-9.28, 1.7, 'r3', -1);
      // bathroom partition (x -14.9..-12.9, z 4.1..5.6) with a doorway gap x -14.45..-13.63
      this.box(0.1, WALL_H, 1.5, M.tileBath, -12.9, WALL_H / 2, 4.85, { collide: true, sight: true, name: 'bathwall' });
      this.box(0.6, WALL_H, 0.1, M.tileBath, -14.75, WALL_H / 2, 4.1, { collide: true, sight: true, name: 'bathwallf' }); // left of doorway
      this.box(0.68, WALL_H, 0.1, M.tileBath, -13.29, WALL_H / 2, 4.1, { collide: true, sight: true, name: 'bathwallf' }); // right of doorway
      this.box(0.82, WALL_H - 2.0, 0.1, M.tileBath, -14.04, 2.0 + (WALL_H - 2.0) / 2, 4.1, { name: 'bathheader' });
      // bathroom door
      const bdoor = new Door(this, 'r3bath', -14.45, 4.1 + 0.02, { w: 0.82, h: 2.0, tex: T.door('#6a7a72'), label: 'Bathroom door' });
      this.doors.set('r3bath', bdoor);
      this.addInteract({
        id: 'door_r3bath', meshes: [bdoor.mesh],
        label: () => bdoor.isOpen() ? 'Close the bathroom door' : 'Open the bathroom door',
        action: (G) => {
          if (!bdoor.isOpen()) { G.audio.doorCreak(true, { x: -14.4, y: 1.1, z: 4.1 }, true); bdoor.open(); G.story && G.story.hook('r3bathOpened'); }
          else { G.audio.doorCreak(false, { x: -14.4, y: 1.1, z: 4.1 }); bdoor.close(); }
        },
      });
      // bathroom light + switch
      this.addLight('r3bath', -14, 2.45, 4.9, 0xd8e2da, 3.4, 5);
      this.flickers.push({ t: 0, speed: 2.6, eval: (t) => (Math.sin(t * 11) > -0.7 ? 1 : 0.12) * (Math.random() < 0.06 ? 0.3 : 1), entry: this.lights.get('r3bath') });
      this.setLight('r3bath', false);
      const sw = this.box(0.07, 0.12, 0.03, this.mat({ color: 0xb8b2a2 }), -13.0, 1.25, 4.35, { castShadow: false });
      this.addInteract({
        id: 'r3bathlight', meshes: [sw],
        label: () => this.lights.get('r3bath').on ? 'Turn off the bathroom light' : 'Turn on the bathroom light',
        action: (G) => {
          const e = this.lights.get('r3bath'); this.setLight('r3bath', !e.on);
          G.audio.latch('switch', { x: -13, y: 1.25, z: 4.35 });
        },
      });
      // sink + mirror + toilet
      this.box(0.6, 0.14, 0.45, this.mat({ color: 0xb8bdb5 }), -13.6, 0.85, 5.32, { name: 'sink' });
      this.box(0.6, 0.72, 0.42, M.woodLight, -13.6, 0.36, 5.32, { collide: true, name: 'vanity' });
      const mir = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.6), this.M.mirror);
      mir.position.set(-13.6, 1.5, 5.57); mir.rotation.y = Math.PI;
      this.scene.add(mir);
      this.box(0.45, 0.42, 0.6, this.mat({ color: 0xb8bdb5 }), -14.5, 0.21, 5.2, { collide: true, name: 'toilet' });
      // vanity drawer (empty)
      const vdr = new Drawer(this, 'r3vanity', -13.6, 0.5, 5.1, 0.5, 0.16, 0.36, T.woodLight, 'Vanity drawer');
      this.drawers.set('r3vanity', vdr);
      this.addInteract({
        id: 'r3vanity', meshes: [vdr.mesh],
        label: () => vdr.target > 0.5 ? 'Close the vanity drawer' : 'Open the vanity drawer',
        action: (G) => {
          G.audio.drawerSlide(vdr.target < 0.5, { x: -13.6, y: 0.5, z: 5.3 });
          vdr.toggle();
          if (vdr.target > 0.5) G.ui.subtitle('DANA', 'Empty. Matches. I count seven matchbooks from bars on Route 9.', { thought: true });
        },
      });
      // open window above the toilet (dark glass + cold draft; storytelling beat)
      const bw = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.85), this.M.glass);
      bw.position.set(-14.5, 1.6, 5.47); bw.rotation.y = Math.PI;
      this.scene.add(bw);
      // TV
      this.addInteract({
        id: 'r3tv', pos: new THREE.Vector3(-13.1, 1.3, 2.6), radius: 0.9,
        label: (G) => this.props.r3tvOn ? 'Turn off the TV' : 'Turn on the TV',
        action: (G) => { G.story && G.story.hook('r3tvToggle'); },
      });
      // scratch message inside closet
      const scratch = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), this.texMat(T.wallScratch, { transparent: true }));
      scratch.position.set(-9.95, 1.5, 1.7); scratch.rotation.y = Math.PI / 2;
      this.scene.add(scratch);
      this.addInteract({
        id: 'scratch', meshes: [scratch],
        label: () => 'Look at the writing',
        action: (G) => {
          G.audio.stingLow(0.3);
          G.ui.subtitle('DANA', `"Don't let him count the rooms." Scratched into the paint. Inside the closet.`, { thought: true });
          G.story && G.story.hook('sawScratch');
        },
      });
      this.props.r3tvGroupPos = new THREE.Vector3(-13.1, 1.2, 2.6);
    }

    // ---- Room 4: Mr. Vale (towel delivery; later found empty)
    {
      const cx = roomInterior(-21, 'r4', { messy: true });
      this._windowCurtains(-20.2, -18.5, 0, 'r4', { closed: true, lit: 0xe89a50 });
      this._windowCurtains(-17.5, -15.8, 0, 'r4b', { closed: true, lit: 0xe89a50 });
      this._closet(-15.28, 1.7, 'r4', -1);
      // bottles lined on the dresser
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.16, 7), this.mat({ color: 0x3a5230 }));
        b.position.set(-19.6, 1.03, 1.35 + i * 0.12); b.rotation.y = Math.PI / 2;
        this.scene.add(b);
      }
      // suitcase open on floor (packed in a hurry — revealed in ch3)
      const suit = new THREE.Group();
      const sb = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.2, 0.5), this.mat({ color: 0x5a4030 }));
      sb.position.y = 0.1;
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.06, 0.5), this.mat({ color: 0x6a4c38 }));
      sl.position.set(0, 0.24, -0.24); sl.rotation.x = -1.9;
      suit.add(sb, sl);
      suit.position.set(-19.4, 0, 3.4); suit.rotation.y = 0.4;
      this.scene.add(suit);
      this.props.valeSuitcase = suit;
      // wallet on bed
      const wal = this.box(0.14, 0.03, 0.1, this.mat({ color: 0x3a2818 }), -19.9, 0.64, 4.3, { castShadow: false });
      this.props.valeWallet = wal;
      this.addInteract({
        id: 'valewallet', meshes: [wal],
        label: () => "Look at the wallet",
        enabled: (G) => true,
        action: (G) => {
          G.ui.subtitle('DANA', 'A wallet, fat with cash, face-down on the bed like a down payment. Nobody checks out and leaves this.', { thought: true });
          G.story && G.story.hook('sawWallet');
        },
      });
      this.addInteract({
        id: 'r4messybed', pos: new THREE.Vector3(-19.6, 0.6, 4.4), radius: 1.1,
        label: () => 'Look at the bed',
        enabled: (G) => G.story && G.story.chapter >= 3,
        action: (G) => {
          G.ui.subtitle('DANA', 'Slept in. Recently. The pillow still holds the shape of a head.', { thought: true });
        },
      });
      // TV (snaps on by itself in chapter 3; toggleable)
      this.addInteract({
        id: 'r4tv', pos: new THREE.Vector3(-19.1, 1.25, 2.6), radius: 0.9,
        enabled: (G) => G.story && G.story.chapter >= 2,
        label: (G) => (this.props.tv_r4 && this.props.tv_r4.userData.on) ? 'Turn off the TV' : 'Turn on the TV',
        action: (G) => {
          const on = !(this.props.tv_r4 && this.props.tv_r4.userData.on);
          G.story.props_r4tv(on);
          G.audio.latch('switch', { x: -19.1, y: 1.2, z: 2.6 });
          if (!on && G.story.flags.leaveR4) G.ui.subtitle('DANA', 'Off. Again. If it comes back on while I’m gone I am walking to Reno.', { thought: true });
        },
      });
      this.props.r4LightWin1 = 'r4';
      this.lights.set('r4', { light: { intensity: 0 }, base: 0, on: true });
      // amber lampshade glow (when occupied)
      const r4lamp = this.addLight('r4lamp', -19.5, 1.15, 4.6, 0xe89a50, 2.6, 6);
      this.flickers.push({ t: 0, speed: 1.4, eval: (t) => (Math.sin(t * 3.7) > -0.98 ? 1 : 0.4) });
    }

    // ---- Room 5: vacant & bare (master key demo)
    {
      const cx = roomInterior(-27, 'r5');
      this._windowCurtains(-26.2, -24.5, 0, 'r5', { closed: false });
      this._windowCurtains(-23.5, -21.8, 0, 'r5b', { closed: false });
      this._closet(-21.28, 1.7, 'r5', -1);
    }

    // ---- Room 6: trucker (locked, dark)
    {
      const cx = roomInterior(-33, 'r6');
      this._windowCurtains(-32.2, -30.5, 0, 'r6', { closed: true, lit: 0xffd0a0 });
      this._windowCurtains(-29.5, -27.8, 0, 'r6b', { closed: true });
    }

    // curtains assoc for story: R4 lit planes to kill later
  };

  // ---------------------------------------------------------
  // PARKING LOT — cars, sign, dumpster, vending, payphone
  // ---------------------------------------------------------
  World.prototype._buildLot = function () {
    const T = this.T, M = this.M;
    const mkCar = (x, z, ry, color, { wagon = false } = {}) => {
      const g = new THREE.Group();
      const bodyMat = this.mat({ color });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, wagon ? 4.6 : 4.2), bodyMat);
      body.position.y = 0.55;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, wagon ? 2.9 : 2.2), bodyMat);
      cab.position.set(0, 1.0, wagon ? 0.2 : -0.1);
      const glassM = M.glass;
      const shield = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 0.05), glassM);
      shield.position.set(0, 0.98, wagon ? -1.3 : -1.2); shield.rotation.x = 0.3;
      const winB = shield.clone(); winB.position.z = wagon ? 1.65 : 1.05; winB.rotation.x = -0.3;
      g.add(body, cab, shield, winB);
      for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.35], [0.85, -1.35]]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 9), this.mat({ color: 0x0c0c0e }));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 0.32, wz * (wagon ? 1.15 : 1));
        g.add(wheel);
      }
      g.position.set(x, 0, z); g.rotation.y = ry;
      g.traverse(m => { m.castShadow = true; m.receiveShadow = true; });
      this.scene.add(g);
      const rad = Math.abs(Math.sin(ry)) > 0.5;
      const b = AABB.fromCenter(x, z, rad ? (wagon ? 4.6 : 4.2) : 1.9, rad ? 1.9 : (wagon ? 4.6 : 4.2), 0, 1.3);
      b.tag = 'car'; this.colliders.push(b);
      return g;
    };

    // player car — teal sedan near office
    this.props.playerCar = mkCar(11.5, -6.2, -0.32, 0x2a4a4c);
    this.addInteract({
      id: 'playercar', pos: new THREE.Vector3(10.8, 1.0, -5.6), radius: 1.6,
      label: (G) => G.story && G.story.flags.carEscape ? 'UNLOCK THE CAR' : 'Your car — a tired teal sedan',
      enabled: (G) => !G.player.hidden,
      action: (G) => { G.story && G.story.hook('carInteract'); },
    });
    // Vale's mud-splattered wagon outside room 4
    this.props.valeCar = mkCar(-17.6, -5.8, 0.12, 0x4a4438, { wagon: true });
    this.addInteract({
      id: 'valecar', pos: new THREE.Vector3(-17.6, 1.0, -5.8), radius: 1.6,
      label: () => 'An old station wagon, mud to the windows',
      action: (G) => {
        G.ui.subtitle('DANA', 'Mud caked over the plates, deliberate-like. The back is full of furniture blankets shaped like bodies.', { thought: true });
        G.audio.stingLow(0.2);
      },
    });
    // trucker's long-nose cab far west
    this.props.truck = mkCar(-30, -7.5, 0.05, 0x5a2a2a, { wagon: true });
    this.props.truck.scale.set(1.3, 1.35, 1.6);

    // ---------------- roadside neon sign ----------------
    const signG = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 5.4, 8), this.mat({ color: 0x3a3a3e }));
    pole.position.y = 2.7;
    const box = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 0.35), this.mat({ color: 0x191a1c }));
    box.position.y = 6.0;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.2), this.emisMat(T.roadsign, 0xffffff, 1.05));
    face.position.set(0, 6.0, -0.19);
    face.rotation.y = Math.PI;
    const face2 = face.clone(); face2.position.z = 0.19; face2.rotation.y = 0;
    signG.add(pole, box, face, face2);
    signG.position.set(24, 0, -31.5);
    this.scene.add(signG);
    this.props.signStar = face; this.props.signMotel = face2;
    this.props.signGlow = this.glowSprite(T.glowDot, 24, 6, -31.4, 9, 0.0);
    this.addLight('sign', 24, 6, -30.4, 0xff7a5a, 0.0, 26);
    this.colliders.push(Object.assign(AABB.fromCenter(24, -31.5, 0.5, 0.5, 0, 7), { tag: 'signpole' }));
    this.props.signPos = new THREE.Vector3(24, 0, -31.5);
    this.addInteract({
      id: 'bigsigntouch', pos: new THREE.Vector3(24, 1.2, -31.5), radius: 2.0,
      label: () => 'The Starview sign',
      action: (G) => G.ui.subtitle('DANA', 'STAR ★ VIEW. American-owned since 1962, the base of the pole says. The star tilts like it heard that and laughed.', { thought: true }),
    });

    // dead street lamp on the road (never works — pure dread)
    const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6.5, 7), this.mat({ color: 0x2c2c30 }));
    lampPost.position.set(4, 3.25, -27);
    const lampArm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.12), this.mat({ color: 0x2c2c30 }));
    lampArm.position.set(4.6, 6.4, -27);
    const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), this.mat({ color: 0x1c1c20 }));
    lampHead.position.set(5.3, 6.34, -27);
    this.scene.add(lampPost, lampArm, lampHead);
    this.props.deadLampPos = new THREE.Vector3(5.3, 6.2, -27);

    // ---------------- ice + vending alcove (east of office)
    this.box(1.3, 2.1, 1.0, this.texMat(T.plate('ICE', '#2a3a4a', '#9ad3ff')), 16.6, 1.05, -1.0, { collide: true, name: 'ice' });
    this.addInteract({
      id: 'ice', pos: new THREE.Vector3(16.6, 1.1, -1.0), radius: 1.6,
      label: () => 'The ice machine',
      action: (G) => {
        G.audio.latch('slam', { x: 16.6, y: 1, z: -1 });
        G.ui.subtitle('DANA', 'Empty. Something at the bottom that used to be a bag.', { thought: true });
      },
    });
    const vend = this.box(1.1, 2.0, 0.9, this.texMat(T.vending), 18.3, 1.0, -1.0, { collide: true, name: 'vending' });
    this.addInteract({
      id: 'vending', pos: new THREE.Vector3(18.3, 1.0, -1.0), radius: 1.6,
      label: () => 'The soda machine',
      action: (G) => {
        G.audio.latch('locked', { x: 18.3, y: 1, z: -1 });
        G.ui.subtitle('DANA', 'It hums and offers eleven buttons, ten of them sold out. The eleventh is CREME.', { thought: true });
        G.story && (G.story.flags.vendSeen = true);
      },
    });

    // payphone kiosk by the office
    this.box(0.9, 2.5, 0.9, this.mat({ color: 0x2a3440 }), 15.6, 1.25, -4.2, { collide: true, name: 'payphone booth' });
    const phFace = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), this.texMat(T.plate('PHONE', '#1a222c', '#7fb8e8')));
    phFace.position.set(15.6, 1.9, -3.72);
    this.scene.add(phFace);
    const receiver = this.box(0.09, 0.22, 0.06, this.mat({ color: 0x15181c }), 15.55, 1.3, -3.76, { name: 'receiver' });
    this.props.payphoneReceiver = receiver;
    this.addInteract({
      id: 'payphone', meshes: [receiver],
      label: () => 'Answer the payphone',
      enabled: (G) => !!(G.story && G.story.flags.payphoneRinging),
      action: (G) => { G.story && G.story.hook('answerPayphone'); },
    });
    this.props.payphonePos = new THREE.Vector3(15.6, 1.3, -4.0);

    // dumpster in the back alley (trash task)
    const dump = new THREE.Group();
    const db = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 1.4), this.mat({ color: 0x2e4a34 }));
    db.position.y = 0.65;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.42), this.mat({ color: 0x243d2a }));
    lid.position.set(0, 1.35, -0.05); lid.rotation.x = -0.08;
    dump.add(db, lid);
    dump.position.set(-24, 0, 8.4);
    dump.traverse(m => { m.castShadow = true; });
    this.scene.add(dump);
    this.props.dumpsterLid = lid;
    this.colliders.push(Object.assign(AABB.fromCenter(-24, 8.4, 2.7, 1.5, 0, 1.3), { tag: 'dumpster' }));
    this.addInteract({
      id: 'dumpster', pos: new THREE.Vector3(-24, 1.1, 7.6), radius: 2.0,
      label: (G) => G.player && G.player.hasItem('trashbag') ? 'Throw the bag in the dumpster' : 'The dumpster',
      action: (G) => {
        if (G.player.hasItem('trashbag')) {
          G.player.takeItem('trashbag');
          G.audio.latch('slam', { x: -24, y: 1.2, z: 8.4 });
          G.story && G.story.hook('trashDumped');
        } else {
          G.audio.stingLow(0.18);
          G.ui.subtitle('DANA', 'Something shifts in there. Trash… probably. Raccoons wear little masks, I remind myself.', { thought: true });
          G.story && G.story.hook('dumpsterPeek');
        }
      },
    });
    // fence gate to back alley (west side)
    const gate = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.9), M.chainlink);
    gate.position.set(-42.5, 0.95, 4); gate.rotation.y = Math.PI / 2 + 0.5;
    this.scene.add(gate);
    // rear walkway gravel patch (alley)
    const alley = new THREE.Mesh(new THREE.PlaneGeometry(60, 5), M.dirt);
    alley.rotation.x = -Math.PI / 2; alley.position.set(-13, 0.03, 8.6); alley.receiveShadow = true;
    this.scene.add(alley);
  };

  // ---------------------------------------------------------
  // CCTV: camera at the office front corner + office monitor feed
  // ---------------------------------------------------------
  World.prototype._buildCCTV = function () {
    // cam 1: mounted at office SE corner pointing WEST down the walkway
    const camG = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.4), this.mat({ color: 0x222226 }));
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.3), this.mat({ color: 0x2c2c30 }));
    housing.position.z = -0.3;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 8), this.mat({ color: 0x0a0a10 }));
    lens.rotation.x = Math.PI / 2; lens.position.z = -0.46;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 5), this.emisMat(null, 0xff2222, 2));
    led.position.set(0.05, -0.06, -0.42);
    camG.add(arm, housing, lens, led);
    camG.position.set(14.9, 2.65, -0.4);
    camG.rotation.y = Math.PI / 2 + Math.PI; // look -x
    this.scene.add(camG);
    this.props.cctvLed = led;

    const rt = new THREE.WebGLRenderTarget(224, 128);
    const cam = new THREE.PerspectiveCamera(70, 224 / 128, 0.3, 40);
    cam.position.set(14.7, 2.5, -0.7);
    cam.lookAt(-20, 1.2, -1.2);
    this.cctv = { rt, cam, live: true, staticAt: 0 };
    // monitor screen material (screen sits on the front face, toward the chair)
    const scrMat = new THREE.MeshBasicMaterial({ map: rt.texture });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.3), scrMat);
    const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.5);
    scr.position.set(5.55, 1.44, 2.6).add(front.multiplyScalar(0.225));
    scr.rotation.y = -0.5;
    this.scene.add(scr);
    this.cctv.screenMat = scrMat;
    this.cctv.screenMesh = scr;
    // door chime sensor over office door
    const chim = this.box(0.14, 0.08, 0.06, this.mat({ color: 0x8a8a8a }), 4.1, 2.25, 0.1, { castShadow: false, name: 'chime' });
    this.props.officeChime = chim;
  };

  // ---------------------------------------------------------
  // power routing: central place where breaker state drives lights
  // ---------------------------------------------------------
  World.prototype.applyPowerMap = function () {
    const B = this.breaker;
    const mains = B.MAIN && B.fuseIn;
    const G = this.G;
    // walkway/porch/ice/vending = LOT
    const lot = mains && B.LOT;
    for (const id of ['walk1', 'walk2', 'walk3']) this.setLight(id, lot);
    this.walkLampMeshes.forEach((t, i) => { t.material.emissiveIntensity = lot ? (i === 2 ? 0.9 : 1.4) : 0; t.material.color.set(lot ? 0x1c1a16 : 0x101010); });
    this.walkLampGlows.forEach(s => s.material.opacity = lot ? 0.4 : 0);
    this.props.porchGlow.material.opacity = lot ? 0.32 : 0;
    if (G.audio.ctx && !this._vendHummed) { G.audio.startHum('hum_vending', { x: 17.5, y: 1.4, z: -1 }, { freq: 100, vol: 0.045, ref: 1.4, max: 12 }); this._vendHummed = true; }
    G.audio.setLoopVol('hum_vending', lot ? 0.045 : 0);
    // sign
    const sign = mains && B.SIGN;
    this.setLight('sign', sign);
    if (this.props.signStar) {
      this.props.signStar.material.emissiveIntensity = sign ? 1.1 : 0.04;
      this.props.signMotel.material.emissiveIntensity = sign ? 1.0 : 0.04;
      this.props.signGlow.material.opacity = sign ? 0.5 : 0;
    }
    if (sign && !this._signHummed && this.G.audio.ctx) { this.G.audio.startHum('hum_sign', { x: 24, y: 5.6, z: -31 }, { freq: 118, vol: 0.04, ref: 3, max: 30 }); this._signHummed = true; }
    this.G.audio.setLoopVol('hum_sign', sign ? 0.04 : 0);
    this.signFlicker = sign;
    // rooms (r2 tv/window glow stays since guest equipment; room3 bath is on ROOMS)
    const rooms = mains && B.ROOMS;
    if (!rooms) this.setLight('r3bath', false);
    // office
    const office = mains && B.OFFICE;
    if (!office) this.setLight('officeLamp', false);
    // laundry light on LOT? put laundry on OFFICE circuit:
    this.setLight('laundry', mains && B.OFFICE);
    this.props.laundryTube.material.emissiveIntensity = (mains && B.OFFICE) ? 1.2 : 0;
    // guest-room window glow dies with the rest
    for (const k of Object.keys(this.props)) {
      if (!k.startsWith('curtains_')) continue;
      const st = this.props[k];
      if (st.litPlane) st.litPlane.visible = mains && st.roomWasLit !== false;
    }
    // global power flag for darkness effects
    this._powerFlag = mains;
    this.power = mains;
    G.story && G.story.hook('powerChanged', mains);
  };

  World.prototype.setRoomWindowLit = function (id, on) {
    const st = this.props['curtains_' + id];
    if (st) { st.roomWasLit = on; if (st.litPlane) st.litPlane.visible = on && this._powerFlag; }
  };

  World.prototype.killPower = function () { // he pulls the main
    this.breaker.MAIN = false;
    this.breaker.fuseIn = false; // and takes the fuse with him
    this.props.fuseMesh.visible = true; // Marco's spare sits in the register
    this.applyPowerMap();
  };

  World.prototype.restorePower = function () {
    this.breaker.MAIN = true;
    this.applyPowerMap();
  };

  // small helper used above
  World.prototype._fuseMesh = function (x, y, z) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), this.mat({ color: 0x8a6a3a }));
    body.rotation.x = Math.PI / 2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.02, 8), this.mat({ color: 0xb8b8b8 }));
    cap.rotation.x = Math.PI / 2; cap.position.z = 0.06;
    const cap2 = cap.clone(); cap2.position.z = -0.06;
    g.add(body, cap, cap2);
    g.position.set(x, y, z);
    this.scene.add(g);
    return g;
  };
}
