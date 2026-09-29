// ─────────────────────────────────────────────────────────────────────────────
//  profile.js — the player record
//
//  Offline this lives in localStorage and is clearly labelled as such. When a
//  game server is connected, the SAME object shape is pushed to it and the
//  server becomes the authority: `Profile.hydrate()` replaces the local copy
//  and `Profile.remote` flips to true, after which every coin/XP change goes
//  through the server round-trip instead of being written locally.
// ─────────────────────────────────────────────────────────────────────────────
import { LEVELS } from './ai.js';

const KEY = 'neurio.pool.profile.v1';

export const TITLES = [
  'Rookie', 'Hustler', 'Rack Runner', 'Chalk Hand', 'Corner Cutter', 'Rail Wizard',
  'Table Runner', 'Sharpshooter', 'Hall Legend', 'Pocket King', 'Grand Master',
];

export const CUE_CATALOG = [
  { id: 'house', name: 'House Cue', price: 0, rarity: 'common', tip: 'standard', shaft: '#c9a26a', wrap: '#3b2a1c', butt: '#6b4a2a', bonus: 'none', desc: 'The cue that hangs by the door. Honest, straight, unloved.' },
  { id: 'maple', name: 'Maple Classic', price: 900, rarity: 'common', tip: 'laminated', shaft: '#e8d3a8', wrap: '#2b2b33', butt: '#a8763c', bonus: '+1% power consistency', desc: 'Plain maple, hand-turned. Nothing fancy, nothing to fix.' },
  { id: 'onyx', name: 'Onyx Night', price: 2400, rarity: 'rare', tip: 'laminated', shaft: '#2a2d33', wrap: '#101318', butt: '#171a20', bonus: 'Quieter stroke audio', desc: 'Blackened ash with a smoked ferrule. Looks like it means it.' },
  { id: 'ivory', name: 'Ivory Sneak', price: 5200, rarity: 'rare', tip: 'leather pro', shaft: '#f3ead7', wrap: '#7a2b2b', butt: '#d9c39a', bonus: '+2% english hold', desc: 'Tournament-grade sneaky pete. Light in the hand, heavy on the table.' },
  { id: 'dragon', name: 'Dragon Scale', price: 12000, rarity: 'epic', tip: 'leather pro', shaft: '#20323a', wrap: '#0d1b21', butt: '#1d5c4a', bonus: 'Scale shimmer finish', desc: 'Lacquered in overlapping green scales that catch the lamp light.' },
  { id: 'aurum', name: 'Aurum 24', price: 28000, rarity: 'legendary', tip: 'phenolic break', shaft: '#3a2c14', wrap: '#1a1206', butt: '#c9a227', bonus: 'Gold inlay rings', desc: 'Twenty-four carat inlay rings. Purely cosmetic — the physics are identical.' },
];

const DEFAULT_SETTINGS = {
  quality: 'auto',          // low | medium | high | ultra | auto
  resolution: 1,            // render-scale multiplier
  vsync: true,
  fullscreen: false,
  bloom: true,
  shadows: true,
  guides: 2,                // 0 none · 1 basic · 2 standard · 3 pro assist
  guideRail: true,
  sound: true,
  music: true,
  volume: 0.7,
  sfxVolume: 0.85,
  spatialAudio: true,
  sensitivity: 1,
  invertLook: false,
  leftHanded: false,
  fastForward: true,
  showFps: true,
  shotClock: true,
  tableFinish: 'tournament', // tournament | bar | vintage
  clothColor: 'blue',        // blue | green | red | graphite
  camera: 'aim',
};

function freshProfile(name) {
  return {
    v: 1,
    id: 'local-' + Math.random().toString(36).slice(2, 10),
    name: name || 'Guest',
    guest: true,
    avatar: '🎱',
    level: 1,
    xp: 0,
    wallet: { free: 500, bought: 0, bonus: 250 },
    ledger: [],
    cues: ['house'],
    equipped: 'house',
    stats: { played: 0, won: 0, lost: 0, potted: 0, shots: 0, bestRun: 0, run: 0, fouls: 0, breaks: 0, eightWins: 0, longestPot: 0, playTime: 0 },
    history: [],
    daily: { last: 0, streak: 0, claimed: [] },
    settings: { ...DEFAULT_SETTINGS },
    friends: [],
    inbox: [],
    loans: { given: [], taken: [], cooldownUntil: 0 },
    unlocked: { zones: ['main', 'practice'], cues: ['house'] },
    created: Date.now(),
  };
}

