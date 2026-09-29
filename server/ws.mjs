// ═════════════════════════════════════════════════════════════════════════════
// Zero-dependency WebSocket (RFC 6455) server transport, written for this repo.
// Only what the game needs: text frames, ping/pong, close, fragmentation,
// masking, back-pressure-safe writes. No npm packages.
// ═════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 4 * 1024 * 1024;

export function isUpgrade(req) {
  const up = String(req.headers.upgrade || '').toLowerCase();
  return up === 'websocket' && String(req.headers.connection || '').toLowerCase().includes('upgrade');
}

export function acceptSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n' +
    '\r\n',
  );
  return new WSConn(socket, req);
}

export class WSConn {
  constructor(socket, req) {
    this.socket = socket;
    this.req = req;
    this.alive = true;
    this.ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').toString().split(',')[0].trim();
    this.onmessage = null;
    this.onclose = null;
    this._frag = null;
    this._len = 0;
    this._buf = Buffer.alloc(0);
    this._lastPong = Date.now();
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._die('socket'));
    socket.on('error', () => this._die('error'));
    socket.setNoDelay(true);
  }

  _die(why) {
    if (!this.alive) return;
    this.alive = false;
    try { this.socket.destroy(); } catch (e) { /* already gone */ }
    if (this.onclose) { try { this.onclose(why); } catch (e) { /* handler error */ } }
  }

  _data(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    let guard = 0;
    while (this.alive && guard++ < 64) {
      const f = this._frame();
      if (f === 'again') break;
      if (f === 'fail') { this._close(1009, 'frame'); return; }
    }
  }

  _frame() {
    const b = this._buf;
    if (b.length < 2) return 'again';
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) { if (b.length < off + 2) return 'again'; len = b.readUInt16BE(off); off += 2; }
    else if (len === 127) { if (b.length < off + 8) return 'again'; const big = b.readBigUInt64BE(off); if (big > BigInt(MAX_FRAME)) return 'fail'; len = Number(big); off += 8; }
    if (len > MAX_FRAME) return 'fail';
    if (!masked) return 'fail'; // clients must mask
    if (b.length < off + 4 + len) return 'again';
    const mask = b.subarray(off, off + 4); off += 4;
    const payload = Buffer.from(b.subarray(off, off + len));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this._buf = b.subarray(off + len);
    if (op === 0x8) { this._close(1000, 'peer'); return 'stop'; }
    if (op === 0x9) { this._raw(0xa, payload); return 'more'; }
    if (op === 0xa) { this._lastPong = Date.now(); return 'more'; }
    if (op === 0x1 || op === 0x2 || op === 0x0) {
      if (op === 0x0) { if (this._frag) { this._frag.push(payload); this._len += payload.length; } }
      else { this._frag = fin ? [payload] : [payload]; this._len = payload.length; }
      if (fin) {
        const full = Buffer.concat(this._frag); this._frag = null;
        const text = full.toString('utf8');
        if (this.onmessage) { try { this.onmessage(text); } catch (e) { /* handler blew up */ } }
      }
      return 'more';
    }
    return 'fail';
  }

  _raw(op, payload) {
    if (!this.alive) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.from([0x80 | op, len]); }
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.socket.write(Buffer.concat([head, payload])); } catch (e) { this._die('write'); }
  }

  send(obj) {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    this._raw(0x1, Buffer.from(s, 'utf8'));
  }

  _close(code, why) {
    try {
      const p = Buffer.alloc(2); p.writeUInt16BE(code || 1000, 0);
      this._raw(0x8, p);
    } catch (e) { /* ignore */ }
    this._die(why || 'close');
  }
  close() { this._close(1000, 'server'); }

  get bufferedAmount() { try { return this.socket.writableLength; } catch (e) { return 0; } }
}

/** Liveness sweep: drop sockets that stopped answering pings. */
export function startPingSweep(conns, ms = 25000) {
  const t = setInterval(() => {
    const now = Date.now();
    for (const c of [...conns]) {
      if (!c.alive) { conns.delete(c); continue; }
      if (now - c._lastPong > ms * 2.5) { c._close(1001, 'stale'); conns.delete(c); continue; }
      c._raw(0x9, Buffer.alloc(0));
    }
  }, ms);
  if (t.unref) t.unref();
  return t;
}
