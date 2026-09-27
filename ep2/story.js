// ============================================================
// ep2/story.js — LAST CALL director. من الدار حتى الشغل:
// home → the route-9 drive → the diner closing shift → the
// freezer → the blackout chase → dawn. Bilingual عربي/English.
// ============================================================
import * as THREE from 'three';
import { fmtClock, rand, pick, clamp } from '../src/utils.js';
import { S } from './i18n.js';

const SAVE_KEY = 'lastcall_save_v2';
const UNLOCK_KEY = 'lastcall_unlocked_v2';
const UNSTUCK_SEES = 'lastcall_wasnt closed';

export const CHAPTERS = [
  { id: 'home', time: '10:41 PM', en: 'THE FLAT', ar: 'الدار', clock: 22 * 60 + 41 },
  { id: 'road', time: '10:58 PM', en: 'ROUTE 9', ar: 'الطريق 9', clock: 22 * 60 + 58 },
  { id: 'arrival', time: '11:12 PM', en: 'THE DINER', ar: 'المقهى', clock: 23 * 60 + 12 },
  { id: 'customers', time: '12:26 AM', en: 'CUSTOMERS', ar: 'الزبناء', clock: 24 * 60 + 26 },
  { id: 'freezer', time: '1:47 AM', en: 'LOW STOCK', ar: 'الموخّر الفارغ', clock: 25 * 60 + 47 },
  { id: 'closing', time: '3:33 AM', en: 'CLOSING', ar: 'الإغلاق', clock: 27 * 60 + 33 },
];
const CP_SPAWNS = {
  home: { x: 1.4, z: 3.0, yaw: Math.PI * 0.9 },
  road: { x: 2.2, z: -7.0, yaw: -Math.PI / 2 },
  arrival: { x: -211.0, z: -9.5, yaw: Math.PI },
  customers: { x: -208.6, z: 0.4, yaw: Math.PI * 0.92 },
  freezer: { x: -208.0, z: 4.6, yaw: Math.PI * 0.92 },
  closing: { x: -209.0, z: -5.0, yaw: Math.PI },
};

// tiny per-episode persistence (independent from episode 1)
function loadEpSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; } }
function writeEpSave(v) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(v)); } catch {} }
function clearEpSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }
export function epLocked() { try { return JSON.parse(localStorage.getItem(UNLOCK_KEY) || '[]'); } catch { return []; } }
function epUnlock(id) { const u = epLocked(); if (!u.includes(id)) { u.push(id); try { localStorage.setItem(UNLOCK_KEY, JSON.stringify(u)); } catch {} } }
export function epHasSave() { return !!loadEpSave(); }
export function epSaveCheckpoint() { return loadEpSave()?.checkpoint || CHAPTERS[0].id; }

export class Story {
  constructor(G) {
    this.G = G;
    this.flags = {};
    this.chapter = 0;
    this.clockMin = 22 * 60 + 41;
    this.timers = [];
    this.stats = { playTime: 0, deaths: 0, scares: 0, texts: 0 };
    this.checkpointId = null;
    this._chaseOn = false;
    this._npc = {};      // named npc humans
    this._npcMovers = [];
    this._driveT = 0;
    this._driveOn = false;
  }

  later(sec, fn) { this.timers.push({ t: sec, fn }); }
  clearTimers() { this.timers.length = 0; this._npcMovers.length = 0; }
  setClock(min) { this.clockMin = min; this.G.phone.setClock(fmtClock(min)); }
  save(cp) { this.checkpointId = cp; epUnlock(cp); writeEpSave({ checkpoint: cp, stats: this.stats }); }

  // ==========================================================
  // ENTRY POINTS
  // ==========================================================
  newGame() {
    this.flags = {};
    this.stats = { playTime: 0, deaths: 0, scares: 0, texts: 0 };
    this.clockMin = 22 * 60 + 41;
    this.G.phone.resetState && this.G.phone.resetState();
    this.G.phone.setClock(fmtClock(this.clockMin));
    this._initThreads();
    this._sanitizeWorld('home');
    this._intro();
  }
  fromCheckpoint(id) {
    this.flags = {};
    const sv = loadEpSave();
    if (sv && sv.stats) this.stats = sv.stats;
    this.G.phone.resetState && this.G.phone.resetState();
    this._initThreads();
    this._sanitizeWorld(id);
    this.applyCheckpoint(id);
  }

  _initThreads() {
    const P = this.G.phone;
    P.addThread('mounir', S('MOUNIR (boss)', 'منير (الشيف)'), '#c98a4a');
    P.addThread('kenza', S('KenkzZza', 'كنزة'), '#4aa3c9');
    P.addThread('mama', S('MAMA', 'ماما'), '#c94a8a');
    P.addThread('tarek', S('Tarek TCK', 'طارق'), '#6a9a5a');
    P.addThread('unknown', S('UNKNOWN', 'مجموع'), '#5a5f68');
  }

  _sanitizeWorld(id) {
    const G = this.G, W = G.world, S2 = G.stalker;
    for (const d of W.doors.values()) { d.target = 0; d.locked = false; }
    W.doors.get('freezer_door') && (W.doors.get('freezer_door').locked = false);
    S2.despawn();
    // npcs out
    for (const k of Object.keys(this._npc)) { this._npc[k].group.visible = false; this._npc[k].group.removeFromParent?.(); delete this._npc[k]; }
    this._npcMovers.length = 0;
    // power defaults
    W.breaker = { MAIN: true, DINING: true, KITCHEN: true, SIGN: false, fuseIn: true };
    W.props.fuseMesh.visible = false;
    W.props.spareFuse.visible = false;
    W.props.blackSedan.visible = false;
    const reg = W.drawers.get('register'); reg.locked = true; reg.target = 0;
    if (id !== 'home') W.breaker.SIGN = true;
    W.props.cat.position.set(3.3, 0, 4.8);
    W.props.homeKeys.visible = true;
    W.props.cashKeys.visible = true;
    W.props.driveRig.visible = false;
    W.props.playerCar.visible = true;
    W.props.playerCar.position.set(-214.6, 0, -6.2);
    G.player.items.clear(); G.player._heldVisual(); G.ui.setVigHint('');
    W.clearTriggers('s_');
    this.clearTimers();
    this._chaseOn = false;
    G.player.flashOn = false; G.player.flash.intensity = 0;
    G.player.speedBoost = 0;
    G.player.frozen = false; G.player.hidden = null;
    G.effects.vignetteBoost(0.85);
    G.ui.letterbox(false);
    G.ui.clearSubtitles();
    this.flags = {};
  }

