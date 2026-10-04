// ── The PC: desktop OS with Zamazor, OPS, Web, Wallpapers, Virus, Bank ──────
import { PART_CATS, PARTS, partById, FURNITURE, GAMES, CHAT_NAMES, CHAT_MSGS, DONATE_MSGS } from './data.js';
import { fmt, fmtMoney, pick, rand, hourStr } from './util.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
let G = null;               // game ref
let basket = [];
let wallpaper = 0;
const WALLPAPERS = [
  'linear-gradient(160deg,#27407c,#3d6fd8)',
  'linear-gradient(160deg,#1a3a2a,#3f7a3a)',
  'linear-gradient(160deg,#3a1a3a,#b44dff)',
  'linear-gradient(160deg,#402020,#d8452f)',
  'linear-gradient(160deg,#0a2a3a,#37b8a5)',
  'linear-gradient(160deg,#2a2a2a,#6b7280)',
];

window.__showApp = (id) => showApp(id);

export function openPC(game) {
  G = game;
  basket = [];
  $('pcOS').classList.add('on');
  $('pcDesktop').style.background = WALLPAPERS[G.save.wallpaper || 0];
  $('pcClose').onclick = () => G.leavePC();
  $('streamEnd').onclick = () => { if (G.session && !G.session.done) G.session.t = G.session.dur; };
  showApp('ops');
  audio.click();
}

export function closePC() {
  $('pcOS').classList.remove('on');
  audio.back();
}

export function updatePCClock(hour) {
  const el = $('pcClock');
  if (el) el.textContent = hourStr(hour);
}

const APPS = [
  { id: 'computers', name: 'Computers', icon: '💻' },
  { id: 'zamazor', name: 'Zamazor', icon: '🛍️' },
  { id: 'ops', name: 'OPS', icon: '' },
  { id: 'web', name: 'Web', icon: '🌐' },
  { id: 'wall', name: 'Wallpapers', icon: '🖼️' },
  { id: 'virus', name: 'Virus Scanner', icon: '🐞' },
  { id: 'bank', name: 'Bank', icon: '🏦' },
];

export function showApp(id) {
  const body = $('pcWinBody');
  $('pcWinTitle').textContent = APPS.find((a) => a.id === id).name;
  document.querySelectorAll('.taskBtn').forEach((b) => b.classList.toggle('act', b.dataset.app === id));
  audio.click();
  if (id === 'zamazor' || id === 'computers') { zamApp = id; renderZamazor(body); }
  else if (id === 'ops') renderOPS(body);
  else if (id === 'web') renderWeb(body);
  else if (id === 'wall') renderWall(body);
  else if (id === 'virus') renderVirus(body);
  else if (id === 'bank') renderBank(body);
}

// ── Zamazor / Computers shop ──
let zamCat = 'gpu';
let zamApp = 'computers';
function stars(t) { return '★'.repeat(Math.min(5, t)) + '☆'.repeat(Math.max(0, 5 - t)); }

