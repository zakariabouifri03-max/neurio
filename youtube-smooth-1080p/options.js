/* YouTube Smooth 1080p — options.js */
(function () {
  'use strict';

  var Core = window.YTSmoothCore;
  var $ = function (id) { return document.getElementById(id); };

  var settings = Core.defaults();
  var dnr = { available: false, granted: false };
  var diagTimer = null;

  // Keys that need a transform between the UI and storage.
  var VIRTUAL = {
    rateMaxDeviationPct: {
      read: function (s) { return Math.round((s.rateMaxDeviation || 0) * 100); },
      write: function (v) { return { rateMaxDeviation: Math.min(0.25, Math.max(0, v / 100)) }; }
    }
  };

  function storageKey(el) { return VIRTUAL[el.dataset.key] ? null : el.dataset.key; }

  // ── Load / render ──────────────────────────────────────────────────────────
  function load() {
    chrome.runtime.sendMessage({ type: 'ytsmooth:getStatus' }, function (res) {
      if (chrome.runtime.lastError || !res || !res.ok) return;
      settings = Object.assign(Core.defaults(), res.settings || {});
      dnr = res.dnr || dnr;
      if (res.version) $('ver').textContent = 'v' + res.version;
      paint();
      paintPermission();
    });
  }

  function paint() {
    var fields = document.querySelectorAll('[data-key]');
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      var key = el.dataset.key;
      var value = VIRTUAL[key] ? VIRTUAL[key].read(settings) : settings[key];
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value;
    }
  }

  function save(patch) {
    chrome.runtime.sendMessage({ type: 'ytsmooth:setSettings', patch: patch }, function (res) {
      if (chrome.runtime.lastError || !res || !res.ok) { paint(); return; }
      settings = Object.assign(Core.defaults(), res.settings);
      paint();
      pollDiag();
    });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  var fields = document.querySelectorAll('[data-key]');
  for (var i = 0; i < fields.length; i++) {
    (function (el) {
      el.addEventListener('change', function () {
        if (el.type === 'checkbox') {
          var checked = el.checked;
          var patch = {};
          if (VIRTUAL[el.dataset.key]) Object.assign(patch, VIRTUAL[el.dataset.key].write(checked ? 1 : 0));
          else patch[el.dataset.key] = checked;

          if (el.dataset.key === 'reduceRequests' && checked) {
            enableReduceRequests(function (ok) {
              if (!ok) { el.checked = false; }
              else { save(patch); }
            });
            return;
          }
          save(patch);
        } else {
          var v = parseFloat(el.value);
          if (!isFinite(v)) { paint(); return; }
          if (el.min !== '' && v < parseFloat(el.min)) v = parseFloat(el.min);
          if (el.max !== '' && v > parseFloat(el.max)) v = parseFloat(el.max);
          el.value = v;
          if (VIRTUAL[el.dataset.key]) save(VIRTUAL[el.dataset.key].write(v));
          else {
            var p = {};
            p[el.dataset.key] = v;
            save(p);
          }
        }
      });
    })(fields[i]);
  }

  function enableReduceRequests(cb) {
    if (!chrome.permissions || !chrome.permissions.request) {
      $('permBox').hidden = false;
      $('permText').textContent = 'This browser build does not expose chrome.permissions — the feature cannot be enabled.';
      $('btnGrant').disabled = true;
      cb(false);
      return;
    }
    chrome.permissions.request({ permissions: ['declarativeNetRequest'] }, function (granted) {
      dnr.granted = !!granted;
      dnr.available = true;
      paintPermission();
      if (!granted) {
        $('permBox').hidden = false;
        $('permText').textContent = 'Permission not granted — request reduction stays off.';
      }
      cb(!!granted);
    });
  }

  function paintPermission() {
    var box = $('permBox');
    if (dnr.available && dnr.granted) {
      box.hidden = false;
      $('permText').textContent = 'Permission granted. Blocking applies to YouTube telemetry endpoints only.';
      $('btnGrant').textContent = 'Permission granted ✓';
      $('btnGrant').disabled = true;
    } else if (dnr.available) {
      box.hidden = false;
      $('permText').innerHTML = 'This feature needs the optional <code>declarativeNetRequest</code> permission.';
      $('btnGrant').textContent = 'Grant permission';
      $('btnGrant').disabled = false;
    } else {
      box.hidden = true;
    }
  }

  $('btnGrant').addEventListener('click', function () {
    enableReduceRequests(function (ok) {
      if (ok) {
        var box = $('reduceRequests');
        box.checked = true;
        save({ reduceRequests: true });
      }
    });
  });

  $('btnReset').addEventListener('click', function () {
    if (!window.confirm('Reset every setting to its default?')) return;
    var d = Core.defaults();
    d.debugLog = false;
    save(d);
  });

  $('btnRefresh').addEventListener('click', pollDiag);

  // ── Diagnostics ────────────────────────────────────────────────────────────
  var CELLS = [
    ['Player', function (s) { return s.pageBridge ? 'connected' : (s.noVideo ? 'not found' : 'no bridge'); }, null],
    ['Video', function (s) { return s.videoId ? s.videoId.slice(0, 11) : '—'; }, null],
    ['Quality', function (s) { return s.quality.selected; }, null],
    ['Available', function (s) { return (s.quality.available || []).join(', ') || '—'; }, null],
    ['Connection', function (s) { return s.connection.level; }, function (s) { return s.connection.level; }],
    ['Speed', function (s) { return Core.formatMbps(s.connection.mbps) + (s.connection.mbpsSource === 'derived' ? ' ≈' : ''); }, null],
    ['Speed source', function (s) { return s.connection.mbpsSource; }, null],
    ['Download ratio', function (s) {
      return s.connection.downloadRatio === null || s.connection.downloadRatio === undefined
        ? '—' : s.connection.downloadRatio.toFixed(2) + '× realtime';
    }, null],
    ['Buffered ahead', function (s) { return Math.round(s.buffer.ahead) + 's'; }, null],
    ['Buffer total', function (s) { return Math.round(s.buffer.total) + 's'; }, null],
    ['Buffered behind', function (s) { return Math.round(s.buffer.behind) + 's'; }, null],
    ['Ranges', function (s) { return String(s.buffer.ranges); }, null],
    ['Runway trend', function (s) {
      return s.buffer.aheadTrend === null ? '—' : (s.buffer.aheadTrend >= 0 ? '+' : '') + s.buffer.aheadTrend.toFixed(2) + ' s/s';
    }, null],
    ['Time to empty', function (s) {
      return s.buffer.timeToEmpty === null ? 'no drain' : Math.round(s.buffer.timeToEmpty) + 's';
    }, null],
    ['Playback', function (s) { return s.playback.state; }, function (s) {
      return s.playback.state === 'stable' ? 'fast' : (s.playback.state === 'buffering' || s.playback.state === 'protecting' ? 'slow' : null);
    }],
    ['Rate', function (s) {
      return (s.playback.rate || 1).toFixed(2) + '×' + (s.playback.rateAdapted ? ' (paced)' : '');
    }, null],
    ['Protection', function (s) { return s.protection.enabled ? s.protection.state : 'disabled'; }, null],
    ['Pauses', function (s) {
      return s.protection.totalPauses + ' · ' + Math.round((s.protection.totalMsPaused || 0) / 1000) + 's total';
    }, null],
    ['Last decision', function (s) { return s.protection.lastReason || '—'; }, null],
    ['Media requests', function (s) { return String(s.stats.mediaRequests); }, null],
    ['Duplicate ranges', function (s) { return String(s.stats.duplicateRequests); }, null],
    ['Throughput samples', function (s) { return String(s.stats.throughputSamples); }, null],
    ['Bytes measured', function (s) {
      return s.stats.measuredBytes ? (s.stats.measuredBytes / 1048576).toFixed(1) + ' MB' : '0 (browser hid sizes)';
    }, null],
    ['Dropped frames', function (s) {
      return s.stats.droppedPercent === null ? '—' : s.stats.droppedFrames + ' / ' + s.stats.totalFrames +
        ' (' + s.stats.droppedPercent.toFixed(1) + '%)';
    }, null],
    ['Uptime', function (s) { return Core.formatSeconds((s.stats.uptimeMs || 0) / 1000); }, null],
    ['Tab hidden', function (s) { return s.playback.hidden ? 'yes' : 'no'; }, null],
    ['Live stream', function (s) { return s.playback.live ? 'yes (protection skipped)' : 'no'; }, null]
  ];

  function cell(k, v, cls) {
    return '<div class="cell"><span class="k">' + k + '</span><span class="v' +
      (cls ? ' ' + cls : '') + '">' + escapeHtml(v) + '</span></div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pollDiag() {
    chrome.runtime.sendMessage({ type: 'ytsmooth:getSnapshot' }, function (res) {
      if (chrome.runtime.lastError) { renderDiag(null); return; }
      renderDiag(res && res.snapshot ? res.snapshot : null);
    });
  }

  function renderDiag(s) {
    var grid = $('dgrid');
    if (!s) {
      grid.innerHTML = cell('Status', 'no YouTube tab with the extension loaded');
      $('dlog').textContent = 'Open a video on youtube.com, then come back here.';
      return;
    }
    var html = '';
    for (var i = 0; i < CELLS.length; i++) {
      var def = CELLS[i];
      var value, cls = null;
      try { value = def[1](s); } catch (e) { value = '—'; }
      if (def[2]) { try { cls = def[2](s); } catch (e) { cls = null; } }
      html += cell(def[0], value, cls);
    }
    grid.innerHTML = html;

    var lines = (s.log || []).map(function (e) {
      var d = new Date(e.t);
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '  ' + e.kind + '  ' + e.msg;
    });
    $('dlog').textContent = lines.length ? lines.join('\n') : 'No decisions yet.';
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (diagTimer) { clearInterval(diagTimer); diagTimer = null; } }
    else if (!diagTimer) { pollDiag(); diagTimer = setInterval(pollDiag, 1500); }
  });

  load();
  pollDiag();
  diagTimer = setInterval(pollDiag, 1500);
})();
