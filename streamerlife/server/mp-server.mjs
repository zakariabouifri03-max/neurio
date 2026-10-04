// ── Streamer Life — multiplayer server (zero dependencies) ─────────────────
// Serves the game over HTTP *and* hosts the WebSocket world on the same port.
//   node server/mp-server.mjs            → http://localhost:8787
//   PORT=3000 node server/mp-server.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 8787;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});

// ── minimal RFC6455 WebSocket ──────────────────────────────────────────────
const clients = new Set();
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  const c = { socket, id: crypto.randomUUID().slice(0, 8), name: 'player', room: 'medina', x: 0, y: 0, z: 0, r: 0, h: 0, c: 0, buf: Buffer.alloc(0) };
  clients.add(c);
  send(c, { t: 'welcome', id: c.id, count: clients.size });

  socket.on('data', (chunk) => { c.buf = Buffer.concat([c.buf, chunk]); drain(c); });
  socket.on('close', () => { clients.delete(c); broadcast(c.room, { t: 'sys', msg: `${c.name} left` }, c); });
  socket.on('error', () => { clients.delete(c); });
});

function drain(c) {
  while (true) {
    const b = c.buf;
    if (b.length < 2) return;
    const op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    const maskLen = masked ? 4 : 0;
    if (b.length < off + maskLen + len) return;
    const mask = masked ? b.subarray(off, off + 4) : null;
    const data = Buffer.from(b.subarray(off + maskLen, off + maskLen + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    c.buf = b.subarray(off + maskLen + len);
    if (op === 8) { c.socket.end(); clients.delete(c); return; }
    if (op === 9) { frame(c.socket, data, 0xA); continue; }
    if (op === 1) { try { handle(c, JSON.parse(data.toString('utf8'))); } catch { } }
  }
}
function frame(socket, payload, op = 1) {
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | op;
  try { socket.write(Buffer.concat([head, payload])); } catch { }
}
const send = (c, o) => frame(c.socket, Buffer.from(JSON.stringify(o)));
function broadcast(room, o, except) { for (const c of clients) if (c.room === room && c !== except) send(c, o); }

function handle(c, m) {
  if (m.t === 'join') {
    c.name = String(m.name || 'player').slice(0, 16); c.room = String(m.room || 'medina').slice(0, 24);
    broadcast(c.room, { t: 'sys', msg: `${c.name} joined` }, c);
    console.log(`+ ${c.name} joined room "${c.room}" (${clients.size} online)`);
  } else if (m.t === 'pos') { Object.assign(c, { x: m.x, y: m.y, z: m.z, r: m.r, h: m.h, c: m.c }); }
  else if (m.t === 'chat') broadcast(c.room, { t: 'chat', name: c.name, msg: String(m.msg).slice(0, 160) });
}

// world state tick (15 Hz)
setInterval(() => {
  const rooms = new Map();
  for (const c of clients) { if (!rooms.has(c.room)) rooms.set(c.room, []); rooms.get(c.room).push(c); }
  for (const [, list] of rooms) {
    const players = list.map(c => ({ id: c.id, name: c.name, x: c.x, y: c.y, z: c.z, r: c.r, h: c.h, c: c.c }));
    for (const c of list) send(c, { t: 'state', players });
  }
}, 66);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Streamer Life server → http://localhost:${PORT}  (WebSocket on the same port)`);
  console.log('   Friends on your Wi-Fi: use ws://YOUR-LOCAL-IP:' + PORT);
});
