// ═════════════════════════════════════════════════════════════════════════════
// SWINDLE SQUAD — authoritative game server.
//
//   • serves the client (static files, no build step)
//   • runs the WebSocket gateway (server/ws.mjs, zero dependencies)
//   • owns one Room per code; the Room *is* the game: roles, secrets, scores,
//     deals, reveals. Clients send intent only. They receive redacted views.
//
//   node server/index.mjs            → http://localhost:8080
//   PORT=3000 HOST=0.0.0.0 node server/index.mjs
// ═════════════════════════════════════════════════════════════════════════════
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { Room } from '../shared/engine.js';
import { PROTO, GAME_TITLE, VENUE } from '../shared/content.js';
import { isUpgrade, acceptSocket, startPingSweep } from './ws.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const TICK_MS = 40;                       // 25 Hz authority tick

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.map': 'text/plain',
};

// ── static ────────────────────────────────────────────────────────────────────
function serve(req, res) {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') { res.writeHead(302, { location: '/swindle/' }).end(); return; }
  if (p === '/racing' || p === '/racing/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end('nope'); return; }
  fs.stat(file, (e, st) => {
    if (!e && st.isDirectory()) {
      if (!p.endsWith('/')) { res.writeHead(301, { location: p.replace(/\/$/, '') + '/' }).end(); return; }
      const idx = path.join(file, 'index.html');
      return fs.stat(idx, (e2, st2) => {
        if (e2 || !st2.isFile()) return fallback(p, res);
        send(idx, res);
      });
    }
    if (e || !st.isFile()) return fallback(p, res);
    send(file, res);
  });
}
// extensionless paths are the app's own routes → hand them to the game
function fallback(p, res) {
  if (!path.extname(p)) return send(path.join(ROOT, 'swindle', 'index.html'), res);
  res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
}
function send(file, res) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const ext = path.extname(abs).toLowerCase();
  fs.readFile(abs, (e, buf) => {
    if (e) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' || abs.endsWith('sw.js') ? 'no-store' : 'public, max-age=300',
      'access-control-allow-origin': '*',
    });
    res.end(buf);
  });
}

// ── rooms ─────────────────────────────────────────────────────────────────────
const rooms = new Map();          // code -> Room
const conns = new Set();          // live WSConn
const byIp = new Map();           // ip -> count
const MAX_PER_IP = 12;

function createRoom(opts = {}) {
  const room = new Room(opts);
  rooms.set(room.code, room);
  return room;
}
function findRoom(code) { return rooms.get(String(code || '').toUpperCase().slice(0, 5)) || null; }
function gcRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const alive = [...room.players.values()].filter((p) => p.connected).length;
    const idle = now - (room.lastActivity || now);
    if (!alive && idle > 10 * 60 * 1000) { rooms.delete(code); log('room', code, 'expired'); }
  }
}
function log(...a) { if (process.env.QUIET !== '1') console.log(new Date().toISOString().slice(11, 19), ...a); }

// ── gateway ───────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/api/rooms') {
    const list = [...rooms.values()].filter((r) => !r.private).map((r) => ({
      code: r.code, players: r.players.size, phase: r.state, name: r.name || 'table',
      host: r.players.get(r.host)?.name || '',
    }));
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ title: GAME_TITLE, venue: VENUE, proto: PROTO, rooms: list }));
    return;
  }
  if (req.url === '/health') { res.writeHead(200).end('ok ' + rooms.size + ' rooms'); return; }
  serve(req, res);
});

server.on('upgrade', (req, socket) => {
  const u = new url.URL(req.url, 'http://x');
  if (u.pathname !== '/ws') { socket.destroy(); return; }
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').toString();
  const n = byIp.get(ip) || 0;
  if (n >= MAX_PER_IP) { socket.destroy(); return; }
  byIp.set(ip, n + 1);

  const ws = acceptSocket(req, socket);
  if (!ws) { byIp.set(ip, Math.max(0, n)); return; }
  conns.add(ws);

  const sess = { pid: null, room: null, hello: 0 };
  ws.onmessage = (raw) => {
    if (raw.length > 64 * 1024) return;                 // oversized intent → drop
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    try { route(ws, sess, m); } catch (e) { log('route error', e?.message); }
  };
  ws.onclose = () => {
    conns.delete(ws);
    byIp.set(ip, Math.max(0, (byIp.get(ip) || 1) - 1));
    if (sess.room && sess.pid) {
      sess.room.lastActivity = Date.now();
      sess.room.dropPlayer(sess.pid, 'left');
      const p = sess.room.players.get(sess.pid);
      if (p) p.conn = null;
      if (sess.room.players.size === 0) { rooms.delete(sess.room.code); log('room', sess.room.code, 'emptied'); }
    }
  };
});

