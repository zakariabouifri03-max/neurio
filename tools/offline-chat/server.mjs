#!/usr/bin/env node
/**
 * 📡 «نوريو تواصل» — Offline Chat server
 * ---------------------------------------------------------------------------
 * A tiny LAN messenger that needs NO internet and NO dependencies.
 * Everything below is built on Node's standard library only (`node:http`,
 * `node:crypto`, ...) — WebSocket is implemented by hand (RFC 6455), so there
 * is not a single line of `npm install` to run.
 *
 *   node tools/offline-chat/server.mjs                 # → http://<lan-ip>:8080
 *   node tools/offline-chat/server.mjs --port 9000
 *   node tools/offline-chat/server.mjs --https         # self-signed → mic/voice notes
 *
 * Who talks to whom: every device that can reach this machine on the local
 * network (same Wi-Fi, or a phone hotspot with no data) joins the same room(s).
 * Messages, files and voice notes stay on this machine — nothing leaves the LAN.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
// runtime data (messages, uploads, TLS) — override with --data or $CHAT_DATA_DIR
const DATA_DIR = process.env.CHAT_DATA_DIR
  ? path.resolve(process.env.CHAT_DATA_DIR)
  : path.join(HERE, '.data');
const FILE_DIR = path.join(DATA_DIR, 'files');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

const VERSION = '1.0.0';
const MAX_UPLOAD = 25 * 1024 * 1024;   // 25 MB per file
const MAX_TEXT = 4000;                  // characters per message
const HISTORY_PER_ROOM = 300;           // kept in memory / replayed to clients
const FILE_TTL_DAYS = 45;               // uploaded files are pruned after that

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { port: 8080, host: '0.0.0.0', https: false, name: 'نوريو تواصل', quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = Number(argv[++i]) || out.port;
    else if (a === '--host') out.host = argv[++i] || out.host;
    else if (a === '--https' || a === '-s') out.https = true;
    else if (a === '--name' || a === '-n') out.name = argv[++i] || out.name;
    else if (a === '--data' || a === '-d') process.env.CHAT_DATA_DIR = argv[++i] || '';
    else if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return out;
}

function printHelp() {
  console.log(`
📡  ${VERSION} — «نوريو تواصل» / Neurio Offline Chat

  الاستعمال / Usage:
    node tools/offline-chat/server.mjs [options]

  Options:
    -p, --port <n>    port to listen on            (default 8080)
        --host <ip>   interface to bind            (default 0.0.0.0 = كل الشبكة)
    -s, --https       self-signed TLS  → enables microphone / voice notes
    -n, --name <s>    server name shown to clients (default «نوريو تواصل»)
    -d, --data <dir>  where messages/uploads are stored (default ./tools/offline-chat/.data)
    -q, --quiet       less logging
    -h, --help        this text
`);
}

const ARGS = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const now = () => Date.now();
const uid = (n = 10) => crypto.randomBytes(n).toString('hex');
const log = (...a) => { if (!ARGS.quiet) console.log(...a); };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.pdf': 'application/pdf', '.zip': 'application/zip',
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  // 192.168.* / 10.* first — those are the ones people can actually reach
  return out.sort((a, b) => rank(a) - rank(b));
  function rank(ip) {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3;
  }
}

function human(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ---------------------------------------------------------------------------
// Persistence — every message is appended to .data/store.json so that a restart
// doesn't wipe the conversation. Files live in .data/files/.
// ---------------------------------------------------------------------------
class Store {
  constructor() {
    this.rooms = new Map();      // id → {id, name, kind, emoji, createdAt}
    this.messages = new Map();   // roomId → [msg, ...]
    this.dirty = false;
    this.timer = null;
  }

  ensureRoom(id, name, kind = 'group', emoji = '#') {
    let r = this.rooms.get(id);
    if (!r) {
      r = { id, name, kind, emoji, createdAt: now() };
      this.rooms.set(id, r);
      this.messages.set(id, []);
      this.dirty = true;
    } else if (name && r.name !== name) {
      r.name = name;
      this.dirty = true;
    }
    return r;
  }

  addMessage(msg) {
    const list = this.messages.get(msg.room) || [];
    list.push(msg);
    while (list.length > HISTORY_PER_ROOM) list.shift();
    this.messages.set(msg.room, list);
    this.dirty = true;
    this.schedule();
    return msg;
  }

  removeMessage(room, id) {
    const list = this.messages.get(room);
    if (!list) return null;
    const i = list.findIndex((m) => m.id === id);
    if (i < 0) return null;
    const [gone] = list.splice(i, 1);
    this.dirty = true;
    this.schedule();
    return gone;
  }

  history(room, limit = HISTORY_PER_ROOM) {
    return (this.messages.get(room) || []).slice(-limit);
  }

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 400);
    if (this.timer.unref) this.timer.unref();
  }

  async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const dump = {
        version: VERSION,
        savedAt: now(),
        rooms: [...this.rooms.values()],
        messages: Object.fromEntries(
          [...this.messages.entries()].map(([k, v]) => [k, v.slice(-HISTORY_PER_ROOM)]),
        ),
      };
      const tmp = STORE_FILE + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(dump));
      await fsp.rename(tmp, STORE_FILE);
    } catch (err) {
      console.error('⚠️  store flush failed:', err.message);
    }
  }

  load() {
    try {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const dump = JSON.parse(raw);
      for (const r of dump.rooms || []) {
        this.rooms.set(r.id, r);
        this.messages.set(r.id, []);
      }
      for (const [room, list] of Object.entries(dump.messages || {})) {
        if (!this.rooms.has(room)) this.ensureRoom(room, room, room.startsWith('dm:') ? 'dm' : 'group');
        this.messages.set(room, list.slice(-HISTORY_PER_ROOM));
      }
      const count = [...this.messages.values()].reduce((a, b) => a + b.length, 0);
      if (count) log(`   📚 history restored: ${count} messages · ${this.rooms.size} rooms`);
    } catch { /* first run — nothing to restore */ }
    this.ensureRoom('general', 'العامة', 'group', '💬');
    this.ensureRoom('help', 'المساعدة', 'group', '🆘');
  }
}