  applyCheckpoint(id) {
    const G = this.G, W = G.world;
    const cp = CHAPTERS.find(c => c.id === id);
    this.chapter = CHAPTERS.indexOf(cp);
    const sp = CP_SPAWNS[id];
    // start unfolded
    switch (id) {
      case 'home':
        break;
      case 'road': {
        G.player.pos.set(sp.x, 0, sp.z); G.player.yaw = sp.yaw;
        this.flags.signedOut = true; this.flags.driveReady = false;
        this._enterChapter(1, true);
        return;
      }
      case 'arrival':
      case 'customers': {
        this.flags.noteDinerRead = id === 'arrival' ? false : true;
        G.player.items.set('jacket', { label: S('Jacket', 'الجاكيطة') });
        if (id === 'customers') {
          this.flags.shiftTasksStarted = true;
          G.phone.setTasks([
            { id: 'sign', text: S('Flip the OPEN sign neon', 'شعل إشارة المفتوح'), done: true },
            { id: 'shelves', text: S('Stock the back shelves', 'زيد غي العرايب'), done: true },
            { id: 'grill', text: S('Scrape the grill', 'نعق الصفيحة'), done: true },
            { id: 'register', text: S('Count the register', 'عمّر الحساب ديال الكاص'), done: true },
            { id: 'trash', text: S('Kitchen trash out the back', 'خد القمامة المالور'), done: true },
          ]);
        }
        break;
      }
      case 'freezer': {
        this.flags.noteDinerRead = true; this.flags.shiftTasksStarted = true; this.flags.everythingDone = true;
        W.setLight('diner_porch', true);
        G.phone.setTasks([{ id: 'cream', text: S('Grab the oat cream from the freezer', 'جيب كريم الشوفان من المجلد') }]);
        break;
      }
      case 'closing': {
        this.flags.noteDinerRead = true; this.flags.hidingUnlocked = true; this.flags.trapped = true;
        this.flags.blackout = true; G.phone.setSignal(false);
        W.killPower(); W.hemi.intensity = 0.2;
        G.player.items.set('fuse', { label: S('MAIN fuse', 'الفيوز الرئيسي') });
        G.player.items.set('cashkeys', { label: S('Car keys', 'مفاتيح السيارة') });
        break;
      }
    }
    this.G.player.pos.set(sp.x, 0, sp.z);
    this.G.player.yaw = sp.yaw; this.G.player.pitch = 0;
    this.setClock(cp.clock);
    this.save(id);
    this._enterChapter(Math.max(this.chapter, 1), true);
  }

  // ==========================================================
  // INTRO + HOME
  // ==========================================================
  _intro() {
    const G = this.G;
    this.chapter = 0;
    this.setClock(22 * 60 + 41);
    G.ui.letterbox(true);
    G.ui.fade(true, 0);
    G.player.frozen = true;
    this.later(1.4, () => {
      G.ui.subtitle('', S('WESTLAND COUNTY — ROUTE 9', 'مقاطعة ويستلاند — الطريق ٩'), {});
    });
    this.later(4.2, () => {
      G.ui.subtitle('', S("an owl's nest stays open for the highway", "عش البومة مازال محاط بالطريق للي ولاتهم"), {});
    });
    this.later(7.2, () => {
      G.ui.chapterCard('22:41', S('LAST CALL', 'آخر نداء'), () => {
        G.ui.fade(false, 2600);
        G.ui.letterbox(false);
        G.player.frozen = false;
        this._chHome();
      });
    });
  }

  _chHome() {
    const G = this.G, F = this.flags, P = G.phone;
    G.ui.setObjective(S('Read Mounir’s list on the counter.', 'اقرأ قصة يومك فوق الصوف.'));
    G.audio.startRain('rain_home', 0.05);
    G.ui.subtitle('SALMA', S(
      'Nap on the couch, rain on the windows, a cat-shaped echo on my leg and Mounir already texting like a cat left the stove on.',
      'سيستر أصغر النومة ف الكنباط، المطر ع الدريسة، وصورة واربة ديال القط عليّ و منير كيبعط رسائل كألي ضار البوتجاج.'),
      { thought: true, dur: 8 });
    this.later(8, () => P.inbound('mounir', { typing: 2.2, text: S('LIST. on the counter. printed. READ IT.', 'الليستة فوق التابليفون. مطبوعة. اقراها.') }));
    this.later(24, () => P.inbound('kenza', { typing: 2.6, text: S('u working at the OWL tonight??? the highway diner???? u know what happens to girls at highway diners', 'خدّامة الليلة ف البومةةةةةةةةةةةةةةةةةةةةةةةة 😱 شفتيهاا فيدييييناتد الجاادة؟') }));
    this.later(38, () => P.addReplyOptions('kenza', [
      { text: S('lol it’s a cafe not a horror movie', 'هههههه قاسة مقاهي مش فيلم رعب'), send: S('lol it’s a cafe not a horror movie', 'هههههه قاسة مقاهي مش فيلم رعب'), then: () => this.later(4, () => P.inbound('kenza', { text: S('exactly what the GIRL in the movie says. text me at 3', 'هاكي هو خوش اللي كتخونت بيه البنت الفيلم. دار نصرسمّ ٣') })) },
      { text: S('mounir pays cash. cash is cash.', 'منير كيخلص بالكاش. الكاش هو الكاش.'), send: S('mounir pays cash. cash is cash.', 'منير كيخلص بالكاش. الكاش هو الكاش.'), then: () => this.later(5, () => P.inbound('kenza', { text: S('fair. cash > common sense. text me at 3 tho', 'فالك. كاش اولسي على فاعل بش. مهم رو نصرسمّ ٣') })) },
    ]));
    this.later(52, () => P.inbound('mama', { typing: 1.8, text: S('did you eat something baby', 'بنتية داكلة شي حاجة الغضا؟') }));
    // home door task trigger
    G.world.addTrigger('s_leavehome', -3.0, -5.2, 3.0, -2.4, () => {
      if (!F.homeDone) {
        G.ui.subtitle('SALMA', S('Keys? yes. Jacket? yes. List memorized? emotionally, yes. Door? shut.', 'المفاتيح؟ اه. الجاكيطة؟ اه. الليستة محفوضة؟ عاطفياً، اه. الباب؟ مسدود.'), { thought: true, dur: 5 });
      }
    });
    G.world.addTrigger('s_carhome', 1.0, -8.5, 3.4, -4.6, () => {
      if (!F.homeDone) return;
      F.driveReady = true;
      G.ui.setObjective(S('Get in the car. Route 9 north.', 'دخل توموبيلك. الطريق ٩ الشمال.'));
      this.later(1.5, () => { if (F.driveReady) G.ui.setObjective(S('Get in the car. Route 9 north.', 'دخل توموبيلك. الطريق ٩ الشمال.')); });
    });
  }

  homeTasksTick() {
    const G = this.G, F = this.flags, P = G.phone;
    const need = ['note', 'coffee', 'catbowl', 'keys'];
    const all = need.every(k => F[k + 'Done']);
    if (all && !F.homeDone) {
      F.homeDone = true;
      G.ui.subtitle('SALMA', S('Out then. Do NOT forget to text Kenza at three. Or, you know, everything else.', 'ياللة نخرج. ما ننساش نرسبر كنزة الساعة ٣. ولاي كلشيو.'), { thought: true });
      G.ui.setObjective(S('Leave the flat.', 'دقا من الدار.'));
      P.completeTask('coffee'); P.completeTask('catbowl'); P.completeTask('keys'); P.completeTask('note');
    }
  }

  // ==========================================================
  // CHAPTER ROUTER
  // ==========================================================
  _enterChapter(n, fromCP = false) {
    const G = this.G;
    this.chapter = n;
    if (n === 0) { this._chHome(); return; }
    const cp = CHAPTERS[n];
    this.save(cp.id);
    if (!fromCP) G.ui.chapterCard(cp.time, S(cp.en, cp.ar));
    if (n === 1) this._chDrive(fromCP);
    else if (n === 2) this._chArrival(fromCP);
    else if (n === 3) this._chCustomers(fromCP);
    else if (n === 4) this._chFreezer(fromCP);
    else if (n === 5) this._chClosing(fromCP);
  }

