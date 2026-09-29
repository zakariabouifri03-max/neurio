// ─────────────────────────────────────────────────────────────────────────────
//  net.js — client for the authoritative game server
//
//  The server (pool/server/) owns accounts, coins, friend lists, loans,
//  matchmaking and match results. This module is the only thing that talks to
//  it. When it is not reachable the game still runs completely — practice,
//  pass-and-play and the five computer opponents are all local — but anything
//  that must be authoritative (real-money coins, ranked ladders, online 1v1,
//  cross-device friends) is reported as unavailable instead of being faked.
//
//  Every request is id-keyed with a timeout, and every reply from the server is
//  treated as data, never as code.
// ─────────────────────────────────────────────────────────────────────────────

export function serverUrl() {
  if (typeof location === 'undefined') return null;
  if (location.protocol === 'file:') return null;            // opened from disk: no server
  const secure = location.protocol === 'https:';
  return `${secure ? 'wss' : 'ws'}://${location.host}/ws`;
}

const TIMEOUT = 8000;

export class Net {
  constructor(url = serverUrl()) {
    this.url = url;
    this.ws = null;
    this.online = false;
    this.user = null;
    this.id = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.retries = 0;
    this.lastError = '';
    this.onStatus = () => {};
    this._queue = [];
  }

  get available() { return !!this.url; }

  connect() {
    if (!this.url || this.ws) return Promise.resolve(false);
    return new Promise((resolve) => {
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { this.lastError = String(e && e.message || e); resolve(false); return; }
      this.ws = ws;
      const done = (ok) => {
        this.online = ok;
        this.retries = ok ? 0 : this.retries + 1;
        this.onStatus(ok, this.lastError);
        resolve(ok);
      };
      const to = setTimeout(() => { if (!this.online) { try { ws.close(); } catch (e) {} done(false); } }, 6000);
      ws.onopen = () => { clearTimeout(to); this._flush(); done(true); };
      ws.onerror = () => { this.lastError = 'connection refused'; };
      ws.onclose = () => {
        clearTimeout(to);
        this.ws = null;
        if (this.online) { this.online = false; this.onStatus(false, 'disconnected'); }
        else done(false);
        // reject anything in flight
        for (const [, p] of this.pending) p.reject(new Error('disconnected'));
        this.pending.clear();
      };
      ws.onmessage = (ev) => this._onMessage(ev.data);
    });
  }

  /** keep trying in the background; the UI simply reflects the current state */
  autoRetry(maxMs = 60000) {
    if (this._timer) return;
    const step = () => {
      this._timer = null;
      if (this.online || !this.url) return;
      this.connect().then((ok) => {
        if (ok || !this.url) return;
        const wait = Math.min(maxMs, 4000 * Math.pow(1.7, Math.min(6, this.retries)));
        this._timer = setTimeout(step, wait);
      });
    };
    this._timer = setTimeout(step, 5000);
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(String(msg.error)));
      else p.resolve(msg.data);
      return;
    }
    const list = this.handlers.get(msg.type) || [];
    for (const fn of list) { try { fn(msg.data, msg); } catch (e) { console.error('[net] handler', e); } }
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return () => {
      const l = this.handlers.get(type) || [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    };
  }

  /** fire and forget */
  send(type, data) {
    if (!this.online || !this.ws) { this._queue.push({ type, data }); if (this._queue.length > 40) this._queue.shift(); return false; }
    try { this.ws.send(JSON.stringify({ type, data })); return true; } catch (e) { return false; }
  }

  _flush() {
    const q = this._queue; this._queue = [];
    for (const m of q) this.send(m.type, m.data);
  }

  /** request/response */
  request(type, data, ms = TIMEOUT) {
    if (!this.online || !this.ws) return Promise.reject(new Error('offline'));
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')); }
      }, ms);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, type, data })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  // ── account ───────────────────────────────────────────────────────────────
  auth(name, password, register = false) {
    return this.request('auth', { name, password, register }).then((d) => {
      if (!d || !d.ok) throw new Error((d && d.why) || 'rejected');
      this.user = d.name || name;
      this.token = d.token || null;
      return d;
    });
  }

  saveProfile(profile) {
    if (!this.online) return false;
    return this.send('profile.save', {
      name: profile.name, avatar: profile.avatar, xp: profile.xp, level: profile.level,
      wallet: profile.wallet, cues: profile.cues, equipped: profile.equipped,
      stats: profile.stats, settings: profile.settings, friends: profile.friends,
    });
  }

  loadProfile() { return this.request('profile.get'); }

  // ── social ────────────────────────────────────────────────────────────────
  addFriend(name) { return this.request('friend.add', { name }); }
  challenge(name, opts) { return this.request('match.challenge', { name, opts }); }
  giftCoins(name, amount) { return this.request('wallet.gift', { name, amount }); }
  askLoan(name, amount) { return this.request('loan.ask', { name, amount }); }
  repayLoan(id) { return this.request('loan.repay', { id }); }
  buyPack(packId) { return this.request('purchase.begin', { packId }); }
  findMatch(opts) { return this.request('match.find', opts, 45000); }
  cancelQueue() { return this.request('match.cancel'); }
  resign(matchId) { return this.request('match.resign', { matchId }); }
  matchState(matchId) { return this.request('match.state', { matchId }); }
  placeCue(matchId, x, z) { return this.request('match.place', { matchId, x, z }); }
  say(text) { return this.send('chat.say', { text }); }
  buyCue(id) { return this.request('cue.buy', { id }); }
  removeFriend(name) { return this.request('friend.remove', { name }); }

  /**
   * Submit a shot. Only the INPUT leaves this machine — direction, power and the
   * tip contact point — never a result. The server replays it against its own
   * table and answers with what actually happened.
   */
  submitShot(matchId, strike) { return this.request('match.shot', { matchId, strike }, 20000); }
  claimDaily() { return this.request('daily.claim'); }

  close() { if (this.ws) { try { this.ws.close(); } catch (e) {} } this.ws = null; this.online = false; }
}

export const net = new Net();
export default net;
