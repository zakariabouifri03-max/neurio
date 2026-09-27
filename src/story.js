// ============================================================
// story.js — the director. Chapters, objectives, phone threads,
// triggers, scares, the stealth section, the chase, and both
// the ending and what happens when he catches you.
// ============================================================
import * as THREE from 'three';
import { fmtClock, rand, pick, clamp } from './utils.js';
import { writeSave, loadSave, clearSave, unlockChapter, loadUnlocked } from './save.js';

export const CHAPTERS = [
  { id: 'shift', time: '11:02 PM', title: 'THE SHIFT', clock: 23 * 60 + 2 },
  { id: 'quiet', time: '12:12 AM', title: 'QUIET HOURS', clock: 24 * 60 + 12 },
  { id: 'room4', time: '1:05 AM', title: 'ROOM 4', clock: 25 * 60 + 5 },
  { id: 'blackout', time: '2:30 AM', title: 'BLACKOUT', clock: 26 * 60 + 30 },
  { id: 'chase', time: '3:12 AM', title: 'THE LOT', clock: 27 * 60 + 12 },
];
const CP_SPAWNS = {
  shift: { x: 11.2, z: -7.8, yaw: Math.PI * 0.94, outside: true },
  quiet: { x: 7.6, z: 3.4, yaw: Math.PI * 0.9 },
  room4: { x: 7.6, z: 3.4, yaw: Math.PI * 0.9 },
  blackout: { x: 6.9, z: 2.0, yaw: Math.PI * 0.8 },
  chase: { x: 1.3, z: 5.0, yaw: Math.PI },
};

export class Story {
  constructor(G) {
    this.G = G;
    this.flags = {};
    this.chapter = 0;
    this.clockMin = 23 * 60 - 2; // 10:58 PM
    this.timers = [];
    this.stats = { playTime: 0, deaths: 0, scares: 0, thrown: 0 };
    this.rowVisited = new Set();
    this.checkpointId = null;
    this._chaseOn = false;
    this._escT = 0;
    this._lookingVale = 0;
  }

  later(sec, fn) { this.timers.push({ t: sec, fn }); }
  clearTimers() { this.timers.length = 0; }

  setClock(min, phoneOnly = false) {
    this.clockMin = min;
    this.G.phone.setClock(fmtClock(min));
  }

  save(cp) {
    this.checkpointId = cp;
    unlockChapter(cp);
    writeSave({ checkpoint: cp, stats: this.stats });
  }

  // ==========================================================
  // ENTRY POINTS
  // ==========================================================
  newGame() {
    this.flags = {};
    this.stats = { playTime: 0, deaths: 0, scares: 0, thrown: 0 };
    this.clockMin = 22 * 60 + 58;
    this.G.phone.resetState();
    this.G.phone.setClock(fmtClock(this.clockMin));
    this._initThreads();
    this._sanitizeWorld('shift');
    this._introSequence();
  }

  fromCheckpoint(id) {
    this.flags = {};
    const sv = loadSave();
    if (sv && sv.stats) this.stats = sv.stats;
    this.G.phone.resetState();
    this._initThreads();
    this._sanitizeWorld(id);
    this.applyCheckpoint(id);
  }

  // reset world to a clean per-chapter state (doors, lights, power, AI)
  _sanitizeWorld(id) {
    const G = this.G, W = G.world, S = G.stalker;
    for (const d of W.doors.values()) { d.target = 0; d.locked = false; }
    W.doors.get('r2').locked = true;
    W.doors.get('r6').locked = true;
    W.doors.get('r7').locked = true;
    W.doors.get('r3').locked = true;
    W.doors.get('r4').locked = true;
    W.doors.get('r5').locked = true;
    S.despawn();
    G.vale.setWatching(false);
    G.world.cctv.live = true;
    G.world.cctv.screenMat.map = G.world.cctv.rt.texture;
    G.valeArm && G.valeArm.hide();
    // power on + default breakers
    W.breaker = { LOT: true, SIGN: false, ROOMS: true, OFFICE: true, MAIN: true, fuseIn: true };
    W.props.fuseMesh.visible = false;
    const reg = W.drawers.get('register'); reg.locked = true; reg.target = 0;
    if (id !== 'shift') { W.breaker.SIGN = true; }
    // curtains + lights default
    W.setCurtains('r4', 0); W.setCurtains('r4b', 0);
    W.setCurtains('r3', 1); W.setCurtains('r3b', 1);
    W.setCurtains('r6', 0);
    W.setLight('r4lamp', true);
    W.setLight('officeLamp', true);
    W.hemi.intensity = 0.42;
    W.applyPowerMap();
    // items back on props
    W.props.trashBag.visible = true;
    W.props.bottle.visible = true;
    W.props.carKeys.visible = true;
    G.player.items.clear(); G.player._heldVisual(); G.ui.setVigHint('');
    W.clearTriggers('s_');
    this.clearTimers();
    this._chaseOn = false;
    this._rowTasksStarted = false;
    G.player.flashOn = false; G.player.flash.intensity = 0;
    G.player.speedBoost = 0;
    G.player.frozen = false; G.player.hidden = null;
    G.effects.vignetteBoost(0.85);
    G.ui.letterbox(false);
    G.ui.clearSubtitles();
  }

  applyCheckpoint(id) {
    const G = this.G;
    const cp = CHAPTERS.find(c => c.id === id);
    this.chapter = CHAPTERS.indexOf(cp);
    const sp = CP_SPAWNS[id];
    G.player.pos.set(sp.x, 0, sp.z);
    G.player.yaw = sp.yaw; G.player.pitch = 0;
    this.flags.officeLocked = false;
    // reconstruct items + world per chapter
    if (id !== 'shift') {
      G.player.giveItem('masterkey', { label: 'Master key' });
      G.world.props.masterKeyMesh.visible = false;
      this.flags.masterUnlockOk = true;
      this.flags.signedIn = true; this.flags.towelsDelivered = true; this.flags.trashDone = true;
      this.flags.tasksDone = true;
      G.phone.setTasks([
        { id: 'ledger', text: 'Sign the night ledger', done: true },
        { id: 'sign', text: 'Flip the SIGN breaker (laundry room)', done: true },
        { id: 'towels', text: 'Fresh towels to Room 4', done: true },
        { id: 'trash', text: 'Trash bag to the dumpster', done: true },
        { id: 'row', text: 'Walk the row — check every door', done: true },
      ]);
    }
    if (id === 'room4' || id === 'blackout' || id === 'chase') {
      this.flags.officeLocked = true;
      G.world.doors.get('office').locked = true;
      this.flags.phoneRinging = false;
      if (id === 'blackout' || id === 'chase') {
        G.world.killPower();
        this.flags.powerOut = true;
        G.phone.setSignal(false);
        G.world.hemi.intensity = 0.2;
        G.effects.vignetteBoost(1.15);
        G.world.setLight('r4lamp', false);
        // Vale's room dark + empty
        G.world.doors.get('r4').locked = false;
        G.world.doors.get('r4').open();
        G.world.setCurtains('r4', 0.5);
      }
      if (id === 'chase') {
        // at the panel, fuse in pocket about to restore power
        G.player.giveItem('registerkey', { label: 'Register key' });
        G.world.props.cashKeyMesh.visible = false;
        G.player.giveItem('fuse', { label: '50A fuse' });
        G.player.giveItem('carkeys', { label: 'Car keys' });
        G.world.props.carKeys.visible = false;
      }
    }
    this.setClock(cp.clock);
    this.save(id);
    this._enterChapter(this.chapter, true);
  }

