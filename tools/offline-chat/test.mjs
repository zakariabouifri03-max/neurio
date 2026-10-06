#!/usr/bin/env node
/**
 * 🧪 self-test for «نوريو تواصل» — boots the real server on a scratch port and
 * drives the real protocol with two clients (Node's built-in fetch + WebSocket).
 *
 *   node tools/offline-chat/test.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8123 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
// a throw-away data directory: the test never touches a real chat database
const TEST_DIR = path.join(os.tmpdir(), 'nurio-test-' + process.pid);
const DATA = path.join(TEST_DIR, 'store.json');

let passed = 0, failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { passed++; console.log(`   ✅ ${label}`); }
  else { failed++; console.log(`   ❌ ${label} ${extra}`); }
};

/* ── tiny test client ─────────────────────────────────────────────────── */
class Client {
  constructor(name, id) {
    this.name = name; this.id = id;
    this.inbox = [];
    this.waiters = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        this.inbox.push(m);
        this.waiters = this.waiters.filter((w) => !w(m));
        if (m.t === 'welcome') res(m);
      });
      this.ws.addEventListener('error', rej);
      setTimeout(() => rej(new Error('timeout connecting ' + name)), 4000);
    });
    this.ws.addEventListener('open', () => this.send({ t: 'hello', id, name, color: '#4b7bec', emoji: '🙂' }));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  /** wait for the next message matching `pred` (also looks at the backlog) */
  wait(pred, ms = 3000) {
    const hit = this.inbox.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`timeout waiting (${this.name})`)), ms);
      const fn = (m) => { if (pred(m)) { clearTimeout(timer); res(m); return true; } return false; };
      this.waiters.push(fn);
    });
  }
  close() { try { this.ws.close(); } catch { } }
}

