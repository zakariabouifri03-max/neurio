/* YouTube Smooth 1080p — popup.js */
(function () {
  'use strict';

  var Core = window.YTSmoothCore;
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    statusPill: $('statusPill'), statusDot: $('statusDot'), statusText: $('statusText'),
    quality: $('mQuality'), conn: $('mConn'), buffer: $('mBuffer'), playback: $('mPlayback'),
    speed: $('mSpeed'), speedSource: $('mSpeedSource'),
    runwayFill: $('runwayFill'), runwayLow: $('runwayLow'), runwayResume: $('runwayResume'),
    runwayLabel: $('runwayLabel'), runwayHint: $('runwayHint'), bar: document.querySelector('.bar'),
    btnSmart: $('btnSmart'), smartState: $('smartState'), btnMax: $('btnMax'), btnHud: $('btnHud'),
    btnSettings: $('btnSettings'), notice: $('notice'), version: $('ftrVersion')
  };

  var settings = Core.defaults();
  var lastSnapshot = null;
  var pollTimer = null;
  var busy = false;

  // ── Settings ───────────────────────────────────────────────────────────────
  function loadStatus() {
    chrome.runtime.sendMessage({ type: 'ytsmooth:getStatus' }, function (res) {
      if (chrome.runtime.lastError || !res || !res.ok) return;
      settings = Object.assign(Core.defaults(), res.settings || {});
      if (res.version) els.version.textContent = 'v' + res.version;
      renderControls();
      if (res.dnr && res.dnr.available && !res.dnr.granted && settings.reduceRequests) {
        showNotice('Request reduction is on but its permission was revoked — grant it again in Settings.');
      }
    });
  }

  function patch(next, cb) {
    if (busy) return;
    busy = true;
    chrome.runtime.sendMessage({ type: 'ytsmooth:setSettings', patch: next }, function (res) {
      busy = false;
      if (chrome.runtime.lastError || !res || !res.ok) {
        showNotice('Could not save that setting.');
        return;
      }
      settings = Object.assign(Core.defaults(), res.settings);
      renderControls();
      if (cb) cb();
    });
  }

  // ── Snapshot polling ───────────────────────────────────────────────────────
  function poll() {
    chrome.runtime.sendMessage({ type: 'ytsmooth:getSnapshot' }, function (res) {
      if (chrome.runtime.lastError) { setStatus('off', 'Inactive'); return; }
      if (!res || !res.ok) {
        lastSnapshot = res && res.snapshot ? res.snapshot : null;
        render(res && res.error === 'no-tab' ? 'no-tab' : 'no-player');
        return;
      }
      lastSnapshot = res.snapshot;
      render(null);
    });
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function setStatus(cls, text) {
    els.statusPill.className = 'status ' + cls;
    els.statusText.textContent = text;
  }

  function setV(el, text, cls) {
    el.textContent = text;
    el.className = 'v' + (cls ? ' ' + cls : '');
  }

  function playbackLabel(state) {
    switch (state) {
      case 'stable': return 'Stable';
      case 'buffering': return 'Buffering';
      case 'protecting': return 'Rebuilding buffer';
      case 'paused': return 'Paused';
      case 'ended': return 'Ended';
      default: return 'Idle';
    }
  }

  function render(kind) {
    var s = lastSnapshot;

    if (!s) {
      setStatus('off', kind === 'no-tab' ? 'Not on YouTube' : 'Inactive');
      setV(els.quality, '—', 'unknown');
      setV(els.conn, '—', 'unknown');
      setV(els.buffer, '—', 'unknown');
      setV(els.playback, '—', 'unknown');
      setV(els.speed, '—', 'unknown');
      els.speedSource.textContent = '';
      els.runwayFill.style.width = '0%';
      els.runwayLabel.textContent = '—';
      els.runwayHint.textContent = kind === 'no-tab'
        ? 'Open a video on youtube.com — the extension only runs there.'
        : 'No live data yet. Open a YouTube video and press play.';
      return;
    }

    var active = !!settings.smartBuffer;
    setStatus(active ? 'on' : 'warn', active ? 'Active' : 'Monitoring');

    setV(els.quality, s.quality.selected || '—', 'unknown');

    var level = (s.connection && s.connection.level) || 'unknown';
    setV(els.conn, level.charAt(0).toUpperCase() + level.slice(1), level);

    var ahead = Math.round((s.buffer && s.buffer.ahead) || 0);
    setV(els.buffer, ahead + (ahead === 1 ? ' second' : ' seconds'), ahead < settings.lowWaterSec ? 'slow' : 'fast');

    var pstate = (s.playback && s.playback.state) || 'idle';
    setV(els.playback, playbackLabel(pstate), pstate === 'stable' ? 'fast' : (pstate === 'buffering' || pstate === 'protecting' ? 'slow' : 'unknown'));

    var mbps = s.connection && s.connection.mbps;
    var src = (s.connection && s.connection.mbpsSource) || 'unknown';
    var srcLabel = {
      measured: 'measured from media requests',
      derived: 'derived from buffer growth',
      'network-api': 'browser estimate',
      unknown: ''
    }[src] || '';
    setV(els.speed, Core.formatMbps(mbps), 'unknown');
    els.speedSource.textContent = mbps === null || mbps === undefined ? '' : '(' + srcLabel + ')';

    // Runway visualisation
    var targets = (s.buffer && s.buffer.targets) || { lowWaterSec: settings.lowWaterSec, resumeSec: settings.resumeSec };
    var scale = Math.max(targets.resumeSec * 2, 20);
    var pct = Math.max(0, Math.min(100, (((s.buffer && s.buffer.ahead) || 0) / scale) * 100));
    els.runwayFill.style.width = pct + '%';
    els.bar.className = 'bar ' + (pct < (targets.lowWaterSec / scale) * 100 ? 'low' : (pct < (targets.resumeSec / scale) * 100 ? 'mid' : ''));
    els.runwayLow.style.left = Math.min(99, (targets.lowWaterSec / scale) * 100) + '%';
    els.runwayResume.style.left = Math.min(99, (targets.resumeSec / scale) * 100) + '%';
    els.runwayLabel.textContent = ahead + 's';

    var tEmpty = s.buffer && s.buffer.timeToEmpty;
    var hint;
    if (pstate === 'protecting') {
      hint = 'Paused to rebuild buffer — resuming at ' + targets.resumeSec + 's (held ' +
        Math.round(((s.protection && s.protection.msInCurrentPause) || 0) / 100) / 10 + 's).';
    } else if (tEmpty !== null && tEmpty !== undefined && isFinite(tEmpty)) {
      hint = 'At the current rate the buffer empties in about ' + Math.round(tEmpty) + 's.';
    } else if (s.protection && s.protection.totalPauses > 0) {
      hint = 'Buffer healthy. ' + s.protection.totalPauses + ' protective pause' +
        (s.protection.totalPauses === 1 ? '' : 's') + ' so far (' +
        Math.round((s.protection.totalMsPaused || 0) / 1000) + 's total).';
    } else if (!active) {
      hint = 'Smart Buffer Protection is off — monitoring only.';
    } else if (s.playback && s.playback.rateAdapted) {
      hint = 'Playing at ' + (s.playback.rate || 1).toFixed(2) + '× to grow the buffer (your speed is restored automatically).';
    } else {
      hint = 'Watching the buffer — no intervention needed.';
    }
    if (s.noVideo) hint = 'Waiting for a YouTube player on this page.';
    if (!s.pageBridge && !s.noVideo) {
      hint += ' Player details unavailable — reload the tab.';    }
    els.runwayHint.textContent = hint;

    if (!active) showNotice('Smart Buffer Protection is off, so the extension only measures and reports.');
    else hideNoticeUnless();
  }

  var stickyNotice = null;
  function showNotice(text) { stickyNotice = text; els.notice.hidden = false; els.notice.textContent = text; }
  function hideNoticeUnless() {
    if (stickyNotice) { els.notice.hidden = false; els.notice.textContent = stickyNotice; return; }
    els.notice.hidden = true;
  }

  function renderControls() {
    els.btnSmart.setAttribute('aria-pressed', settings.smartBuffer ? 'true' : 'false');
    els.smartState.textContent = settings.smartBuffer ? 'ON' : 'OFF';
    els.btnMax.setAttribute('aria-pressed', settings.maxSmoothness ? 'true' : 'false');
    els.btnHud.setAttribute('aria-pressed', settings.hudEnabled ? 'true' : 'false');
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  els.btnSmart.addEventListener('click', function () {
    patch({ smartBuffer: !settings.smartBuffer });
  });

  els.btnMax.addEventListener('click', function () {
    var next = !settings.maxSmoothness;
    patch({ maxSmoothness: next });
    if (next) {
      showNotice('Maximum Smoothness: earlier intervention, bigger buffer targets and continuous bandwidth monitoring. Still no quality change.');
    }
  });

  els.btnHud.addEventListener('click', function () { patch({ hudEnabled: !settings.hudEnabled }); });

  els.btnSettings.addEventListener('click', function () {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
    else if (!pollTimer) { poll(); pollTimer = setInterval(poll, 1000); }
  });

  loadStatus();
  renderControls();
  poll();
  pollTimer = setInterval(poll, 1000);
})();