  // ==========================================================
  // CHAPTER 1 — THE DRIVE (cinématique)
  // ==========================================================
  _chDrive() {
    const G = this.G, F = this.flags, P = G.phone;
    this._driveOn = true;
    this._driveT = 0;
    this._driveX = G.player.pos.x;
    G.ui.letterbox(true);
    G.player.frozen = true;
    G.ui.setObjective(S('Route 9 north. Two miles. Nothing faster.', 'الطريق ٩ الشمال. كيلومتران. ماشي أسرع.'));
    G.audio.engineSet(true, 0.2);
    G.audio.startRain('rain_drive', 0.08);
    G.audio.setWind(0.03);
    // sit camera in the rig, headlights later from story.update
    const rig = G.world.props.driveRig;
    rig.visible = true;
    rig.position.set(G.player.pos.x, 0, G.player.pos.z + 0.6);
    G.camera.position.set(G.player.pos.x - 0.35, 1.05, G.player.pos.z);
    // messages on the way
    this.later(8, () => P.inbound('mounir', { typing: 2.0, text: S('do NOT forget the OPEN sign. the truckers see the sign, they stop. no sign, no tips, no diner.', 'ماتنساتش إشارة المفتوح. السواق كيهرب ابدها ولا يقف هنا. لا إشارة لا بوادار لا قهوة.') }));
    this.later(24, () => P.inbound('tarek', { typing: 2.4, text: S('rolling north w/ the silver crown. u at the nest tonight? save me the window stool habiba', 'راني ع الطريق بكريت الفضّ. نتاية ف العش اللّيلة؟ شوفيليك بالكولوار يا حبيبة') }));
    // the figure on the road — mini scare
    this.later(41, () => {
      G.effects.shake(0.3);
      G.audio.stingLow(0.4);
      this._scare('roadfig', 0.4);
      G.ui.subtitle('SALMA', S('a person. standing IN the lane for a second, lit white in my lights. then nobody. HUNDRED meters of nobody.', 'وَحدة. كاينة ف النص د الطريق على ضو المصبة ديالي، عليها بضو البالبوح. ومن بعد ممنع منهم. ميّة ميتر خاطب.'), { thought: true, dur: 8 });
    });
    this.later(66, () => P.inbound('mama', { typing: 1.6, text: S('call me tomorrow baby', 'عيطيلي بك غدا بنتية') }));
    this.later(80, () => {
      // arrive: fade out, park, chapter 2
      G.ui.fade(true, 1400);
      this.later(1.6, () => {
        G.audio.engineSet(false);
        this._endingDriveDone();
      });
    });
  }
  _endingDriveDone() {
    const G = this.G;
    this._driveOn = false;
    G.world.props.driveRig.visible = false;
    G.player.frozen = false;
    G.ui.letterbox(false);
    const sp = CP_SPAWNS.arrival;
    G.player.pos.set(sp.x, 0, sp.z); G.player.yaw = sp.yaw; G.player.pitch = 0;
    // the car appears in the lot
    G.world.props.playerCar.visible = true;
    G.world.props.playerCar.position.set(-214.6, 0, -6.2);
    this.setClock(23 * 60 + 12);
    G.ui.fade(false, 1800);
    this._enterChapter(2);
  }

  // ==========================================================
  // CHAPTER 2 — ARRIVAL & the shift list
  // ==========================================================
  _chArrival(fromCP) {
    const G = this.G, F = this.flags, P = G.phone, W = G.world;
    G.ui.setObjective(S('The diner. Mounir left the place to you. Read his shift note on the counter.', 'المقها. منير خلاها Pousta. اقرا الورقة ديالو على الكونطوار.'));
    W.doors.get('back_door').locked = true; // boss locked it on his way out
    this.later(5, () => P.inbound('kenza', { typing: 2.4, text: S('ok u made it GO-GIRL. the place looks so pretty when its closed i bet. photos of absolutely everything', 'يااا سربعة البنّة. المكان جالب مزا واللي سدات أخي حط. صوّري ليا كولشي') }));
    this.later(40, () => {
      // the sedan idles across the lot — headlights beam through the diner glass
      W.props.blackSedan.visible = true;
      G.audio.stingLow(0.35);
      G.effects.shake(0.22);
      this._scare('sedan', 0.3);
      G.ui.subtitle('SALMA', S('a black sedan slid into the far stall while Mounir was still warm in his chair. engine ribbit. nobody got out. nobody is in it, from here.', 'سيدانة كحلة سربات ف بلاصة الطوال ماشي تلعب منير منشي. منّيكد يغرد. ممنع خرج. ممنع فيها، من بعيد.'), { thought: true, dur: 8 });
      this.later(18, () => { W.props.blackSedan.visible = false; G.audio.carPass(); });
    });
    // tasks when the note is read
  }

  startShiftTasks() {
    const G = this.G, F = this.flags, P = G.phone;
    if (F.shiftTasksStarted) return;
    F.shiftTasksStarted = true;
    P.setTasks([
      { id: 'sign', text: S('Flip on the OPEN neon (breaker box, by the freezer)', 'شعل إشارة المفتوح عند لوحة الكهرباء') },
      { id: 'shelves', text: S('Stock the pantry shelves (3 crates)', 'عمّر رفوف المحزن ٣ مرات') },
      { id: 'grill', text: S('Scrape the grill', 'نكص صفيحة الشواء') },
      { id: 'register', text: S('Count the register drawer', 'عد الفمية في الكاص') },      { id: 'trash', text: S('Take the kitchen trash to the back dumpster', 'شد قمامة المطبخ للمسطور') },
    ]);
    G.ui.setObjective(S('The list, then the paying public.', 'الليستة، معزّك الحبش اللّي كيدخل.'));
    this.later(9, () => P.inbound('mounir', { typing: 2, text: S('close at 3. THREE. not 3:10. bolt the back after last order and count the register under the camera nobody installs', 'بالإغلاق على ٣. تلثا. ماشي ٣ وعشرة. روقي الباب الخلفي بعد آخر طلب وعم الK زحص بالكاميرا') }));
  }

  _checkShiftTasks() {
    const G = this.G, F = this.flags, P = G.phone;
    const all = ['sign', 'shelves', 'grill', 'register', 'trash'].every(id => P.tasks.find(t => t.id === id && t.done));
    if (all && !F.everythingDone) {
      F.everythingDone = true;
      this.setClock(24 * 60 + 26);
      this.later(3, () => P.inbound('kenza', { typing: 2, text: S('ok spill. whos in there', 'يااا خض. شكون ماعندتك عنوان') }));
      this.later(12, () => this._enterChapter(3));
    }
  }

  // ==========================================================
  // CHAPTER 3 — CUSTOMERS
  // ==========================================================
  _chCustomers(fromCP) {
    const G = this.G, F = this.flags, P = G.phone, W = G.world;
    G.ui.setObjective(S('Serve whoever walks in. Smile tastefully.', 'دول عليهم معزّك. ابتسم بأدب.'));
    W.setLight('sign_l', true);
    // Tarek the trucker — friendly npc
    this._spawnNPC('tarek', -206.5, -3.5, -207.5, 0.9, { height: 1.86, bulk: 1.25, shirt: 0x4a3a2a, pants: 0x3a4048, hair: 0x3a2a1a });
    this.later(14, () => {
      G.audio.doorbellBuzz({ x: -207, y: 1.4, z: -2 });
      this._walkNPC('tarek', -206.5, -1.5, -208.6, 1.1, 1.1, () => {
        this._npc.tarek.lookAt(-210.5, 1.1, 1.85);
        G.ui.subtitle('TAREK', S('Ey habiba. The window stool saved me a heart attack already.', 'يا محيبة. الكولوادو مش ميشيليا ف القلب تحت.'), { dur: 4 });
        G.ui.setObjective(S('Serve Tarek his coffee. (counter pot)', 'دوّل طارق قهوتو. (قهوة الكونطوار)'));
        F.tarekAngryWaiting = true;
        G.world.addTrigger('s_tarek_seated', -209.5, 0.9, -207.7, 1.6, () => {}, { once: false });
      });
    });
    this.later(120, () => this._hediArrives());
    this.later(210, () => this._strangerArrives());
    this.later(320, () => this._jukeboxScare());
    this.later(430, () => this._strangerLeaves());
    this.later(500, () => this._closingBeats());
  }

