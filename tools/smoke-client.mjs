// Headless client smoke test: runs the real main.js (renderer stubbed), opens a
// local table with bots, fast-forwards a whole game and exercises every UI
// surface. Anything that would throw in the browser throws here.
import { register } from 'node:module';
register(new URL('./three-resolver.mjs', import.meta.url).href, import.meta.url);
import { installDom, pumpFrames } from './domshim.mjs';

const ids = ['gl', 'grade', 'vignette', 'ui', 'topbar', 'roundNum', 'roundTot', 'phaseIcon', 'phaseName', 'roomCode',
  'codeBadge', 'phaseBadge', 'roundBadge', 'btnChatTop', 'btnEmoteTop', 'btnSound', 'btnSettings', 'clock', 'clockArc',
  'clockNum', 'clockLabel', 'scoreRail', 'objCard', 'ocRole', 'ocObjective', 'ocSecret', 'ocAbility', 'ocLock', 'board',
  'feed', 'dealTray', 'accuseStrip', 'actionDock', 'decisionPad', 'dpTitle', 'dpSub', 'dpOptions', 'btnPush', 'btnLock',
  'speechLayer', 'toasts', 'ticker', 'tickerTrack', 'miniDock', 'miniMenu', 'theatre', 'thVignette', 'thCaption',
  'thRow', 'thSkip', 'bigBanner', 'bbText', 'bbSub', 'menu', 'menuTips', 'mQuick', 'mCreate', 'mJoin', 'joinBox',
  'joinInput', 'joinGo', 'joinHint', 'mCustom', 'mShop', 'mStats', 'mHelp', 'mOpts', 'menuChips', 'netDot', 'netLabel',
  'protoTag', 'lobby', 'lbCode', 'lbCount', 'lbPlayers', 'lbReady', 'lbStart', 'lbSettings', 'lbHost', 'lbHostNote',
  'lbInvite', 'lbLeave', 'lbCustom', 'lbEmote', 'lbBots', 'lbChat', 'lbHint', 'modal', 'mdTitle', 'mdTabs', 'mdBody',
  'mdFoot', 'mdClose', 'finalCard', 'fcWinner', 'fcQuote', 'fcBoard', 'fcEarned', 'fcRematch', 'fcLobby', 'fcQuit',
  'emoteWheel', 'chatSheet', 'csTabs', 'csLines', 'csInput', 'csSend', 'offerSheet', 'osBox', 'errLog', 'fps'];
const { get } = installDom({ ids });
globalThis.__frameErrors = [];

let errs = 0;
const step = async (label, fn) => {
  try { await fn(); console.log('  ✓ ' + label); }
  catch (e) { errs++; console.log('  ✗ ' + label + ' → ' + (e?.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e)); }
};

console.log('\nBOOT');
let main;
await step('import main.js (scene + UI + client wire-up)', async () => { main = await import('../swindle/js/main.js'); });
await step('menu renders a first frame', async () => { globalThis.__renderLoop && globalThis.__renderLoop(); await pumpFrames(3); });

const S = globalThis.window.__swindle;
await step('debug surface present', async () => {
  if (!S || !S.client || !S.ui) throw new Error('no __swindle hook');
});

// ── UI surfaces ───────────────────────────────────────────────────────────────
console.log('\nUI SURFACES');
for (const [name, fn] of [
  ['help modal', () => S.ui.openHelp()],
  ['options modal', () => S.ui.openOptions()],
  ['stats modal', () => S.ui.openStats()],
  ['shop modal', () => S.ui.openShop()],
  ['character editor', () => S.ui.openCustomize()],
  ['close modal', () => S.ui.closeModal()],
  ['chat sheet', () => S.ui.toggleChat(true)],
  ['chat send', () => { S.ui.renderChatLines(); get('#csInput').value = 'i counted it twice, the seal is honest'; get('#csSend').click(); }],
  ['emote wheel', () => S.ui.toggleEmotes(true)],
  ['banner + toast', () => { S.ui.banner('SCAM SUCCESS', 'signed, sealed, no regrets'); }],
  ['feed', () => S.ui.feed('<b>Marlo</b> +240 · SCAM_SUCCESS', 'good')],
  ['picker', () => S.ui.openPicker({ title: 'Flag whose hands?', sub: 'one target', items: [{ id: 'p1', label: 'Bea', icon: '🙂' }], onPick: () => {} })],
  ['final card', () => S.ui.showFinal({ board: [{ pid: 'p1', name: 'Marlo', chips: 2100, earned: 240, stats: { scams: 2, catches: 1, wrong: 0, voids: 0 } }], me: 'p1', quote: 'test' })],
]) {
  await step(name, async () => { fn(); await pumpFrames(2); });
}

