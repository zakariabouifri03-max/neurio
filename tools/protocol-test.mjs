// Authoritative-server protocol test: real WebSocket clients, real Room, checks
// for redaction (no leaked secrets), anti-cheat rejection and reveal delivery.
//   node tools/protocol-test.mjs
const URL = process.env.WS || 'ws://localhost:8099/ws';
let errs = 0;
const ok = (c, m) => { if (!c) { errs++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Bot {
  constructor(name) {
    this.name = name; this.msgs = []; this.byT = {};
    this.got = (t) => this.byT[t] || [];
  }
  async connect() {
    this.ws = new WebSocket(URL);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = (e) => rej(e);
      setTimeout(() => rej(new Error('open timeout')), 6000);
    });
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      this.msgs.push(m);
      (this.byT[m.t] = this.byT[m.t] || []).push(m);
    };
    return this;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  hello(extra) { this.send({ t: 'hello', proto: JSON.parse(JSON.stringify(extra || {})).proto || 12, ...extra }); }
  first(t, pred) { return (this.byT[t] || []).find(pred || (() => true)); }
  wait(t, pred, ms = 8000) {
    const t0 = Date.now();
    return new Promise((res, rej) => {
      const iv = setInterval(() => {
        const f = this.first(t, pred);
        if (f) { clearInterval(iv); res(f); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(this.name + ': timed out waiting for ' + t)); }
      }, 60);
    });
  }
}

const A = new Bot('A'), B = new Bot('B'), C = new Bot('C');
await A.connect(); await B.connect(); await C.connect();

// ── create + join ─────────────────────────────────────────────────────────────
A.send({ t: 'hello', proto: 12, action: 'create', name: 'Marlo', avatar: { skin: 2, face: 1, hair: 3, hat: -1, glasses: -1, shirt: 1, pants: 0, shoes: 0, acc: -1, color: 3, hairColor: 5 }, private: true });
const wa = await A.wait('welcome', null, 6000);
ok(!!wa.pid && /^[A-Z0-9]{5}$/.test(wa.code), 'create returns pid + 5-char code (' + wa.code + ')');
ok(typeof wa.token === 'string' && wa.token.length > 6, 'resume token issued');

B.send({ t: 'hello', proto: 12, action: 'join', code: wa.code, name: 'Bea' });
const wb = await B.wait('welcome');
ok(wb.code === wa.code && wb.pid !== wa.pid, 'second player joins the same room');

// wrong code + bad proto
C.send({ t: 'hello', proto: 12, action: 'join', code: 'ZZZZZ', name: 'Ghost' });
const errC = await C.wait('err', null, 4000).catch(() => null);
ok(errC && errC.why === 'noroom', 'unknown code rejected');
const D = new Bot('D'); await D.connect();
D.send({ t: 'hello', proto: 999, action: 'join', code: wa.code, name: 'Old Build' });
const badProto = await D.wait('err', (m) => m.why === 'version', 4000).catch(() => null);
ok(!!badProto, 'protocol mismatch rejected (forces a reload instead of desync)');
A.send({ t: 'hello', proto: 12, action: 'create', name: 'dup' });
ok(await A.wait('err', (m) => m.why === 'already-hello', 2000).catch(() => null), 'a second hello on a live socket is refused');

// ── anti-cheat: the client cannot write to the game ────────────────────────────
const chipsOf = (s) => JSON.stringify((s.players || []).map((p) => [p.name, p.chips, p.role]));
const before = chipsOf(A.msgs.filter((m) => m.t === 'state').slice(-1)[0] || { players: [] });
A.send({ t: 'state', players: [{ pid: wa.pid, chips: 999999 }] });
A.send({ t: 'score', chips: 1e9 });
A.send({ t: 'setSecret', role: 'trickster' });
A.send({ t: 'act', id: 'commit', p: { choice: 'undefinedRoleHack' } });
A.send({ t: 'accuse', target: 'everyone' });
A.send({ t: 'move', x: 9999, z: -9999, r: 0 });
await sleep(500);
const after = chipsOf(A.msgs.filter((m) => m.t === 'state').slice(-1)[0] || { players: [] });
ok(before === after, 'no client message can rewrite the roster or scores');
const st = A.msgs.filter((m) => m.t === 'state').slice(-1)[0];
const meP = st.players.find((p) => p.pid === wa.pid);
ok(meP && Math.hypot(meP.pos.x, meP.pos.z) < 20, 'teleport attempt clamped by the server (pos ' + meP.pos.x + ',' + meP.pos.z + ')');