  _initThreads() {
    const P = this.G.phone;
    P.addThread('marco', 'Marco Reyes', '#c98a4a');
    P.addThread('ash', 'Ash', '#4aa3c9');
    P.addThread('mom', 'Mom', '#c94a8a');
    P.addThread('unknown', 'UNKNOWN', '#5a5f68');
  }

  // ==========================================================
  // INTRO — cold open
  // ==========================================================
  _introSequence() {
    const G = this.G;
    this.chapter = 0;
    this.setClock(22 * 60 + 58);
    G.ui.letterbox(true);
    G.ui.fade(true, 0);
    G.player.frozen = true;
    // title cards while black
    this.later(1.2, () => {
      G.ui.subtitle('', 'WESTLAND COUNTY, ROUTE 9', { dur: 3.2 });
    });
    this.later(4.0, () => {
      G.ui.subtitle('', 'the Starview Motel needs a night clerk', { dur: 3.4 });
    });
    this.later(7.6, () => {
      G.ui.chapterCard('10:58 PM', 'STARVIEW', () => {
        G.ui.fade(false, 2800);
        G.ui.letterbox(false);
        // player by their car, engine ticking quiet
        G.player.frozen = false;
        this.chapter = 0;
        this._chapterZero();
      });
    });
  }

  _chapterZero() {
    const G = this.G;
    G.ui.setObjective('Head into the motel office.');
    G.ui.subtitle('DANA', "One night. Marco's exact words: 'Darla needs me, it's one night, the rooms run themselves, nobody books the Starview in October anyway.'", { thought: true, dur: 6 });
    G.audio.thunder(true);
    // Mrs. Abernathy's late show murmurs behind room 2's door all night
    G.audio.startMurmur('r2tv', { x: -6, y: 1.2, z: 2.5 });
    // entering the office
    G.world.addTrigger('s_officein', 3.4, 0.2, 14.5, 5.4, () => {
      G.ui.objectiveDone('Head into the motel office.');
      G.ui.setObjective('Read the note on the counter.');
    });
  }

  // ==========================================================
  // CHAPTER 1 — tasks
  // ==========================================================
  _enterChapter(n, fromCheckpoint = false) {
    const G = this.G;
    this.chapter = n;
    if (n === 0) { this._chapterZero(); return; }
    const cp = CHAPTERS[n];
    if (!fromCheckpoint) {
      G.ui.chapterCard(cp.time, cp.title, () => this.save(cp.id));
      this.save(cp.id);
    }
    if (n === 1) this._chQuiet(fromCheckpoint);
    if (n === 2) this._chRoom4(fromCheckpoint);
    if (n === 3) this._chBlackout(fromCheckpoint);
    if (n === 4) this._chChase(fromCheckpoint);
  }

  // note read → populate the night's task list
  _startTaskList() {
    const G = this.G, F = this.flags, P = G.phone;
    if (this._rowTasksStarted) return;
    this._rowTasksStarted = true;
    F.tasksAll = true;
    P.setTasks([
      { id: 'ledger', text: 'Sign the night ledger', done: false },
      { id: 'sign', text: 'Flip the SIGN breaker (breaker panel, laundry room)', done: false },
      { id: 'towels', text: 'Bring folded towels to Room 4', done: false },
      { id: 'trash', text: 'Take the office trash bag to the dumpster', done: false },
      { id: 'row', text: 'Walk the row — check every room door', done: false },
    ]);
    F.taskTrash = true; F.taskTowels = true;
    G.ui.setObjective('Work Marco\'s list. (Notes app on your phone — press T)');
    this.later(6, () => P.inbound('marco', { text: 'you made it? find the ledger' }));
    this.later(16, () => P.inbound('marco', { text: 'remember: lobby locked at 1. sign on. nobody gets a room key tonight, the cabins are full. (room 2 and 6 are it)' }));
  }

  // Room 3 is found ajar down the row — the first wrong thing of the night
  _room3Beat() {
    const G = this.G, F = this.flags, W = G.world;
    F.foundR3 = true;
    F.tasksOpenedR3 = 'open';
    const door = W.doors.get('r3');
    door.locked = false;
    door.speed = 0.4;
    door.open(true);
    G.audio.doorCreak(true, { x: -12.0, y: 1.2, z: 0 }, true);
    G.ui.subtitle('DANA', 'Room 3. Housekeeping swore they locked it. Vacant room. VACANT. So why is it open?', { thought: true, dur: 5.5 });
    G.ui.setObjective('Room 3 is standing open. Take a look.');
    // the TV bursts alive as you step in (soft scare), bathroom light strobes
    W.addTrigger('s_r3inside', -14.8, 0.3, -9.3, 5.4, () => {
      F.r3tvOn = true;
      W.setTvNoise(W.props.tv_r3, true);
      G.audio.startStatic('r3tv', { x: -13.1, y: 1.3, z: 2.6 }, 0.14);
      W.setLight('r3bath', true);
      G.effects.shake(0.35);
      G.audio.stingLow(0.4);
      G.ui.subtitle('DANA', 'TV on. Static. Bathroom light strobing like a dying pulse. Nobody is in here. Nobody is in here.', { thought: true, dur: 6 });
      G.ui.setObjective('Shut it all off, then close Room 3.');
    });
  }