  _spawnNPC(name, x0, z0, lookX, lookZ, opts = {}) {
    const G = this.G;
    const { Human } = G.npcLib;
    const h = new Human(G.world, opts);
    h.group.position.set(x0, 0, z0);
    h.group.rotation.y = Math.atan2(lookX - x0, lookZ - z0);
    G.scene.add(h.group);
    this._npc[name] = h;
    return h;
  }
  _walkNPC(name, x1, z1, x2, z2, speed, onDone) {
    const h = this._npc[name];
    if (!h) { onDone && onDone(); return; }
    h.setMotion && typeof h.setMotion === 'function' ? h.setMotion('walk') : null;
    this._npcMovers.push({ h, x1, z1, x2, z2, speed, onDone });
  }

  _hediArrives() {
    const G = this.G, F = this.flags, P = G.phone;
    this._spawnNPC('hedi', -206.5, -4.5, -213.4, 1.8, { height: 1.65, bulk: 0.95, shirt: 0x4a4a3a, pants: 0x2c3038, hair: 0x8a8578 });
    this.later(2, () => {
      G.audio.doorbellBuzz({ x: -207, y: 1.4, z: -2 });
      this._walkNPC('hedi', -206.5, -1.5, -212.8, 1.1, 0.9, () => {
        const h = this._npc.hedi;
        h.group.position.set(-213.2, 0.1, 1.5);
        h.group.rotation.y = Math.PI / 2;
        h.lookAt && h.lookAt(-213.8, 1.4, 0.2);
        G.ui.subtitle('HEDI', S('Tea. The special. And quiet. I know where it comes from.', 'أتاي. الاسبيسيال. والسكينة. أرف واسمها.'), { dur: 4 });
        F.hediWaiting = true;
        G.ui.setObjective(S('Note: abādi abay. Get the small silver the kitchen. THE TRAY. (counter)', 'يالك داخلات: هيطلس الفضّة د مطبخ. الطّيرسير. (الكونطوار)'));
      });
    });
  }
  _strangerArrives() {
    const G = this.G, F = this.flags;
    this._spawnNPC('stranger', -206.8, -3.2, -214, 3, { height: 1.96, bulk: 0.92, shirt: 0x1a1c20, pants: 0x14161a, shoes: 0x0c0d0e, skin: 0xc9b8a8, hair: 0x15100e, faceTex: G.world.faceStalkerTex || G.T.faceStalker });
    this.later(3, () => {
      G.audio.doorbellBuzz({ x: -207, y: 1.4, z: -2 }, 0.5);
      G.audio.duckAmbience(1.4);
      G.effects.vignetteBoost(0.95);
      this._walkNPC('stranger', -206.8, -1.6, -213.3, 0.6, 0.95, () => {
        const h = this._npc.stranger;
        h.group.position.set(-213.2, -0.02, 0.2);
        h.group.rotation.y = Math.PI / 2.2;
        h.headTilt && h.headTilt(0.18);
        h.lookAt && h.lookAt(-207, 1.4, 1.0, true);
        G.audio.stingLow(0.5);
        this._scare('stranger', 0.45);
        G.ui.subtitle('SALMA', S('He took the booth Hami always takes with his face to the window. Didn’t order. Didn’t look at the menu. Didn’t look at anything but me.', 'خذى بلاصة د الحمّي اللي كياخد ديما ووجهو عالجاج. ما طلب حتى حاجة. ما قرا القائمة. ما شاف حتى شي حاجة غير ميا.'), { thought: true, dur: 9 });
      });
    });
  }

  _jukeboxScare() {
    const G = this.G, F = this.flags;
    if (F.jukePlayed) return;
    F.jukePlayed = true;
    const jb = G.world.props.jukebox;
    G.audio.jukeboxSong('juke1', { x: -213.5, y: 1.0, z: 3.85 }, { reps: 2, vol: 0.18 });
    jb && (jb.lamp.material.emissiveIntensity = 2.2);
    G.audio.duckAmbience(2);
    G.effects.impulse(0.8, 0.5);
    this._scare('jukebox', 0.5);
    G.ui.subtitle('SALMA', S('the jukebox switched itself on. nobody put a coin in it. and the man in the booth started nodding his head like he’d called the song ten minutes ago.', 'الجوكبوكس خد بيه الهوا بوحدّو. ممنع كبّت فيه lo cصف. و الراجل الي ف البوت كيبدأ يهز راسو كأليهول كياني ایلت على ساعة وماشيليا.'), { thought: true, dur: 9 });
    this.later(9, () => {
      G.ui.subtitle('???', S('“the owl used to hoot at closing.”', '"عش البومة كيهوت عند الإغلاق."'), { dur: 3.5 });
    });
  }
  _strangerLeaves() {
    const G = this.G, F = this.flags;
    const h = this._npc.stranger;
    if (!h) return;
    this._walkNPC('stranger', -213.3, 0.6, -206.6, -1.2, 1.6, null);
    this.later(4.2, () => {
      h.group.visible = false;
      delete this._npc.stranger;
      G.audio.doorbellBuzz({ x: -207, y: 1.4, z: -2 }, 0.5);
      G.audio.setLoopVol('hum_sign', 0.045) && 0;
      G.effects.vignetteBoost(0.85);
      // coins on his table — a little wrong
      G.ui.subtitle('SALMA', S('He left four coins on the table. All of them are hammered flat on one side like somebody wanted to have nothing worth reading. Mounir keeps ones like this in a jar. I asked nobody about the jar.', 'خلا ٤ فموهود درجات على الطابلة. كولوا مسكّون جنع من وجه واحد. منير كيخلّي حفات ف الزجاجة بينما حدى. سولسيت حدى.'), { thought: true, dur: 10 });
      this.G.phone.inbound('unknown', { typing: 1.4, text: S('how fast do you close', 'بش استعجاد كيرستنا عند الإغلاق') });
      this.later(9, () => {
        G.phone.inbound('unknown', {
          typing: 2.8, buzz: true,
          text: S('you looked lovely in the orange light.', 'كنتِ زوينة فالضو البرتقالي.'),
          img: './art/mms.jpg',
        });
        G.audio.stingLow(0.5);
        this._scare('mmsphoto', 0.6);
      });
      F.unknownTexts = true;
      this.setClock(25 * 60 + 47);
      this.later(12, () => G.ui.setObjective(S('Low on oat cream. Freezer — kitchen corner.', 'كريم الشوفان خاص منير. المجلد — زاوية المطبخ.')));
      this.later(60, () => this._enterChapter(4));
    });
  }
  _closingBeats() { /* handled by _enterChapter(4) */ }

