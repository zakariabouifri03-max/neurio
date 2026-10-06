/*
 * YouTube Smooth 1080p — core.js
 * ---------------------------------------------------------------------------
 * Pure, dependency-free logic: buffer maths, throughput estimation, connection
 * classification, the Smart Buffer Protection state machine and the optional
 * playback-rate adapter.
 *
 * This file deliberately touches NOTHING browser-specific (no DOM, no chrome.*)
 * so the exact same code that ships in the extension can be unit-tested under
 * Node (`npm test` in this folder). Everything that touches the page lives in
 * content.js / page.js / background.js.
 *
 * UMD-ish export: `globalThis.YTSmoothCore` in the browser, module.exports in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YTSmoothCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── Settings ───────────────────────────────────────────────────────────────
  var DEFAULT_SETTINGS = {
    // Master switches (mirrored in the popup)
    smartBuffer: true,      // Smart Buffer Protection ON/OFF
    maxSmoothness: false,   // Maximum Smoothness Mode
    hudEnabled: false,      // In-page dashboard overlay

    // Smart Buffer Protection tuning
    lowWaterSec: 4,         // playable runway below which we consider intervening
    resumeSec: 12,          // playable runway required before we resume
    maxPauseMs: 8000,       // never hold a protective pause longer than this
    minPauseMs: 1500,       // shortest useful protective pause
    cooldownSec: 25,        // minimum gap between two interventions
    maxInterventionsPerMin: 3,
    graceSec: 3,            // hands-off window after play/seek
    protectHiddenTab: false,// do not pause a video in a background tab

    // Optional levers (OFF by default — see README "What this can and cannot do")
    rateAdapt: false,       // nudge playbackRate down a few % to grow the buffer
    rateMaxDeviation: 0.08, // never more than 8 % slower than the user's speed
    rateMinRate: 0.75,      // absolute floor for the adapted rate
    pinQuality: false,      // best-effort restore of the user's chosen quality

    // Experimental (needs the optional declarativeNetRequest permission)
    reduceRequests: false,

    // Internals
    pollMs: 500,            // monitor tick
    pushMs: 2000,           // snapshot push to the service worker
    sampleWindowMs: 6000    // sliding window used for trend/throughput maths
  };

  // Applied when Maximum Smoothness Mode is ON. Only the knobs that can be
  // changed *honestly* — bigger safety margins, earlier intervention, tighter
  // monitoring. It never touches resolution.
  var MAX_SMOOTHNESS_OVERRIDES = {
    lowWaterSec: 6,
    resumeSec: 20,
    cooldownSec: 15,
    maxInterventionsPerMin: 5,
    pollMs: 350,
    pushMs: 1500,
    sampleWindowMs: 8000
  };

  function defaults() { return Object.assign({}, DEFAULT_SETTINGS); }

  /** Merge user settings + Maximum Smoothness overrides into a resolved config. */
  function resolveSettings(user) {
    var s = Object.assign({}, DEFAULT_SETTINGS, user || {});
    if (s.maxSmoothness) Object.assign(s, MAX_SMOOTHNESS_OVERRIDES);
    // Defensive clamping — the options page validates too, but the FSM must
    // never see nonsense even if storage was hand-edited.
    s.lowWaterSec = clamp(num(s.lowWaterSec, 4), 1, 30);
    s.resumeSec = clamp(num(s.resumeSec, 12), s.lowWaterSec + 2, 120);
    s.maxPauseMs = clamp(num(s.maxPauseMs, 8000), 1500, 60000);
    s.minPauseMs = clamp(num(s.minPauseMs, 1500), 500, 10000);
    s.cooldownSec = clamp(num(s.cooldownSec, 25), 5, 300);
    s.maxInterventionsPerMin = clamp(num(s.maxInterventionsPerMin, 3), 1, 20);
    s.graceSec = clamp(num(s.graceSec, 3), 0, 30);
    s.pollMs = clamp(num(s.pollMs, 500), 200, 5000);
    s.pushMs = clamp(num(s.pushMs, 2000), 500, 30000);
    s.sampleWindowMs = clamp(num(s.sampleWindowMs, 6000), 2000, 60000);
    s.rateMaxDeviation = clamp(num(s.rateMaxDeviation, 0.08), 0, 0.25);
    s.rateMinRate = clamp(num(s.rateMinRate, 0.75), 0.25, 1);
    return s;
  }

  // ── Small helpers ──────────────────────────────────────────────────────────
  function num(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function formatSeconds(sec) {
    if (!isFinite(sec)) return '—';
    sec = Math.max(0, sec);
    var s = Math.floor(sec % 60);
    var m = Math.floor(sec / 60) % 60;
    var h = Math.floor(sec / 3600);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m > 0 ? m + ':' + pad(s) : s + 's';
  }

  function formatMbps(mbps) {
    if (typeof mbps !== 'number' || !isFinite(mbps)) return '—';
    return (mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)) + ' Mbps';
  }

  // ── Buffer maths ───────────────────────────────────────────────────────────
  /**
   * Index of the buffered range containing `t` (with a small tolerance for the
   * float wobble Chrome reports while appending), or -1.
   */
  function rangeIndexAt(timeRanges, t, tolerance) {
    if (!timeRanges || typeof timeRanges.length !== 'number') return -1;
    var tol = typeof tolerance === 'number' ? tolerance : 0.05;
    for (var i = 0; i < timeRanges.length; i++) {
      if (t >= timeRanges.start(i) - tol && t < timeRanges.end(i)) return i;
    }
    return -1;
  }

  /** Total seconds buffered across all ranges. */
  function totalBuffered(timeRanges) {
    var total = 0;
    if (!timeRanges) return 0;
    for (var i = 0; i < timeRanges.length; i++) total += timeRanges.end(i) - timeRanges.start(i);
    return total;
  }

  /**
   * Playable runway: how many seconds of media can play from `t` without
   * stalling. Returns 0 when `t` sits in a gap (playback would stall now).
   */
  function bufferedAhead(timeRanges, t) {
    var i = rangeIndexAt(timeRanges, t);
    if (i < 0) return 0;
    return Math.max(0, timeRanges.end(i) - t);
  }

  /** End of the current-or-next range minus `t` (playable runway + any gap). */
  function bufferedAheadIncludingGap(timeRanges, t) {
    if (!timeRanges) return 0;
    for (var i = 0; i < timeRanges.length; i++) {
      if (timeRanges.end(i) > t) return Math.max(0, timeRanges.end(i) - t);
    }
    return 0;
  }

  /** Seconds of gap between `t` and the next buffered range (0 if none/playing). */
  function gapAfter(timeRanges, t) {
    if (!timeRanges) return 0;
    if (rangeIndexAt(timeRanges, t) >= 0) return 0;
    for (var i = 0; i < timeRanges.length; i++) {
      if (timeRanges.start(i) > t) return timeRanges.start(i) - t;
      if (timeRanges.end(i) > t) return 0;
    }
    return 0;
  }

  /** How much media is already buffered behind the playhead. */
  function bufferedBehind(timeRanges, t) {
    var total = 0;
    if (!timeRanges) return 0;
    for (var i = 0; i < timeRanges.length; i++) {
      var start = timeRanges.start(i);
      var end = Math.min(timeRanges.end(i), t);
      if (end > start) total += end - start;
    }
    return total;
  }

  /** True for live streams, where pausing to buffer is actively harmful. */
  function isLiveStream(video) {
    if (!video) return false;
    if (!isFinite(video.duration)) return true;
    try {
      if (video.seekable && video.seekable.length) {
        var end = video.seekable.end(video.seekable.length - 1);
        // Live players keep sliding the seekable window; the playhead sits near
        // the moving edge and duration is Infinity.
        if (!isFinite(end)) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  // ── Sample buffer (time-series helper) ─────────────────────────────────────
  /** Fixed-size rolling window of {t, v} points with a least-squares slope. */
  function createSeries(windowMs) {
    var pts = [];
    var win = windowMs || 6000;
    return {
      setWindow: function (ms) { win = ms; if (pts.length) prune(pts[pts.length - 1].t); },
      push: function (t, v) {
        pts.push({ t: t, v: v });
        prune(t);
      },
      prune: function (now) { prune(now); },
      clear: function () { pts.length = 0; },
      get length() { return pts.length; },
      points: function () { return pts.slice(); },
      /** units per second over the window (least-squares, robust to jitter). */
      slope: function () {
        if (pts.length < 2) return null;
        var n = pts.length, sx = 0, sy = 0, sxy = 0, sxx = 0;
        for (var i = 0; i < n; i++) {
          var x = (pts[i].t - pts[0].t) / 1000;
          var y = pts[i].v;
          sx += x; sy += y; sxy += x * y; sxx += x * x;
        }
        var denom = n * sxx - sx * sx;
        if (Math.abs(denom) < 1e-9) return null;
        return (n * sxy - sx * sy) / denom;
      },
      /** Simple endpoint delta rate; used as a sanity cross-check on slope(). */
      endpointRate: function () {
        if (pts.length < 2) return null;
        var a = pts[0], b = pts[pts.length - 1];
        var dt = (b.t - a.t) / 1000;
        if (dt <= 0.05) return null;
        return (b.v - a.v) / dt;
      },
      spanMs: function () {
        return pts.length < 2 ? 0 : pts[pts.length - 1].t - pts[0].t;
      }
    };
    function prune(now) {
      while (pts.length && now - pts[0].t > win) pts.shift();
      while (pts.length > 240) pts.shift();
    }
  }

  // ── Throughput estimation ──────────────────────────────────────────────────
  /**
   * EWMA of real byte measurements. The only *measured* Mbps figure we ever
   * show comes from here (Resource Timing entries for media requests whose
   * transferSize the browser was willing to expose).
   */
  function createThroughputEstimator(opts) {
    opts = opts || {};
    var alpha = num(opts.alpha, 0.35);
    var mbps = null;
    var samples = 0;
    var bytesTotal = 0;
    var msTotal = 0;
    return {
      /** bytes: transferred bytes, ms: request duration */
      addSample: function (bytes, ms) {
        if (!(bytes > 0) || !(ms > 20)) return false; // ignore redirects/cached/no-info
        var v = (bytes * 8) / (ms / 1000) / 1e6;
        if (!(v > 0) || !isFinite(v)) return false;
        mbps = mbps === null ? v : mbps * (1 - alpha) + v * alpha;
        samples++; bytesTotal += bytes; msTotal += ms;
        return true;
      },
      get mbps() { return mbps; },
      get samples() { return samples; },
      get bytesTotal() { return bytesTotal; },
      get msTotal() { return msTotal; },
      /** Cumulative average — a stable floor when the EWMA has few samples. */
      get cumulativeMbps() {
        return msTotal > 0 ? (bytesTotal * 8) / (msTotal / 1000) / 1e6 : null;
      },
      reset: function () { mbps = null; samples = 0; bytesTotal = 0; msTotal = 0; }
    };
  }

  /**
   * Rough *streaming* bitrates (Mbps) per quality label, used ONLY to convert a
   * measured download ratio into an approximate Mbps figure when the browser
   * refuses to expose transfer sizes. Always reported with source='derived'.
   * These are conservative DASH-serving figures, not YouTube's upload targets.
   */
  var STREAM_BITRATE_MBPS = {
    '144p': 0.1, '240p': 0.35, '360p': 0.6, '480p': 1.0,
    '720p': 2.0, '720p60': 2.6, '1080p': 3.5, '1080p60': 5.0,
    '1440p': 8.0, '1440p60': 11.0, '2160p': 20.0, '2160p60': 30.0, '4320p': 45.0
  };

  function bitrateForQuality(label) {
    if (!label) return null;
    var direct = STREAM_BITRATE_MBPS[label];
    if (typeof direct === 'number') return direct;
    var m = String(label).match(/(\d+)\s*p/i);
    if (m) {
      var h = parseInt(m[1], 10);
      var keys = Object.keys(STREAM_BITRATE_MBPS).map(function (k) {
        return { k: k, h: parseInt(k, 10) };
      }).filter(function (o) { return isFinite(o.h); })
        .sort(function (a, b) { return Math.abs(a.h - h) - Math.abs(b.h - h); });
      if (keys.length) return STREAM_BITRATE_MBPS[keys[0].k];
    }
    return null;
  }

  // ── Connection classification ──────────────────────────────────────────────
  var CONNECTION_BANDS = { slowBelow: 3, fastAbove: 10 };

  /**
   * @param input {mbps, downloadRatio, effectiveType, saveData, online}
   *   downloadRatio = media-seconds downloaded per wall-second. <1 means the
   *   network cannot keep up with the selected quality, whatever the Mbps is.
   */
  function classifyConnection(input) {
    input = input || {};
    if (input.online === false) return { level: 'slow', reason: 'offline' };

    var mbps = typeof input.mbps === 'number' && isFinite(input.mbps) ? input.mbps : null;
    var ratio = typeof input.downloadRatio === 'number' && isFinite(input.downloadRatio)
      ? input.downloadRatio : null;

    // Hard signals first: the browser's own "you are on a bad link" flags.
    if (input.saveData) return { level: 'slow', reason: 'save-data' };
    var et = input.effectiveType;
    if (et === 'slow-2g' || et === '2g') return { level: 'slow', reason: 'effectiveType ' + et };

    // The download ratio is quality-relative and therefore the most direct
    // answer to "can this stream keep playing?"
    if (ratio !== null) {
      if (ratio < 0.85) return { level: 'slow', reason: 'download ratio ' + ratio.toFixed(2) + '× realtime' };
      if (ratio < 1.5) {
        // Enough to keep up, but with no real headroom.
        if (mbps !== null && mbps >= CONNECTION_BANDS.fastAbove) return { level: 'medium', reason: 'ratio-limited' };
        return { level: 'medium', reason: 'download ratio ' + ratio.toFixed(2) + '× realtime' };
      }
      if (ratio >= 1.5 && mbps !== null && mbps < CONNECTION_BANDS.slowBelow) {
        return { level: 'medium', reason: 'ratio good but measured Mbps low' };
      }
    }

    if (mbps !== null) {
      if (mbps < CONNECTION_BANDS.slowBelow) return { level: 'slow', reason: 'measured ' + mbps.toFixed(1) + ' Mbps' };
      if (mbps < CONNECTION_BANDS.fastAbove) return { level: 'medium', reason: 'measured ' + mbps.toFixed(1) + ' Mbps' };
      return { level: 'fast', reason: 'measured ' + mbps.toFixed(1) + ' Mbps' };
    }

    if (et === '3g') return { level: 'medium', reason: 'effectiveType 3g' };
    if (et === '4g') return { level: 'fast', reason: 'effectiveType 4g' };

    return { level: 'unknown', reason: 'no signal yet' };
  }

  // ── Smart Buffer Protection state machine ──────────────────────────────────
  /**
   * Pure decision engine. The caller (content.js) supplies the world state on
   * every tick and acts on the returned `action`; this object only decides.
   *
   * ctx = {
   *   now, enabled, ahead,           // playable runway in seconds
   *   aheadTrend,                    // d(runway)/dt  (>0 = gaining buffer)
   *   timeToEmpty,                   // seconds, or Infinity
   *   isPlaying, userPaused, hidden, seeking,
   *   playable,                      // anything buffered at all?
   *   live,                          // never pause a live stream
   *   graceUntil                     // timestamp; hands-off until then
   * }
   */
  function createProtectionController(settings) {
    var s = settings || {};
    var state = 'idle';
    var since = 0;
    var lastIntervention = -Infinity;
    var interventions = [];
    var lastReason = '';
    var totalPauses = 0;
    var totalMsPaused = 0;

    function recentCount(now) {
      interventions = interventions.filter(function (t) { return now - t <= 60000; });
      return interventions.length;
    }

    var api = {
      get state() { return state; },
      get since() { return since; },
      get totalPauses() { return totalPauses; },
      get totalMsPaused() { return totalMsPaused; },
      get lastReason() { return lastReason; },
      /** ms spent in the protective pause that is currently open (0 if idle). */
      msInCurrentPause: function (now) {
        return state === 'protecting' && since ? Math.max(0, num(now, Date.now()) - since) : 0;
      },

      reset: function () {
        state = 'idle'; since = 0; lastReason = '';
      },
      hardReset: function () {
        state = 'idle'; since = 0; lastIntervention = -Infinity;
        interventions = []; lastReason = ''; totalPauses = 0; totalMsPaused = 0;
      },

      updateSettings: function (next) { s = next || s; },

      /**
       * @returns {{action:'pause'|'resume'|'none', reason:string, state:string}}
       */
      tick: function (ctx) {
        ctx = ctx || {};
        var now = num(ctx.now, Date.now());

        // ── Safety valves: always release our own pause first. ──
        var mustRelease =
          !ctx.enabled ||
          ctx.userPaused ||
          ctx.live ||
          !ctx.playable ||
          (ctx.hidden && !s.protectHiddenTab) ||
          (ctx.seeking === true);

        if (state === 'protecting') {
          var heldFor = now - since;
          if (mustRelease) {
            return finish('resume', ctx, now, releaseReason(ctx));
          }
          if (ctx.ahead >= s.resumeSec) {
            return finish('resume', ctx, now, 'buffer rebuilt to ' + Math.round(ctx.ahead) + 's');
          }
          if (heldFor >= s.maxPauseMs) {
            return finish('resume', ctx, now, 'max pause ' + s.maxPauseMs + 'ms reached');
          }
          return { action: 'none', reason: 'holding pause (' + Math.round(ctx.ahead) + 's buffered)', state: state };
        }

        // ── idle → maybe pause ──
        if (!ctx.enabled) return none('Smart Buffer Protection is off');
        if (mustRelease) return none(releaseReason(ctx));
        if (!ctx.isPlaying) return none('not playing');
        if (now < (ctx.graceUntil || 0)) return none('grace period after seek/play');

        var ahead = num(ctx.ahead, Infinity);
        var trend = typeof ctx.aheadTrend === 'number' ? ctx.aheadTrend : null;
        var tEmpty = typeof ctx.timeToEmpty === 'number' ? ctx.timeToEmpty : Infinity;

        var runwayIsLow = ahead <= s.lowWaterSec;
        var notRecovering = trend === null || trend <= 0.08;
        var emptyImminent = tEmpty <= Math.max(s.lowWaterSec * 1.5, 3);

        if (!runwayIsLow) return none('runway ' + ahead.toFixed(1) + 's ok');
        if (!notRecovering) return none('buffer recovering (+' + trend.toFixed(2) + 's/s)');
        if (!emptyImminent) return none('stall not imminent (t-empty ' + tEmpty.toFixed(1) + 's)');

        if (now - lastIntervention < s.cooldownSec * 1000) {
          return none('cooldown');
        }
        if (recentCount(now) >= s.maxInterventionsPerMin) {
          return none('intervention cap reached');
        }

        state = 'protecting';
        since = now;
        lastIntervention = now;
        interventions.push(now);
        totalPauses++;
        lastReason = 'runway ' + ahead.toFixed(1) + 's, empty in ' + tEmpty.toFixed(1) + 's';
        return { action: 'pause', reason: lastReason, state: state };

        function none(reason) { lastReason = reason; return { action: 'none', reason: reason, state: state }; }
        function finish(action, _ctx, _now, reason) {
          totalMsPaused += Math.max(0, _now - since);
          state = 'idle'; since = 0; lastReason = reason;
          return { action: action, reason: reason, state: state };
        }
        function releaseReason(_ctx) {
          if (!_ctx.enabled) return 'protection disabled';
          if (_ctx.userPaused) return 'user paused';
          if (_ctx.live) return 'live stream';
          if (!_ctx.playable) return 'nothing buffered';
          if (_ctx.hidden && !s.protectHiddenTab) return 'tab hidden';
          if (_ctx.seeking) return 'seeking';
          return 'released';
        }
      }
    };
    return api;
  }

  // ── Optional playback-rate adapter ─────────────────────────────────────────
  /**
   * If the link delivers F media-seconds per wall-second and we play at rate r,
   * the runway changes at (F - r) per second. Lowering r below F therefore grows
   * the buffer *without changing resolution at all*. The user's chosen speed is
   * the hard ceiling and the deviation is capped (default 8 %).
   */
  function createRateAdapter(settings) {
    var s = settings || {};
    var applied = false;
    var current = null;

    return {
      get applied() { return applied; },
      get current() { return current; },
      reset: function () { applied = false; current = null; },
      updateSettings: function (next) { s = next || s; },

      /**
       * @returns {{rate:number|null, reason:string}} rate === null → restore the
       * user's own speed.
       */
      target: function (ctx) {
        ctx = ctx || {};
        var userRate = num(ctx.userRate, 1);

        if (!ctx.enabled || !ctx.isPlaying || ctx.hidden || ctx.seeking) {
          return release('inactive');
        }
        var F = ctx.downloadRatio;
        if (typeof F !== 'number' || !isFinite(F) || F <= 0) {
          return release('no throughput estimate');
        }
        var ahead = num(ctx.ahead, 0);
        var hi = num(s.resumeSec, 12);

        // Hysteresis: once the buffer is healthy, get out of the way.
        if (applied && ahead >= hi) return release('buffer healthy (' + ahead.toFixed(1) + 's)');
        if (!applied && ahead >= hi * 1.2) return release('buffer healthy (' + ahead.toFixed(1) + 's)');

        var headroom = F - 0.05;               // leave a little net gain
        if (headroom >= userRate) return release('throughput keeps up (' + F.toFixed(2) + '×)');

        var floor = Math.max(num(s.rateMinRate, 0.75), userRate * (1 - num(s.rateMaxDeviation, 0.08)));
        var rate = clamp(headroom, floor, userRate);
        rate = Math.round(rate * 100) / 100;   // 2 decimals: keeps YouTube's menu sane
        if (rate >= userRate - 0.005) return release('no useful headroom');

        applied = true; current = rate;
        return { rate: rate, reason: 'throughput ' + F.toFixed(2) + '× realtime' };

        function release(reason) {
          applied = false; current = null;
          return { rate: null, reason: reason };
        }
      }
    };
  }

  // ── Quality handling ───────────────────────────────────────────────────────
  var QUALITY_LABELS = {
    tiny: '144p', small: '240p', medium: '360p', large: '480p',
    hd720: '720p', hd1080: '1080p', hd1440: '1440p', hd2160: '2160p',
    hd2880: '2880p', highres: '4320p', auto: 'Auto'
  };

  function qualityLabel(raw) {
    if (!raw) return '—';
    return QUALITY_LABELS[raw] || String(raw);
  }

  function qualityHeight(label) {
    var m = String(label || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  /**
   * Only ever used by the opt-in "pin quality" feature: it *restores* the
   * user's own choice when YouTube's ABR dropped below it. It never picks a
   * lower quality than the user asked for.
   */
  function qualityToRestore(reported, desired) {
    if (!desired || desired === 'auto') return null;
    if (!reported) return null;
    return qualityHeight(reported) < qualityHeight(desired) ? desired : null;
  }

  // ── Public surface ─────────────────────────────────────────────────────────
  return {
    VERSION: '1.0.0',
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    MAX_SMOOTHNESS_OVERRIDES: MAX_SMOOTHNESS_OVERRIDES,
    STREAM_BITRATE_MBPS: STREAM_BITRATE_MBPS,
    QUALITY_LABELS: QUALITY_LABELS,
    CONNECTION_BANDS: CONNECTION_BANDS,

    defaults: defaults,
    resolveSettings: resolveSettings,
    num: num,
    clamp: clamp,
    formatSeconds: formatSeconds,
    formatMbps: formatMbps,

    rangeIndexAt: rangeIndexAt,
    totalBuffered: totalBuffered,
    bufferedAhead: bufferedAhead,
    bufferedAheadIncludingGap: bufferedAheadIncludingGap,
    gapAfter: gapAfter,
    bufferedBehind: bufferedBehind,
    isLiveStream: isLiveStream,

    createSeries: createSeries,
    createThroughputEstimator: createThroughputEstimator,
    bitrateForQuality: bitrateForQuality,
    classifyConnection: classifyConnection,
    createProtectionController: createProtectionController,
    createRateAdapter: createRateAdapter,

    qualityLabel: qualityLabel,
    qualityHeight: qualityHeight,
    qualityToRestore: qualityToRestore
  };
});
