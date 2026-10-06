// Unit tests for the shipped core.js (imported, not copied).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../core.js');

const { test, section } = globalThis.__test;

// ── Buffer maths ─────────────────────────────────────────────────────────────
section('bufferedAhead');
function R(pairs) { return { length: pairs.length, start: i => pairs[i][0], end: i => pairs[i][1] }; }

test('runway inside a range', () => eq(Core.bufferedAhead(R([[0, 10]]), 4), 6));
test('runway zero inside a gap', () => eq(Core.bufferedAhead(R([[0, 2], [5, 10]]), 3), 0));
test('runway zero before first range', () => eq(Core.bufferedAhead(R([[5, 10]]), 3), 0));
test('runway at range start', () => eq(Core.bufferedAhead(R([[0, 10]]), 0), 10));
test('runway clamped at end', () => approx(Core.bufferedAhead(R([[0, 10]]), 9.99), 0.01, 1e-9));

section('bufferedAheadIncludingGap');
test('includes the gap', () => eq(Core.bufferedAheadIncludingGap(R([[5, 10]]), 3), 7));
test('no gap inside range', () => eq(Core.bufferedAheadIncludingGap(R([[0, 10]]), 4), 6));

section('gapAfter');
test('gap between ranges', () => eq(Core.gapAfter(R([[0, 2], [5, 10]]), 3), 2));
test('no gap when inside range', () => eq(Core.gapAfter(R([[0, 10]]), 4), 0));

section('bufferedBehind');
test('behind sums prior ranges', () => eq(Core.bufferedBehind(R([[0, 2], [5, 10]]), 6), 3));

section('totalBuffered / isLiveStream');
test('total across ranges', () => eq(Core.totalBuffered(R([[0, 2], [5, 10]])), 7));
test('live when duration Infinity', () => ok(Core.isLiveStream({ duration: Infinity })));
test('not live finite duration', () => ok(!Core.isLiveStream({ duration: 120, seekable: R([[0, 120]]) })));

// ── Classification ───────────────────────────────────────────────────────────
section('classifyConnection');
test('2 Mbps => slow', () => eq(Core.classifyConnection({ mbps: 2 }).level, 'slow'));
test('5 Mbps => medium', () => eq(Core.classifyConnection({ mbps: 5 }).level, 'medium'));
test('20 Mbps => fast', () => eq(Core.classifyConnection({ mbps: 20 }).level, 'fast'));
test('ratio 0.5 => slow', () => eq(Core.classifyConnection({ downloadRatio: 0.5 }).level, 'slow'));
test('ratio 1.2 => medium', () => eq(Core.classifyConnection({ downloadRatio: 1.2 }).level, 'medium'));
test('saveData => slow', () => eq(Core.classifyConnection({ saveData: true, mbps: 50 }).level, 'slow'));
test('2g => slow', () => eq(Core.classifyConnection({ effectiveType: '2g' }).level, 'slow'));
test('offline => slow', () => eq(Core.classifyConnection({ online: false, mbps: 100 }).level, 'slow'));

// ── Throughput estimator ─────────────────────────────────────────────────────
section('throughput estimator');
test('1MB over 1s => 8 Mbps', () => {
  const t = Core.createThroughputEstimator({ alpha: 1 });
  ok(t.addSample(1e6, 1000));
  approx(t.mbps, 8, 1e-9);
});
test('rejects zero-byte sample', () => {
  const t = Core.createThroughputEstimator();
  ok(!t.addSample(0, 1000));
});
test('cumulative average', () => {
  const t = Core.createThroughputEstimator();
  t.addSample(1e6, 1000);  // 8
  t.addSample(1e6, 2000);  // 4
  approx(t.cumulativeMbps, 5.3333, 0.01);
});

// ── Quality handling ─────────────────────────────────────────────────────────
section('quality');
test('label mapping', () => eq(Core.qualityLabel('hd1080'), '1080p'));
test('bitrate lookup', () => approx(Core.bitrateForQuality('1080p'), 3.5, 1e-9));
test('restore up only', () => eq(Core.qualityToRestore('720p', '1080p'), '1080p'));
test('no restore when equal', () => eq(Core.qualityToRestore('1080p', '1080p'), null));
test('never downgrade', () => eq(Core.qualityToRestore('1440p', '1080p'), null));
test('auto desired => null', () => eq(Core.qualityToRestore('720p', 'auto'), null));

// ── Settings resolution ──────────────────────────────────────────────────────
section('resolveSettings');
test('defaults present', () => {
  const s = Core.resolveSettings({});
  ok(s.smartBuffer === true);
  ok(s.resumeSec === 12);
});
test('maxSmoothness raises targets', () => {
  const s = Core.resolveSettings({ maxSmoothness: true });
  eq(s.resumeSec, 20);
  eq(s.lowWaterSec, 6);
});
test('clamps nonsense', () => {
  const s = Core.resolveSettings({ lowWaterSec: -5, resumeSec: 9999 });
  ok(s.lowWaterSec >= 1);
  ok(s.resumeSec <= 120);
});

// ── Protection FSM ───────────────────────────────────────────────────────────
section('protection FSM');
function ctx(now, over) {
  return Object.assign({
    now, enabled: true, ahead: 2, aheadTrend: -0.5, timeToEmpty: 4,
    isPlaying: true, userPaused: false, hidden: false, seeking: false,
    playable: true, live: false, graceUntil: 0
  }, over || {});
}
function newCtrl(over) {
  const s = Core.resolveSettings(Object.assign({ cooldownSec: 5, maxInterventionsPerMin: 10, maxPauseMs: 3000, resumeSec: 8, graceSec: 0 }, over || {}));
  return { ctrl: Core.createProtectionController(s), s };
}