  // ==========================================================
  // CHAPTER 4 — THE FREEZER TRAP
  // ==========================================================
  _chFreezer(fromCP) {
    const G = this.G, F = this.flags, P = G.phone, W = G.world;
    G.ui.setObjective(S('The oat cream lives in the walk-in freezer. Grab it and get back out.', 'كريم الشوفان كاين ف غرفة المجلد. دالو الصديق و خرج.'));
    // the trap triggers when you step inside
    G.world.addTrigger('s_freezer_in', -213.6, 4.4, -211.4, 5.8, () => {
      if (F.trapped) return;
      F.trapped = true;
      this._freezerTrap();
    });
    // cream interaction (inside the freezer) — added by world onuse 'cream'
  }
  _freezerTrap() {
    const G = this.G, F = this.flags;
    const fd = G.world.doors.get('freezer_door');
    G.audio.doorSlam({ x: -212.6, y: 1.2, z: 4.0 }, 1.3);
    fd.close(); fd.locked = true;
    F.freezerStuck = true;
    G.effects.shake(1.1);
    G.effects.flash(0x111111, 0.7);
    G.audio.stingHit(0.9);
    this._scare('freezerslam', 1.0);
    G.phone.setSignal(false);
    G.audio.setWind(0.02);
    G.ui.subtitle('SALMA', S('the door’s LED went out with it. everything that was ever frozen in here is listening. I am the loudest thing in the freezer.', 'اللفظة د الباب خرجات عليها السالسة. كلشي الي اجمد هنا كيسمع. أنا الحاجة الوحيدة الي كتقارق فيها.'), { thought: true, dur: 10 });
    this.later(5, () => {
      // he tests the handle from the kitchen side — twice
      G.audio.knock(2, { x: -212.6, y: 1.1, z: 4.2 }, 0.9, true);
      fd.pound && fd.pound();
      G.audio.heartbeat(112, 0.26);
      G.ui.subtitle('SALMA', S('the handle moved. from outside. twice. heavy, like the meat knows better.', 'المقبض تها. من بياني فوقي. جوّج مرات. كأن اللحم كيشك.'), { thought: true, dur: 8 });
    });
    this.later(13, () => {
      G.audio.footstep('concrete', 0.5, { x: -211, y: 1.1, z: 4.5 });
      G.ui.subtitle('SALMA', S('one backdrop of slow steps slid between us and the whole kitchen, and didn’t stop.', 'صامته دقا ديبرى بطيئة بيننا كولو الصفاء ديال المطبخ، ولا توغلت.'), { thought: true, dur: 7 });
    });
    this.later(21, () => {
      // door gives way under a kick (interactable will override too) + power dies
      fd.locked = false; fd.setLocked && fd.setLocked(false);
      W_powerDieSlow(G.world);
      this.flags.escapedFreezer = true;
      G.ui.setObjective(S('Kick, or use E on the freezer door.', 'رفده ف الباب، ولا استعمل E فيه.'));
      this.later(2.4, () => {
        G.world.killPower();
        G.audio.powerDown();
        G.effects.flash(0x000000, 0.5);
        G.effects.shake(0.6);
        this.flags.blackout = true;
        this.flags.hidingUnlocked = true;
        G.ui.subtitle('SALMA', S('closer than the cold — the whole owl went out with him', 'أقرب من البرودة — عش البومة كامل خرجات معاه'), { thought: true, dur: 6 });
        G.ui.setObjective(S('Find the MAIN fuse. Then the register, then the panel.', 'جيب الفيوز الرئيسي. ومن بعد الكاص، ومن بعد اللوحة.'));
        this.later(5, () => this._startHunt());
      });
    });
  }

  _startHunt() {
    const G = this.G, S2 = G.stalker;
    if (S2.mode !== 'off') return;
    S2.spawn(-198, -9.5, Math.PI);
    S2.startHunt(G.world.aiWaypoints);
    G.audio.heartbeat(82, 0.18);
    G.ui.subtitle('SALMA', S('Footsteps on asphalt crossing my kitchen-window light. One direction. God who put him on my side of the cordon.', 'خطوات على الاسفلت كيعبر ضو الدريسة دياي المطبخ. اتجاه واحد. مرحباً منشنو، شحال كنونة واحد جوايز بلا باس.'), { thought: true, dur: 9 });
  }

  // ==========================================================
  // CHAPTER 5 — CLOSING (the chase + dawn epilogue)
  // ==========================================================
  _chClosing(fromCP) {
    const G = this.G, F = this.flags, S2 = G.stalker;
    this.flags.carEscape = true;
    if (!fromCP) G.audio.powerUp();
    G.ui.letterbox(true);
    G.ui.setObjective(S('YOUR CAR.', 'التوموبيل.'));
    this.later(fromCP ? 1.2 : 2.2, () => this._beginChase());
  }
  _beginChase() {
    const G = this.G, P = G.player, S2 = G.stalker;
    if (this._chaseOn) return;
    this._chaseOn = true;
    this.flags.carEscape = true;
    S2.spawn(-206, -2.6, Math.PI);
    S2.startChase({ finale: true });
    G.audio.jumpscare();
    G.audio.chaseMusic(true, 152);
    G.audio.heartbeat(140, 0.4);
    G.effects.impulse(1.4, 1.2);
    G.effects.shake(1.1);
    this._scare('chase', 1.1);
    P.speedBoost = 1.1;
    G.ui.subtitle('SALMA', S('RUN. LOT. YOUR CAR. WHATEVER IS BEHIND YOU IS NOT A CUSTOMER.', 'جري. الموقف. التوموبيل. كلشي اللي وراك مش زبون.'), { thought: true, dur: 4 });
    this.save('closing');
  }

  onCaught(cause) {
    const G = this.G, P = G.player;
    if (this._dying) return;
    this._dying = true;
    this.stats.deaths++;
    writeEpSave({ checkpoint: this.checkpointId || 'home', stats: this.stats });
    P.frozen = true;
    Phome_uncaught(G);
    G.audio.jumpscare();
    G.audio.chaseMusic(false);
    G.audio.heartbeat(0);
    G.effects.flash(0xff2211, 0.35);
    G.effects.impulse(1.5, 1.5);
    G.effects.shake(1.4);
    G.ui.letterbox(true);
    this.later(1.2, () => {
      G.ui.letterbox(false);
      G.ui.showDead(pick([
        S('the counter got cold anyway.', 'الكونطوار برد كذلك.'),
        S('the owl never learned to say goodbye.', 'البومة ماهبعتش تستانر.'),
        S('nobody heard the closing bell.', 'ممنع سمع القارس دّ الإغلاق.'),
      ]));
      this._dying = false;
    });
  }