const store = new Store();

// ---------------------------------------------------------------------------
// Minimal WebSocket server (RFC 6455) — no dependencies.
// ---------------------------------------------------------------------------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const sockets = new Set();   // all live clients

class WS {
  constructor(socket, req) {
    this.socket = socket;
    this.req = req;
    this.buf = Buffer.alloc(0);
    this.alive = true;
    this.closed = false;
    this.frag = [];          // continuation frames
    this.fragOp = 0;
    this.id = uid(8);

    socket.on('data', (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      try { this.drain(); } catch { this.close(1002, 'protocol'); }
    });
    socket.on('error', () => this.close(1006));
    socket.on('close', () => this.close(1006));
    socket.setTimeout(0);
  }

  static upgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return null;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    return new WS(socket, req);
  }

  drain() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < off + 2) return; len = b.readUInt16BE(off); off += 2; }
      else if (len === 127) {
        if (b.length < off + 8) return;
        const big = b.readBigUInt64BE(off); off += 8;
        if (big > 8n * 1024n * 1024n) throw new Error('frame too large');
        len = Number(big);
      }
      const maskLen = masked ? 4 : 0;
      if (b.length < off + maskLen + len) return;
      const mask = masked ? b.subarray(off, off + 4) : null;
      off += maskLen;
      const payload = Buffer.from(b.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + len);

      if (op === 0x8) { this.close(1000); return; }             // close
      else if (op === 0x9) { this.sendFrame(payload, 0xa); }    // ping → pong
      else if (op === 0xa) { this.alive = true; }               // pong
      else if (op === 0x0) {                                    // continuation
        this.frag.push(payload);
        if (fin) { const all = Buffer.concat(this.frag); this.frag = []; this.deliver(this.fragOp, all); }
      } else if (op === 0x1 || op === 0x2) {
        if (fin) this.deliver(op, payload);
        else { this.fragOp = op; this.frag = [payload]; }
      }
    }
  }

  deliver(op, payload) {
    if (op !== 0x1) return;                       // the app only speaks text/JSON
    if (payload.length > 64 * 1024) return;
    let data;
    try { data = JSON.parse(payload.toString('utf8')); } catch { return; }
    if (data && typeof data === 'object') onClientMessage(this, data);
  }

  sendFrame(payload, op = 0x1) {
    if (this.closed) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    try { this.socket.write(Buffer.concat([head, payload])); } catch { this.close(1006); }
  }

  send(obj) {
    this.sendFrame(Buffer.from(JSON.stringify(obj), 'utf8'), 0x1);
  }

  ping() {
    if (this.closed) return;
    this.alive = false;
    this.sendFrame(Buffer.alloc(0), 0x9);
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    try {
      const b = Buffer.alloc(2 + Buffer.byteLength(reason));
      b.writeUInt16BE(code, 0);
      b.write(reason, 2);
      this.sendFrame(b, 0x8);
      this.socket.end();
    } catch { /* socket already gone */ }
    sockets.delete(this);
    onDisconnect(this);
  }
}