// ── a full local game, fast-forwarded ─────────────────────────────────────────
console.log('\nLOCAL TABLE (real authority Room + real client wiring)');
let sawPhases = new Set(), sawReveal = false, sawAwards = 0, sawFinal = false, chatSeen = 0, emoteSeen = 0, errLines = [];
await step('open solo room with 3 bots', async () => {
  const orig = S.client.onMsg;
  S.client.onMsg = (m) => {
    try { orig(m); } catch (e) { errLines.push(m.t + ': ' + (e?.stack || e)); throw e; }
    if (m.t === 'state') sawPhases.add(m.phase);
    if (m.t === 'reveal') { sawReveal = true; }
    if (m.t === 'awards') sawAwards += (m.awards || []).length;
    if (m.t === 'final') sawFinal = true;
    if (m.t === 'chat') chatSeen++;
    if (m.t === 'emote') emoteSeen++;
  };
  await S.client.solo({ name: 'Tester', avatar: S.ui.p.avatar, settings: { rounds: 2, briefMs: 6, turnMs: 25, submitMs: 12, minigames: true, chat: true }, bots: 3 });
  S.client.send({ t: 'ready', on: true });
  for (const p of S.client.room.players.values()) if (p.isBot) p.ready = true;
  S.client.start();
});

await step('fast-forward two full rounds + final, pumping frames', async () => {
  const room = S.client.room;
  if (!room) throw new Error('no local room (online mode?)');
  const t0 = Date.now();
  let guard = 0;
  while (Date.now() - t0 < 60000 && guard++ < 60000) {
    // squash every wait down to ~120ms so the state machine sprints
    const now = room._now();
    if (room.phaseEnds > now + 120 && room.state !== 'lobby') room.phaseEnds = now + 120;
    if (room.revealEnds && room.revealEnds > now + 60) room.revealEnds = now + 60;
    if (room.state === 'final') break;
    // click things like a player would
    const v = room.view([...room.players.keys()][0]);
    const mePid = S.client.pid;
    if (v.me && (v.phase === 'talk' || v.phase === 'submit')) {
      if (v.options?.length && !v.me.locked && guard % 4 === 0) S.client.commit(v.options[guard % v.options.length].id);
      if (v.actions?.length && guard % 7 === 0) {
        const a = v.actions[0];
        S.client.act(a.id, { target: [...room.players.keys()].find((p) => p !== mePid), cases: [0, 1], lots: [0], amount: 2 });
      }
      if (v.roundInfo?.accuse && guard % 9 === 0) S.client.accuse([...room.players.keys()].find((p) => p !== mePid));
      if (v.roundInfo?.push && guard % 11 === 0) S.client.push(true);
      if (v.offers?.length && guard % 5 === 0) for (const o of v.offers) if (o.to === mePid && o.status === 'open') S.client.offerResp(o.id, guard % 2 === 0);
      if (v.roundInfo?.offers && guard % 6 === 0) {
        const to = [...room.players.keys()].find((p) => p !== mePid);
        const inv = v.inv || [];
        S.client.offer({ to, giveItem: inv[0]?.uid, wantItem: (v.hands?.[to] || [])[0]?.uid, giveChips: 40, wantChips: 90, note: 'quick, no pressure' });
        S.client.offerVoid('o1', true);
      }
    }
    if (guard % 13 === 0) S.client.chat('sign it tonight and I will forget the number');
    if (guard % 17 === 0) S.client.emote(guard % 12);
    if (guard % 3 === 0) S.client.move(Math.sin(guard * 0.3) * 3.6, Math.cos(guard * 0.3) * 3.6, guard * 0.1);
    await pumpFrames(1);
    await new Promise((r) => setImmediate(r));
  }
  console.log('      phases: ' + [...sawPhases].join(',') + ' · reveal=' + sawReveal + ' · awards=' + sawAwards + ' · final=' + sawFinal + ' · chat=' + chatSeen + ' · emotes=' + emoteSeen);
  if (errLines.length) throw new Error(errLines.slice(0, 2).join(' || '));
  if (!sawReveal) throw new Error('no reveal packet ever reached the client');
  if (!sawFinal) throw new Error('never reached the final board');
  if (!sawPhases.has('submit') || !sawPhases.has('results')) throw new Error('phase machine skipped something: ' + [...sawPhases]);
});

await step('lobby sync after the game (rematch path)', async () => {
  S.client.rematch(true);
  await pumpFrames(4);
  if (!S.client.room) throw new Error('lost the room');
});
await step('customise + avatar relay', async () => {
  S.ui.p.avatar.skin = 4; S.ui.p.avatar.hat = 3;
  S.client.setAvatar(S.ui.p.avatar);
  S.client.send({ t: 'name', name: 'Slick Pickle' });
  await pumpFrames(2);
});
await step('quality switch mid-session', async () => {
  for (const q of ['low', 'ultra', 'medium']) { S.applyQuality(q); await pumpFrames(2); }
});
await step('keyboard controls', async () => {
  const hd = globalThis.document.body.parentNode; void hd;
  // main.js listens on window/document in the browser; simulate via its key handler
  const ev = (k, type = 'keydown') => ({ key: k, target: { tagName: 'DIV' }, preventDefault() {} });
  // no direct handle exposed → call through the registered handler list kept by the shim
  for (const k of ['w', 'a', 's', 'd', '1', '2', 'q', 't', 'e', 'f', 'x', ' ', 'Escape']) globalThis.__keyEvt?.(ev(k));
  await pumpFrames(2);
});
await step('leave back to menu', async () => {
  S.ui.on.leave();
  await pumpFrames(2);
  if (S.mode !== 'menu') throw new Error('did not return to menu');
});

console.log('\ngl frames rendered: ' + globalThis.__glFrames + ' · errors: ' + errs);
console.log(errs ? '\n' + errs + ' PROBLEM(S)' : '\nCLIENT SMOKE OK');
process.exit(errs ? 1 : 0);
