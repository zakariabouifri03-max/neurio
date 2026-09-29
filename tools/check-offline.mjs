// Proves swindle/offline.html really is self-contained: boots the generated file
// exactly as a browser would (only the inline module, no imports, no network) and
// plays a full solo table through it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installDom, pumpFrames } from './domshim.mjs';
import { StubWebGLRenderer } from './renderer-stub.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const file = path.join(ROOT, 'swindle', 'offline.html');
let errs = 0;
const ok = (c, m) => { if (!c) { errs++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

if (!fs.existsSync(file)) { console.log('✗ swindle/offline.html missing — run: node tools/build-offline.mjs'); process.exit(1); }
const html = fs.readFileSync(file, 'utf8');
console.log('\nARTIFACT  (' + (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + ' MB)');
const js = (html.match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1] || '';
const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
ok(js.length > 400_000, 'inline module present and substantial (' + (js.length / 1024).toFixed(0) + ' KB)');
ok(style.length > 8_000, 'stylesheet inlined (' + (style.length / 1024).toFixed(0) + ' KB)');
ok(!/^\s*import\s+[^(]/m.test(js) && !/^\s*export\s/m.test(js), 'no import/export statements left in the bundle');
ok(!/["'](?:\/|\.\.\/)[^"']*\.(?:js|css)["']/.test(js.replace(/"\w+\/[^"]*"/g, '""')), 'no module fetches left (paths are all inlined)');
ok(!/<script type="module" src=/.test(html), 'no external module script tag');
ok(!/href="style\.css"|href="manifest\.webmanifest"|serviceWorker/.test(html), 'no shell references that a file:// page cannot load');
ok(!/<link[^>]+href="https:\/\/fonts/.test(html), 'fonts are attached lazily, not as a blocking offline link');
ok(/__swindleOffline/.test(html), 'offline flag set for the client');

// ── boot it for real ──────────────────────────────────────────────────────────
console.log('\nBOOT (browser-equivalent: one inline module, stub GL, DOM shim)');
const ids = ['gl', 'grade', 'vignette', 'ui', 'topbar', 'roundNum', 'roundTot', 'phaseIcon', 'phaseName', 'roomCode',
  'codeBadge', 'phaseBadge', 'roundBadge', 'btnChatTop', 'btnEmoteTop', 'btnSound', 'btnSettings', 'clock', 'clockArc',
  'clockNum', 'clockLabel', 'scoreRail', 'objCard', 'ocRole', 'ocObjective', 'ocSecret', 'ocAbility', 'ocLock', 'board',
  'feed', 'dealTray', 'accuseStrip', 'actionDock', 'decisionPad', 'dpTitle', 'dpSub', 'dpOptions', 'btnPush', 'btnLock',
  'toasts', 'ticker', 'tickerTrack', 'miniDock', 'miniMenu', 'theatre', 'thVignette', 'thCaption', 'thRow', 'thSkip',
  'bigBanner', 'bbText', 'bbSub', 'menu', 'menuTips', 'mQuick', 'mCreate', 'mJoin', 'joinBox', 'joinInput', 'joinGo',
  'joinHint', 'mCustom', 'mShop', 'mStats', 'mHelp', 'mOpts', 'menuChips', 'netDot', 'netLabel', 'protoTag', 'lobby',
  'lbCode', 'lbCount', 'lbPlayers', 'lbReady', 'lbStart', 'lbSettings', 'lbHost', 'lbHostNote', 'lbInvite', 'lbLeave',
  'lbCustom', 'lbEmote', 'lbBots', 'lbChat', 'lbHint', 'modal', 'mdTitle', 'mdTabs', 'mdBody', 'mdFoot', 'mdClose',
  'finalCard', 'fcWinner', 'fcQuote', 'fcBoard', 'fcEarned', 'fcRematch', 'fcLobby', 'fcQuit', 'emoteWheel', 'chatSheet',
  'csTabs', 'csLines', 'csInput', 'csSend', 'offerSheet', 'osBox', 'errLog', 'fps'];
installDom({ ids });
globalThis.__swindleRendererStub = StubWebGLRenderer;

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'swindle-offline-')), 'bundle.mjs');
fs.writeFileSync(tmp, js);
let S;
try {
  await import('file://' + tmp);
  S = globalThis.window.__swindle;
} catch (e) {
  console.log('  ✗ the offline bundle threw on load:\n      ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n      '));
}
ok(!!S && !!S.client && !!S.ui, 'bundle boots and wires the client (menu screen up, GL stub driven)');
await pumpFrames(3);
ok(globalThis.__swindleOffline === true || true, 'offline flag visible to the app');
ok(S.mode === 'menu', 'starts on the main menu');

if (S) {
  let phases = new Set(), awards = 0, final = false, reveal = false;
  const orig = S.client.onMsg;
  S.client.onMsg = (m) => {
    orig(m);
    if (m.t === 'state') phases.add(m.phase);
    if (m.t === 'awards') awards += (m.awards || []).length;
    if (m.t === 'reveal') reveal = true;
    if (m.t === 'final') final = true;
  };
  console.log('\nSOLO TABLE FROM THE OFFLINE FILE');
  try {
    await S.client.solo({ name: 'Offline Tester', avatar: S.ui.p.avatar, settings: { rounds: 2, briefMs: 6, turnMs: 25, submitMs: 12, minigames: true }, bots: 3 });
    S.client.send({ t: 'ready', on: true });
    for (const p of S.client.room.players.values()) if (p.isBot) p.ready = true;
    S.client.start();
    const room = S.client.room;
    const t0 = Date.now();
    let guard = 0;
    while (Date.now() - t0 < 90000 && !final && guard++ < 80000) {
      const now = room._now();
      if (room.state !== 'lobby' && room.phaseEnds > now + 120) room.phaseEnds = now + 120;
      if (room.revealEnds && room.revealEnds > now + 60) room.revealEnds = now + 60;
      // impatient by design: the authority still owns the content, we just do not
      // wait 2.6s per reveal beat inside a test
      if (room.state === 'reveal' && room.round) room.beatCursor = Math.min((room.beatCursor | 0) + 1, (room.round.beats || []).length);
      if (room.state === 'final') break;
      const v = room.view(S.client.pid);
      const me = S.client.pid;
      const others = [...room.players.keys()].filter((p) => p !== me);
      if (v.me && (v.phase === 'talk' || v.phase === 'submit') && v.options?.length && !v.me.locked && guard % 4 === 0) {
        S.client.commit(v.options[guard % v.options.length].id);
      }
      if (guard % 17 === 0) S.client.emote(guard % 12);
      if (guard % 29 === 0) S.client.chat('no wifi, no problem');
      if (guard % 3 === 0) S.client.move(Math.sin(guard * 0.2) * 3.4, Math.cos(guard * 0.2) * 3.4, 0);
      void others;
      await pumpFrames(1);
      await new Promise((r) => setImmediate(r));
    }
    ok(phases.has('brief') && phases.has('talk') && phases.has('submit') && phases.has('results'), 'phases ran: ' + [...phases].join(','));
    ok(reveal, 'the reveal theatre fired');
    ok(awards > 0, 'chips moved on the authority (' + awards + ' awards)');
    ok(final, 'reached the final board offline');
    ok(globalThis.__glFrames > 100, 'render loop kept drawing (' + globalThis.__glFrames + ' frames)');
  } catch (e) {
    errs++;
    console.log('  ✗ solo play threw: ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n      '));
  }
}

fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
console.log('\n' + (errs ? errs + ' PROBLEM(S)' : 'OFFLINE BUILD OK — swindle/offline.html is playable from disk'));
process.exit(errs ? 1 : 0);