/* ── run ─────────────────────────────────────────────────────────────── */
const server = spawn(process.execPath, [path.join(HERE, 'server.mjs'), '--port', String(PORT), '--quiet'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CHAT_DATA_DIR: TEST_DIR },
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // wait for the port
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch { }
    await sleep(100);
  }

  console.log('\n🧪 «نوريو تواصل» self-test\n');

  console.log(' · HTTP');
  const health = await (await fetch(BASE + '/api/health')).json();
  ok(health.ok === true && health.name, '/api/health answers with server info');
  for (const f of ['/', '/app.js', '/style.css', '/manifest.webmanifest', '/sw.js', '/icon-192.png']) {
    const r = await fetch(BASE + f);
    ok(r.ok, `GET ${f} → ${r.status}`);
  }
  const notFound = await fetch(BASE + '/nope.txt');
  ok(notFound.status === 404, 'unknown path → 404');

  console.log(' · protocol');
  const a = new Client('يوسف', 'user-a');
  const b = new Client('سلمى', 'user-b');
  const wa = await a.ready, wb = await b.ready;
  ok(wa.you.name === 'يوسف' && wb.you.id === 'user-b', 'hello → welcome with identity');
  ok(wa.rooms.some((r) => r.id === 'general'), 'default room «general» exists');
  const peers = await a.wait((m) => m.t === 'peers' && m.peers.length >= 2);
  ok(peers.peers.length >= 2, 'both clients see each other as online');

  console.log(' · messages');
  a.send({ t: 'msg', room: 'general', id: 'm1', text: 'سلام عليكم 👋' });
  const got = await b.wait((m) => m.t === 'msg' && m.msg.id === 'm1');
  ok(got.msg.text === 'سلام عليكم 👋' && got.msg.from.name === 'يوسف', 'text message relayed to the other client');
  const echo = await a.wait((m) => m.t === 'msg' && m.msg.id === 'm1');
  ok(echo.msg.from.id === 'user-a', 'sender receives the confirmed echo');

  console.log(' · room creation');
  a.send({ t: 'room', name: 'فريق الدار', emoji: '🏠' });
  const rooms = await a.wait((m) => m.t === 'rooms' && m.rooms.some((r) => r.name === 'فريق الدار'));
  const room = rooms.rooms.find((r) => r.name === 'فريق الدار');
  ok(!!room, 'new room appears in the room list');
  const sys = await b.wait((m) => m.t === 'msg' && m.msg.kind === 'system' && m.msg.room === room.id);
  ok(/أنشأت|تم إنشاء/.test(sys.msg.text), 'system message announces the new room');

  console.log(' · direct messages');
  b.send({ t: 'dm', peer: { id: 'user-a', name: 'يوسف', color: '#4b7bec', emoji: '🙂' } });
  const dmHist = await b.wait((m) => m.t === 'history' && m.dm);
  const dmId = dmHist.room;
  ok(dmHist.dm && dmId.startsWith('dm:'), 'dm room opened');
  b.send({ t: 'msg', room: dmId, id: 'd1', text: 'خاص' });
  const dm = await a.wait((m) => m.t === 'msg' && m.msg.id === 'd1');
  ok(dm.msg.text === 'خاص', 'private message reaches the peer');

  console.log(' · uploads');
  const payload = Buffer.from('PNGDATA'.repeat(500));
  const up = await fetch(BASE + '/api/upload', {
    method: 'POST', body: payload,
    headers: { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('صورة تجريبية.png'), 'x-file-type': 'image/png' },
  });
  const meta = await up.json();
  ok(up.ok && meta.size === payload.length && meta.name === 'صورة تجريبية.png', 'upload stores the file and returns metadata');
  const back = await fetch(BASE + meta.url);
  ok(back.ok && (await back.arrayBuffer()).byteLength === payload.length, 'uploaded file downloads intact');
  const tooBig = await fetch(BASE + '/api/upload', { method: 'POST', headers: { 'content-length': String(30 * 1024 * 1024) }, body: Buffer.alloc(30 * 1024 * 1024) });
  ok(tooBig.status === 413, 'oversized upload rejected with 413');

  console.log(' · typing + delete');
  a.send({ t: 'typing', room: 'general', on: true });
  const typ = await b.wait((m) => m.t === 'typing' && m.on);
  ok(typ.from.name === 'يوسف', 'typing indicator relayed');
  a.send({ t: 'msg', room: 'general', id: 'm2', text: 'رسالة كتبقى' });
  await a.wait((m) => m.t === 'msg' && m.msg.id === 'm2');
  a.send({ t: 'delete', room: 'general', id: 'm1' });
  const del = await b.wait((m) => m.t === 'delete' && m.id === 'm1');
  ok(del.room === 'general', 'delete fans out to the room');
  b.send({ t: 'delete', room: 'general', id: 'd1' });
  await sleep(200);
  ok(!a.inbox.some((m) => m.t === 'delete' && m.id === 'd1'), 'you cannot delete someone else’s message');

  console.log(' · HTTP polling transport (WebSocket fallback)');
  const pollIn = (msg) => fetch(BASE + '/api/poll/in?sid=test-poll', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sid: 'test-poll', msg }),
  });
  const pollOut = (cursor) => fetch(BASE + `/api/poll/out?sid=test-poll&cursor=${cursor}&wait=2500`).then((r) => r.json());

  const helloOk = await pollIn({ t: 'hello', id: 'poll-user', name: 'بولر', color: '#20bf6b', emoji: '📡' });
  ok(helloOk.ok, 'poll: hello accepted over plain HTTP');
  const first = await pollOut(0);
  ok(first.messages.some((m) => m.t === 'welcome' && m.you.id === 'poll-user'), 'poll: welcome delivered');
  ok(first.messages.some((m) => m.t === 'peers' && m.peers.length >= 2), 'poll: poll client shows up in the peer list');

  a.send({ t: 'msg', room: 'general', id: 'pm1', text: 'من WebSocket لـ HTTP' });
  const second = await pollOut(first.cursor);
  ok(second.messages.some((m) => m.t === 'msg' && m.msg.text === 'من WebSocket لـ HTTP'),
    'poll: websocket message lands in the poll mailbox');

  await pollIn({ t: 'msg', room: 'general', id: 'pm2', text: 'رد من HTTP' });
  const fromPoll = await a.wait((m) => m.t === 'msg' && m.msg.id === 'pm2');
  ok(fromPoll.msg.from.name === 'بولر' && fromPoll.msg.text === 'رد من HTTP', 'poll: poll client can send to websocket clients');

  const t0 = Date.now();
  const idle = await pollOut(1e6);
  ok(Date.now() - t0 >= 1200 && idle.messages.length === 0, 'poll: idle requests are held open (no busy-waiting)');
  ok(idle.cursor <= 1e6, 'poll: cursor protocol keeps the client in sync', String(idle.cursor));

  console.log(' · export');
  const exp = await fetch(BASE + '/api/export?room=general');
  const txt = await exp.text();
  ok(exp.ok && txt.length > 0, 'chat export returns a text transcript');

  console.log(' · persistence');
  await sleep(700);                       // debounced flush
  a.close(); b.close();
  ok(fs.existsSync(DATA), 'store.json written to disk');
  const dump = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  ok(dump.rooms.some((r) => r.kind === 'dm'), 'dm rooms serialised');
  ok(dump.messages[dmId]?.some((m) => m.id === 'd1'), 'private message serialised');
  ok(!dump.messages.general?.some((m) => m.id === 'm1'), 'deleted message is gone from the store');
  const again = new Client('زائر', 'user-c');
  const wc = await again.ready;
  ok(wc.history?.general?.some((m) => m.id === 'm2'), 'history is replayed to a brand-new client');
  again.close();
}

main()
  .catch((err) => { failed++; console.log(`\n   ❌ crashed: ${err.message}`); if (serverLog) console.log(serverLog.slice(-2000)); })
  .finally(async () => {
    server.kill('SIGTERM');
    await sleep(300);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    console.log(`\n${failed ? '❌' : '🎉'} ${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
  });