  // ==========================================================
  // CHAPTER 2 — quiet hours
  // ==========================================================
  _chQuiet(fromCP) {
    const G = this.G, F = this.flags, P = G.phone;
    G.ui.setObjective('Wait out the shift at the front desk. Watch the cameras.');
    this.later(8, () => {
      P.inbound('ash', { text: 'ok but why are YOU working at that murder motel on the highway' });
    });
    this.later(14, () => {
      P.inbound('ash', { text: 'kara says hi btw. she says "don\'t die at the murder motel"' });
    });
    this.later(20, () => {
      P.addReplyOptions('ash', [
        { text: 'haha very funny', send: 'haha very funny', then: () => this.later(5, () => P.inbound('ash', { text: 'we worry!!! text me at 2 so I know ur alive' })) },
        { text: "it's totally dead here", send: "it's actually dead quiet. full moon and everything", then: () => this.later(5, () => P.inbound('ash', { text: 'that is somehow worse. text me at 2' })) },
      ]);
    });

    // --- watcher walkby (early movement scare, no music) ---
    this.later(50, () => this._walkbyScare());

    // --- soft knocks at the office door ---
    this.later(105, () => {
      G.audio.knock(3, { x: 4.1, y: 1.3, z: -0.2 }, 0.8);
      G.ui.subtitle('DANA', 'Three knocks. Soft. Patient.', { thought: true });
      this.later(6, () => {
        G.ui.subtitle('DANA', 'Nobody on the step. The lot breathing fog. Nobody.', { thought: true });
      });
    });

    // --- UNKNOWN texts + the photo (SCARE #2) ---
    this.later(140, () => {
      P.inbound('unknown', { typing: 2.6, text: 'is the pool open?' });
      this.later(9, () => P.inbound('unknown', { typing: 3.4, text: 'the internet says the starview has a pool' }));
      this.later(18, () => P.inbound('unknown', { typing: 2.2, text: 'never mind. i can see the sign from the road' }));
      this.later(30, () => {
        P.inbound('unknown', { typing: 0, text: '', img: 'assets/mms_office.jpg' });
        this._scare('photo', 0.55);
        this.later(4, () => P.inbound('unknown', { typing: 2.0, text: 'you look tired, clerk. turn off the office light.' }));
        G.ui.subtitle('DANA', 'That photo was taken from the lot. Taken minutes ago. Taken from between the cars.', { thought: true, dur: 5 });
        this.later(7, () => G.ui.setObjective('Check the cameras. (CCTV monitor, front desk)'));
      });
      F.watchCamsObjective = true;
    });

    // --- PAYPHONE rings (ch2 ambience sting, optional dread) ---
    this.later(240, () => {
      F.payphoneRinging = true;
      this._payphoneRings(3);
      G.ui.subtitle('DANA', 'The payphone outside. Ringing. At this hour.', { thought: true });
      this.later(30, () => { F.payphoneRinging = false; });
    });

    // --- object-change beat: Marco's note migrates to the floor by the door ---
    this.later(185, () => {
      const note = G.world.props.marcoNote;
      if (!note || !note.visible) return;
      note.rotation.x = -Math.PI / 2; note.rotation.z = 1.1;
      note.position.set(4.6, 0.03, 0.9);
      G.world.addTrigger('s_noticed_note', 3.6, 0.2, 6, 1.8, () => {
        G.audio.latch('paper');
        G.ui.subtitle('DANA', 'Marco’s note. On the floor. By the door. It was ON THE COUNTER.', { thought: true, dur: 5 });
        G.audio.stingLow(0.35);
        this._scare('notemoved', 0.3);
      });
    });

    // --- if the player dawdles with the door unbolted late: he pounds it ---
    this.later(300, () => {
      if (!F.officeLocked && !F.camDead && G.stalker.mode === 'off') {
        const door = G.world.doors.get('office');
        G.stalker.spawn(4.1, -1.1, 0);
        G.stalker.poundDoorAt(door);
        G.ui.subtitle('DANA', 'The door shakes in its frame. Something out there wants in, politely at first.', { thought: true });
        this.later(9, () => {
          G.stalker.stopPound();
          G.audio.doorSlam({ x: 4.1, y: 1.2, z: 0 }, 0.5);
          G.stalker.despawn();
          G.audio.footstep('concrete', 0.6, { x: 4.1, y: 1, z: -2 });
          G.ui.subtitle('DANA', 'Then it just… stopped. That was worse.', { thought: true });
        });
      }
    });
  }

  _walkbyScare() {
    const G = this.G, S = G.stalker;
    if (S.mode !== 'off') return;
    S.spawn(-40, -1.4, Math.PI / 2);
    S.followPath([
      { x: -30, z: -1.4 }, { x: -18, z: -1.4 }, { x: -6, z: -1.4 }, { x: 6, z: -1.4 }, { x: 14.5, z: -1.2 }, { x: 17, z: -2.5 },
    ], {
      speed: 1.35, motion: 'walk', onDone: () => {
        S.despawn();
      },
    });
    // he notices if you're outside watching
    this._walkbyWatch = 0;
  }

  _payphoneRings(n) {
    const G = this.G, F = this.flags;
    for (let i = 0; i < n; i++) {
      this.later(i * 2.6, () => {
        if (F.payphoneRinging) G.audio.landlineRing({ x: 15.6, y: 1.4, z: -4 }, 1);
      });
    }
  }

  // CCTV scare (SCARE #3 — the face on the feed)
  _cctvScare() {
    const G = this.G, S = G.stalker, F = this.flags;
    if (F.camDead) { G.ui.subtitle('DANA', 'CAM 1 still shows nothing. NO SIGNAL, burned into the tube.', { thought: true }); return; }
    if (F.camScareRunning) return;
    F.camScareRunning = true;
    S.spawn(13.5, -1.3, -Math.PI / 2);
    S.followPath([{ x: 6, z: -1.4 }, { x: -4, z: -1.4 }, { x: -16, z: -1.4 }, { x: -30, z: -1.4 }], {
      speed: 1.6, motion: 'walk',
    });
    // after he registers on the feed: snap him right up to the camera
    this.later(4.5, () => {
      S.path = null;
      S.spawn(13.3, -1.15, Math.PI * 0.5);
      S.mode = 'script';
      // slide him into the lens
      this._camFaceT = 0;
      F.camFace = true;
      G.effects.shake(0.5);
      G.effects.impulse(1.2, 0.8);
      G.audio.stingHit(0.9);
      G.audio.duckAmbience(2);
      this._scare('camface');
      this.later(1.6, () => {
        G.world.cctv.live = false;
        G.world.cctv.screenMat.map = G.world.tvNoiseTex();
        G.world.cctv.screenMat.needsUpdate = true;
        F.camDead = true;
        S.despawn();
        F.camScareRunning = false;
        G.audio.startStatic('cctvstatic', { x: 5.55, y: 1.4, z: 2.6 }, 0.07);
        G.ui.subtitle('DANA', 'He reached the camera. CAM 1 — NO SIGNAL. The hallway it watched is right outside this door.', { thought: true, dur: 5.5 });
        this.later(6, () => G.ui.setObjective('Slide the bolt on the office door.'));
      });
    });
  }

  _scare(id, shake = 0.8) {
    this.stats.scares++;
    const G = this.G;
    G.effects.shake(shake);
    G.effects.impulse(1.0, 0.7);
  }