test('pauses on low runway', () => {
  const { ctrl } = newCtrl();
  const d = ctrl.tick(ctx(1000));
  eq(d.action, 'pause');
  eq(ctrl.state, 'protecting');
});

test('resumes when runway rebuilt', () => {
  const { ctrl } = newCtrl();
  ctrl.tick(ctx(1000));
  const d = ctrl.tick(ctx(2000, { ahead: 9 }));
  eq(d.action, 'resume');
  eq(ctrl.state, 'idle');
});

test('resumes at maxPause even if not filled', () => {
  const { ctrl } = newCtrl();
  ctrl.tick(ctx(1000));
  const d = ctrl.tick(ctx(1000 + 3001, { ahead: 2 }));
  eq(d.action, 'resume');
});

test('no pause when disabled', () => {
  const { ctrl } = newCtrl();
  const d = ctrl.tick(ctx(1000, { enabled: false }));
  eq(d.action, 'none');
});

test('releases existing pause when disabled', () => {
  const { ctrl } = newCtrl();
  ctrl.tick(ctx(1000));
  const d = ctrl.tick(ctx(2000, { enabled: false }));
  eq(d.action, 'resume');
});

test('no pause when user paused', () => {
  const { ctrl } = newCtrl();
  eq(ctrl.tick(ctx(1000, { userPaused: true })).action, 'none');
});

test('no pause on live stream', () => {
  const { ctrl } = newCtrl();
  eq(ctrl.tick(ctx(1000, { live: true })).action, 'none');
});

test('no pause when recovering', () => {
  const { ctrl } = newCtrl();
  eq(ctrl.tick(ctx(1000, { aheadTrend: 0.5 })).action, 'none');
});

test('no pause when stall not imminent', () => {
  const { ctrl } = newCtrl();
  eq(ctrl.tick(ctx(1000, { timeToEmpty: 60 })).action, 'none');
});

test('cooldown blocks immediate re-pause', () => {
  const { ctrl } = newCtrl();
  ctrl.tick(ctx(1000));
  ctrl.tick(ctx(1500, { ahead: 9 })); // resume
  const d = ctrl.tick(ctx(2000, { ahead: 2 }));
  eq(d.action, 'none');   // still within 5s cooldown
  eq(d.reason, 'cooldown');
});

test('intervention cap respected', () => {
  const { ctrl } = newCtrl({ cooldownSec: 0, maxInterventionsPerMin: 2 });
  let pauses = 0;
  for (let i = 0; i < 6; i++) {
    const a = ctrl.tick(ctx(1000 + i * 10000, { ahead: 2 }));
    if (a.action === 'pause') pauses++;
    if (ctrl.state === 'protecting') ctrl.tick(ctx(1000 + i * 10000 + 4000, { ahead: 9 }));
  }
  eq(pauses, 2);
});

test('hidden tab releases unless allowed', () => {
  const { ctrl } = newCtrl();
  ctrl.tick(ctx(1000));
  eq(ctrl.tick(ctx(2000, { hidden: true })).action, 'resume');
});

// ── Rate adapter ─────────────────────────────────────────────────────────────
section('rate adapter');
function rctx(over) {
  return Object.assign({
    enabled: true, isPlaying: true, hidden: false, seeking: false,
    downloadRatio: 0.9, ahead: 2, userRate: 1
  }, over || {});
}
test('deviation capped at 8%', () => {
  const s = Core.resolveSettings({});
  const a = Core.createRateAdapter(s);
  const r = a.target(rctx());
  approx(r.rate, 0.92, 1e-9);
});
test('releases when throughput keeps up', () => {
  const a = Core.createRateAdapter(Core.resolveSettings({}));
  eq(a.target(rctx({ downloadRatio: 1.5 })).rate, null);
});
test('releases when buffer healthy', () => {
  const a = Core.createRateAdapter(Core.resolveSettings({}));
  eq(a.target(rctx({ ahead: 30 })).rate, null);
});
test('disabled => null', () => {
  const a = Core.createRateAdapter(Core.resolveSettings({}));
  eq(a.target(rctx({ enabled: false })).rate, null);
});
test('respects a lower user rate', () => {
  const a = Core.createRateAdapter(Core.resolveSettings({ rateMinRate: 0.5 }));
  const r = a.target(rctx({ userRate: 0.75, downloadRatio: 0.7 }));
  ok(r.rate !== null, 'should adapt');
  ok(r.rate <= 0.75, 'must not exceed user rate');
  approx(r.rate, 0.69, 1e-6, 'within deviation');
});

test('refuses to dip below the floor', () => {
  // userRate == rateMinRate -> no legal headroom -> release (null).
  const a = Core.createRateAdapter(Core.resolveSettings({}));
  const r = a.target(rctx({ userRate: 0.75, downloadRatio: 0.7 }));
  eq(r.rate, null);
});

// ── Series slope ─────────────────────────────────────────────────────────────
section('series slope');
test('negative slope on shrinking runway', () => {
  const s = Core.createSeries(6000);
  for (let i = 0; i <= 10; i++) s.push(i * 500, 10 - i * 0.5); // -1/s
  approx(s.slope(), -1, 0.05);
});
test('null with a single point', () => {
  const s = Core.createSeries(6000);
  s.push(0, 5);
  eq(s.slope(), null);
});