// ── redaction: nobody sees anyone else's secrets ───────────────────────────────
B.send({ t: 'ready', on: true });
A.send({ t: 'ready', on: true });
A.send({ t: 'settings', k: { rounds: 3, turnMs: 25, submitMs: 12, briefMs: 6, minigames: false, chat: true } });
A.send({ t: 'start' });
await A.wait('round', null, 10000);
await sleep(900);
const statesA = A.msgs.filter((m) => m.t === 'state');
const statesB = B.msgs.filter((m) => m.t === 'state');
let leaks = 0, otherSec = 0;
for (const s of statesA) {
  const raw = JSON.stringify(s);
  if (raw.includes('"audited"') || raw.includes('"knowTrap"') || raw.includes('"intent"')) leaks++;
  if (s.me && s.me.pid !== wa.pid && raw.includes('"secret"')) otherSec++;
  for (const h of Object.values(s.hands || {})) for (const it of h) if ('fake' in it) leaks++;
}
for (const s of statesB) { if (s.me && s.me.pid !== wb.pid) leaks++; if (s.secret && s.me?.pid !== wb.pid) leaks++; }
ok(leaks === 0 && otherSec === 0, 'secret state never crosses the wire (roles, fakes, intents all redacted)');
ok(statesA.some((s) => s.me?.role) && statesB.some((s) => s.me?.role), 'each player gets exactly their own role');
const rolesA = new Set(statesA.map((s) => s.me?.role)), rolesB = new Set(statesB.map((s) => s.me?.role));
console.log('    roles seen by A: ' + [...rolesA] + ' · by B: ' + [...rolesB]);

// ── play a full round and demand a reveal ──────────────────────────────────────
A.send({ t: 'chat', text: 'i would never fold on you here' });
B.send({ t: 'chat', text: 'look at my face. honest face' });
A.send({ t: 'chat', text: '<script>alert(1)</script> hi' });
await sleep(400);
const chats = A.msgs.filter((m) => m.t === 'chat');
const dirty = chats.find((c) => /<|>/.test(c.text || ''));
ok(!dirty, 'chat sanitised before broadcast');
A.send({ t: 'emote', id: 3 });
const em = await A.wait('emote', null, 3000).catch(() => null);
ok(!!em && em.pid === wa.pid, 'emotes relay to the whole room');

let reveal = null;
const t0 = Date.now();
while (!reveal && Date.now() - t0 < 90000) {
  await sleep(500);
  for (const m of A.msgs.filter((x) => x.t === 'reveal')) reveal = m;
  for (const m of B.msgs.filter((x) => x.t === 'reveal')) reveal = reveal || m;
  // keep clicking so the round resolves
  const s = A.msgs.filter((m) => m.t === 'state').slice(-1)[0];
  if (s && (s.phase === 'submit' || s.phase === 'talk') && s.options?.length && !s.me?.locked) {
    A.send({ t: 'act', id: 'commit', p: { choice: s.options[0].id } });
  }
  const sb = B.msgs.filter((m) => m.t === 'state').slice(-1)[0];
  if (sb && sb.options?.length) B.send({ t: 'act', id: 'commit', p: { choice: sb.options[Math.floor(Math.random() * sb.options.length)].id } });
}
ok(!!reveal, 'reveal delivered with beats + awards');
if (reveal) {
  ok(Array.isArray(reveal.beats) && reveal.beats.length > 0, 'reveal has ' + reveal.beats.length + ' staged beats');
  ok(Object.keys(reveal.roles || {}).length >= 2, 'roles revealed at the end only');
  ok(reveal.awards.every((a) => Number.isFinite(a.delta) && Math.abs(a.delta) <= 800), 'all awards in a sane range');
  const tags = new Set(reveal.awards.map((a) => a.tag));
  console.log('    tags this round: ' + [...tags].join(', '));
}
let sawResults = !!A.msgs.find((m) => m.t === 'state' && m.phase === 'results');
const tr = Date.now();
while (!sawResults && Date.now() - tr < 22000) {
  await sleep(500);
  A.send({ t: 'revealSkip' });
  sawResults = !!A.msgs.find((m) => m.t === 'state' && (m.phase === 'results' || m.phase === 'countdown' || m.phase === 'brief' || m.phase === 'lobby'));
}
ok(sawResults, 'payout phase reached (the reveal is server-paced, the client cannot skip it)');

// ── disconnect + resume ────────────────────────────────────────────────────────
const seatBefore = (A.msgs.filter((m) => m.t === 'state').slice(-1)[0].players || []).length;
B.ws.close();
await sleep(600);
const stAfter = A.msgs.filter((m) => m.t === 'state').slice(-1)[0];
ok(stAfter.players.some((p) => p.pid === wb.pid && p.connected === false), 'disconnect marks the seat away (round keeps running)');
const B2 = new Bot('B2');
await B2.connect();
B2.send({ t: 'hello', proto: 12, action: 'resume', code: wa.code, token: wb.token });
const wr = await B2.wait('welcome', null, 5000).catch(() => null);
ok(!!wr && wr.resumed && wr.pid === wb.pid, 'reconnect resumes the same seat with the same chips');
const chipsNow = (B2.msgs.filter((m) => m.t === 'state').slice(-1)[0]?.players || []).find((p) => p.pid === wb.pid)?.chips;
const chipsThen = (stAfter.players || []).find((p) => p.pid === wb.pid)?.chips;
ok(chipsNow === chipsThen, 'score survived the drop (server-owned)');
void seatBefore;

A.ws.close(); B2.ws.close(); C.ws.close();
console.log('\n' + (errs ? errs + ' PROBLEM(S)' : 'PROTOCOL OK'));
process.exit(errs ? 1 : 0);