/**
 * A client that speaks plain HTTP (long-polling) instead of WebSocket — used as a
 * fallback when a proxy/network blocks the upgrade. It implements the same tiny
 * surface the rest of the server expects: send(obj) / close().
 */
class PollClient {
  constructor(sid) {
    this.sid = sid;
    this.isHttp = true;
    this.out = [];            // pending outbound frames
    this.base = 0;            // absolute index of out[0]
    this.waiters = [];
    this.lastSeen = now();
    this.closed = false;
  }
  send(obj) {
    if (this.closed) return;
    this.out.push(obj);
    if (this.out.length > 800) { this.out.shift(); this.base++; }
    const w = this.waiters.splice(0, this.waiters.length);
    for (const fn of w) fn();
  }
  flush(cursor) {
    const since = Math.max(Number(cursor) || 0, this.base);
    return { cursor: this.base + this.out.length, messages: this.out.slice(since - this.base) };
  }
  wait(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(), ms);
      this.waiters.push(() => { clearTimeout(t); resolve(); });
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.waiters.splice(0, this.waiters.length)) fn();
    sockets.delete(this);
    onDisconnect(this);
  }
}

/** sid → PollClient (an HTTP client is identified by a browser-side id) */
const httpClients = new Map();

// keep-alive: drop dead peers (phone locked, walked out of Wi-Fi range, ...)
setInterval(() => {
  for (const ws of [...sockets]) {
    if (ws.isHttp) {
      if (now() - ws.lastSeen > 90000) ws.close();       // long-poll client went away
      continue;
    }
    if (!ws.alive) ws.close(1001, 'timeout');
    else ws.ping();
  }
}, 30000).unref();

// ---------------------------------------------------------------------------
// Chat state — who is online, who is in which room.
// ---------------------------------------------------------------------------
/** ws → { id, name, color, emoji, rooms:Set, typing, lastSeen, joinedAt } */
const clients = new Map();