  // ==========================================================
  // CHAPTER 3 — room 4
  // ==========================================================
  _chRoom4(fromCP) {
    const G = this.G, F = this.flags, P = G.phone;
    G.ui.setObjective('Check Room 4.');
    // the phone rings as the chapter opens
    this.later(2.5, () => {
      F.phoneRinging = true;
      G.audio.landlineRing({ x: 5.95, y: 1.2, z: 2.45 }, 4);
      this.later(20, () => { F.phoneRinging = false; });
    });
    // Vale's room stands open + dark across the lot
    const r4 = G.world.doors.get('r4');
    r4.locked = false;
    r4.open(true);
    G.world.setLight('r4lamp', false);
    G.world.setRoomWindowLit('r4', false);
    G.world.setRoomWindowLit('r4b', false);
    G.world.setCurtains('r4', 0.5);
    G.world.setCurtains('r4b', 0.5);
    G.vale.setWatching(false);
    // walking the row in the dark is supposed to feel wrong
    G.world.addTrigger('s_r4enter', -20.5, 0.3, -15.5, 5.4, () => {
      G.ui.subtitle('DANA', 'Door open. Heat off. Bed slept in. Wallet on the bed like an apology.', { thought: true, dur: 5 });
      // TV snaps on by itself (SCARE #4a)
      this.later(2.2, () => {
        this.props_r4tv(true);
        G.audio.stingHit(0.5);
        G.effects.shake(0.4);
        this._scare('r4tv', 0.4);
        G.ui.subtitle('DANA', 'The TV turned itself on. Static. Nobody touched it.', { thought: true });
      });
      // then the closet door breathes shut behind you
      this.later(9, () => {
        const st = G.world.props['closet_r4'];
        st.target = 0;
        G.audio.drawerSlide(false, { x: -15.3, y: 1.1, z: 1.7 });
        this._scare('r4closet', 0.5);
        G.audio.stingLow(0.5);
        G.ui.subtitle('DANA', 'The closet doors slid shut. Behind me. I did not hear anyone move. I did not hear anyone leave.', { thought: true, dur: 5.5 });
        this.later(4, () => G.ui.setObjective('Get back to the office.'));
        F.leaveR4 = true;
      });
    });
    // stepping back into the office kills the power across the whole motel
    G.world.addTrigger('s_powercut', 3.2, 0.2, 14.5, 5.4, () => {
      if (!F.leaveR4) return;
      F.leaveR4 = false;
      this._powerCutBeat();
    });
  }

  props_r4tv(on) {
    const G = this.G;
    G.world.setTvNoise(G.world.props.tv_r4, on);
    if (on) G.audio.startStatic('r4tv', { x: -19.4, y: 1.3, z: 2.6 }, 0.12);
    else G.audio.stopLoop('r4tv');
  }

  // power dies as Dana returns to the office after Room 4 (chapter 3 entry)
  _powerCutBeat() {
    const G = this.G, W = G.world, F = this.flags;
    G.audio.powerDown();
    W.killPower();
    G.effects.shake(0.45);
    G.effects.flash(0x000000, 0.55);
    G.audio.heartbeat(88, 0.24);
    G.ui.subtitle('DANA', 'The whole strip just exhaled at once. Office, sign, walkway, everything — one breath, gone.', { thought: true, dur: 6 });
    // he is standing at the far end of the walkway, barely lit, facing the office
    const S = G.stalker;
    this.later(4.2, () => {
      S.idleAt(13.8, -1.3, -Math.PI / 2, true);
      G.audio.stingLow(0.55);
      this._scare('endfigure', 0.4);
      G.ui.subtitle('DANA', 'Someone is standing at the end of the walkway. Very still. Facing me.', { thought: true, dur: 5 });
      this.later(5.5, () => {
        S.followPath([{ x: 16, z: -1.6 }, { x: 17.5, z: -3.2 }, { x: 17.5, z: 1 }],
          { speed: 1.5, motion: 'walk', onDone: () => S.despawn() });
        this.later(4, () => this._enterChapter(3));
      });
    });
  }

  // ==========================================================
  // CHAPTER 4 — blackout
  // ==========================================================
  _chBlackout(fromCP) {
    const G = this.G, F = this.flags, P = G.phone;
    F.powerOut = true;
    P.setSignal(false);
    G.world.hemi.intensity = 0.2;
    G.effects.vignetteBoost(1.15);
    F.flashDip = true;
    G.ui.setObjective("Restore the power. Breaker panel — laundry room.");
    G.ui.subtitle('DANA', "The whole strip just died at once. That's not a storm. That's someone at the mains.", { thought: true, dur: 5 });
    this.later(3, () => {
      // ONE failed text out (no service) — then it cues the epilogue
      P.addReplyOptions('marco', [
        { text: 'SOMETHING IS WRONG. CALL THE POLICE.', send: 'SOMETHING IS WRONG. CALL THE POLICE.', then: () => { F.sentSOS = true; this.later(4, () => P.inbound('marco', { typing: 0, text: '(message failed to send)' , buzz: false})); } },
        { text: 'someone cut the power at the motel', send: 'someone cut the power at the motel', then: () => { F.sentSOS = true; this.later(4, () => P.inbound('marco', { typing: 0, text: '(message failed to send)', buzz: false })); } },
      ]);
      if (!P.up) G.ui.notify('MARCO', 'message him?');
    });
    // the hunt begins outside
    this.later(6, () => this._startHunt());
    // objective chain hooks: fuse path handled in hook('mainBreaker') etc.
  }

  _startHunt() {
    const G = this.G, S = G.stalker;
    if (S.mode !== 'off') return;
    S.spawn(-40, 8.5, Math.PI / 2);
    S.startHunt([
      { x: -24, z: 7.6 }, { x: -2, z: 8.2 }, { x: 12, z: 7.8 }, { x: 16.5, z: 2 }, { x: 16, z: -4.5 },
      { x: 13, z: -1.4 }, { x: 2, z: -1.4 }, { x: -12, z: -1.4 }, { x: -26, z: -1.4 }, { x: -36, z: -1.4 },
      { x: -41.5, z: 4 },
    ]);
    this.flags.hidingUnlocked = true;
    G.ui.subtitle('DANA', 'Footsteps. Slow ones. Circling the building — my building, where I am the only signed-in name in the ledger.', { thought: true, dur: 6 });
    G.audio.heartbeat(72, 0.16);
  }

  // ==========================================================
  // CHAPTER 5 — the chase
  // ==========================================================
  _chChase(fromCP) {
    const G = this.G, F = this.flags, S = G.stalker;
    this.flags.carEscape = false;
    if (!fromCP) {
      // burst-of-scare launch: power just came on; the laundry door blows open
      G.audio.powerUp();
      const ldoor = G.world.doors.get('laundry');
      ldoor.close();
      this.later(1.2, () => {
        G.audio.doorSlam({ x: 0, y: 1, z: 0 }, 1.2);
        ldoor.open();
        G.effects.shake(0.8);
        G.ui.subtitle('DANA', 'The laundry door just blew open.', { thought: true, dur: 2.5 });
      });
      this.later(2.6, () => this._beginChase(true));
    } else {
      // resumed at the chase checkpoint: the fuse just closed, power is back
      G.world.restorePower();
      G.world.hemi.intensity = 0.42;
      G.effects.vignetteBoost(0.95);
      G.phone.setSignal(true);
      this.flags.powerOut = false;
      this.later(1.5, () => this._beginChase(true));
    }
    G.ui.setObjective('GET TO YOUR CAR.');
    // laundry window becomes the escape hatch
    this.flags.hidingUnlocked = true;
  }

