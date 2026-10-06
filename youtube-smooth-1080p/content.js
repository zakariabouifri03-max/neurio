/*
 * YouTube Smooth 1080p — content.js  (isolated world)
 * ---------------------------------------------------------------------------
 * The brain of the extension. It:
 *   • finds the active <video> element (watch pages, embeds, Shorts)
 *   • samples its TimeRanges to know exactly how much playable runway exists
 *   • measures real throughput from Resource Timing (googlevideo.com)
 *   • predicts when the runway runs out
 *   • runs the Smart Buffer Protection state machine (pause → build → resume)
 *   • optionally nudges playbackRate a few % (never resolution)
 *   • reports everything to the popup / service worker
 *   • draws the optional in-page dashboard
 *
 * HARD RULE, enforced here and nowhere else is allowed to override it:
 *   this file never lowers the playback quality. It never calls
 *   setPlaybackQuality() with anything other than the quality the user picked.
 */
(function () {
  'use strict';

  if (window.__ytSmoothContentLoaded) return;
  window.__ytSmoothContentLoaded = true;

  var Core = (typeof YTSmoothCore !== 'undefined') ? YTSmoothCore : null;
  if (!Core) { // Should never happen (core.js is listed first in the manifest).
    try { console.warn('[YT Smooth] core.js missing — extension disabled'); } catch (e) {}
    return;
  }

  var CHANNEL = 'ytsmooth-1080p';
  var token = Math.random().toString(36).slice(2) + Date.now().toString(36);

  // ── State ──────────────────────────────────────────────────────────────────
  var settings = Core.defaults();
  var resolved = Core.resolveSettings(settings);

  var video = null;
  var videoKey = '';            // identifies the attached element (for swap detect)
  var attachedAt = 0;
  var startedAt = Date.now();

  var userPaused = false;
  var selfPause = false;
  var selfPlay = false;
  var seeking = false;
  var graceUntil = 0;
  var lastCurrent = -1;
  var lastCurrentAt = 0;

  var userRate = 1;
  var pendingRate = null;       // rate we just wrote (ratechange attribution)
  var rateHostile = false;      // YouTube keeps reverting our rate → stop trying
  var rateBackoffUntil = 0;
  var lastUserRateAt = 0;

  var runwaySeries = Core.createSeries(resolved.sampleWindowMs);
  var throughput = Core.createThroughputEstimator();
  var protection = Core.createProtectionController(resolved);
  var rateAdapter = Core.createRateAdapter(resolved);

  var mediaRequests = 0;
  var duplicateRequests = 0;
  var lastMediaActivityAt = 0;
  var seenRequestKeys = Object.create(null);
  var seenRequestCount = 0;

  var page = {                  // data coming from page.js (MAIN world)
    quality: null, available: [], videoId: null, title: null,
    playerState: null, connected: false, at: 0, desired: null
  };

  var snapshot = null;
  var hud = null;
  var ticker = null;
  var pushTimer = null;
  var scanTimer = null;

  var log = [];
  function note(kind, msg) {
    var entry = { t: Date.now(), kind: kind, msg: msg };
    log.push(entry);
    if (log.length > 60) log.shift();
    try {
      if (settings.debugLog) console.info('[YT Smooth]', kind, msg);
    } catch (e) {}
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  function applySettings(next) {
    settings = Object.assign(Core.defaults(), next || {});
    resolved = Core.resolveSettings(settings);
    runwaySeries.setWindow(resolved.sampleWindowMs);
    protection.updateSettings(resolved);
    rateAdapter.updateSettings(resolved);
    restartTicker();
    if (settings.hudEnabled) ensureHud(); else destroyHud();
  }

  try {
    chrome.storage.local.get(null, function (stored) {
      applySettings(stored && stored.settings ? stored.settings : Core.defaults());
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes.settings) applySettings(changes.settings.newValue);
      if (area === 'sync' && changes.settings) applySettings(changes.settings.newValue);
    });
  } catch (e) { note('error', 'storage unavailable'); }

  // ── Page bridge (page.js runs in the MAIN world) ───────────────────────────
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.channel !== CHANNEL || d.token !== token) return;
    if (d.type === 'hello') { page.connected = true; return; }
    if (d.type === 'player') {
      page.quality = d.payload.quality || null;
      page.available = d.payload.available || [];
      page.videoId = d.payload.videoId || null;
      page.title = d.payload.title || null;
      page.playerState = d.payload.playerState;
      page.connected = true;
      page.at = Date.now();
      var desired = d.payload.quality || null;
      if (desired && desired !== 'auto') page.desired = desired;
      maybePinQuality();
    }
  });

  function postToPage(type, payload) {
    try {
      window.postMessage({ channel: CHANNEL, token: token, type: type, payload: payload }, '*');
    } catch (e) {}
  }

  /**
   * Opt-in only. Restores the quality the *user* chose if YouTube's own ABR
   * silently dropped below it. Never selects anything lower than the user's pick.
   */
  var lastPinAt = 0;
  function maybePinQuality() {
    if (!settings.pinQuality || !page.desired) return;
    var restore = Core.qualityToRestore(page.quality, page.desired);
    if (!restore) return;
    var now = Date.now();
    if (now - lastPinAt < 8000) return;
    lastPinAt = now;
    note('pin', 'restoring ' + restore + ' (reported ' + page.quality + ')');
    postToPage('setQuality', { quality: restore });
  }

  // ── Finding the video element ──────────────────────────────────────────────
  function pickVideo() {
    var list = document.querySelectorAll('video');
    var best = null, bestScore = 0;
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      var score = 0;
      var rect = null;
      try { rect = v.getBoundingClientRect(); } catch (e) {}
      if (rect && rect.width > 0 && rect.height > 0) score += rect.width * rect.height;
      if (v.duration && isFinite(v.duration) && v.duration > 0) score += 100000;
      if (!isFinite(v.duration)) score += 50000;                  // live
      if (v.readyState >= 2) score += 5000;
      if (v.closest && v.closest('#movie_player, ytd-player, ytd-reel-video-renderer, ytd-shorts')) score += 25000;
      if (score > bestScore) { bestScore = score; best = v; }
    }
    return bestScore >= 100000 ? best : null;
  }

  function scanForVideo() {
    var candidate = pickVideo();
    if (!candidate) return;
    if (candidate === video) return;
    var key = describe(candidate);
    if (key === videoKey) return;
    detach();
    video = candidate;
    videoKey = key;
    attachedAt = Date.now();
    attach();
    note('attach', 'video attached (' + key + ')');
  }

  function describe(v) {
    var id = v.id || (v.closest && v.closest('[id]') ? v.closest('[id]').id : '');
    var src = '';
    try { src = (v.currentSrc || v.src || '').slice(0, 40); } catch (e) {}
    return id + '|' + src + '|' + (v.duration || 0);
  }

  // ── Attach / detach ────────────────────────────────────────────────────────
  var listeners = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  function attach() {
    userPaused = video.paused;
    userRate = video.playbackRate || 1;
    seeking = false;
    graceUntil = Date.now() + 1500;
    lastCurrent = video.currentTime;
    lastCurrentAt = Date.now();
    runwaySeries.clear();
    throughput.reset();
    protection.hardReset();
    rateAdapter.reset();
    seenRequestKeys = Object.create(null);
    seenRequestCount = 0;

    on(video, 'playing', function () {
      userPaused = false; seeking = false;
      graceUntil = Date.now() + Math.round(resolved.graceSec * 1000);
    });
    on(video, 'play', function () {
      selfPlay = false;
      if (!selfPause) userPaused = false;
    });
    on(video, 'pause', function () {
      if (selfPause) { selfPause = false; return; }
      if (selfPlay) { selfPlay = false; }
      userPaused = true;
      protection.reset();
    });
    on(video, 'seeking', function () {
      seeking = true;
      graceUntil = Date.now() + Math.round(resolved.graceSec * 1000);
    });
    on(video, 'seeked', function () {
      seeking = false;
      lastCurrent = video.currentTime;
      lastCurrentAt = Date.now();
      runwaySeries.clear();
      graceUntil = Date.now() + Math.round(resolved.graceSec * 1000);
    });
    on(video, 'ratechange', onRateChange);
    on(video, 'emptied', function () { runwaySeries.clear(); protection.reset(); });
    on(video, 'loadedmetadata', function () {
      userRate = video.playbackRate || 1;
      graceUntil = Date.now() + 1500;
    });
    on(video, 'error', function () { note('error', 'media element error'); });

    try { video.preload = 'auto'; } catch (e) {}
    restartTicker();
    postToPage('start', { token: token });
  }

  function detach() {
    for (var i = 0; i < listeners.length; i++) {
      listeners[i][0].removeEventListener(listeners[i][1], listeners[i][2], listeners[i][3]);
    }
    listeners = [];
    if (video && protection.state === 'protecting') {
      try { selfPause = false; video.play(); } catch (e) {}
      protection.reset();
    }
    video = null; videoKey = '';
    runwaySeries.clear();
  }

  // ── Playback-rate adapter ──────────────────────────────────────────────────
  function onRateChange() {
    var r = video.playbackRate;
    if (pendingRate !== null && Math.abs(r - pendingRate) < 0.011) {
      pendingRate = null;                 // our own write landed
      return;
    }
    if (pendingRate !== null) {
      // We wrote a rate and something else immediately overwrote it.
      pendingRate = null;
      rateHostile = true;
      rateAdapter.reset();
      note('rate', 'player overrode our rate — adaptation disabled for this video');
      return;
    }
    userRate = r || 1;
    lastUserRateAt = Date.now();
    rateAdapter.reset();                  // the user picked a speed; re-baseline
  }

  function applyRate(target) {
    if (!video || rateHostile) return;
    if (Date.now() < rateBackoffUntil) return;
    if (target === null) {
      if (Math.abs(video.playbackRate - userRate) > 0.011) {
        pendingRate = userRate;
        video.playbackRate = userRate;
      }
      return;
    }
    if (Math.abs(video.playbackRate - target) < 0.005) return;
    if (Date.now() - lastUserRateAt < 2500) return;  // let a fresh user choice settle
    pendingRate = target;
    video.playbackRate = target;
    // If the player reverts it silently we want to notice quickly.
    setTimeout(function () {
      if (pendingRate === target && video && Math.abs(video.playbackRate - target) > 0.011) {
        pendingRate = null;
        rateHostile = true;
        rateAdapter.reset();
        rateBackoffUntil = Date.now() + 60000;
        note('rate', 'rate not honoured — adaptation disabled for 60s');
      }
    }, 900);
  }

  // ── Protection actions ─────────────────────────────────────────────────────
  function doPause(reason) {
    if (!video || video.paused) return;
    selfPause = true;
    try { video.pause(); } catch (e) { selfPause = false; return; }
    note('pause', reason);
    flashHud('Buffering… building ' + resolved.resumeSec + 's of buffer');
  }

  function doResume(reason) {
    if (!video) return;
    if (video.paused && !userPaused) {
      selfPlay = true;
      var p = video.play();
      if (p && typeof p.catch === 'function') p.catch(function () { selfPlay = false; userPaused = true; });
    }
    note('resume', reason);
    flashHud(null);
  }

  // ── Throughput from Resource Timing ────────────────────────────────────────
  var MEDIA_URL = /(^|\/\/|\.)(googlevideo\.com|youtube\.com)\/videoplayback/i;

  function requestKey(name) {
    // Same object + same byte range = a genuine repeat.
    var m = String(name).match(/[?&]range=(\d+-\d+)/);
    var idm = String(name).match(/[?&]id=([0-9a-f]+)/i);
    return (idm ? idm[1] : name.split('?')[0]) + '#' + (m ? m[1] : 'full');
  }

  function ingestResource(entry) {
    if (!entry || !entry.name || !MEDIA_URL.test(entry.name)) return;
    mediaRequests++;
    lastMediaActivityAt = Date.now();
    var key = requestKey(entry.name);
    if (seenRequestKeys[key]) {
      duplicateRequests++;
    } else {
      seenRequestKeys[key] = 1;
      if (++seenRequestCount > 4000) { seenRequestKeys = Object.create(null); seenRequestCount = 0; }
    }
    var bytes = entry.transferSize || entry.encodedBodySize || 0;
    throughput.addSample(bytes, entry.duration || 0);
  }

  try {
    var po = new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      for (var i = 0; i < entries.length; i++) ingestResource(entries[i]);
    });
    po.observe({ type: 'resource', buffered: true });
  } catch (e) {
    // Fallback for browsers without the resource PerformanceObserver.
    note('warn', 'PerformanceObserver unavailable');
  }

  function networkSignals() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      effectiveType: c ? c.effectiveType : null,
      downlink: c && isFinite(c.downlink) ? c.downlink : null,
      saveData: !!(c && c.saveData),
      online: navigator.onLine !== false
    };
  }

  // ── The tick ───────────────────────────────────────────────────────────────
  function computeFrameQuality() {
    if (!video || typeof video.getVideoPlaybackQuality !== 'function') return null;
    try {
      var q = video.getVideoPlaybackQuality();
      var total = q.totalVideoFrames || 0;
      var dropped = q.droppedVideoFrames || 0;
      return {
        dropped: dropped,
        total: total,
        percent: total > 0 ? (dropped / total) * 100 : 0
      };
    } catch (e) { return null; }
  }

  function tick() {
    if (!video) { scanForVideo(); snapshot = idleSnapshot(); publish(); return; }
    var now = Date.now();

    var buffered = video.buffered;
    var t = video.currentTime;
    var rate = video.playbackRate || 1;
    var ahead = Core.bufferedAhead(buffered, t);
    var aheadGap = Core.bufferedAheadIncludingGap(buffered, t);
    var behind = Core.bufferedBehind(buffered, t);
    var total = Core.totalBuffered(buffered);
    var gap = Core.gapAfter(buffered, t);
    var live = Core.isLiveStream(video);

    // Detect seeks the element did not announce (SPA scrubbing, chapters).
    if (lastCurrent >= 0 && !seeking) {
      var expected = lastCurrent + (now - lastCurrentAt) / 1000 * (video.paused ? 0 : rate);
      if (Math.abs(t - expected) > 1.5) {
        seeking = true;
        graceUntil = now + Math.round(resolved.graceSec * 1000);
        runwaySeries.clear();
        setTimeout(function () { seeking = false; }, 400);
      }
    }
    lastCurrent = t; lastCurrentAt = now;

    if (!seeking) runwaySeries.push(now, ahead);
    var aheadTrend = runwaySeries.slope();
    if (aheadTrend === null) aheadTrend = runwaySeries.endpointRate();
    if (runwaySeries.spanMs() < 1200) aheadTrend = null;   // not enough evidence yet

    // Download ratio: media-seconds downloaded per wall-second.
    // F = dA/dt + playbackRate while playing; dA/dt while paused.
    var downloadRatio = null;
    var downloading = (now - lastMediaActivityAt) < 4000 || (aheadTrend !== null && aheadTrend > 0.05);
    if (aheadTrend !== null && downloading) {
      downloadRatio = aheadTrend + (video.paused ? 0 : rate);
      if (downloadRatio < 0) downloadRatio = 0;
      if (downloadRatio > 20) downloadRatio = 20;
    }

    var timeToEmpty = Infinity;
    if (aheadTrend !== null && aheadTrend < -0.02) timeToEmpty = ahead / (-aheadTrend);

    // ── Speed figure ──
    // 1) measured bytes (real), 2) derived from the download ratio, 3) the
    // browser's own estimate. Each carries its source so the UI can be honest.
    var net = networkSignals();
    var mbps = null, mbpsSource = 'unknown';
    if (throughput.samples > 0 && throughput.mbps) { mbps = throughput.mbps; mbpsSource = 'measured'; }
    else if (downloadRatio !== null) {
      var qBitrate = Core.bitrateForQuality(Core.qualityLabel(page.quality));
      if (qBitrate) { mbps = downloadRatio * qBitrate; mbpsSource = 'derived'; }
    }
    if (mbps === null && net.downlink !== null) { mbps = net.downlink; mbpsSource = 'network-api'; }

    var conn = Core.classifyConnection({
      mbps: mbps, downloadRatio: downloadRatio,
      effectiveType: net.effectiveType, saveData: net.saveData, online: net.online
    });

    // ── Protection decision ──
    var ctx = {
      now: now,
      enabled: !!settings.smartBuffer,
      ahead: ahead,
      aheadTrend: aheadTrend,
      timeToEmpty: timeToEmpty,
      isPlaying: !video.paused && !video.ended && video.readyState > 2,
      userPaused: userPaused,
      hidden: document.hidden === true,
      seeking: seeking,
      playable: buffered && buffered.length > 0,
      live: live,
      graceUntil: Math.max(graceUntil, attachedAt + 1200)
    };
    var decision = protection.tick(ctx);
    if (decision.action === 'pause') doPause(decision.reason);
    else if (decision.action === 'resume') doResume(decision.reason);

    // ── Optional rate adaptation ──
    if (settings.rateAdapt) {
      var r = rateAdapter.target({
        enabled: true,
        isPlaying: ctx.isPlaying,
        hidden: ctx.hidden,
        seeking: seeking,
        downloadRatio: downloadRatio,
        ahead: ahead,
        userRate: userRate
      });
      applyRate(r.rate);
    } else if (rateAdapter.applied) {
      rateAdapter.reset();
      applyRate(null);
    }

    // ── Playback state ──
    var state = 'stable';
    if (video.ended) state = 'ended';
    else if (userPaused || (video.paused && protection.state !== 'protecting')) state = 'paused';
    else if (protection.state === 'protecting') state = 'protecting';
    else if (ahead < 0.5 || (aheadTrend !== null && timeToEmpty < 1.5)) state = 'buffering';
    else if (video.readyState <= 2) state = 'buffering';

    var frames = computeFrameQuality();

    snapshot = {
      ok: true,
      at: now,
      version: Core.VERSION,
      url: location.href,
      host: location.host,
      path: location.pathname,
      videoId: page.videoId || (location.search.match(/[?&]v=([\w-]{6,})/) || [])[1] || null,
      title: page.title || document.title,
      pageBridge: page.connected && (now - page.at) < 5000,
      active: !!settings.smartBuffer,
      maxSmoothness: !!settings.maxSmoothness,
      settings: publicSettings(),
      quality: {
        selected: Core.qualityLabel(page.quality),
        raw: page.quality,
        available: (page.available || []).map(Core.qualityLabel),
        pinned: !!settings.pinQuality,
        restored: settings.pinQuality ? page.desired : null
      },
      connection: {
        level: conn.level,
        reason: conn.reason,
        mbps: mbps,
        mbpsSource: mbpsSource,
        downloadRatio: downloadRatio,
        effectiveType: net.effectiveType,
        saveData: net.saveData,
        online: net.online,
        downloading: downloading
      },
      buffer: {
        ahead: ahead,
        aheadIncludingGap: aheadGap,
        behind: behind,
        total: total,
        gap: gap,
        ranges: buffered ? buffered.length : 0,
        aheadTrend: aheadTrend,
        timeToEmpty: timeToEmpty === Infinity ? null : timeToEmpty,
        targets: { lowWaterSec: resolved.lowWaterSec, resumeSec: resolved.resumeSec }
      },
      playback: {
        state: state,
        rate: rate,
        userRate: userRate,
        rateAdapted: rateAdapter.applied,
        currentTime: t,
        duration: isFinite(video.duration) ? video.duration : null,
        live: live,
        hidden: ctx.hidden,
        muted: !!video.muted,
        readyState: video.readyState
      },
      protection: {
        enabled: !!settings.smartBuffer,
        state: protection.state,
        totalPauses: protection.totalPauses,
        totalMsPaused: protection.totalMsPaused,
        msInCurrentPause: protection.msInCurrentPause(now),
        lastReason: protection.lastReason,
        maxPauseMs: resolved.maxPauseMs,
        cooldownSec: resolved.cooldownSec
      },
      stats: {
        mediaRequests: mediaRequests,
        duplicateRequests: duplicateRequests,
        throughputSamples: throughput.samples,
        measuredBytes: throughput.bytesTotal,
        droppedFrames: frames ? frames.dropped : null,
        totalFrames: frames ? frames.total : null,
        droppedPercent: frames ? frames.percent : null,
        uptimeMs: now - startedAt
      },
      limits: [
        'This extension cannot increase your bandwidth — it manages buffering and playback only.',
        'Resolution is never changed automatically: ' + Core.qualityLabel(page.quality) + ' stays ' + Core.qualityLabel(page.quality) + '.',
        'YouTube controls which byte ranges are fetched; we prioritise by pausing, pacing and (optionally) dropping telemetry.'
      ],
      log: log.slice(-12)
    };

    if (settings.hudEnabled) updateHud(snapshot);
    publish();
  }

  function publicSettings() {
    return {
      smartBuffer: !!settings.smartBuffer,
      maxSmoothness: !!settings.maxSmoothness,
      hudEnabled: !!settings.hudEnabled,
      rateAdapt: !!settings.rateAdapt,
      pinQuality: !!settings.pinQuality,
      reduceRequests: !!settings.reduceRequests,
      lowWaterSec: resolved.lowWaterSec,
      resumeSec: resolved.resumeSec
    };
  }

  function idleSnapshot() {
    return {
      ok: true, at: Date.now(), version: Core.VERSION,
      url: location.href, host: location.host, path: location.pathname,
      videoId: null, title: document.title, pageBridge: page.connected,
      active: !!settings.smartBuffer, noVideo: true,
      settings: publicSettings(),
      quality: { selected: '—', raw: null, available: [], pinned: false },
      connection: { level: 'unknown', reason: 'no video', mbps: null, mbpsSource: 'unknown', downloadRatio: null },
      buffer: { ahead: 0, behind: 0, total: 0, gap: 0, ranges: 0, aheadTrend: null, timeToEmpty: null, targets: { lowWaterSec: resolved.lowWaterSec, resumeSec: resolved.resumeSec } },
      playback: { state: 'idle', rate: 1, userRate: 1, rateAdapted: false, live: false, hidden: document.hidden === true },
      protection: { enabled: !!settings.smartBuffer, state: 'idle', totalPauses: 0, totalMsPaused: 0, msInCurrentPause: 0, lastReason: '' },
      stats: { mediaRequests: mediaRequests, duplicateRequests: duplicateRequests, throughputSamples: throughput.samples, droppedFrames: null, totalFrames: null, uptimeMs: Date.now() - startedAt },
      limits: ['No YouTube player found on this page yet.'],
      log: log.slice(-12)
    };
  }

  // ── Messaging ──────────────────────────────────────────────────────────────
  function publish() {
    if (!snapshot) return;
    try {
      chrome.runtime.sendMessage({ type: 'ytsmooth:snapshot', payload: snapshot }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || msg.type !== 'ytsmooth:getSnapshot') return;
      sendResponse(snapshot || idleSnapshot());
      return false;
    });
  } catch (e) {}

  // ── Ticker lifecycle ───────────────────────────────────────────────────────
  function restartTicker() {
    if (ticker) clearInterval(ticker);
    ticker = setInterval(tick, resolved.pollMs);
    if (pushTimer) clearInterval(pushTimer);
    pushTimer = setInterval(publish, resolved.pushMs);
    tick();
  }

  // ── HUD ────────────────────────────────────────────────────────────────────
  function ensureHud() {
    if (hud || !document.body) return;
    try {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('hud.css');
      document.documentElement.appendChild(link);
    } catch (e) {}

    hud = document.createElement('div');
    hud.className = 'yts-hud';
    hud.innerHTML =
      '<div class="yts-hud-head" data-drag="1">' +
      '<span class="yts-hud-dot"></span><span class="yts-hud-title">YouTube Smooth 1080p</span>' +
      '<button class="yts-hud-close" title="Hide dashboard">&times;</button></div>' +
      '<div class="yts-hud-rows">' +
      row('conn', 'Connection') + row('mbps', 'Speed') + row('qual', 'Quality') +
      row('buf', 'Buffered') + row('state', 'Playback') + row('mode', 'Mode') +
      '</div>';
    document.documentElement.appendChild(hud);

    hud.querySelector('.yts-hud-close').addEventListener('click', function () {
      destroyHud();
      try {
        chrome.storage.local.get({ settings: Core.defaults() }, function (s) {
          var next = Object.assign({}, s.settings, { hudEnabled: false });
          chrome.storage.local.set({ settings: next });
        });
      } catch (e) {}
    });
    makeDraggable(hud, hud.querySelector('.yts-hud-head'));
  }

  function row(key, label) {
    return '<div class="yts-hud-row"><span class="yts-hud-k">' + label +
      '</span><span class="yts-hud-v" data-k="' + key + '">—</span></div>';
  }

  function makeDraggable(el, handle) {
    var sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('pointerdown', function (e) {
      dragging = true; sx = e.clientX; sy = e.clientY;
      var r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      el.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
      el.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto';
    });
    handle.addEventListener('pointerup', function () { dragging = false; });
    handle.addEventListener('pointercancel', function () { dragging = false; });
  }

  var flashUntil = 0, flashText = '';
  function flashHud(text) {
    flashText = text || '';
    flashUntil = text ? Date.now() + 6000 : 0;
  }

  function setV(key, text, cls) {
    if (!hud) return;
    var el = hud.querySelector('[data-k="' + key + '"]');
    if (!el) return;
    el.textContent = text;
    el.className = 'yts-hud-v' + (cls ? ' ' + cls : '');
  }

  function updateHud(s) {
    if (!hud) return;
    hud.classList.toggle('yts-hud-flash', Date.now() < flashUntil);
    var dot = hud.querySelector('.yts-hud-dot');
    if (dot) dot.className = 'yts-hud-dot yts-' + s.connection.level;
    setV('conn', String(s.connection.level).toUpperCase(), 'yts-c-' + s.connection.level);
    setV('mbps', Core.formatMbps(s.connection.mbps) + (s.connection.mbpsSource === 'derived' ? ' ≈' : ''));
    setV('qual', s.quality.selected);
    setV('buf', Math.round(s.buffer.ahead) + 's' + (s.buffer.timeToEmpty !== null ? ' · empty in ' + Math.round(s.buffer.timeToEmpty) + 's' : ''));
    setV('state', s.playback.state, s.playback.state === 'stable' ? 'yts-c-fast' : '');
    setV('mode', Date.now() < flashUntil ? flashText :
      (s.protection.state === 'protecting' ? 'holding' : (s.maxSmoothness ? 'max smoothness' : (s.protection.enabled ? 'smart buffer' : 'monitoring'))));
  }

  function destroyHud() {
    if (!hud) return;
    try { hud.remove(); } catch (e) {}
    hud = null;
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  scanForVideo();

  var observer = null;
  try {
    observer = new MutationObserver(function () { scanForVideo(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  scanTimer = setInterval(function () {
    scanForVideo();
    // The MAIN-world script polls on its own, but nudge it after SPA swaps.
    if (video && !page.connected) postToPage('start', { token: token });
  }, 1200);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { lastCurrentAt = Date.now(); }
  });

  window.addEventListener('pagehide', function () {
    if (observer) observer.disconnect();
    if (scanTimer) clearInterval(scanTimer);
    if (ticker) clearInterval(ticker);
    if (pushTimer) clearInterval(pushTimer);
    detach();
  });

  note('boot', 'content script ready v' + Core.VERSION);
})();
