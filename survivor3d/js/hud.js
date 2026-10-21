import { G, profile, TIERS } from './state.js';
import { clamp, fmtTime } from './util.js';
import { damageNumber } from './fx.js';
import { sfx } from './audio.js';

// ══════════════════════════════════════════════════════════════
//  HUD — DOM overlay: bars, ammo, minimap, kill feed, banners,
//  prompts, results. Text nodes are cached and only touched when
//  the value actually changes (cheap on weak CPUs).
// ══════════════════════════════════════════════════════════════

const $ = (id) => document.getElementById(id);
const el = {};
let last = {};
let kfItems = [];
let toastT = 0;
let minimapCtx = null;

export function initHUD() {
  ['alive', 'kills', 'zoneT', 'zoneChip', 'hpFill', 'hpTxt', 'arFill', 'arTxt', 'wpnName', 'ammo',
    'reloadWrap', 'reloadFill', 'itMed', 'itNar', 'hud', 'touch', 'banner', 'prompt', 'killfeed',
    'minimap', 'vig', 'hitmark', 'btnPause', 'menu', 'how', 'pause', 'result', 'loading', 'ldFill',
    'ldTxt', 'stats', 'qHint', 'perfNote', 'rBadge', 'rTitle', 'rSub', 'rKills', 'rDmg', 'rTime',
    'rCoins', 'rBest', 'errLog'].forEach((k) => { el[k] = $(k); });
  minimapCtx = el.minimap ? el.minimap.getContext('2d') : null;
  G.ui = {
    hitmark: el.hitmark,
    damageNumber: (p, d, c) => damageNumber(p, d, c),
    killFeed, toast, banner, vig, chatter,
    sfx: (n, v, p) => sfx(n, v, p),
    setPhase, equipGun,
  };
}

function set(node, key, val) {
  if (last[key] === val) return;
  last[key] = val;
  if (node) node.textContent = val;
}

// ── screens ────────────────────────────────────────────────────
export function showScreen(name) {
  ['menu', 'how', 'pause', 'result'].forEach((s) => {
    if (el[s]) el[s].classList.toggle('hide', s !== name);
  });
  if (name) el.loading.classList.add('hide');
}
export function hideScreens() {
  ['menu', 'how', 'pause', 'result'].forEach((s) => el[s] && el[s].classList.add('hide'));
}
export function setPhase(p) {
  const on = p === 'drop' || p === 'play';
  el.hud.classList.toggle('on', on);
  el.touch.classList.toggle('on', on);
}

export function setLoad(pct, txt) {
  if (el.ldFill) el.ldFill.style.width = clamp(pct, 0, 100) + '%';
  if (txt) set(el.ldTxt, 'ldtxt', txt);
}
export function hideLoading() { el.loading.classList.add('hide'); }