function route(ws, sess, m) {
  const room = sess.room;
  // ── handshake ────────────────────────────────────────────────────────────
  if (m.t === 'hello') {
    if (sess.hello++) { ws.send({ t: 'err', why: 'already-hello' }); return; }
    if (m.proto !== PROTO) { ws.send({ t: 'err', why: 'version', need: PROTO }); return; }
    const name = String(m.name || '').slice(0, 24);
    if (m.action === 'create') {
      let code;
      do { code = genCode(); } while (rooms.has(code));
      const r = createRoom({ code, private: m.private !== false, settings: m.settings || {}, now: () => Date.now() });
      r.name = String(m.roomName || '').slice(0, 24);
      sess.room = r;
      const p = r.addPlayer({ name, avatar: m.avatar, conn: ws });
      sess.pid = p.pid;
      ws.send({ t: 'welcome', pid: p.pid, token: p.token, code: r.code, proto: PROTO, maxPlayers: 8 });
      log('create', r.code, p.name);
      r.push('chat', { pid: 'sys', name: 'House', text: 'Welcome to ' + VENUE + '. Deals are final, friendships are not.', at: Date.now() });
      r.flush();
      return;
    }
    if (m.action === 'join') {
      const r = findRoom(m.code);
      if (!r) { ws.send({ t: 'err', why: 'noroom' }); return; }
      if (r.players.size >= 8) { ws.send({ t: 'err', why: 'full' }); return; }
      sess.room = r;
      const p = r.addPlayer({ name, avatar: m.avatar, conn: ws });
      sess.pid = p.pid;
      ws.send({ t: 'welcome', pid: p.pid, token: p.token, code: r.code, proto: PROTO, maxPlayers: 8 });
      log('join', r.code, p.name);
      r.push('chat', { pid: 'sys', name: 'House', text: p.name + ' walked in wearing someone else’s hat.', at: Date.now() });
      r.flush();
      return;
    }
    if (m.action === 'resume') {
      const r = findRoom(m.code);
      const p = r && [...r.players.values()].find((x) => x.token === m.token);
      if (!p) { ws.send({ t: 'err', why: 'nosession' }); return; }
      sess.room = r; sess.pid = p.pid;
      p.connected = true; p.conn = ws; p.lastSeen = Date.now();
      ws.send({ t: 'welcome', pid: p.pid, token: p.token, code: r.code, proto: PROTO, resumed: true });
      r.flush();
      return;
    }
    ws.send({ t: 'err', why: 'bad-action' });
    return;
  }

  if (!room || !sess.pid) { ws.send({ t: 'err', why: 'no-session' }); return; }
  if (ws.bufferedAmount > 700 * 1024) return;    // slow client: drop input, not the game
  room.lastActivity = Date.now();
  room.handle(sess.pid, m);
}

function genCode() {
  const A = 'ACDEFGHJKLMNPQRSTUVWXY345679';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}

// ── the authority loop ─────────────────────────────────────────────────────────
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(250, now - last); last = now;
  for (const room of rooms.values()) {
    try { room.tick(dt); } catch (e) { log('tick error', room.code, e?.stack || e); }
  }
}, TICK_MS);
setInterval(gcRooms, 60000);
startPingSweep(conns, 25000);

server.listen(PORT, HOST, () => {
  log('Swindle Squad authority on http://' + HOST + ':' + PORT + '  (ws: /ws)  proto', PROTO);
});
process.on('SIGINT', () => { log('shutting down'); process.exit(0); });