function renderZamazor(body) {
  const HW = ['cpu', 'gpu', 'ram', 'monitor'];
  const catList = zamApp === 'computers' ? PART_CATS.filter((c) => HW.includes(c.id)) : PART_CATS;
  if (zamApp === 'computers' && !HW.includes(zamCat)) zamCat = 'gpu';
  if (zamApp === 'zamazor' && HW.includes(zamCat)) zamCat = 'mic';
  const isFurn = zamApp === 'zamazor' && zamCat === 'furn';
  const items = isFurn ? FURNITURE : (PARTS[zamCat] || []);
  body.innerHTML = `
    <div class="zamWrap">
      <div class="zamCats">
        ${catList.map((c) => `<button class="catBtn ${!isFurn && zamCat === c.id ? 'act' : ''}" data-cat="${c.id}">${c.emoji} ${c.name}</button>`).join('')}
        ${zamApp === 'zamazor' ? `<button class="catBtn ${isFurn ? 'act' : ''}" data-cat="furn">🛋️ Furniture</button>` : ''}
      </div>
      <div class="zamGrid">
        ${items.map((it, i) => {
          const owned = isFurn ? (G.save.furniture.includes(it.id) || Object.values(G.save.placed).some((p) => Object.values(p).includes(it.id))) : G.save.parts[zamCat] >= it.t;
          return `<div class="prodCard">
            <div class="prodImg">${isFurn ? it.emoji : (PART_CATS.find((c) => c.id === zamCat)?.emoji || '⚙️')}</div>
            <div class="prodName">${it.name}</div>
            <div class="prodStars">${isFurn ? '★★★' : stars(it.t + 1)}</div>
            <div class="prodDesc">${it.desc}</div>
            <div class="prodPrice">${fmtMoney(it.price)}</div>
            <button class="addBasket" data-i="${i}" ${owned ? 'disabled' : ''}>${owned ? '✓ owned' : 'Add to basket!'}</button>
          </div>`;
        }).join('')}
      </div>
      <div class="zamCart">
        <div class="cartTitle">🧺 Basket ($${fmt(G.save.money)})</div>
        <div class="cartItems">${basket.length ? basket.map((b, i) => `<div class="cartRow">${b.name} <button data-rm="${i}">✕</button></div>`).join('') : '<i>empty…</i>'}</div>
        <div class="cartTotal">Total: ${fmtMoney(basket.reduce((s, b) => s + b.price, 0))}</div>
        <button class="completeBtn" id="zamBuy">Complete Purchase</button>
        <div class="zamNote">📦 delivery arrives tomorrow</div>
      </div>
    </div>`;
  body.querySelectorAll('.catBtn').forEach((b) => (b.onclick = () => { zamCat = b.dataset.cat; renderZamazor(body); }));
  body.querySelectorAll('.addBasket').forEach((b) => (b.onclick = () => {
    const it = items[+b.dataset.i];
    basket.push(isFurn ? { kind: 'furn', id: it.id, name: it.emoji + ' ' + it.name, price: it.price } : { kind: 'part', cat: zamCat, t: it.t, name: it.name, price: it.price });
    audio.click(); renderZamazor(body);
  }));
  body.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { basket.splice(+b.dataset.rm, 1); renderZamazor(body); }));
  $('zamBuy').onclick = () => {
    const total = basket.reduce((s, b) => s + b.price, 0);
    if (!basket.length) return;
    if (total > G.save.money) { audio.err(); G.toast('⚠️ Not enough money!', true); return; }
    G.save.money -= total;
    basket.forEach((b) => G.save.deliveries.push({ kind: b.kind, id: b.id ?? null, cat: b.cat ?? null, t: b.t ?? null, day: G.save.day + 1 }));
    G.persist(); G.refreshHUD();
    G.toast(`📦 Order placed! Delivery tomorrow (${fmtMoney(total)})`);
    audio.buy();
    basket = [];
    renderZamazor(body);
  };
}

// ── OPS streaming app ──
let opsCfg = { game: 'blocks', quality: '480p', refresh: 15, cat: 'gaming' };
export function pcPowerLabel() {
  return G ? G.power() : 0;
}