let me = null;
let remote = false;
let onWalletChange = () => {};
let dirty = false;

export const Profile = {
  get me() { return me; },
  get remote() { return remote; },
  get settings() { return me.settings; },
  get total() { return me.wallet.free + me.wallet.bought + me.wallet.bonus; },

  onChange(fn) { onWalletChange = fn; },

  load(name) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        me = { ...freshProfile(p.name), ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings || {}) }, stats: { ...freshProfile().stats, ...(p.stats || {}) }, wallet: { ...freshProfile().wallet, ...(p.wallet || {}) } };
        return me;
      }
    } catch (e) { /* a corrupt save is not worth crashing over */ }
    me = freshProfile(name);
    this.save();
    return me;
  },

  save() {
    if (remote || !me) return;
    try { localStorage.setItem(KEY, JSON.stringify(me)); } catch (e) { /* private mode */ }
    dirty = false;
  },

  wipe() { try { localStorage.removeItem(KEY); } catch (e) {} me = freshProfile('Guest'); this.save(); },

  /** the server sent us the authoritative copy */
  hydrate(serverProfile) {
    me = { ...freshProfile(serverProfile.name), ...serverProfile, settings: { ...DEFAULT_SETTINGS, ...(serverProfile.settings || {}) } };
    remote = true;
    onWalletChange('sync');
    return me;
  },

  rename(name) {
    me.name = String(name || '').slice(0, 16) || me.name;
    this.save(); onWalletChange('name');
  },
  setAvatar(a) { me.avatar = a; this.save(); onWalletChange('avatar'); },

  // ── coins. FREE (earned), BOUGHT (real money) and BONUS (packs/events) are
  //    kept strictly separate and every movement is written to the ledger.
  addCoins(kind, amount, reason) {
    amount = Math.max(0, Math.round(amount));
    if (!amount) return 0;
    if (!(kind in me.wallet)) return 0;
    me.wallet[kind] += amount;
    this.ledger(+amount, kind, reason);
    dirty = true; this.save(); onWalletChange('add');
    return amount;
  },
  /** spend from bonus first, then free, then bought — bought coins last, always */
  spend(amount, reason) {
    amount = Math.round(amount);
    if (amount <= 0) return true;
    if (this.total < amount) return false;
    let left = amount;
    for (const kind of ['bonus', 'free', 'bought']) {
      const take = Math.min(left, me.wallet[kind]);
      if (take > 0) { me.wallet[kind] -= take; this.ledger(-take, kind, reason); left -= take; }
    }
    dirty = true; this.save(); onWalletChange('spend');
    return left === 0;
  },
  ledger(amount, kind, reason) {
    me.ledger.unshift({ t: Date.now(), amount, kind, reason: reason || '' });
    if (me.ledger.length > 200) me.ledger.length = 200;
  },

  // ── progression ───────────────────────────────────────────────────────────
  xpForLevel(l) { return Math.round(320 * Math.pow(l, 1.42)); },
  levelFromXp(xp) {
    let l = 1, acc = 0;
    while (l < 200) { const need = this.xpForLevel(l); if (xp < acc + need) break; acc += need; l++; }
    return { level: l, into: xp - acc, need: this.xpForLevel(l) };
  },
  addXp(n, reason) {
    n = Math.max(0, Math.round(n));
    const before = this.levelFromXp(me.xp).level;
    me.xp += n;
    const after = this.levelFromXp(me.xp);
    me.level = after.level;
    dirty = true; this.save();
    onWalletChange('xp');
    return { gained: n, leveledUp: after.level > before, level: after.level, reason };
  },
  get title() { return TITLES[Math.min(TITLES.length - 1, Math.floor((me.level - 1) / 4))]; },

  // ── cues (cosmetic only — the physics never reads this) ───────────────────
  cue(id) { return CUE_CATALOG.find((c) => c.id === id) || CUE_CATALOG[0]; },
  ownsCue(id) { return me.cues.includes(id); },
  buyCue(id) {
    const c = this.cue(id);
    if (this.ownsCue(id)) return { ok: false, why: 'already owned' };
    if (!this.spend(c.price, `bought ${c.name}`)) return { ok: false, why: 'not enough coins' };
    me.cues.push(id); me.unlocked.cues.push(id);
    this.addXp(Math.round(c.price / 40), 'new cue');
    this.save(); onWalletChange('cue');
    return { ok: true, cue: c };
  },
  equipCue(id) {
    if (!this.ownsCue(id)) return false;
    me.equipped = id; this.save(); onWalletChange('equip');
    return true;
  },

  // ── settings ──────────────────────────────────────────────────────────────
  set(key, value) {
    me.settings[key] = value;
    dirty = true; this.save(); onWalletChange('settings');
  },

  // ── stats & history ───────────────────────────────────────────────────────
  recordMatch(outcome, detail = {}) {
    me.stats.played++;
    if (outcome === 'win') { me.stats.won++; me.stats.run++; me.stats.bestRun = Math.max(me.stats.bestRun, me.stats.run); }
    else { me.stats.lost++; me.stats.run = 0; }
    me.stats.potted += detail.potted || 0;
    me.stats.shots += detail.shots || 0;
    me.stats.fouls += detail.fouls || 0;
    if (detail.eightWin) me.stats.eightWins++;
    me.history.unshift({
      t: Date.now(), mode: detail.mode || '8-ball', opponent: detail.opponent || '—',
      outcome, coins: detail.coins || 0, xp: detail.xp || 0, shots: detail.shots || 0, potted: detail.potted || 0,
    });
    if (me.history.length > 60) me.history.length = 60;
    dirty = true; this.save();
  },

  // ── daily reward ──────────────────────────────────────────────────────────
  dailyAvailable() {
    const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return me.daily.last !== today;
  },
  claimDaily() {
    if (!this.dailyAvailable()) return null;
    const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    me.daily.streak = me.daily.last === yesterday ? me.daily.streak + 1 : 1;
    me.daily.last = today;
    const day = ((me.daily.streak - 1) % 7) + 1;
    const table = [100, 150, 250, 400, 600, 900, 1500];
    const coins = table[day - 1];
    this.addCoins('free', coins, `daily reward day ${day}`);
    this.addXp(40 + day * 10, 'daily reward');
    this.save();
    return { day, coins, streak: me.daily.streak };
  },

  // ── friends (local/offline copy — the server owns the real list) ──────────
  addFriend(name) {
    const n = String(name || '').trim().slice(0, 16);
    if (!n) return { ok: false, why: 'empty name' };
    if (me.friends.some((f) => f.name.toLowerCase() === n.toLowerCase())) return { ok: false, why: 'already on your list' };
    me.friends.push({ name: n, avatar: '🎱', online: false, coins: 0, added: Date.now(), note: 'offline entry' });
    this.save(); onWalletChange('friends');
    return { ok: true };
  },
  removeFriend(name) { me.friends = me.friends.filter((f) => f.name !== name); this.save(); onWalletChange('friends'); },

  /**
   * Ask a friend for coins when you are broke. Offline this is a local, rate
   * limited request against your own friend list; on the server it becomes a
   * validated transfer with per-day limits and a cooldown (see server/economy).
   */
  askFriendLoan(friendName, amount) {
    if (this.total > 0) return { ok: false, why: 'you still have coins — loans are for 0' };
    if (me.loans.cooldownUntil > Date.now()) {
      const mins = Math.ceil((me.loans.cooldownUntil - Date.now()) / 60000);
      return { ok: false, why: `loan cooldown: ${mins} min left` };
    }
    const f = me.friends.find((x) => x.name === friendName);
    if (!f) return { ok: false, why: 'no such friend' };
    const takenToday = me.loans.taken.filter((l) => Date.now() - l.t < 86400000);
    if (takenToday.length >= 3) return { ok: false, why: 'daily loan limit reached (3)' };
    const amt = Math.min(Math.max(50, Math.round(amount)), 250);
    me.loans.taken.push({ t: Date.now(), from: f.name, amount: amt });
    me.loans.cooldownUntil = Date.now() + 20 * 60000;
    this.addCoins('bonus', amt, `loan from ${f.name}`);
    this.save();
    return { ok: true, amount: amt, from: f.name, repay: Math.round(amt * 1.1) };
  },
  repayLoan(idx) {
    const l = me.loans.taken[idx];
    if (!l || l.repaid) return { ok: false, why: 'nothing to repay' };
    const amt = Math.round(l.amount * 1.1);
    if (!this.spend(amt, `repay ${l.from}`)) return { ok: false, why: 'not enough coins' };
    l.repaid = Date.now();
    this.save();
    return { ok: true, amount: amt };
  },

  get isDirty() { return dirty; },
  aiLevelName(id) { return (LEVELS.find((l) => l.id === id) || LEVELS[2]).name; },
};

export default Profile;