// ── per-frame HUD ──────────────────────────────────────────────
export function updateHUD(dt) {
  const p = G.player;
  if (!p) return;
  set(el.alive, 'alive', String(G.aliveCount));
  set(el.kills, 'kills', String(G.stats.kills));

  const zt = G.zone;
  const label = zt.shrinking ? '⚠ KAT9LLAS' : fmtTime(zt.timer);
  set(el.zoneT, 'zoneT', label);
  el.zoneChip.classList.toggle('warn', zt.shrinking || zt.timer < 6);

  const hp = Math.max(0, p.hp);
  el.hpFill.style.transform = `scaleX(${hp / 100})`;
  set(el.hpTxt, 'hpTxt', Math.round(hp) + ' HP');
  const ar = Math.max(0, p.armor);
  el.arFill.style.transform = `scaleX(${ar / 100})`;
  set(el.arTxt, 'arTxt', Math.round(ar) + ' ARMOR');

  const g = p.gun;
  set(el.wpnName, 'wpnName', g.name);
  if (g.melee) set(el.ammo, 'ammo', '∞');
  else el.ammo.innerHTML = `${p.mag}<small> / ${p.reserve[g.id] || 0}</small>`;
  last.ammo = el.ammo.innerHTML;

  const rl = p.reloading > 0;
  el.reloadWrap.classList.toggle('on', rl);
  if (rl) el.reloadFill.style.width = (100 - (p.reloading / g.reload) * 100) + '%';

  el.itMed.classList.toggle('off', p.meds <= 0);
  el.itMed.querySelector('b').textContent = p.meds;
  el.itNar.classList.toggle('off', p.nars <= 0);
  el.itNar.querySelector('b').textContent = p.nars;

  // pickup prompt
  const near = G.ui._nearLoot;
  if (near && !near.taken) {
    let txt = '';
    if (near.kind === 'gun') txt = `🎒 ${near.label}`;
    else if (near.kind === 'ammo') txt = `🎒 ذخيرة +${near.amount}`;
    else if (near.kind === 'med') txt = `🎒 🩹 medkit`;
    else if (near.kind === 'armor') txt = `🎒 🛡 armor +${near.amount}`;
    else if (near.kind === 'nar') txt = `🎒 💥 grenade`;
    else txt = `🎒 🪙 +${near.amount}`;
    set(el.prompt, 'prompt', txt + (G.ui.touch ? '   [🎒 PICK]' : '   [F]'));
    el.prompt.classList.add('on');
  } else { el.prompt.classList.remove('on'); last.prompt = null; }

  // toast fade
  if (toastT > 0) {
    toastT -= dt;
    if (toastT <= 0) el.banner.style.opacity = '';
  }
  // kill feed pruning
  const now = performance.now();
  kfItems = kfItems.filter((k) => {
    if (now - k.t > 4600) { k.el.remove(); return false; }
    return true;
  });

  drawMinimap();
}

// ── kill feed ──────────────────────────────────────────────────
function killFeed(killer, victim, headshot, gunName) {
  if (!el.killfeed) return;
  const d = document.createElement('div');
  d.className = 'kf';
  d.innerHTML = `<span style="color:${killer === 'NTA' ? '#ffd45e' : '#ffb3a0'}">${killer}</span>` +
    ` <span style="opacity:.65">${headshot ? '🎯' : gunName ? gunName.split(' ')[0] : '💀'}</span> ` +
    `<span style="color:${victim === 'NTA' ? '#ffd45e' : '#cfe0c6'}">${victim}</span>`;
  el.killfeed.appendChild(d);
  kfItems.push({ el: d, t: performance.now() });
  while (kfItems.length > 4) { const k = kfItems.shift(); k.el.remove(); }
}

// ── banner / toast / chatter ───────────────────────────────────
function banner(txt) {
  if (!el.banner) return;
  el.banner.textContent = txt;
  el.banner.classList.remove('on');
  void el.banner.offsetWidth;
  el.banner.classList.add('on');
}
function toast(txt) {
  banner(txt);
  toastT = 1.5;
}
let chatT = 0;
function chatter(name, txt) {
  if (performance.now() - chatT < 2200) return;
  chatT = performance.now();
  const d = document.createElement('div');
  d.className = 'kf';
  d.style.borderLeftColor = '#7fd3ff';
  d.innerHTML = `<span style="color:#9fd8ff">${name}:</span> ${txt}`;
  el.killfeed.appendChild(d);
  kfItems.push({ el: d, t: performance.now() });
}

function vig(on) { el.vig && el.vig.classList.toggle('on', !!on); }
function equipGun() { /* meshes are handled in entities */ }