function renderOPS(body) {
  const p = G.power();
  const qualities = [
    { id: '480p', need: 0 }, { id: '720p', need: 30 }, { id: '1080p', need: 70 }, { id: '4K', need: 140 },
  ];
  const refreshes = [{ v: 15, need: 0 }, { v: 30, need: 50 }, { v: 60, need: 110 }];
  const bitrate = Math.round(900 + p * 45);
  const soundKbps = [0, 44, 128, 320][G.save.parts.mic] || 0;
  body.innerHTML = `
    <div class="opsWrap">
      <div class="opsCol">
        <div class="opsRow"><span>🔑 Stream key:</span><b class="mono">${G.streamKey}</b></div>
        <div class="opsRow"><span>👤 Nickname:</span><b>${G.save.name}</b></div>
        <div class="opsRow"><span>📶 Bitrate:</span><b class="mono">${bitrate} kbps</b></div>
        <div class="opsRow"><span>🖥️ PC power:</span><b class="mono">${p}</b></div>
        <div class="opsRow"><span>Category:</span>
          <select id="opsCat"><option value="gaming" ${opsCfg.cat === 'gaming' ? 'selected' : ''}>GAMING</option><option value="chat" ${opsCfg.cat === 'chat' ? 'selected' : ''}>JUST CHATTING</option></select>
        </div>
        <div class="opsRow" id="opsGameRow" style="${opsCfg.cat === 'chat' ? 'display:none' : ''}"><span>🎮 Game:</span>
          <select id="opsGame">${GAMES.map((g) => `<option value="${g.id}" ${G.canStreamGame(g) ? '' : 'disabled'}>${g.emoji} ${g.name}${G.canStreamGame(g) ? '' : ` (🔒 ${g.minPower}⚡/${fmt(g.minFol)} fol)`}</option>`).join('')}</select>
        </div>
        <div class="opsRow"><span>🎚️ Quality:</span>
          <select id="opsQ">${qualities.map((q) => `<option value="${q.id}" ${p >= q.need ? '' : 'disabled'}>${q.id}${p >= q.need ? '' : ` (🔒 ${q.need}⚡)`}</option>`).join('')}</select>
        </div>
        <div class="opsRow"><span> Refresh:</span>
          <select id="opsR">${refreshes.map((q) => `<option value="${q.v}" ${p >= q.need ? '' : 'disabled'}>${q.v} FPS${p >= q.need ? '' : ` (🔒 ${q.need}⚡)`}</option>`).join('')}</select>
        </div>
        <div class="opsRow"><span>🔊 Sound:</span><b class="mono">${soundKbps} kbps</b></div>
      </div>
      <div class="opsRight">
        <div class="opsPrev">🎥<br><span>${G.save.parts.webcam ? 'face-cam ON' : 'no webcam'}</span></div>
        <button class="goLive" id="goLive">● GO LIVE</button>
        <div class="opsHint">${G.save.parts.mic ? '' : '⚠️ You need a microphone to stream!'}</div>
      </div>
    </div>`;
  $('opsCat').onchange = (e) => { opsCfg.cat = e.target.value; $('opsGameRow').style.display = opsCfg.cat === 'chat' ? 'none' : ''; };
  $('goLive').onclick = () => {
    if (!G.canStream()) return;
    opsCfg.game = $('opsGame').value;
    opsCfg.quality = $('opsQ').value;
    opsCfg.refresh = +$('opsR').value;
    startStream(opsCfg);
  };
}