  _beginChase(withIntro = true) {
    const G = this.G, S = G.stalker, P = G.player;
    if (this._chaseOn) return;
    this._chaseOn = true;
    this.flags.carEscape = true;
    this.flags.flashDip = false;
    // the escape must never be sealed by a bolted door
    this.flags.officeLocked = false;
    G.world.doors.get('office').locked = false;
    // he comes for you
    S.spawn(0.4, -2.6, 0);
    S.human.headTilt(0.3);
    S.startChase({ finale: true });
    G.audio.jumpscare();
    G.audio.heartbeat(138, 0.4);
    G.audio.chaseMusic(true, 150);
    G.effects.shake(1.2);
    G.effects.flash(0xff2211, 0.3);
    G.effects.impulse(1.4, 1.2);
    this._scare('chase', 1.2);
    P.speedBoost = 1.05;
    G.ui.letterbox(true);
    G.ui.subtitle('DANA', 'RUN. WINDOW. CLIMB OUT THE BACK WINDOW.', { thought: true, dur: 2.6 });
    this.save('chase');
    // if the player tarries he simply arrives (chase AI handles it)
    this.later(24, () => {
      if (!this.flags.inCar) G.ui.setObjective('GET TO YOUR CAR. (press E fast when you reach it)');
    });
  }

  // ==========================================================
  // CAUGHT — death cinematic
  // ==========================================================
  onCaught(cause = 'grab') {
    const G = this.G, S = G.stalker, P = G.player;
    if (this._dying) return;
    this._dying = true;
    this.stats.deaths++;
    writeSave({ checkpoint: this.checkpointId || 'shift', stats: this.stats });
    P.frozen = true;
    S.mode = 'script';
    S.group.visible = true;
    // he fills your vision
    const cam = G.camera;
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const hp = eye.clone().add(fwd.multiplyScalar(0.62));
    S.group.position.x = hp.x; S.group.position.z = hp.z;
    S.group.position.y = eye.y - 1.66; // his face fills the lens
    S.yaw = Math.atan2(eye.x - S.group.position.x, eye.z - S.group.position.z);
    S.group.rotation.y = S.yaw + Math.PI;
    S.human.lookAt(eye.x, eye.y, eye.z, true);
    G.phone.close();
    G.audio.jumpscare();
    G.audio.chaseMusic(false);
    G.audio.heartbeat(0);
    G.effects.flash(0x330000, 0.4);
    G.effects.impulse(1.5, 1.5);
    G.effects.shake(1.5);
    G.ui.letterbox(true);
    this.later(1.1, () => {
      G.ui.letterbox(false);
      G.ui.showDead(pick([
        'he was already inside the room.',
        'you never heard him open the door.',
        'the lot is quiet again.',
        'nobody heard the register bell.',
      ]));
      this._dying = false;
    });
  }

  // ==========================================================
  // ENDING
  // ==========================================================
  _endingSequence() {
    const G = this.G, S = G.stalker, P = G.player;
    this.flags.inCar = true;
    P.frozen = true;
    G.audio.chaseMusic(false);
    G.ui.letterbox(true);
    G.ui.setObjective('');
    G.ui.setPrompt(null);
    // place camera in the driver's seat of the teal sedan
    const car = G.world.props.playerCar;
    const cp = car.position;
    G.camera.position.set(cp.x - Math.sin(car.rotation.y) * 0.2, 1.16, cp.z - 0.1);
    P.yaw = car.rotation.y + Math.PI * 0.92; // face roughly front-left window
    P.pitch = 0.05;
    S.mode = 'script';
    // he appears at the driver's window (SCARE #6)
    this.later(1.6, () => {
      const winX = cp.x - Math.cos(car.rotation.y) * 1.0, winZ = cp.z + Math.sin(car.rotation.y) * 1.0;
      S.group.visible = true;
      S.pos.set(winX, 0, winZ);
      S.yaw = Math.atan2(cp.x - winX, cp.z - winZ);
      S.group.rotation.y = S.yaw;
      S.group.position.y = -0.35; // crouched to the glass
      S.human.lookAt(G.camera.position.x, 1.1, G.camera.position.z, true);
      G.audio.doorSlam({ x: winX, y: 1, z: winZ }, 1.3);
      G.audio.jumpscare();
      G.effects.shake(1.4);
      G.effects.flash(0xff3322, 0.35);
      this._scare('carwindow', 1.4);
      G.ui.subtitle('DANA', 'HIS FACE. AT THE GLASS.', { thought: true, dur: 2 });
      // ignition fumbling
      this.later(1.4, () => G.audio.latch('locked', { x: cp.x, y: 1, z: cp.z }));
      this.later(2.4, () => G.audio.latch('locked', { x: cp.x, y: 1, z: cp.z }));
      this.later(3.4, () => {
        // engine finally catches: build a rumble
        G.audio.startHum('carengine', null, { freq: 42, vol: 0.0, type: 'sawtooth', bus: 'sfx' });
        G.audio.setLoopVol('carengine', 0.3, 0.4);
        G.effects.shake(0.4);
        // headlights on: two cones + his silhouette lit against them as you reverse
        G.world.hemi.intensity = 0.34;
        const hl = new THREE.SpotLight(0xd8e2ff, 30, 26, 0.5, 0.4, 1.2);
        hl.position.set(cp.x, 0.9, cp.z);
        hl.target.position.set(cp.x + Math.sin(car.rotation.y) * -14, 0.4, cp.z + Math.cos(car.rotation.y) * -14);
        G.scene.add(hl, hl.target);
        G.ui.subtitle('DANA', 'Drive. Now. Don\'t look at the mirror. Don\'t look at the mirror—', { thought: true, dur: 4 });
        this.later(2.2, () => {
          // he steps back into the light... and is simply gone between frames
          S.group.visible = false;
          S.mode = 'off';
          G.audio.whisper();
          G.effects.flash(0x000000, 0.6);
          this.later(2.6, () => this._epilogue());
        });
      });
    });
  }

  _epilogue() {
    const G = this.G;
    G.ui.fade(true, 1600);
    this.later(1.6, () => {
      const mins = Math.floor(this.stats.playTime / 60);
      unlockChapter('credits');
      G.ui.showEnding([
        "You drove until the sky went grey, then past the county line, then past the next.",
        "The police found Room 4 as you left it: slept-in bed, wallet on the pillow, paying for another night it never used. They found your neatly signed ledger and your cold coffee. They found both fuses — one in the panel. One under the front desk, still greasy from handling.",
        "They did not find the man from the highway. The register key you'd left on the rack was back on its hook in the morning.",
        "Marco sold the Starview the following spring. Room 7 stayed boarded through the sale. Neither of you ever asked why out loud.",
        "— S H I F T   C O M P L E T E —",
        `time on shift: ${mins}m · deaths: ${this.stats.deaths} · scares survived: ${this.stats.scares}`,
        "STARVIEW\nthanks for working the night shift.",
      ], () => {
        clearSave();
        G.quitToMenu();
      });
    });
  }