function peers() {
  const map = new Map();     // userId → public profile (+ how many devices)
  for (const c of clients.values()) {
    const p = map.get(c.id) || { id: c.id, name: c.name, color: c.color, emoji: c.emoji, devices: 0, joinedAt: c.joinedAt };
    p.devices++;
    p.name = c.name; p.color = c.color; p.emoji = c.emoji;
    map.set(c.id, p);
  }
  return [...map.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

function broadcastRoomPeers() {
  const list = peers();
  for (const ws of sockets) ws.send({ t: 'peers', peers: list, ts: now() });
}

function publicRooms() {
  const live = new Map();
  for (const c of clients.values()) for (const r of c.rooms) live.set(r, (live.get(r) || 0) + 1);
  return [...store.rooms.values()]
    .filter((r) => r.kind === 'group')
    .map((r) => ({
      id: r.id, name: r.name, kind: r.kind, emoji: r.emoji,
      createdAt: r.createdAt, online: live.get(r.id) || 0,
      last: (store.history(r.id, 1)[0] || null),
    }));
}

function isMember(room, userId) {
  const r = store.rooms.get(room);
  if (!r) return false;
  if (r.kind !== 'dm') return true;
  return r.members.includes(userId);
}

function dmRoomFor(a, b) {
  const key = 'dm:' + [a, b].map(String).sort().join('|');
  const existing = store.rooms.get(key);
  if (existing) return existing;
  const room = store.ensureRoom(key, 'خاص', 'dm', '✉️');
  room.members = [a, b].map(String).sort();
  store.dirty = true;
  return room;
}

function myDms(userId) {
  return [...store.rooms.values()]
    .filter((r) => r.kind === 'dm' && r.members?.includes(userId))
    .map((r) => {
      const other = r.members.find((m) => m !== userId);
      const peer = peers().find((p) => p.id === other) || null;
      return {
        id: r.id,
        peer: { id: other, name: peer?.name || r.peerName?.[other] || 'مستخدم', color: peer?.color || '#8b95a5', emoji: peer?.emoji || '🙂', online: !!peer },
        last: store.history(r.id, 1)[0] || null,
      };
    });
}

function systemMessage(room, text) {
  const msg = { id: uid(6), room, kind: 'system', text, ts: now() };
  store.addMessage(msg);
  sendToRoom(room, { t: 'msg', msg });
}

function sendToRoom(room, payload, except) {
  const r = store.rooms.get(room);
  for (const ws of sockets) {
    if (ws === except) continue;
    const c = clients.get(ws);
    if (!c) continue;
    if (r && r.kind === 'dm' && !r.members?.includes(c.id)) continue;
    ws.send(payload);
  }
}

// ---------------------------------------------------------------------------
// WS protocol
// ---------------------------------------------------------------------------
let guestCounter = 0;

function sanitizeName(name, fallback) {
  const clean = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
  return clean || fallback;
}

function onClientMessage(ws, m) {
  const me = clients.get(ws);
  switch (m.t) {
    case 'hello': {
      guestCounter++;
      if (ws.isHttp) { ws.out.length = 0; ws.base = 0; ws.waiters.length = 0; }
      const id = String(m.id || uid(6)).slice(0, 40);
      const name = sanitizeName(m.name, 'ضيف ' + guestCounter);
      const color = /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : pickColor(id);
      const emoji = String(m.emoji || '🙂').slice(0, 4);
      const prev = clients.get(ws);
      clients.set(ws, {
        id, name, color, emoji,
        rooms: new Set(prev ? prev.rooms : ['general']),
        joinedAt: prev?.joinedAt || now(),
        lastSeen: now(),
        typing: new Set(),
      });
      ws.send({
        t: 'welcome',
        you: { id, name, color, emoji },
        server: { name: ARGS.name, version: VERSION, time: now(), https: ARGS.https },
        rooms: publicRooms(),
        dms: myDms(id),
        peers: peers(),
        history: Object.fromEntries(
          [...clients.get(ws).rooms].filter((r) => isMember(r, id)).map((r) => [r, store.history(r, 100)]),
        ),
      });
      broadcastRoomPeers();
      log(`   👤 ${name} joined (${id.slice(0, 6)}) — ${peers().length} online`);
      break;
    }

    case 'msg': {
      if (!me) return;
      const room = String(m.room || 'general');
      if (!isMember(room, me.id)) {
        if (room.startsWith('dm:')) return;   // never leak private rooms
        store.ensureRoom(room, sanitizeName(m.roomName || room, room), 'group');
      }
      const text = String(m.text || '').slice(0, MAX_TEXT);
      // the canonical URL is rebuilt server-side — a client can't point it anywhere else
      const file = m.file && typeof m.file === 'object' && m.file.id ? {
        id: String(m.file.id).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 60),
        name: sanitizeName(m.file.name, 'ملف').slice(0, 80),
        size: Number(m.file.size) || 0,
        type: String(m.file.type || 'application/octet-stream').slice(0, 80),
      } : null;
      if (file) {
        file.url = '/api/file/' + encodeURIComponent(file.id);
        if (!fs.existsSync(path.join(FILE_DIR, file.id))) file.missing = true;
      }
      if (!text.trim() && !file) return;
      const kind = m.kind === 'voice' ? 'voice'
        : file && /^image\//.test(file.type) ? 'image'
        : file ? 'file' : 'text';
      const msg = {
        id: String(m.id || uid(6)).slice(0, 40), room, ts: now(),
        from: { id: me.id, name: me.name, color: me.color, emoji: me.emoji },
        kind, text, file,
        replyTo: m.replyTo && typeof m.replyTo === 'object' ? {
          id: String(m.replyTo.id || '').slice(0, 40),
          name: sanitizeName(m.replyTo.name, '').slice(0, 24),
          text: String(m.replyTo.text || '').slice(0, 160),
        } : null,
      };
      store.addMessage(msg);
      sendToRoom(room, { t: 'msg', msg });
      break;
    }

    case 'typing': {
      if (!me) return;
      const room = String(m.room || 'general');
      sendToRoom(room, {
        t: 'typing', room, on: !!m.on,
        from: { id: me.id, name: me.name },
      }, ws);
      break;
    }

    case 'open': {                        // client subscribes / asks for history
      if (!me) return;
      const room = String(m.room || 'general');
      if (room.startsWith('dm') && !isMember(room, me.id)) return;
      if (!store.rooms.has(room) && !room.startsWith('dm:')) store.ensureRoom(room, sanitizeName(m.name || room, room), 'group');
      me.rooms.add(room);
      ws.send({ t: 'history', room, messages: store.history(room, HISTORY_PER_ROOM), rooms: publicRooms() });
      break;
    }

    case 'room': {                        // create a group/channel
      if (!me) return;
      const name = sanitizeName(m.name, '');
      if (!name) return;
      const id = 'r-' + name.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) + '-' + uid(2);
      store.ensureRoom(id, name, 'group', String(m.emoji || '#').slice(0, 4));
      me.rooms.add(id);
      systemMessage(id, `تم إنشاء الغرفة «${name}» بواسطة ${me.name}`);
      for (const w of sockets) w.send({ t: 'rooms', rooms: publicRooms() });
      break;
    }

    case 'dm': {                          // start/continue a private chat
      if (!me) return;
      const peerId = String(m.peer?.id || '').slice(0, 40);
      if (!peerId || peerId === me.id) return;
      const room = dmRoomFor(me.id, peerId);
      room.peerName = { ...(room.peerName || {}), [peerId]: sanitizeName(m.peer?.name, 'مستخدم'), [me.id]: me.name };
      me.rooms.add(room.id);
      ws.send({ t: 'history', room: room.id, messages: store.history(room.id, HISTORY_PER_ROOM), dm: { id: room.id, peer: { id: peerId, name: sanitizeName(m.peer?.name, 'مستخدم'), color: m.peer?.color || '#8b95a5', emoji: m.peer?.emoji || '🙂' } } });
      // the other side gets the room in their list (and the history so far)
      for (const [w, c] of clients) {
        if (c.id === peerId) {
          c.rooms.add(room.id);
          w.send({ t: 'history', room: room.id, messages: store.history(room.id, HISTORY_PER_ROOM) });
          w.send({ t: 'dms', dms: myDms(peerId) });
        }
      }
      store.dirty = true;
      break;
    }

    case 'delete': {
      if (!me) return;
      const room = String(m.room || '');
      const list = store.messages.get(room) || [];
      const msg = list.find((x) => x.id === m.id);
      if (!msg || msg.from?.id !== me.id) return;
      store.removeMessage(room, msg.id);
      sendToRoom(room, { t: 'delete', room, id: msg.id });
      break;
    }

    case 'rooms': {
      ws.send({ t: 'rooms', rooms: publicRooms() });
      break;
    }

    case 'ping': ws.send({ t: 'pong', ts: now() }); break;
  }
}