// ── STREAM SESSION ──
export class StreamSession {
  constructor(cfg) {
    this.cfg = cfg;
    this.t = 0;
    this.dur = 45;
    this.viewers = 0;
    this.peak = 0;
    this.vSum = 0;
    this.money = 0;
    this.followers = 0;
    this.donations = 0;
    this.chatT = 0;
    this.donT = 4;
    this.viral = Math.random() < 0.07;
    const g = GAMES.find((x) => x.id === cfg.game);
    this.hype = cfg.cat === 'chat' ? 0.9 : (g ? g.hype : 1);
    this.reward = cfg.cat === 'chat' ? 0.9 : (g ? g.reward : 1);
    const qm = { '480p': 0.8, '720p': 1.0, '1080p': 1.25, '4K': 1.55 }[cfg.quality];
    const rm = { 15: 0.9, 30: 1.05, 60: 1.2 }[cfg.refresh];
    const collab = G.partnerNear(25) > 0 ? 1.5 : 1;
    this.collab = collab;
    const powerMult = 0.72 + G.power() / 230 + G.vibe() / 90 + G.save.skill * 0.025;
    const base = 3 + Math.pow(Math.max(0, G.save.followers), 0.78);
    this.peak = Math.max(2, base * this.hype * qm * rm * powerMult * collab * (0.85 + Math.random() * 0.35) * (this.viral ? 3 : 1));
    $('streamUI').classList.add('on');
    $('streamChat').innerHTML = '';
    $('streamViral').style.display = this.viral ? '' : 'none';
    if (collab > 1) G.toast('🤝 CO-OP STREAM x1.5 — your friend is nearby!');
    audio.live();
    G.mp?.sendEvent({ t: 'stream', on: true });
  }
  update(dt) {
    this.t += dt;
    const prog = this.t / this.dur;
    const target = this.peak * (0.35 + 0.75 * Math.sin(Math.min(1, prog * 1.15) * Math.PI * 0.62)) * (0.9 + Math.random() * 0.2);
    this.viewers += (target - this.viewers) * Math.min(1, dt * 1.4);
    this.viewers = Math.max(0, this.viewers);
    this.vSum += this.viewers * dt;
    $('streamViewers').textContent = fmt(this.viewers);
    $('streamTimer').style.width = (prog * 100) + '%';
    $('streamGame').textContent = this.cfg.cat === 'chat' ? '💬 Just Chatting' : (GAMES.find((g) => g.id === this.cfg.game)?.emoji || '') + ' ' + (GAMES.find((g) => g.id === this.cfg.game)?.name || '');
    // chat
    this.chatT -= dt;
    if (this.chatT <= 0) {
      this.chatT = Math.max(0.12, 1.4 - Math.log10(this.viewers + 10) * 0.4) * (0.5 + Math.random());
      pushChat(pick(Math.random, CHAT_NAMES), pick(Math.random, CHAT_MSGS));
    }
    // donations
    this.donT -= dt;
    if (this.donT <= 0) {
      this.donT = 5 + Math.random() * 9 - Math.min(4, this.viewers / 400);
      const amt = Math.max(1, Math.ceil(rand(Math.random, 2, 6 + this.viewers * 0.06)));
      this.money += amt; this.donations += amt;
      donatePop(pick(Math.random, CHAT_NAMES), amt, pick(Math.random, DONATE_MSGS));
      audio.donate();
    }
    if (this.t >= this.dur) this.finish();
  }
  finish() {
    const avg = this.vSum / Math.max(1, this.t);
    const folGain = Math.round((avg * 1.15 + rand(Math.random, 4, 10)) * (this.viral ? 6 : 1) * this.hype);
    const ads = avg * 0.9 * this.reward * G.incomeMult();
    this.money += ads;
    this.followers = folGain;
    // apply
    G.addMoney(Math.round(this.money));
    G.addFollowers(folGain);
    G.addXp(Math.round(12 + avg * 0.25));
    G.save.energy = Math.max(0, G.save.energy - 24);
    G.save.hunger = Math.max(0, G.save.hunger - 8);
    G.save.streams++;
    G.save.skill = Math.min(12, G.save.skill + 0.12);
    G.save.donations += Math.round(this.donations);
    G.persist(); G.refreshHUD(); G.questCheck();
    // results
    $('streamResults').innerHTML = `
      <div class="resTitle">STREAM COMPLETE ${this.viral ? '🚀 VIRAL!' : ''}</div>
      <div class="resRow">👥 peak viewers <b>${fmt(this.peak)}</b></div>
      <div class="resRow">➕ followers <b>+${fmt(folGain)}</b></div>
      <div class="resRow">💰 earned <b>${fmtMoney(this.money)}</b> <span class="dim">(incl. ${fmtMoney(this.donations)} donations)</span></div>
      <div class="resRow">⭐ xp <b>+${Math.round(12 + avg * 0.25)}</b></div>
      <button class="completeBtn" id="resClose">NICE</button>`;
    $('streamResults').classList.add('on');
    $('resClose').onclick = () => {
      $('streamResults').classList.remove('on');
      $('streamUI').classList.remove('on');
      G.endStreamLock();
    };
    G.mp?.sendEvent({ t: 'stream', on: false });
    this.done = true;
  }
}

function pushChat(name, msg) {
  const el = document.createElement('div');
  el.className = 'chatLine';
  el.innerHTML = `<span class="chatName">${name}</span> ${msg}`;
  const box = $('streamChat');
  box.appendChild(el);
  while (box.children.length > 26) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}