  // ==========================================================
  // WORLD/AI/INTERACT HOOKS
  // ==========================================================
  hook(name, a, b) {
    const G = this.G, F = this.flags, P = G.phone, W = G.world;

    switch (name) {
      case 'note': {
        if (!F.noteRead) {
          F.noteRead = true;
          G.ui.objectiveDone("Read Marco's note.");
          P.inbound('mom', { typing: 1, text: 'Dinner Sunday? Your uncle says he roped you into the motel. Be safe, baby.' , buzz: true});
          this._startTaskList();
        } else {
          G.ui.subtitle('DANA', "'You know the drill. Ask nothing, open for no one after one.' Normal Marco.", { thought: true });
        }
        break;
      }
      case 'ledger': {
        if (!F.signedIn) {
          F.signedIn = true;
          G.audio.latch('paper');
          G.ui.subtitle('DANA', '"REYES, D. — NIGHT CLERK — 10:58 PM." First name in the book in three weeks, by the dust.', { thought: true });
          P.completeTask('ledger');
          this._checkTasksDone();
          F.masterUnlockOk = true;
          this.later(4, () => P.inbound('marco', { typing: 2, text: 'good. guest in room 4 asked for towels earlier. weird guy. keep it quick, his lights are still on' }));
        } else G.ui.subtitle('DANA', 'Already signed. Official. Trapped. Kidding. Mostly.', { thought: true });
        break;
      }
      case 'breaker': {
        const sw = a;
        if (sw === 'SIGN' && W.breaker.SIGN && !F.signDone) {
          F.signDone = true;
          P.completeTask('sign');
          G.ui.subtitle('DANA', 'The sign buzzes awake out there, pink and proud, STAR-VIEW over the black highway. Feel better already.', { thought: true, dur: 5 });
          this._checkTasksDone();
        }
        break;
      }
      case 'mainBreaker': {
        const on = a;
        if (F.powerOut && on && chBetween(this, 3, 4)) {
          this._restoreAndChase();
        } else if (on) {
          G.ui.subtitle('DANA', 'Main breaker back on. The building hums like it’s remembering how.', { thought: true });
        } else {
          G.ui.subtitle('DANA', 'Everything just… quit.', { thought: true });
        }
        break;
      }
      case 'registerOpened': {
        if (F.powerOut && !F.fuseSeen) {
          F.fuseSeen = true;
          G.ui.subtitle('DANA', 'A fat 50-amp fuse, right where Marco’s note said. Old-school. Reliable. Please let it fit.', { thought: true });
          if (!G.player.hasItem('carkeys')) this.later(1.5, () => G.ui.setObjective('Take the fuse. And your car keys.'));
        }
        break;
      }
      case 'fuseTaken': {
        G.ui.subtitle('DANA', 'Got it. Heavy little thing. The spine of the whole building, apparently.', { thought: true });
        if (!G.player.hasItem('carkeys')) G.ui.setObjective('Grab your car keys from the counter, then the laundry panel.');
        else G.ui.setObjective('Back to the laundry panel. Fuse, then MAIN.');
        break;
      }
      case 'carKeysTaken': {
        if (F.powerOut) G.ui.subtitle('DANA', 'Keys: pocketed. For morale.', { thought: true });
        break;
      }
      case 'fuseInserted': {
        G.audio.latch('unlock');
        G.ui.setObjective('Flip the MAIN breaker.');
        G.ui.subtitle('DANA', 'Seated. Okay. Here goes the noise.', { thought: true });
        break;
      }
      case 'roomUnlocked': {
        if (a === 'r3') G.ui.subtitle('DANA', 'Master key turns like it’s been waiting.', { thought: true });
        break;
      }
      case 'roomOpened': {
        if (a === 'r3' && F.tasksOpenedR3 !== 'done') { /* handled via trigger instead */ }
        if (a === 'r4' && this.chapter === 2) {
          G.ui.subtitle('DANA', 'It’s not locked anymore. It was locked. I locked it. Didn’t I?', { thought: true });
        }
        break;
      }
      case 'roomClosed': {
        if (a === 'r3' && F.tasksOpenedR3 === 'open') {
          F.tasksOpenedR3 = 'done';
          G.world.doors.get('r3').locked = true;
          G.audio.latch('unlock', { x: -12.0, y: 1.2, z: 0 });
          G.ui.subtitle('DANA', 'Shut. Locked with the master. Done. Three more doors to eyeball.', { thought: true });
          this._rowMark('r3');
        }
        break;
      }
      case 'knockLocked': {
        if (F.tasksAll && !F.rowDone) {
          const map = { r2: 'r2', r3: 'r3', r4: 'r4', r5: 'r5', r6: 'r6' };
          if (map[a]) this._rowMark(map[a]);
        } else if (a === 'r2') {
          G.ui.subtitle('DANA', 'Locked. Mrs. Abernathy’s TV is going — some late show, muffled through the door.', { thought: true });
        } else if (a === 'r6') {
          G.ui.subtitle('DANA', 'Locked. A long-haul cab out front, and snoring sawing through the wall.', { thought: true });
        } else if (a === 'r4' && !F.towelsDelivered) {
          G.ui.subtitle('DANA', 'Locked. Dim amber inside. I’ve got your towels right here, sir.', { thought: true });
        } else if (a === 'r5') {
          G.ui.subtitle('DANA', 'Vacant. Cold coming off it like a fridge left open.', { thought: true });
        }
        break;
      }
      case 'sawRoom7': break;
      case 'r3bathOpened': {
        if (!F.r3bathSeen) {
          F.r3bathSeen = true;
          G.ui.subtitle('DANA', 'Window’s open in here. That’s the banging. And the cold. Close that, that’s free horror.', { thought: true });
        }
        break;
      }
      case 'r3tvToggle': {
        const on = !F.r3tvOn;
        F.r3tvOn = on;
        G.world.setTvNoise(G.world.props.tv_r3, on);
        if (on) { G.audio.startStatic('r3tv', { x: -13.1, y: 1.3, z: 2.6 }, 0.1); }
        else G.audio.stopLoop('r3tv');
        if (F.tasksOpenedR3 === 'open' && !on) {
          G.ui.subtitle('DANA', 'TV off. Bathroom light off. Window shut. Nobody panic. Close it up.', { thought: true });
        }
        break;
      }
      case 'sawScratch': {
        F.sawScratch = true;
        break;
      }
      case 'cctv': {
        G.audio.latch('ui');
        if (F.watchCamsObjective && !F.camDead) this._cctvScare();
        else if (F.camDead) G.ui.subtitle('DANA', 'Static. NO SIGNAL. It sits in the corner of the screen like a bruise.', { thought: true });
        else G.ui.subtitle('DANA', 'CAM 1 — the walkway, doors 2 through 7, lit up like a stage. All quiet. All mine.', { thought: true });
        break;
      }
      case 'officeDoorOpened': {
        if (!F.firstBell) {
          F.firstBell = true;
          G.audio.msgDing();
        }
        break;
      }
      case 'bolted': {
        if (this.chapter === 1 && !F.camDead) {
          // too early: the camera beat must play out first
          F.officeLocked = false;
          G.world.doors.get('office').locked = false;
          G.ui.subtitle('DANA', 'Not yet. Not until I\'ve seen what\'s on that camera with my own eyes.', { thought: true });
          break;
        }
        if (this.chapter === 1) {
          G.ui.objectiveDone('Slide the bolt on the office door.');
          G.audio.stingLow(0.4);
          this.later(2.5, () => {
            G.audio.knock(4, { x: 4.1, y: 1.3, z: -0.2 }, 1.0, true);
            W.doors.get('office').pound();
            G.ui.subtitle('DANA', 'Fists, this time. On the bolted door. They stop after four, politely.', { thought: true, dur: 5 });
          });
          this.later(8, () => this._enterChapter(2));
        } else {
          G.ui.subtitle('DANA', 'Bolted. Thin little length of brass between me and anything out there.', { thought: true });
        }
        break;
      }
      case 'unbolted': break;
      case 'answerOffice': {
        F.phoneRinging = false;
        G.audio.latch('pickup');
        if (this.chapter === 2) this._room4PhoneCall();
        else G.ui.subtitle('DANA', 'Starview front desk. …Nothing. Just the highway hiss of an open line.', { thought: true });
        break;
      }
      case 'answerPayphone': {
        F.payphoneRinging = false;
        G.audio.latch('pickup');
        G.audio.whisper();
        this._scare('payphone', 0.6);
        G.ui.subtitle('???', 'Clerk. Your sign lights eight doors. I count nine rooms. Where is the ninth door?', { dur: 6 });
        this.later(4, () => G.ui.subtitle('DANA', 'Dial tone. The receiver is warm. WARM.', { thought: true }));
        break;
      }
      case 'trashDumped': {
        F.trashDone = true;
        P.completeTask('trash');
        G.ui.subtitle('DANA', 'In and gone. The lid slams itself — wind. Wind.', { thought: true });
        this._checkTasksDone();
        break;
      }
      case 'dumpsterPeek': {
        if (this.chapter >= 1 && !F.dumpsterScare) {
          F.dumpsterScare = true;
          W.props.dumpsterLid.rotation.x = -0.5;
          G.audio.latch('slam', { x: -24, y: 1.3, z: 8.4 });
          this.later(0.8, () => { W.props.dumpsterLid.rotation.x = -0.08; G.audio.latch('slam', { x: -24, y: 1.3, z: 8.4 }); });
          this._scare('dumpster', 0.5);
        }
        break;
      }
      case 'trashbagTaken': break;
      case 'msgRead': break;
      case 'heSawYou': {
        G.ui.subtitle('DANA', 'He stopped. He’s looking this way. He’s LOOKING this way.', { thought: true, dur: 3.5 });
        break;
      }
      case 'lostYou': {
        G.ui.subtitle('DANA', 'He lost me. Keep low. Keep quiet. Fuse first, pride later.', { thought: true });
        break;
      }
      case 'hid': {
        G.ui.setPrompt(null);
        G.ui.subtitle('DANA', 'Don’t breathe. Don’t exist. Inventory the dark instead.', { thought: true });
        G.audio.heartbeat(96, 0.3);
        // if he was actively chasing and saw you slip in, he is coming for you
        const S = G.stalker;
        if (S.mode === 'chase') {
          const d = Math.hypot(G.player.pos.x - S.pos.x, G.player.pos.z - S.pos.z);
          if (d < 5 && S.canSeePlayer()) { S.sawHide = true; S.lastKnown.copy(G.player.pos); }
        }
        this.later(6, () => { if (G.player.hidden) G.audio.heartbeat(76, 0.2); });
        break;
      }
      case 'unhid': {
        G.audio.heartbeat(72, 0.16);
        G.stalker.sawHide = false;
        break;
      }
      case 'powerChanged': break;
      case 'mainNoFuse': {
        if (F.powerOut && !F.toldFuse) {
          F.toldFuse = true;
          G.ui.setObjective('Find a spare 50A fuse — Marco keeps spares in the register drawer.');
        }
        break;
      }
      case 'needFuse': {
        if (F.powerOut && !F.toldFuse) {
          F.toldFuse = true;
          G.ui.setObjective('Find a spare 50A fuse — Marco keeps spares in the register drawer.');
        }
        break;
      }
      case 'wentWindow': {
        // he crashes through the laundry after you
        G.audio.knock(3, { x: 0.5, y: 1.4, z: 4 }, 1.0, true);
        break;
      }
      case 'carInteract': {
        if (F.carEscape) this._carMash();
        else {
          G.audio.latch('locked', { x: 11.5, y: 1, z: -6.2 });
          G.ui.subtitle('DANA', 'Locked, like always. Shift first, errands later.', { thought: true });
        }
        break;
      }
      case 'sawWallet': {
        if (F.leaveR4) break;
        this.later(3, () => G.ui.setObjective('Nobody checks out like this. Look around. (bed, suitcase, wallet)'));
        break;
      }
    }
  }