function onDisconnect(ws) {
  const c = clients.get(ws);
  if (!c) return;
  clients.delete(ws);
  broadcastRoomPeers();
  log(`   👋 ${c.name} left — ${peers().length} online`);
}

function pickColor(seed) {
  const palette = ['#ff6b6b', '#f7b731', '#20bf6b', '#4b7bec', '#a55eea', '#fd79a8', '#00b8d4', '#e17055'];
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

// ---------------------------------------------------------------------------
// HTTP: static app + small API (health, upload, download)
// ---------------------------------------------------------------------------
async function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { req.pause(); reject(new Error('too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(code, {
    'Content-Type': type,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(buf);
}

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!target.startsWith(PUBLIC_DIR)) return send(res, 403, '{"error":"forbidden"}');
  try {
    const st = await fsp.stat(target);
    if (st.isDirectory()) return serveStatic(req, res, path.posix.join(rel, 'index.html'));
    const ext = path.extname(target).toLowerCase();
    const headers = {
      'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600',
      'Service-Worker-Allowed': '/',
    };
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, ...headers });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(target).pipe(res);
  } catch {
    send(res, 404, JSON.stringify({ error: 'not found', path: rel }));
  }
}

async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/health') {
    return send(res, 200, JSON.stringify({
      ok: true, name: ARGS.name, version: VERSION, ts: now(),
      online: peers().length, rooms: publicRooms().length,
      addresses: lanAddresses(), addresses_full: lanAddresses().map((ip) => `http://${ip}:${ARGS.port}`),
      https: ARGS.https, uptime: Math.round(process.uptime()),
    }));
  }

  if (p === '/api/upload' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, MAX_UPLOAD); }
    catch {
      res.on('finish', () => req.destroy());     // let the browser read the error first
      return send(res, 413, JSON.stringify({ error: 'file-too-large', max: MAX_UPLOAD }));
    }
    const nameHeader = decodeURIComponent(String(req.headers['x-file-name'] || '').replace(/[\u0000-\u001f/\\]/g, '')).slice(0, 80) || 'file';
    const type = String(req.headers['x-file-type'] || 'application/octet-stream').split(';')[0].slice(0, 80);
    const id = uid(12) + (path.extname(nameHeader).slice(0, 8) || '');
    await fsp.mkdir(FILE_DIR, { recursive: true });
    await fsp.writeFile(path.join(FILE_DIR, id), body);
    log(`   📎 ${nameHeader} (${human(body.length)}) from ${req.socket.remoteAddress}`);
    return send(res, 200, JSON.stringify({ id, name: nameHeader, size: body.length, type, url: '/api/file/' + encodeURIComponent(id) }));
  }

  if (p.startsWith('/api/file/')) {
    const id = path.basename(decodeURIComponent(p.slice('/api/file/'.length)));
    const target = path.join(FILE_DIR, id);
    try {
      const st = await fsp.stat(target);
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        'Content-Disposition': 'inline; filename="' + id.replace(/"/g, '') + '"',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Accept-Ranges': 'none',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(target).pipe(res);
      return;
    } catch {
      return send(res, 404, JSON.stringify({ error: 'file not found' }));
    }
  }

  // ── long-polling transport (fallback when WebSocket is blocked) ──────────
  if (p === '/api/poll/in' && req.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8')); }
    catch { return send(res, 400, JSON.stringify({ error: 'bad json' })); }
    const sid = String(url.searchParams.get('sid') || body.sid || '').slice(0, 40);
    if (!sid) return send(res, 400, JSON.stringify({ error: 'missing sid' }));
    let client = httpClients.get(sid);
    if (!client) { client = new PollClient(sid); httpClients.set(sid, client); sockets.add(client); }
    client.lastSeen = now();
    const msg = body.msg || body;
    if (msg && typeof msg === 'object' && typeof msg.t === 'string') onClientMessage(client, msg);
    return send(res, 200, JSON.stringify({ ok: true, cursor: client.base + client.out.length }));
  }

  if (p === '/api/poll/out') {
    const sid = String(url.searchParams.get('sid') || '').slice(0, 40);
    if (!sid) return send(res, 400, JSON.stringify({ error: 'missing sid' }));
    let client = httpClients.get(sid);
    if (!client) { client = new PollClient(sid); httpClients.set(sid, client); sockets.add(client); }
    client.lastSeen = now();
    const cursor = Number(url.searchParams.get('cursor') || 0);
    const waitMs = Math.min(Number(url.searchParams.get('wait') || 25000), 30000);

    const finish = (closed) => {
      if (res.writableEnded) return;
      if (closed) { client.close(); return; }
      send(res, 200, JSON.stringify(client.flush(cursor)));
    };
    res.on('close', () => finish(true));
    const first = client.flush(cursor);
    if (first.messages.length || waitMs <= 0) return finish(false);
    await client.wait(waitMs);
    return finish(false);
  }

  if (p === '/api/export') {
    const room = url.searchParams.get('room') || 'general';
    const list = store.history(room, HISTORY_PER_ROOM);
    const txt = list.map((m) => {
      const d = new Date(m.ts).toLocaleString('fr-FR');
      if (m.kind === 'system') return `— ${m.text} (${d})`;
      const body = m.file ? `${m.text ? m.text + ' ' : ''}[${m.file.name} ${human(m.file.size)}]` : m.text;
      return `[${d}] ${m.from.name}: ${body}`;
    }).join('\n');
    return send(res, 200, '\uFEFF' + txt, 'text/plain; charset=utf-8',
      { 'Content-Disposition': `attachment; filename="chat-${room}-${new Date().toISOString().slice(0, 10)}.txt"` });
  }

  return send(res, 404, JSON.stringify({ error: 'no such api route' }));
}