function donatePop(name, amt, msg) {
  const el = document.createElement('div');
  el.className = 'donatePop';
  el.innerHTML = `💸 <b>${name}</b> donated <b>$${amt}</b> — “${msg}”`;
  $('streamPops').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function startStream(cfg) {
  closePC();
  G.lockPlayerForStream();
  G.session = new StreamSession(cfg);
}

// ── Web ──
function renderWeb(body) {
  const canChirp = G.save.lastChirpDay < G.save.day;
  body.innerHTML = `
    <div class="webWrap">
      <div class="webBar">🌐 <span class="mono">weeb://www.chirp.com/home</span></div>
      <div class="webPage">
        <h3>🐦 chirp — what's happening?</h3>
        <div class="newsBox">${[
          '📰 Local streamer seen buying RGB. Neighbors "concerned".',
          '📰 Cedar Creek lake monster still just a log, experts confirm.',
          '📰 Homestead Foods noodles on sale. Again.',
          '📰 Yellow van parked on Main St for 3rd year. "It\'s vintage now," says owner.',
        ][G.save.day % 4]}</div>
        <textarea id="chirpText" placeholder="Post something for your followers…">${['Just bought new gear!! 🔥', 'Stream later today, chat 🫡', 'Cedar Creek supremacy 🌲', 'Road to 1M followers!! 🚀'][G.save.day % 4]}</textarea>
        <button class="completeBtn" id="chirpBtn" ${canChirp ? '' : 'disabled'}>${canChirp ? 'Post to chirp 📢' : 'Posted today already ✔'}</button>
        <div class="dim small">A good post gains ~${fmt(Math.max(3, G.save.followers * 0.03))} followers. Once per day.</div>
      </div>
    </div>`;
  $('chirpBtn').onclick = () => {
    if (G.save.lastChirpDay >= G.save.day) return;
    G.save.lastChirpDay = G.save.day;
    const gain = Math.round(Math.max(3, G.save.followers * 0.03) * (0.7 + Math.random() * 0.6));
    G.addFollowers(gain);
    G.persist(); G.refreshHUD(); G.questCheck();
    G.toast(`🐦 Your post is trending! +${fmt(gain)} followers`);
    audio.fan();
    renderWeb(body);
  };
}

// ── Wallpapers ──
function renderWall(body) {
  body.innerHTML = `<div class="wallWrap">${WALLPAPERS.map((w, i) => `<div class="wallPrev ${i === (G.save.wallpaper || 0) ? 'act' : ''}" data-w="${i}" style="background:${w}"></div>`).join('')}</div>`;
  body.querySelectorAll('.wallPrev').forEach((el) => (el.onclick = () => {
    G.save.wallpaper = +el.dataset.w;
    G.persist();
    $('pcDesktop').style.background = WALLPAPERS[G.save.wallpaper];
    audio.click();
    renderWall(body);
  }));
}

// ── Virus Scanner ──
function renderVirus(body) {
  body.innerHTML = `
    <div class="virusWrap">
      <h3>Virus Scanner Premium™</h3>
      <div class="scanRing" id="scanRing"><span id="scanPct">—</span></div>
      <div id="scanMsg">Your PC is probably fine. Probably.</div>
      <button class="completeBtn" id="scanBtn">START SCANNING</button>
      ${G.save.virusPremium ? '<div class="premTag">👑 PREMIUM ACTIVE</div>' : '<button class="premBtn" id="premBtn">👑 $50 BUY PREMIUM</button>'}
    </div>`;
  $('scanBtn').onclick = () => {
    let p = 0;
    const iv = setInterval(() => {
      p += 2 + Math.random() * 4;
      if (p >= 100) {
        clearInterval(iv);
        $('scanPct').textContent = '100%';
        $('scanRing').style.background = `conic-gradient(#4aa34a 100%, #222 0)`;
        $('scanMsg').innerHTML = '✅ 0 viruses found. Your biggest threat is your GPU temperatures.';
        audio.buy();
      } else {
        $('scanPct').textContent = Math.floor(p) + '%';
        $('scanRing').style.background = `conic-gradient(#3f7fd8 ${p}%, #222 0)`;
      }
    }, 60);
  };
  const pb = $('premBtn');
  if (pb) pb.onclick = () => {
    if (!G.spend(50)) { audio.err(); G.toast('⚠️ Not enough money!', true); return; }
    G.save.virusPremium = true;
    G.persist(); G.refreshHUD();
    G.mail('Virus Scanner Premium', 'Thank you for $50. You now have a crown icon. That\'s it. That\'s the product. 👑');
    G.toast('👑 Premium acquired (it does nothing)');
    audio.buy();
    renderVirus(body);
  };
}

// ── Bank ──
function renderBank(body) {
  const s = G.save;
  body.innerHTML = `
    <div class="bankWrap">
      <div class="bankBal">${fmtMoney(s.money)}</div>
      <div class="opsRow"><span>👥 Followers</span><b>${fmt(s.followers)}</b></div>
      <div class="opsRow"><span>🎥 Streams done</span><b>${s.streams}</b></div>
      <div class="opsRow"><span>💵 Total earned</span><b>${fmtMoney(s.totalEarned)}</b></div>
      <div class="opsRow"><span>💸 Donations</span><b>${fmtMoney(s.donations)}</b></div>
      <div class="opsRow"><span>🤝 Sponsor</span><b>${s.sponsor ? s.sponsorName : '— none —'}</b></div>
      <div class="opsRow"><span>🏠 Property</span><b>${s.ownedHouses.length}/5</b></div>
      <div class="opsRow"><span>🚗 Cars</span><b>${s.cars.length}</b></div>
      <div class="dim small">💡 Tip: work shifts at Homestead Foods pay $60. Supermarket is on Main St.</div>
    </div>`;
}
