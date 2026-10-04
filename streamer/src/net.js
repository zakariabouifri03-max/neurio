// ---------- multiplayer client (WebSocket) ----------
export class MPClient {
  constructor(url, room, name, cb) {
    this.url = url; this.room = room; this.name = name; this.cb = cb;
    this.players = new Map();   // id -> state
    this.me = null;
    this.ok = false;
    try {
      this.ws = new WebSocket(url);
    } catch (e) { cb.error('Bad server URL'); return; }
    this.ws.onopen = () => {
      this.send({ t: 'join', room, name });
    };
    this.ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      this.onMsg(m);
    };
    this.ws.onclose = () => { if (!this.ok) cb.error('Could not connect to server'); cb.close(); };
    this.ws.onerror = () => {};
    this.ping = setInterval(() => this.send({ t: 'ping' }), 4000);
  }

  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  onMsg(m) {
    switch (m.t) {
      case 'welcome':
        this.ok = true; this.me = m.id;
        for (const id in m.players) if (id !== m.id) this.players.set(id, m.players[id]);
        this.cb.ready(m.players);
        break;
      case 'pjoin':
        if (m.id !== this.me) { this.players.set(m.id, m); this.cb.join(m); }
        break;
      case 'pstate':
        if (m.id !== this.me && this.players.has(m.id)) Object.assign(this.players.get(m.id), m);
        break;
      case 'pleave':
        this.players.delete(m.id); this.cb.leave(m.id);
        break;
      case 'chat':
        this.cb.chat(m);
        break;
      case 'err':
        this.cb.error(m.msg);
        break;
    }
  }

  state(s) { this.send({ t: 'state', ...s }); }
  chatMsg(msg) { this.send({ t: 'chat', msg }); }

  close() {
    clearInterval(this.ping);
    this.send({ t: 'bye' });
    try { this.ws.close(); } catch {}
  }
}

export function defaultWSUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