const requestHandler = async (req, res) => {
  // the app must be usable from any origin (phones hitting it as http://192.168.x.x,
  // the dev preview proxy, localhost, …) — so: wide-open, LAN-only CORS.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-file-name, x-file-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const proto = ARGS.https ? 'https' : 'http';
  const url = new URL(req.url, `${proto}://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('⚠️  request failed:', err.message);
    if (!res.headersSent) send(res, 500, JSON.stringify({ error: 'server error' }));
    else res.end();
  }
};

// ---------------------------------------------------------------------------
// TLS (optional) — a self-signed certificate unlocks the microphone
// (browsers only allow recording on https:// or localhost).
// ---------------------------------------------------------------------------
function ensureCert() {
  const dir = path.join(DATA_DIR, 'tls');
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, 'cert.pem');
  if (fs.existsSync(key) && fs.existsSync(crt)) return { key, crt };
  fs.mkdirSync(dir, { recursive: true });
  const ips = lanAddresses();
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => 'IP:' + ip)].join(',');
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', crt, '-days', '825',
      '-subj', '/CN=' + ARGS.name,
      '-addext', 'subjectAltName=' + san,
    ], { stdio: 'ignore' });
    log('   🔐 created a self-signed certificate in .data/tls/');
    return { key, crt };
  } catch (err) {
    console.error('⚠️  --https needs the `openssl` command in PATH:', err.message);
    console.error('    falling back to plain http (voice notes will be unavailable).');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function pruneOldFiles() {
  try {
    const files = await fsp.readdir(FILE_DIR);
    const cutoff = now() - FILE_TTL_DAYS * 86400e3;
    let removed = 0;
    for (const f of files) {
      const st = await fsp.stat(path.join(FILE_DIR, f));
      if (st.mtimeMs < cutoff) { await fsp.unlink(path.join(FILE_DIR, f)); removed++; }
    }
    if (removed) log(`   🧹 pruned ${removed} old file(s)`);
  } catch { /* no uploads yet */ }
}

function banner(server) {
  const scheme = ARGS.https ? 'https' : 'http';
  const ips = lanAddresses();
  const rule = '─'.repeat(66);
  const row = (label, value) => `   ${label.padEnd(34)} ${value}`;
  const lines = [
    '',
    rule,
    `  📡  «${ARGS.name}» — تواصل بلا إنترنت · offline-first LAN chat`,
    rule,
    row('💻  هذا الجهاز / this machine', `${scheme}://localhost:${ARGS.port}`),
  ];
  for (const ip of ips) lines.push(row('📱  الهواتف / phones', `${scheme}://${ip}:${ARGS.port}`));
  if (!ips.length) lines.push(row('⚠️  تنبيه', 'لا يوجد اتصال شبكة محلية — فعّل hotspot / connect Wi-Fi'));
  lines.push(
    rule,
    '',
    '   1) خلّي الجميع على نفس الواي فاي، أو فعّل hotspot من هاتف (بلا داتا)',
    '      everyone on the same Wi-Fi, or use a phone hotspot (no data needed)',
    '   2) كل واحد يحل الرابط فوق فالمتصفح  →  open the link above',
    '   3) «إضافة للشاشة الرئيسية» باش تولي بحال تطبيق  →  Add to Home Screen',
    '',
  );
  if (!ARGS.https) {
    lines.push('   🎙️  للرسائل الصوتية زيد  --https   (voice notes need --https)', '');
  } else {
    lines.push('   🔐 المتصفح غادي يحذر من الشهادة → «متقدم / Advanced» → كمّل', '');
  }
  console.log(lines.join('\n'));
}