  _room4PhoneCall() {
    const G = this.G, F = this.flags;
    G.audio.latch('pickup');
    this.later(1.5, () => {
      G.audio.whisper();
      G.ui.subtitle('???', 'Front desk… this is room four.', { dur: 2.6 });
    });
    this.later(4.4, () => G.ui.subtitle('???', 'You can stop counting towels now, clerk. I’m finished with them.', { dur: 4 }));
    this.later(8.6, () => {
      G.ui.subtitle('DANA', 'The line goes dead. Room 4’s light inside my chest goes with it. The row cam shows his door — it’s open.', { thought: true, dur: 6 });
      G.ui.setObjective('Check Room 4.');
    });
    this.later(8.0, () => {
      // physical beat across the lot: door stands open now
      const r4 = G.world.doors.get('r4');
      r4.locked = false; r4.open(true);
      G.world.setLight('r4lamp', false);
      G.audio.doorCreak(true, { x: -18.0, y: 1.2, z: 0 }, true);
      G.world.setCurtains('r4', 0.5); G.world.setCurtains('r4b', 0.5);
    });
  }

  _restoreAndChase() {
    const G = this.G, W = G.world, F = this.flags;
    if (this.chapter < 3 || F.restored) return;
    F.restored = true;
    W.restorePower();
    G.audio.powerUp();
    G.phone.setSignal(true);
    F.powerOut = false;
    W.hemi.intensity = 0.42;
    G.effects.vignetteBoost(0.95);
    // the office is bolted from the quiet hours — in the escape it swings free
    F.officeLocked = false;
    W.doors.get('office').locked = false;
    // one beat of light, then hell
    this.later(0.9, () => this._enterChapter(4));
  }

  _carMash() {
    const G = this.G, F = this.flags;
    if (F.inCar) return;
    if (!G.player.hasItem('carkeys')) {
      G.audio.latch('locked', { x: 11.5, y: 1, z: -6.2 });
      G.ui.subtitle('DANA', 'KEYS. THEY’RE ON THE COUNTER. STUPID. STUPID.', { thought: true, dur: 3 });
      G.ui.setObjective('THE KEYS ARE ON THE OFFICE COUNTER.');
      return;
    }
    this._mash = (this._mash || 0) + 1;
    G.audio.latch('key', { x: 11.5, y: 1, z: -6.2 });
    G.effects.shake(0.25);
    if (this._mash === 1) G.ui.subtitle('DANA', 'Fumbling the fob—', { thought: true, dur: 1.2 });
    if (this._mash === 2) G.ui.subtitle('DANA', 'Come on come on—', { thought: true, dur: 1.2 });
    if (this._mash >= 3) {
      G.audio.latch('unlock', { x: 11.5, y: 1, z: -6.2 });
      this._endingSequence();
    }
  }

