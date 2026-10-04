// ---------- Streamer Life Sim 2 — static server + WebSocket multiplayer relay ----------
// Zero dependencies. Usage: node streamer/server.mjs [port]
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';

const PORT = +(process.argv[2] || 8080);
const ROOT = join(new URL('.', import.meta.url).pathname, '..'); // repo root

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.md': 'text/plain',
};

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '' || p === '/streamer' || p === '/streamer/') {
    // redirect so the browser resolves relative assets (style.css, src/, icons/) correctly
    res.writeHead(302, { Location: '/streamer/index.html' });
    res.end();
    return;
  }
  let file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    // fallback: try under streamer/ (covers previews that strip the prefix)
    const alt = normalize(join(ROOT, 'streamer', p));
    if (alt.startsWith(ROOT) && existsSync(alt) && !statSync(alt).isDirectory()) file = alt;
    else { res.writeHead(404); res.end('404'); return; }
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
});

// ---------------- minimal WebSocket server (RFC6455, text frames) ----------------
const rooms = new Map(); // room -> Map(id -> {sock, name, x, z, yaw, mode})
let nextId = 1;

function wsAccept(key) {
  return createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}
function wsSend(sock, obj) {
  if (!sock._wsOpen) return;
  const payload = Buffer.from(JSON.stringify(obj));
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
  else if (payload.length < 65536) {
    header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  try { sock.write(Buffer.concat([header, payload])); } catch {}
}
function broadcast(room, obj, except) {
  const r = rooms.get(room); if (!r) return;
  for (const [id, p] of r) if (id !== except) wsSend(p.sock, obj);
}

server.on('upgrade', (req, sock) => {
  if (req.url.split('?')[0] !== '/ws') { sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n');
  sock._wsOpen = true;
  let buf = Buffer.alloc(0);
  let me = null; // {id, room}

  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2) {
      const b1 = buf[0], b2 = buf[1];
      const op = b1 & 0x0f;
      const masked = (b2 & 0x80) !== 0;
      let len = b2 & 0x7f, pos = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); pos = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); pos = 10; }
      let mask = null;
      if (masked) { if (buf.length < pos + 4) return; mask = buf.subarray(pos, pos + 4); pos += 4; }
      if (buf.length < pos + len) return;
      let payload = buf.subarray(pos, pos + len);
      if (mask) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(pos + len);
      if (op === 8) { sock.end(); return; }
      if (op === 9) { try { sock.write(Buffer.from([0x8a, 0])); } catch {} continue; }
      if (op === 1 || op === 2) handleMsg(payload.toString());
    }
  });

  function handleMsg(text) {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (m.t === 'join') {
      const room = String(m.room || 'ROOM').toUpperCase().slice(0, 8);
      if (!rooms.has(room)) rooms.set(room, new Map());
      const r = rooms.get(room);
      const id = 'p' + (nextId++);
      const pl = { sock, name: String(m.name || 'Streamer').slice(0, 14), x: 0, z: 0, yaw: 0, mode: 'walk' };
      r.set(id, pl);
      me = { id, room };
      const players = {};
      for (const [pid, p] of r) players[pid] = { id: pid, name: p.name, x: p.x, z: p.z, yaw: p.yaw, mode: p.mode };
      wsSend(sock, { t: 'welcome', id, players });
      broadcast(room, { t: 'pjoin', id, name: pl.name, x: 0, z: 0, yaw: 0, mode: 'walk' }, id);
      console.log(`[mp] ${pl.name} joined ${room} (${r.size} online)`);
    } else if (me && m.t === 'state') {
      const r = rooms.get(me.room); const p = r?.get(me.id);
      if (!p) return;
      p.x = m.x; p.z = m.z; p.yaw = m.yaw; p.mode = m.mode;
      broadcast(me.room, { t: 'pstate', id: me.id, x: m.x, z: m.z, yaw: m.yaw, mode: m.mode }, me.id);
    } else if (me && m.t === 'chat') {
      const r = rooms.get(me.room); const p = r?.get(me.id);
      if (!p) return;
      broadcast(me.room, { t: 'chat', id: me.id, name: p.name, msg: String(m.msg).slice(0, 200) });
      wsSend(sock, { t: 'chat', id: me.id, name: p.name, msg: String(m.msg).slice(0, 200) });
    } else if (me && m.t === 'bye') {
      leave();
    }
  }

  function leave() {
    if (!me) return;
    const r = rooms.get(me.room);
    if (r) {
      r.delete(me.id);
      broadcast(me.room, { t: 'pleave', id: me.id });
      if (r.size === 0) rooms.delete(me.room);
    }
    me = null;
  }

  sock.on('close', leave);
  sock.on('error', leave);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Streamer Life Sim 2 server → http://0.0.0.0:${PORT}/  (ws on /ws)`);
});