// ── minimap ────────────────────────────────────────────────────
let mmT = 0;
function drawMinimap() {
  if (!minimapCtx) return;
  // 12 fps is plenty for a minimap
  if (performance.now() - mmT < 82) return;
  mmT = performance.now();
  const c = minimapCtx, S = el.minimap.width, R = 124, sc = (S / 2) / R;
  const p = G.player;
  c.clearRect(0, 0, S, S);
  // background
  c.fillStyle = '#16210f';
  c.fillRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;

  c.save();
  c.translate(cx, cy);
  c.rotate(-(p.yaw || 0));

  // island
  c.beginPath(); c.arc(0, 0, 116 * sc, 0, 6.2832);
  c.fillStyle = '#3d5a26'; c.fill();
  // water edge
  c.lineWidth = 3; c.strokeStyle = '#1d4f6b'; c.stroke();

  // buildings
  c.fillStyle = '#c9bda4';
  for (const b of G.world.buildings) {
    const x = (b.x - p.pos.x) * sc, z = (b.z - p.pos.z) * sc;
    if (Math.abs(x) > S / 2 + 8 || Math.abs(z) > S / 2 + 8) continue;
    c.fillRect(x - Math.max(1.5, b.w * sc * 0.5), z - Math.max(1.5, b.d * sc * 0.5), Math.max(3, b.w * sc), Math.max(3, b.d * sc));
  }
  // loot
  c.fillStyle = '#ffd45e';
  for (const it of G.pickups) {
    if (it.taken) continue;
    const x = (it.x - p.pos.x) * sc, z = (it.z - p.pos.z) * sc;
    if (Math.abs(x) > S / 2 || Math.abs(z) > S / 2) continue;
    c.fillRect(x - 1, z - 1, 2, 2);
  }
  // bots (only ones who recently fired / are close — no wallhack)
  for (const b of G.bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
    const show = d < 26 || (b._seenAt && performance.now() - b._seenAt < 2600);
    if (!show) continue;
    const x = (b.pos.x - p.pos.x) * sc, z = (b.pos.z - p.pos.z) * sc;
    c.beginPath(); c.arc(x, z, 2.6, 0, 6.2832);
    c.fillStyle = '#ff5a4a'; c.fill();
  }
  // zone
  const zx = (G.zone.x - p.pos.x) * sc, zz = (G.zone.z - p.pos.z) * sc;
  c.beginPath(); c.arc(zx, zz, G.zone.r * sc, 0, 6.2832);
  c.strokeStyle = '#7fd3ff'; c.lineWidth = 2; c.stroke();
  c.save();
  c.beginPath(); c.rect(-S, -S, S * 2, S * 2); c.arc(zx, zz, G.zone.r * sc, 0, 6.2832, true);
  c.fillStyle = 'rgba(90,20,20,.34)'; c.fill();
  c.restore();
  // next zone
  if (G.zone.tx !== undefined && G.zone.tr < G.zone.r) {
    c.beginPath();
    c.arc((G.zone.tx - p.pos.x) * sc, (G.zone.tz - p.pos.z) * sc, G.zone.tr * sc, 0, 6.2832);
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.2; c.setLineDash([3, 3]); c.stroke();
    c.setLineDash([]);
  }
  c.restore();

  // player arrow (always centre, always up)
  c.beginPath();
  c.moveTo(cx, cy - 5.5); c.lineTo(cx - 4, cy + 4.5); c.lineTo(cx, cy + 2); c.lineTo(cx + 4, cy + 4.5);
  c.closePath();
  c.fillStyle = '#fff'; c.fill();
  c.strokeStyle = '#000a'; c.lineWidth = 1; c.stroke();
}

// ── menu / stats ───────────────────────────────────────────────
export function renderStats() {
  if (!el.stats) return;
  const p = profile;
  el.stats.innerHTML = [
    ['🎮 Matches', p.matches],
    ['🏆 Wins', p.wins],
    ['🥇 Best place', '#' + p.bestPlace],
    ['☠ Total kills', p.totalKills],
    ['🔥 Best kills (match)', p.bestKills],
    ['🪙 Coins', p.coins],
  ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
}

export function renderQualityHint() {
  if (el.qHint) el.qHint.textContent = TIERS[G.tier].hint;
  if (el.perfNote) {
    el.perfNote.textContent = G.autoTune
      ? `Auto-tune ON · ${Math.round(G.fps)} fps · render ${(G.renderScale * 100) | 0}% · ${TIERS[G.tier].name}`
      : `${Math.round(G.fps)} fps · ${TIERS[G.tier].name}`;
  }
}

// ── results ────────────────────────────────────────────────────
export function showResult(o) {
  set(el.rBadge, 'rBadge', o.badge);
  set(el.rTitle, 'rTitle', o.title);
  set(el.rSub, 'rSub', o.sub);
  set(el.rKills, 'rKills', String(o.kills));
  set(el.rDmg, 'rDmg', String(Math.round(o.damage)));
  set(el.rTime, 'rTime', fmtTime(o.time));
  set(el.rCoins, 'rCoins', '+' + o.coins);
  set(el.rBest, 'rBest', '#' + profile.bestPlace);
  showScreen('result');
  setPhase('none');
}