  // car mash + ending
  _carMash() {
    const G = this.G, F = this.flags;
    if (F.inCar) return;
    this._mash = (this._mash || 0) + 1;
    G.audio.latch('key', { x: -214.6, y: 1, z: -6.2 });
    G.effects.shake(0.24);
    if (this._mash === 1) G.ui.subtitle('SALMA', S('alright alright alright—', 'هه هه هه—'), { thought: true, dur: 1.2 });
    if (this._mash === 2) G.ui.subtitle('SALMA', S('COME ON—', 'يااا—'), { thought: true, dur: 1.2 });
    if (this._mash >= 3) {
      G.audio.latch('unlock', { x: -214.6, y: 1, z: -6.2 });
      this._carEnding();
    }
  }
  _carEnding() {
    const G = this.G, P = G.player;
    this.flags.inCar = true;
    P.frozen = true;
    G.audio.chaseMusic(false);
    G.ui.letterbox(true);
    G.ui.setObjective('');
    G.ui.setPrompt(null);
    const car = G.world.props.playerCar;
    const cp = car.position;
    G.camera.position.set(cp.x - 0.2, 1.16, cp.z - 0.1);
    P.yaw = car.rotation.y + Math.PI * 0.92; P.pitch = 0.05;
    // palms hit the driver window
    this.later(1.6, () => {
      const winX = cp.x - Math.cos(car.rotation.y) * 1.0, winZ = cp.z + Math.sin(car.rotation.y) * 1.0;
      const S2 = G.stalker;
      S2.group.visible = true;
      S2.pos.set(winX, 0, winZ);
      S2.yaw = Math.atan2(cp.x - winX, cp.z - winZ);
      S2.group.rotation.y = S2.yaw;
      S2.group.position.y = -0.35;
      G.audio.doorSlam({ x: winX, y: 1, z: winZ }, 1.3);
      G.audio.jumpscare();
      G.effects.shake(1.4);
      G.effects.flash(0xff3322, 0.4);
      this._scare('carwindow', 1.4);
      G.ui.subtitle('SALMA', S('THE JAWS Y HOOKED THE DOOR FRAME.', 'يداه سد الهيكل.'), { thought: true, dur: 2 });
      this.later(1.4, () => G.audio.latch('locked', { x: cp.x, y: 1, z: cp.z }));
      this.later(2.6, () => G.audio.latch('locked', { x: cp.x, y: 1, z: cp.z }));
      this.later(3.6, () => {
        G.audio.engineSet(true, 0.28);
        G.effects.shake(0.4);
        G.world.hemi.intensity = 0.34;
        const hl = new THREE.SpotLight(0xd8e2ff, 30, 26, 0.5, 0.4, 1.2);
        hl.position.set(cp.x, 0.9, cp.z);
        hl.target.position.set(cp.x + Math.sin(car.rotation.y) * -14, 0.4, cp.z + Math.cos(car.rotation.y) * -14);
        G.scene.add(hl, hl.target);
        G.ui.subtitle('SALMA', S('drive. home. nothing in the mirror. nothing in the mirror—', 'سوق. الدار. حتى شي حاجة ف المرية. حتى شي حاجة ف المرية—'), { thought: true, dur: 5 });
        this.later(2.4, () => {
          S2.group.visible = false;
          S2.mode = 'off';
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
      epUnlock('credits');
      G.ui.showEnding([
        S('You drove home with the rain running backwards off your heartbeat.', 'سقت الطريق للدار و المطر كيجري يتعكس خلف ضربات قلبك.'),
        S('Mounir closed the worm-to-ranks the next day and never once asked why your hands bled when you handed in the key.', 'منير سد تعالة اليوم جاية وقطعت حرفن حاجة عايش ب misديام ديالدكتياغ ديالك عليك.'),
        S('The police found nothing — except four flat coins on the west-facing booth, crushed one against the other as if to weigh less.', 'البوليس ماتقاتل والو — غير أربع مسيّيلون مطبّقين على القاعدة اللّي برشوة الغرب، واحد فوق الآخر كائن كتزن شحال.'),
        S('You never went back after the rain. The owl had other customers. You let them have it.', 'كنزي ما كيلي المسق. البومة كاين عندها زبناء جدد. را خلاك فالرش.'),
        S('— SHIFT PASSED. YOU SURVIVED —', '— وردية خالصة. نجوت —'),
        `${S('time', 'الوقت')}: ${mins}m · ${S('deaths', 'الخسف')} : ${this.stats.deaths} · ${S('scares', 'الخاوية')} : ${this.stats.scares}`,
        S('LAST CALL\nthanks for playing route nine', 'نهاية اللعب\nشكراً على الطريق ٩'),
      ], () => { clearEpSave(); G.quitToMenu(); });
    });
  }

  // ---------- helpers ----------
  _scare(id, shake = 0.8) {
    this.stats.scares++;
    const G = this.G;
    G.effects.shake(shake);
    G.audio.stingLow(0.3);
  }
  crisisDanger() { return this.flags.blackout; }

  // ==========================================================
  // PER-FRAME
  // ==========================================================
  update(dt) {
    const G = this.G;
    this.stats.playTime += dt;
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); try { tm.fn(); } catch (e) { console.error('timer', e); } }
    }
    // named npc walkers
    for (let i = this._npcMovers.length - 1; i >= 0; i--) {
      const m = this._npcMovers[i];
      const dx = m.x2 - m.x1, dz = m.z2 - m.z1;
      m.t = (m.t || 0) + (m.speed * dt) / Math.max(0.01, Math.hypot(dx, dz));
      const k = clamp(m.t, 0, 1);
      m.h.group.position.set(m.x1 + dx * k, m.h.group.position.y, m.z1 + dz * k);
      m.h.group.rotation.y = Math.atan2(dx, dz);
      m.h.update(dt, this.stats.playTime);
      if (k >= 1) {
        this._npcMovers.splice(i, 1);
        m.h.setMotion && m.h.setMotion('idle');
        m.onDone && m.onDone();
      }
    }
    for (const k of Object.keys(this._npc)) this._npc[k].update(dt, this.stats.playTime);
    // drive cinematic: the world slides past the car windows
    if (this._driveOn) {
      this._driveT += dt;
      const rig = G.world.props.driveRig;
      // camera gently bobs with speed
      const t = this._driveT;
      G.camera.position.set(rig.position.x - 0.34, 1.06 + Math.sin(t * 9) * 0.006, rig.position.z + 0.05);
      G.camera.rotation.set(Math.sin(t * 0.3) * 0.01, Math.PI / 2 + Math.sin(t * 0.22) * 0.03, 0, 'YXZ');
      // trees/poles rush backwards on a loop (world slides past the car)
      const props = G.world.props;
      props.driveLoopMeshes = props.driveLoopMeshes || G.world.trees.concat(G.world.poles || []);
      const v = 14.5; // m/s past the windows
      this._scrollOff = (this._scrollOff || 0) + v * dt;
      const off = this._scrollOff % 220;
      for (const m2 of props.driveLoopMeshes) m2.position.x = off;
      // radio hiss
      if ((this._radioTick = (this._radioTick || 0) + dt) > 7) { this._radioTick = 0; G.audio.startStatic('drive_r', { x: rig.position.x, y: 1, z: rig.position.z }, 0.05); }
    }
    // car escape: stalker pounding when you're inside is handled by _carEnding
  }

  // ==========================================================
  // HOOKS
  // ==========================================================
  hook(name, a, b) {
    const G = this.G, F = this.flags, P = G.phone, W = G.world, C = this;
    const sub = (sp, tx, opts = {}) => G.ui.subtitle(sp, tx, { thought: sp === 'SALMA', ...opts });
    switch (name) {
      // -------- home --------
      case 'bossNoteHome':
        if (!F.noteDone) {
          F.noteDone = true;
          G.audio.latch('paper');
          P.setTasks([
            { id: 'coffee', text: S('Make coffee', 'دير لقهوة') },
            { id: 'catbowl', text: S('Feed Timo', 'أطعم تيمو') },
            { id: 'keys', text: S('Take the keys and the jacket', 'خد المفاتيح والجاكيطة') },
          ]);
          G.ui.setObjective(S('Coffee, cat, keys. Rain says hurry.', 'قهوة، قط، مفاتيح. المطر كيقول هابشيل.'));
          sub('SALMA', S('Mounir printed a list. He prints everything. The paper reads like he swallowed a software manual and swallowed a chair.', 'منير طبع الليستة. كيپي print كولشي. جو الورقة كتبقا كبير.'), {});
          this.homeTasksTick();
        } else sub('SALMA', S('Closed between three and four. Coffee pot stays hot. Fridge holds cream. Tarek comes before midnight.', 'مقشى بين ثلاثة وربعة. قهوة دائىية سخونة. الخوخر شافي. طارق قولفين قبل ماแรبوح.'), {});
        break;
      case 'coffee': {
        if (!F.coffeeDone) {
          F.coffeeDone = true;
          G.audio.latch('switch');
          G.ui.notify && 0;
          G.phone.startbrew ? G.phone.startbrew() : null;
          this.later(2.2, () => G.audio.latch('ui'));
          G.ui.subtitle('SALMA', S('The machine does its dying-cat aria and fills the counter with the smell of the 24th of every month.', 'الماكينة كتدير مقئت الحياة و الهون يملو الكونطوار برسّ سج ديال الشهر.'), { thought: true, dur: 5 });
          P.giveItem && 0; G.player.giveItem('coffeecup', { label: S('Travel mug', 'كوب التوصيل') });
          this.homeTasksTick();
        }
        break;
      }
      case 'kettle':
        G.audio.latch('ui');
        sub('SALMA', S('Twáncd: this is overdue. Then it settles with the sound of people forgetting why they’re even leaving home.', 'الشاهيد: متلسلل. ومن بعد كيطويق كأن الناس كين اللي كيشيلا من المنزل.'), {});
        break;
      case 'catbowl': {
        if (!F.catbowlDone) {
          F.catbowlDone = true;
          G.audio.meow({ x: 2.9, y: 0.5, z: 4.6 }, 0.4);
          this.later(0.4, () => G.audio.latch('paper'));
          sub('SALMA', S('Timo. Breakfast as if the sun actually comes back sometimes.', 'تيمو. فطور كعلي عمري الشمس.'), {});
          this.homeTasksTick();
        }
        break;
      }
      case 'cat': {
        G.audio.meow({ x: 3.3, y: 0.4, z: 4.8 }, 0.32);
        sub('SALMA', S('his shoulders vibrate like a badly grounded coffee maker. count to ten then leave him some of the sun you’re skipping.', 'كتز ef resله كالو كالولار مشمول. سمحاش منك ٣ دقائق.'), {});
        break;
      }
      case 'homeKeys': {
        if (!F.keysDoneSoftSkill) F.keysDoneSoftSkill = true;
        if (!F.keysDone) {
          F.keysDone = true;
          W.props.homeKeys.visible = false;
          G.audio.latch('key');
          G.player.giveItem('homekeys', { label: S('House keys', 'مفاتيح الدار') });
          sub('SALMA', S('Keys. The house looks less abandoned already.', 'الحضير. الدار ولات أقل مغطّاة مسبقاً.'), {});
          this.homeTasksTick();
        }
        break;
      }
      case 'jacket': {
        if (!F.jacketDone) {
          F.jacketDone = true;
          G.audio.latch('paper');
          G.player.giveItem('jacket', { label: S('Jacket', 'الجاكيطة') });
          sub('SALMA', S('the jacket says: two days of diner fog and another decade of rain.', 'الجاكيطة كيقةود: جوج أيام دب و عشر سنين دّالمطر؟'), {});
          this.homeTasksTick();
        }
        break;
      }
      case 'homeTv': // door toggling
        G.audio.latch('ui');
        break;
      case 'homeDoorOpen':
        sub('SALMA', S('rain.help. keys, keys, keys—', 'أعي. حبيبتي المفاتيح المفاتيح—'), {});
        break;
      case 'fridge': break;
      // -------- arrival / shift --------
      case 'bossNoteDiner': {
        if (!F.noteDinerRead) {
          F.noteDinerRead = true;
          G.audio.latch('paper');
          this.startShiftTasks();
        } else sub('SALMA', S('Lock up at 3, count the drawer under no light, do not feed strangers after midnight ~mounir', 'الإغلاق على ٣، عد الكاص بلا ضو، ما تسافر الغرباء من بعد UIView.midnight ~منير'), {});
        break;
      }
      case 'breaker': {
        const sw = a;
        const B = W.breaker;
        if (sw === 'MAIN') {
          if (!B.MAIN) { B.MAIN = true; G.audio.powerUp(); W.restorePower(); G.audio.breakerChunk(W.props.breakerPos, true); this.hook('powerFlipMain', true); }
          else { B.MAIN = false; G.audio.powerDown(); W.applyPowerMap(); this.flags.powerOut = true; }
          break;
        }
        B[sw] = !B[sw];
        G.audio.breakerChunk(W.props.breakerPos, true);
        W.applyPowerMap();
        if (sw === 'SIGN' && B.SIGN && !F.signDone) {
          F.signDone = true;
          G.phone.completeTask('sign');
          G.ui.subtitle('SALMA', S('The owl lights up out there like it remembers being paid.', 'البومة تشعل بها برّا كأنها تذكري أجر المرشودة.'), { thought: true });
          this._checkShiftTasks();
        }
        break;
      }
      case 'crate': {
        if (!F.shelfStage) F.shelfStage = 0;
        if (F.shelfStage < 3) {
          F.shelfStage++;
          G.audio.latch('pickup');
          G.player.giveItem('crate', { label: S('Restock crate', 'صندوق الغدي') });
          G.ui.setObjective(S('Stock the back shelves. (' + F.shelfStage + '/3 done)', 'عمّر الرفوف. (' + F.shelfStage + '/3 مكمل)'));
          G.ui.subtitle('SALMA', S('Cans, mason jars, star anise for no customer ever.', 'علاوي، مرطبانات، النجمة اليانسون لم لا يطلب حدنا جرا.'), { thought: true });
          G.world.props.canStock.forEach((c, i) => { c.visible = i >= F.shelfStage; });
          if (F.shelfStage >= 3) {
            G.phone.completeTask('shelves');
            G.ui.subtitle('SALMA', S('Restocked. Something still stares past the shelves through me.', 'الرفوف عامّرة. شي حاجة بعدسا كتشوف من بيني خلات.'), { thought: true });
            this._checkShiftTasks();
          }
        }
        break;
      }
      case 'grill': {
        if (!F.grillDone) {
          F.grillDone = true;
          G.audio.latch('metal') || G.audio.latch('locked');
          G.phone.completeTask('grill');
          sub('SALMA', S('the grill scrapes like it’s been keeping secrets in its grease.', 'الصفيحة كتنقّي كأن مخبّية سرية ف الدّهن.'), { dur: 4 });
          this._checkShiftTasks();
        }
        break;
      }
      case 'registerLocked': {
        if (!G.player.hasItem('cashkeys')) {
          sub('SALMA', S('locked. the keys Mounir keeps by the coffee pot. stuck to the counter under a pad.', 'مسدودة. المفاتيح اللي ما كيسلي مين فقدها زير قفل.'), {});
          G.ui.setObjective(S('Find the register keys (under the counter lip).', 'جيب مفاتيح الكاص (تحت حرف الكونطوار).'));
        }
        break;
      }
      case 'cashKeys': {
        if (!F.cashKeysDone) {
          F.cashKeysDone = true;
          W.props.cashKeys.visible = false;
          G.player.giveItem('cashkeys', { label: S('Register keys', 'مفاتيح الكاص') });
          G.audio.latch('key');
          sub('SALMA', S('small brass, cold as first watch.', 'نجمات النحاس، بارد كساعة الفّجر.'), {});
        }
        break;
      }
      case 'registerUnlocked': break;
      case 'registerOpen': {
        if (!F.registerDone) {
          F.registerDone = true;
          G.phone.completeTask('register');
          sub('SALMA', S('4,306 dirham and one 20 crisped like winter. Mounir counts it on film every morning anyway.', '٤٣٠٦ درهم و عشرة لا ورقة كالشتاء. منير عادي كيعد كل صباح.'), { dur: 5 });
          if (F.blackout) W.props.spareFuse.visible = true;
          this._checkShiftTasks();
        }
        break;
      }
      case 'fuseSlot': {
        if (W.breaker.fuseIn) { sub('SALMA', S('fuse is in. the lever now.', 'الفيوز ف بلاصتو. المفتاح درك.'), {}); break; }
        if (!G.player.hasItem('fuse')) {
          sub('SALMA', S('the MAIN slot is empty. the big brass one lives in the register drawer — Mounir keeps spares by the money.', 'القفطورة الرئيسية خاوية. الفيوز النحاسي الرئيسي كاين ف درج الكاص — منير كيحفظ النسخ الاحتياطية حدا الفلوس.'), {});
          if (!W.props.spareFuse.visible) W.props.spareFuse.visible = F.registerDone;
          break;
        }
        G.player.takeItem('fuse');
        W.breaker.fuseIn = true;
        W.applyPowerMap();
        G.audio.latch('switch');
        G.effects.impulse(0.5, 0.3);
        sub('SALMA', S('teeth. the fuse seats with a tiny kiss of heat. now the MAIN lever itself.', 'هاك الفيوز توحّر بصفارة شهق خفيفة. درك المفتاح الرئيسي الرئيسي.'), { dur: 4 });
        G.ui.setObjective(S('Flip the MAIN breaker lever.', 'قلب المفتاح الرئيسي لمطبخ.'));
        break;
      }
      case 'fuseTaken': {
        G.audio.latch('pickup');
        break;
      }
      case 'trashcan': {
        if (!F.trashbagTaken) {
          F.trashbagTaken = true;
          G.player.giveItem('trashbag', { label: S('Trash bag', 'قيسونة النفايات') });
          G.audio.latch('paper');
          sub('SALMA', S('big blue catfood-flavor bag. gone in one trip of stubbornness.', 'قيسونة النفايات كبير، أزرق مع بنات القط. بسيلك.'), {});
        }
        break;
      }
      case 'ice': {
        G.audio.latch('locked', { x: -201.4, y: 1.0, z: -3 });
        sub('SALMA', S('machine is older than the diner’s lease. fine ice for drinks — if you scream at it from exactly here.', 'الماكينة عايشة أكثر من التوق ع. ماكان في بقهي فط المداد — يلا قحتات هنينيا.'), {});
        break;
      }
      case 'jukebox': {
        sub('SALMA', S('sixty songs from when this county still had summers. the dance hall on the sticker has been empty for decades.', 'ستون أغنية من أيام هاد البلد ملي كانت عندها الصيفية. قاعة الرقص الي في الملصق خاوية من عشرات السنين.'), { dur: 5 });
        break;
      }
      case 'coffeePot': {
        sub('SALMA', S('coffee pot hotter than the desert after the month-end marathon.', 'القهوة أسخن من الصحرا بعد معركة أخر الشهر.'), {});
        break;
      }
      case 'trashDumped': {
        if (!F.trashDone) {
          F.trashDone = true;
          G.player.takeItem('trashbag');
          this.G.phone.completeTask('trash');
          sub('SALMA', S('lid slams behind me. the rain stops listening for two seconds. somewhere the fence wire sings applause.', 'الغطاء تسد ورايا. المطر كرمولنيا شوَاه. سلك الدم كيسهزّن؟'), { dur: 5 });
          this._checkShiftTasks();
        }
        break;
      }
      case 'dumpster': {
        G.audio.latch('locked', { x: -212.5, y: 1, z: 8.4 });
        if (G.player.hasItem('trashbag')) { this.hook('trashDumped'); }
        else sub('SALMA', S('smells like the proud end of a marine corps. the lid likes me better closed.', 'ريتّها شرفية آخر المارينز. الغطاء أكثر صحبات)، ولا طول المثال.'), {});
        break;
      }
      case 'payphone': {
        if (F.payphoneRinging) { this.hook('answerPayphone'); break; }
        G.audio.latch('pickup');
        sub('SALMA', S('dial tone across the mountains. call my mom? the rings breathe back. —mom, i’ll call tomorrow.', 'نغم الخط ديال الطريق ع الجبال. عيط لماما؟ — غدا، غدا ماما.'), { dur: 6 });
        break;
      }
      case 'answerPayphone': {
        F.payphoneRinging = false;
        G.audio.latch('pickup');
        G.audio.whisper();
        this._scare('payphone', 0.55);
        sub('???', S('"how many minutes until closing, waitress."', '"شحال دقائق للإغلاق يا قادمة."'), { dur: 4 });
        this.later(4, () => sub('SALMA', S('dial tone again. the receiver was warm, again. theen this was already used for CALLING.', 'غير نغم الخط. السماعة سخونة مليار. هادو كيستعملوها للهاتف??'), {}));
        break;
      }
      case 'backLocked': {
        sub('SALMA', S('mounir locked it on the way out. chain looks recent. fine.', 'منير مقفلها في الخروجة. السلسلة كاينة جديدة. مزيان.'), {});
        break;
      }
      case 'backDoorOpen': {
        // back door only opens when unlocked (event sets it unlocked during chase)
        if (F.blackout && !F.doorOpenedEscape) {
          F.doorOpenedEscape = true;
        }
        break;
      }
      case 'freezerDoor': {
        const fd = W.doors.get('freezer_door');
        if (F.freezerStuck && !fd.locked) {
          if (G.player.hidden) return;
          G.audio.doorSlam({ x: -212.6, y: 1.2, z: 4.0 }, 0.7);
          fd.close();
          sub('SALMA', S('the door only seals itself when it feels like it. noted: I do not trust this freezer.', 'الباب كيسدد بوحدّو ملي كيبغا. قلح لا عمّو ما ثقتية.'), { dur: 4 });
          break;
        }
        if (fd.isOpen()) { G.audio.doorCreak(false, { x: -212.6, y: 1.2, z: 4 }); fd.close(); }
        else { G.audio.doorCreak(true, { x: -212.6, y: 1.2, z: 4 }, true); fd.open(); this.hook('freezerOpened'); }
        break;
      }
      case 'freezerOpened': {
        if (!F.trappedSeen) {
          F.trappedSeen = true;
          G.audio.startStatic && 0;
          G.ui.subtitle('SALMA', S('the breath you breathe there lands in clouds and crawls off embarrassed.', 'أنفاس كيجي و الضبيةXd سنبعث إعلام مفدّي الحنىن.'), { dur: 4 });
        }
        break;
      }
      case 'cream': {
        if (!F.creamGot) {
          F.creamGot = true;
          G.player.giveItem('cream', { label: S('Oat cream', 'كريم الشوفان') });
          sub('SALMA', S('يعني الإن للإبراز. المهمة على البساط.'), {});
          G.phone.completeTask('cream');
        }
        break;
      }
      case 'carInteract': {
        if (F.driveReady && this.chapter === 0) {
          // leaving home
          this._enterChapter(1);
          F.driveReady = false;
          break;
        }
        if (F.carEscape) { this._carMash(); break; }
        if (this.chapter >= 2 && !F.carEscape) {
          G.audio.latch('locked', { x: -214.6, y: 1, z: -6.2 });
          sub('SALMA', S('locked, like mounir’s schedule. and like i specifically designed for a working woman.', 'مسدودة، كذلك محطات منير. وكاني صممت الشغل من جواطي.'), {});
        }
        break;
      }
      case 'powerChanged': break;
      case 'powerFlipMain': {
        // main back on after blackout → chase
        if (this.flags.blackout && a === true) {
          this.flags.blackout = false;
          this.flags.restored = true;
          G.world.hemi.intensity = 0.4;
          G.effects.vignetteBoost(0.95);
          this.later(0.9, () => this._enterChapter(5));
        }
        break;
      }
      case 'dinerDoorOpen': {
        if (!F.dinerDoorFirst) {
          F.dinerDoorFirst = true;
          sub('SALMA', S('smoke, heat, familiar rattle of the fryer. yep. it’s mine until 3.', 'دخان، دفء، صلية المقلا الي كنستحقوّر. صدق. ديالي حتى الثالثة.'), {});
        }
        break;
      }
    }
  }
}

// server-render helper used in freezer beat
function W_powerDieSlow(W) {
  if (W.hemi) W.hemi.intensity = 0.3;
}
function Phome_uncaught(G) { /* shadow figure present, camera jump happens in Stalker model */ }