  // ---------- tasks helpers ----------
  _rowMark(id) {
    this.rowVisited.add(id);
    if (this.rowVisited.size >= 5 && !this.flags.rowDone) {
      this.flags.rowDone = true;
      this.G.phone.completeTask('row');
      this._checkTasksDone();
    }
  }
  _checkTasksDone() {
    const G = this.G, F = this.flags, P = G.phone;
    const pend = P.tasks.filter(t => !t.done);
    if (pend.length === 0 && !F.tasksAllDone) {
      F.tasksAllDone = true;
      // towelsDelivered & trash handled individually; when all done:
    }
    const all = ['ledger', 'sign', 'towels', 'trash', 'row'].every(id => P.tasks.find(t => t.id === id && t.done));
    if (all && !F.everythingDone) {
      F.everythingDone = true;
      this.setClock(24 * 60 + 12);
      this.later(3, () => P.inbound('marco', { typing: 2, text: 'list done? good kid. now keep the spider eggs — sorry — keep the light on and watch the cameras' }));
      this.later(12, () => this._enterChapter(1));
    }
  }

  // towels delivery = SCARE #1
  _towelDelivery() {
    const G = this.G, F = this.flags, W = G.world;
    if (F.towelScene) return;
    F.towelScene = true;
    const door = W.doors.get('r4');
    // knock on the door yourself
    G.audio.knock(3, { x: -18.0, y: 1.2, z: -0.1 }, 0.7);
    this.later(1.6, () => {
      G.ui.subtitle('DANA', '"Towels, Mr… Vale?" Nothing. Then the chain sliding, one link at a time.', { thought: true, dur: 4 });
    });
    this.later(4.6, () => {
      // door opens a crack, chain-jangle, pale arm slides out
      door.open(true); door.speed = 0.35; door.target = 0.16;
      G.audio.doorCreak(true, { x: -18.0, y: 1.2, z: 0 }, true);
      const arm = G.valeArm;
      arm.show(-18.06, 1.15, -0.42, Math.PI + 0.12);
      this._scare('towel1', 0.5);
      G.effects.shake(0.5);
      G.audio.stingHit(0.55);
      this.later(1.8, () => {
        arm.grab();
        G.audio.latch('paper');
        G.player.takeItem('towels');
        this.later(0.7, () => {
          arm.hide();
          G.audio.doorSlam({ x: -18.0, y: 1.2, z: 0 }, 0.9);
          door.close();
          this.later(1.2, () => G.audio.knock(1, { x: -18.0, y: 1.2, z: -0.1 }, 1.0, true)); // one hard gratitude-thump
          G.ui.choices('THE DOOR — SAY SOMETHING?', [
            { text: '"Enjoy your stay, sir."' },
            { text: 'Say nothing. Just leave.' },
          ], (opt, i) => {
            if (i === 0) {
              this.later(1.2, () => G.ui.subtitle('???', '"…I intend to." The voice fits through the crack like a key.', { dur: 4 }));
            } else {
              this.later(1.2, () => G.ui.subtitle('DANA', 'Walking away feels like swimming against syrup. Behind the door, fabric. Breathing.', { thought: true, dur: 5 }));
            }
            this.flags.towelsDelivered = true;
            this.G.phone.completeTask('towels');
            this._checkTasksDone();
            // afterwards: a thin gap opens in his curtains, and he watches the lot
            this.later(30, () => {
              G.world.setCurtains('r4', 0.22);
              G.vale.setWatching(true);
            });
          });
        });
      });
    });
  }

  // ==========================================================
  // PER-FRAME
  // ==========================================================
  update(dt) {
    const G = this.G, F = this.flags;
    this.stats.playTime += dt;
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } }
    }
    // ---------- chapter-specific continuous logic ----------
    // task: walk the row — proximity to each door counts (with jiggle)
    if (F.tasksAll && !F.rowDone) { /* handled via knockLocked & room3 */ }
    // walkby watcher notices you
    const S = G.stalker;
    if (S.mode === 'path' && this.chapter === 1 && !F.walkbyNoticed) {
      const d = Math.hypot(G.player.pos.x - S.pos.x, G.player.pos.z - S.pos.z);
      if (d < 7 && G.player.pos.z < -0.5) {
        F.walkbyNoticed = true;
        S.path = null; S.mode = 'watch';
        G.audio.stingLow(0.5);
        this._scare('watcher', 0.4);
        this.later(3.5, () => {
          if (S.mode === 'watch') {
            S.followPath([{ x: 14.5, z: -1.2 }, { x: 17, z: -2.5 }], { speed: 1.55, motion: 'walk', onDone: () => S.despawn() });
          }
        });
      }
    }
    // camera-face lerp during cctv scare
    if (F.camFace) {
      this._camFaceT += dt;
      const k = Math.min(1, this._camFaceT / 0.55);
      S.pos.x = 13.3 + (14.1 - 13.3) * k;
      S.pos.z = -1.15 + (-0.55 - -1.15) * k;
      S.group.position.y = -0.3 * k;
      S.yaw = Math.PI * 0.5;
      S.group.rotation.y = S.yaw;
      S.human.lookAt(14.9, 1.8, -0.7, true);
      if (k >= 1) F.camFace = false;
    }
    // room-4 towel trigger: approaching his door with towels starts the scene
    if (F.taskTowels && G.player.hasItem('towels') && !F.towelScene && !F.towelsDelivered) {
      if (Math.abs(G.player.pos.x + 18.0) < 2.2 && G.player.pos.z > -2.2 && G.player.pos.z < 0.5) {
        this._towelDelivery();
      }
    }
    // chapter 1 -> first discovery: room 3 door open (beat on first approach)
    if (this.chapter === 0 && F.tasksAll && !F.foundR3) {
      if (Math.abs(G.player.pos.x + 11.5) < 4 && G.player.pos.z < 0.4) this._room3Beat();
    }
    // vale watching: if player gets close to his window, the curtains snap shut
    if (G.vale.active) {
      const d = Math.hypot(G.player.pos.x + 19.3, G.player.pos.z + 1);
      if (d < 4.5) {
        G.vale.setWatching(false);
        W_setCur(G, 'r4', 0);
        G.audio.latch('paper');
        this._scare('valeshut', 0.4);
        G.audio.stingLow(0.45);
        G.ui.subtitle('DANA', 'The curtains just closed. From the inside. While I watched.', { thought: true });
      }
    }
    // blackout: heartbeat quiet when he is far, loud when near
    if (F.powerOut && !this._chaseOn && S.mode !== 'off') {
      const d = Math.hypot(G.player.pos.x - S.pos.x, G.player.pos.z - S.pos.z);
      const bpm = d < 5 ? 120 : d < 10 ? 102 : d < 18 ? 88 : 74;
      const vol = d < 5 ? 0.42 : d < 10 ? 0.3 : 0.18;
      G.audio.heartbeat(bpm, vol);
    }
    // masterUnlockOk set once master key taken
    if (G.player.hasItem('masterkey') && !F.masterUnlockOk && this.chapter === 0) F.masterUnlockOk = true;
  }
}

function W_setCur(G, id, v) { G.world.setCurtains(id, v); }
function chBetween(story, a, b) { return story.chapter >= a && story.chapter <= b; }
