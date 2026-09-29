// ── transport: online (authoritative WS server) or local (you host, bots fill)
// Both modes speak the exact same message protocol, so the rest of the client
// does not care which one it is in. In local mode the Room object from
// shared/engine.js runs inside this tab and is still the only writer of scores.
import { Room } from '../../shared/engine.js';
import { PROTO, DEFAULT_SETTINGS } from '../../shared/content.js';
import { clamp } from './util.js';

const WS_URL = () => {
  const p = location.protocol === 'https:' ? 'wss' : 'ws';
  return p + '://' + location.host + '/ws';
};

export class GameClient {
  constructor(handlers = {}) {
    this.onMsg = handlers.onMsg || (() => {});
    this.onStatus = handlers.onStatus || (() => {});
    this.ws = null;
    this.room = null;         // local mode
    this.timer = null;
    this.mode = 'offline';    // offline | online | local
    this.pid = null;
    this.code = '';
    this.token = '';
    this.wantReconnect = false;
    this.retries = 0;
    this.rtt = 0;
    this.pending = [];
  }

  get live() { return this.mode === 'online' ? !!(this.ws && this.ws.readyState === 1) : !!this.room; }

  // ── online ────────────────────────────────────────────────────────────────
  async create(opts) {
    return this._connect({ action: 'create', ...opts });
  }
  async join(opts) {
    return this._connect({ action: 'join', ...opts });
  }
  async _resume() {
    if (!this.code || !this.token) return false;
    try {
      await this._connect({ action: 'resume', code: this.code, token: this.token }, { silent: true });
      return true;
    } catch (e) { return false; }
  }

  _connect(payload, o = {}) {
    return new Promise((resolve, reject) => {
      this.onStatus('connecting');
      let ws;
      try { ws = new WebSocket(WS_URL()); } catch (e) { this.onStatus('error', e); reject(e); return; }
      const to = setTimeout(() => { try { ws.close(); } catch (x) { /* dead */ } reject(new Error('timeout')); }, 7000);
      const onErr = () => { clearTimeout(to); this.onStatus('offline'); reject(new Error('nows')); };
      ws.onerror = onErr;
      ws.onopen = () => {
        clearTimeout(to);
        ws.onerror = () => this._dropped();
        this.ws = ws;
        this.mode = 'online';
        this.wantReconnect = true;
        ws.send(JSON.stringify({ t: 'hello', proto: PROTO, ...payload }));
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'welcome') {
          this.pid = m.pid; this.code = m.code; this.token = m.token;
          this.onStatus('online');
          this._startPing();
          this.pending.forEach((p) => this.ws.send(JSON.stringify(p)));
          this.pending = [];
          if (!o.silent) resolve(m); else resolve(m);
        }
        if (m.t === 'err') {
          this.onStatus('error', m);
          if (!o.silent) reject(new Error(m.why || 'err'));
        }
        this.onMsg(m);
      };
      ws.onclose = () => this._dropped();
    });
  }

  _dropped() {
    this._stopPing();
    if (this.wantReconnect && this.retries < 4 && this.code) {
      this.retries++;
      this.onStatus('reconnecting');
      setTimeout(async () => {
        const ok = await this._resume();
        if (!ok && this.retries < 4) this._dropped();
        else if (!ok) this.onStatus('offline');
      }, 700 * this.retries);
    } else {
      this.onStatus('offline');
    }
  }

  _startPing() {
    this._stopPing();
    this._pingT = setInterval(() => this.send({ t: 'ping', ts: Date.now() }), 9000);
  }
  _stopPing() { if (this._pingT) clearInterval(this._pingT); this._pingT = null; }

  // ── local: you are the authority in your own tab, bots fill the seats ───────
  solo({ name, avatar, settings = {}, bots = 3 }) {
    this.mode = 'local';
    this.wantReconnect = false;
    this.room = new Room({
      private: true,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      now: () => performance.now(),
    });
    this.code = this.room.code;
    const p = this.room.addPlayer({ name, avatar, conn: { send: (m) => this.onMsg(m) } });
    this.pid = p.pid;
    this.token = p.token;
    for (let i = 0; i < clamp(bots, 0, 6); i++) this.room.addBot();
    for (const q of this.room.players.values()) if (q.isBot) q.ready = true;
    this.timer = setInterval(() => {
      if (!this.room) return;
      this.room.tick(40);
    }, 40);
    this.onStatus('local');
    this.room.flush();
    return Promise.resolve({ pid: this.pid, code: this.code, local: true });
  }

  /** mid-session: add or remove bot seats in local mode */
  adjustBots(n) {
    if (this.mode !== 'local' || !this.room) return;
    const cur = [...this.room.players.values()].filter((p) => p.isBot).length;
    if (n > cur) for (let i = 0; i < n - cur; i++) this.room.addBot();
    else if (n < cur) {
      for (let i = 0; i < cur - n; i++) {
        const b = [...this.room.players.values()].filter((p) => p.isBot).pop();
        if (b) this.room.removePlayer(b.pid);
      }
    }
    this.room.flush();
  }

  send(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (this.mode === 'online') {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
      else { if (this.pending.length < 12) this.pending.push(msg); }
      return;
    }
    if (this.mode === 'local' && this.room) {
      this.room.handle(this.pid, msg);
      this.room.flush();
    }
  }

  // ── convenience intents (the ONLY things this client can ask for) ──────────
  ready(on) { this.send({ t: 'ready', on }); }
  setName(name) { this.send({ t: 'name', name }); }
  setAvatar(avatar) { this.send({ t: 'avatar', avatar }); }
  emote(id) { this.send({ t: 'emote', id }); }
  chat(text, quick) { this.send({ t: 'chat', text, quick }); }
  move(x, z, r) { this.send({ t: 'move', x: +x.toFixed(2), z: +z.toFixed(2), r: +r.toFixed(2) }); }
  spectate(on) { this.send({ t: 'spectate', on }); }
  sit(on, seat) { this.send({ t: 'sit', on, seat }); }
  act(id, p) { this.send({ t: 'act', id, p }); }
  commit(choice) { this.send({ t: 'act', id: 'commit', p: { choice } }); }
  accuse(target) { this.send({ t: 'accuse', target }); }
  push(on) { this.send({ t: 'push', on }); }
  offer(o) { this.send({ t: 'offer', ...o }); }
  offerResp(id, accept) { this.send({ t: 'offerResp', id, accept }); }
  offerVoid(id, on) { this.send({ t: 'offerVoid', id, on }); }
  start() { this.send({ t: 'start' }); }
  rematch(keep) { this.send({ t: 'rematch', keep }); }
  abort() { this.send({ t: 'abort' }); }
  kick(pid) { this.send({ t: 'kick', pid }); }
  botAdd() { this.send({ t: 'botAdd' }); }
  botDel() { this.send({ t: 'botDel' }); }
  settings(k) { this.send({ t: 'settings', k }); }
  skipReveal() { this.send({ t: 'skipTo' }); }

  close() {
    this.wantReconnect = false;
    this._stopPing();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.room) {
      for (const p of this.room.players.values()) if (p.conn && p.conn.send === this.room._localSend) p.conn = null;
      this.room = null;
    }
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) { /* closed */ } this.ws = null; }
    this.mode = 'offline';
  }
}
