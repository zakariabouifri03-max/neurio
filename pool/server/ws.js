// ── Zero-dependency RFC-6455 WebSocket server (Node >= 18, ESM) ──────────────
// Implemented by hand so the whole project installs with `node server` and
// nothing else — no node_modules, no network access required at deploy time.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONT = 0x0, OP_TEXT = 0x1, OP_BIN = 0x2, OP_CLOSE = 0x8, OP_PING = 0x9, OP_PONG = 0xA;

function acceptKey(key) {
  return crypto.createHash('sha1').update(key.trim() + GUID).digest('base64');
}

/**
 * RFC 6455 §5.1: a server MUST NOT mask the frames it sends — browsers and
 * undici both drop the connection with "Frame cannot be masked" if it does.
 * Only client→server frames are masked, so `mask` defaults to false here.
 */
function encodeFrame(op, payload, mask = false) {
  const len = payload.length;
  const maskBit = mask ? 0x80 : 0;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = maskBit | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = maskBit | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | op;
  if (!mask) return Buffer.concat([header, Buffer.from(payload)]);
  const key = crypto.randomBytes(4);
  const out = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) out[i] = payload[i] ^ key[i & 3];
  return Buffer.concat([header, key, out]);
}

class WsConn extends EventEmitter {
  constructor(socket, server) {
    super();
    this.socket = socket;
    this.server = server;
    this.readyState = 1;               // OPEN
    this._buf = Buffer.alloc(0);
    this._fragOp = null;
    this._fragBuf = [];
    this._fragLen = 0;
    this.bytesIn = 0;
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('error', () => this._teardown());
    socket.on('close', () => this._teardown());
  }

  _teardown() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    try { this.socket.destroy(); } catch (e) { /* noop */ }
    this.emit('close');
  }

  _onData(chunk) {
    this.bytesIn += chunk.length;
    // crude flood guard: 4 MB of unread data → drop
    if (this._buf.length + chunk.length > 4 * 1024 * 1024) { this.close(1009, 'too much'); return; }
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    for (;;) {
      const frame = this._parseFrame();
      if (frame === null) return;      // need more bytes
      if (frame === false) return;     // protocol error, already closed
    }
  }

  _parseFrame() {
    const b = this._buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < off + 2) return null;
      len = b.readUInt16BE(off); off += 2;
    } else if (len === 127) {
      if (b.length < off + 8) return null;
      const big = b.readBigUInt64BE(off); off += 8;
      if (big > 20n * 1024n * 1024n) { this.close(1009, 'frame too big'); return false; }
      len = Number(big);
    }
    if (!masked) { this.close(1002, 'unmasked frame'); return false; } // clients MUST mask
    if (b.length < off + 4 + len) return null;
    const mask = b.subarray(off, off + 4); off += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
    this._buf = b.subarray(off + len);

    if (op === OP_PING) { this._raw(OP_PONG, payload); return true; }
    if (op === OP_PONG) { this.alive = true; return true; }
    if (op === OP_CLOSE) { this.close(1000); this._teardown(); return false; }

    if (op === OP_CONT) {
      if (this._fragOp === null) { this.close(1002, 'stray continuation'); return false; }
      this._fragBuf.push(payload); this._fragLen += len;
      if (this._fragLen > 2 * 1024 * 1024) { this.close(1009, 'message too big'); return false; }
      if (fin) {
        const full = Buffer.concat(this._fragBuf, this._fragLen);
        const fop = this._fragOp;
        this._fragOp = null; this._fragBuf = []; this._fragLen = 0;
        this._deliver(fop, full);
      }
      return true;
    }

    if (!fin) { // start of a fragmented message
      if (this._fragOp !== null) { this.close(1002, 'nested fragments'); return false; }
      this._fragOp = op; this._fragBuf = [payload]; this._fragLen = len;
      return true;
    }
    this._deliver(op, payload);
    return true;
  }

  _deliver(op, payload) {
    if (op === OP_TEXT) {
      let msg;
      try { msg = JSON.parse(payload.toString('utf8')); }
      catch (e) { this.emit('bad', 'invalid json'); return; }
      if (!msg || typeof msg !== 'object') { this.emit('bad', 'not an object'); return; }
      this.emit('message', msg);
    } else if (op === OP_BIN) {
      this.emit('binary', payload);
    } else {
      this.close(1002, 'unknown opcode');
    }
  }

  _raw(op, payload) {
    if (this.readyState !== 1) return;
    try { this.socket.write(encodeFrame(op, payload)); } catch (e) { this._teardown(); }
  }

  send(obj) {
    if (typeof obj === 'string') this._raw(OP_TEXT, Buffer.from(obj, 'utf8'));
    else this._raw(OP_TEXT, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  sendBinary(buf) { this._raw(OP_BIN, buf); }

  ping() { this.alive = false; this._raw(OP_PING, Buffer.alloc(0)); }

  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    const r = Buffer.from(String(reason).slice(0, 100), 'utf8');
    const p = Buffer.allocUnsafe(2 + r.length);
    p.writeUInt16BE(code, 0); r.copy(p, 2);
    try { this.socket.write(encodeFrame(OP_CLOSE, p)); } catch (e) { /* noop */ }
    setTimeout(() => this._teardown(), 60);
  }
}

class WsServer extends EventEmitter {
  /**
   * @param {import('node:http').Server} httpServer
   * @param {{path?:string, maxConns?:number}} opts
   */
  constructor(httpServer, opts = {}) {
    super();
    this.path = opts.path || '/ws';
    this.maxConns = opts.maxConns || 512;
    this.conns = new Set();
    httpServer.on('upgrade', (req, socket, head) => this._upgrade(req, socket, head));
    this._gc = setInterval(() => {
      for (const c of this.conns) {
        if (!c.alive) { c.close(1001, 'ping timeout'); continue; }
        c.ping();
      }
    }, 30000);
    if (this._gc.unref) this._gc.unref();
  }

  _upgrade(req, socket, head) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== this.path) { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
    if (this.conns.size >= this.maxConns) {
      socket.end('HTTP/1.1 503 Too many connections\r\n\r\n'); return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
    );
    const conn = new WsConn(socket, this);
    conn.ip = (req.headers['x-forwarded-for'] || socket.remoteAddress || '').toString().split(',')[0].trim();
    this.conns.add(conn);
    if (head && head.length) conn._onData(head);
    conn.on('close', () => { this.conns.delete(conn); this.emit('close', conn); });
    this.emit('connection', conn, req);
  }

  close() {
    clearInterval(this._gc);
    for (const c of this.conns) c.close(1001, 'server shutting down');
  }
}

export { WsServer, WsConn };
export default WsServer;