async function main() {
  await fsp.mkdir(FILE_DIR, { recursive: true });
  store.load();
  await pruneOldFiles();

  let server;
  if (ARGS.https) {
    const cert = ensureCert();
    if (cert) {
      server = https.createServer({ key: fs.readFileSync(cert.key), cert: fs.readFileSync(cert.crt) }, requestHandler);
    }
  }
  if (!server) {
    ARGS.https = false;
    server = http.createServer(requestHandler);
  }

  server.on('upgrade', (req, socket) => {
    const ws = WS.upgrade(req, socket);
    if (!ws) return;
    sockets.add(ws);
    // a client that never says hello is dropped after 15 s
    setTimeout(() => { if (sockets.has(ws) && !clients.has(ws)) ws.close(1002, 'no hello'); }, 15000).unref();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n⚠️  المنفذ ${ARGS.port} مستعمل من طرف برنامج آخر.`);
      console.error(`    جرّب منفذ آخر:  node tools/offline-chat/server.mjs --port ${ARGS.port + 1}\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(ARGS.port, ARGS.host, () => {
    banner(server);
    log('   ✅ يعمل الآن — اضغط Ctrl+C للتوقف  (Ctrl+C to stop)\n');
  });

  const shutdown = async () => {
    console.log('\n   💾 saving …');
    await store.flush();
    for (const ws of [...sockets]) ws.close(1001, 'server stopping');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 800).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
