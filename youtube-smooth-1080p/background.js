/*
 * YouTube Smooth 1080p — background.js  (MV3 service worker)
 * ---------------------------------------------------------------------------
 * Responsibilities (deliberately small):
 *   • seed default settings on install
 *   • inject page.js into the MAIN world of YouTube tabs (the only way to reach
 *     YouTube's player object from an extension)
 *   • cache the latest per-tab snapshot and answer popup/options queries
 *   • keep the toolbar badge in sync
 *   • toggle the optional telemetry-blocking ruleset
 *
 * No network requests, no analytics, no external endpoints, no browsing history.
 */

var CHANNEL_VERSION = '1.0.0';
var YOUTUBE_HOSTS = ['www.youtube.com', 'youtube.com', 'm.youtube.com'];

var snapshots = new Map();   // tabId -> snapshot
var lastInjected = new Map(); // tabId -> timestamp

// ── Defaults ─────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(function (details) {
  chrome.storage.local.get({ settings: null }, function (stored) {
    if (!stored.settings) {
      chrome.storage.local.set({
        settings: {
          smartBuffer: true,
          maxSmoothness: false,
          hudEnabled: false,
          rateAdapt: false,
          pinQuality: false,
          reduceRequests: false,
          lowWaterSec: 4,
          resumeSec: 12,
          maxPauseMs: 8000,
          minPauseMs: 1500,
          cooldownSec: 25,
          maxInterventionsPerMin: 3,
          graceSec: 3,
          protectHiddenTab: false,
          rateMaxDeviation: 0.08,
          rateMinRate: 0.75,
          pollMs: 500,
          pushMs: 2000,
          sampleWindowMs: 6000,
          debugLog: false
        },
        installedAt: Date.now(),
        version: CHANNEL_VERSION
      });
    }
  });
  applyRulesetFromStorage();
});

chrome.runtime.onStartup.addListener(function () { applyRulesetFromStorage(); });

// ── Helpers ──────────────────────────────────────────────────────────────────
function isYouTubeUrl(url) {
  if (!url) return false;
  try {
    var u = new URL(url);
    return YOUTUBE_HOSTS.indexOf(u.hostname) !== -1;
  } catch (e) { return false; }
}

function isYouTubeTab(tab) {
  return !!(tab && (isYouTubeUrl(tab.url) || isYouTubeUrl(tab.pendingUrl)));
}

function injectPageScript(tabId) {
  if (!chrome.scripting || !chrome.scripting.executeScript) return;
  var now = Date.now();
  var prev = lastInjected.get(tabId) || 0;
  if (now - prev < 1500) return;      // debounce SPA navigations
  lastInjected.set(tabId, now);
  chrome.scripting.executeScript({
    target: { tabId: tabId, allFrames: false },
    files: ['page.js'],
    world: 'MAIN',
    injectImmediately: true
  }).catch(function () {
    // Pre-rendered/discarded tabs and chrome:// pages reject injection; harmless.
    lastInjected.delete(tabId);
  });
}

// ── Tab lifecycle ────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (!isYouTubeTab(tab)) return;
  if (changeInfo.status === 'complete' || changeInfo.url) {
    injectPageScript(tabId);
    if (changeInfo.url) snapshots.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  snapshots.delete(tabId);
  lastInjected.delete(tabId);
});

chrome.tabs.onActivated.addListener(function (info) {
  refreshBadge(info.tabId);
});

// ── Messaging ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'ytsmooth:snapshot') {
    if (sender && sender.tab && typeof sender.tab.id === 'number') {
      snapshots.set(sender.tab.id, msg.payload);
      refreshBadge(sender.tab.id);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ytsmooth:getSnapshot') {
    resolveActiveTab(function (tab) {
      if (!tab) { sendResponse({ ok: false, error: 'no-tab' }); return; }
      var cached = snapshots.get(tab.id);
      var fresh = cached && (Date.now() - cached.at) < 6000;
      if (fresh) { sendResponse({ ok: true, tabId: tab.id, snapshot: cached }); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'ytsmooth:getSnapshot' }, function (snap) {
        if (chrome.runtime.lastError || !snap) {
          sendResponse({ ok: false, error: 'no-content-script', tabId: tab.id, snapshot: cached || null });
          return;
        }
        snapshots.set(tab.id, snap);
        sendResponse({ ok: true, tabId: tab.id, snapshot: snap });
      });
    });
    return true; // async
  }

  if (msg.type === 'ytsmooth:getStatus') {
    chrome.storage.local.get({ settings: {} }, function (stored) {
      dnrAvailable(function (hasDnr, granted) {
        sendResponse({
          ok: true,
          version: CHANNEL_VERSION,
          settings: stored.settings,
          dnr: { available: hasDnr, granted: granted },
          tabs: snapshots.size
        });
      });
    });
    return true;
  }

  if (msg.type === 'ytsmooth:setSettings') {
    chrome.storage.local.get({ settings: {} }, function (stored) {
      var next = Object.assign({}, stored.settings, msg.patch || {});
      chrome.storage.local.set({ settings: next }, function () {
        if (Object.prototype.hasOwnProperty.call(msg.patch || {}, 'reduceRequests')) {
          setRulesetEnabled(!!next.reduceRequests);
        }
        sendResponse({ ok: true, settings: next });
      });
    });
    return true;
  }

  if (msg.type === 'ytsmooth:setRuleset') {
    setRulesetEnabled(!!msg.enabled, function (ok, err) { sendResponse({ ok: ok, error: err }); });
    return true;
  }
});

function resolveActiveTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    cb(tab && isYouTubeTab(tab) ? tab : null);
  });
}

// Alt+Shift+Y flips the in-page dashboard on the active YouTube tab.
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(function (command) {
    if (command !== 'toggle-hud') return;
    resolveActiveTab(function (tab) {
      if (!tab) return;
      chrome.storage.local.get({ settings: {} }, function (stored) {
        var next = Object.assign({}, stored.settings, { hudEnabled: !stored.settings.hudEnabled });
        chrome.storage.local.set({ settings: next });
      });
    });
  });
}

// ── Badge ────────────────────────────────────────────────────────────────────
var LEVEL_COLORS = { slow: '#ef4444', medium: '#f59e0b', fast: '#22c55e', unknown: '#64748b' };

function refreshBadge(tabId) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var active = tabs && tabs[0];
    if (!active || (tabId && active.id !== tabId)) return;
    var snap = snapshots.get(active.id);
    if (!snap || !snap.quality) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    var level = (snap.connection && snap.connection.level) || 'unknown';
    var label = String(snap.quality.selected || '').replace('p', '');
    if (!label || label === '—' || label === 'Auto') label = level === 'unknown' ? '' : '●';
    chrome.action.setBadgeBackgroundColor({ color: LEVEL_COLORS[level] || LEVEL_COLORS.unknown });
    chrome.action.setBadgeText({ text: label.slice(0, 4) });
    chrome.action.setTitle({
      title: 'YouTube Smooth 1080p — ' + level + ', ' +
        Math.round((snap.buffer && snap.buffer.ahead) || 0) + 's buffered'
    });
  });
}

// ── Optional request reduction (declarativeNetRequest, off by default) ───────
// The permission is OPTIONAL, so the manifest never asks for it up front. The
// rules themselves are dynamic and are only installed after the user grants the
// permission in the options page. They target telemetry endpoints only — media
// (googlevideo.com) and anything the player needs are never touched.
var TELEMETRY_RULES_URL = 'rules/telemetry.json';
var TELEMETRY_RULE_BASE_ID = 9000;

function dnrAvailable(cb) {
  var has = !!(chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules);
  if (!has) { cb(false, false); return; }
  if (!chrome.permissions || !chrome.permissions.contains) { cb(true, true); return; }
  chrome.permissions.contains({ permissions: ['declarativeNetRequest'] }, function (granted) {
    cb(true, !!granted);
  });
}

var rulesCache = null;
function loadTelemetryRules(cb) {
  if (rulesCache) { cb(rulesCache); return; }
  fetch(chrome.runtime.getURL(TELEMETRY_RULES_URL))
    .then(function (r) { return r.json(); })
    .then(function (rules) {
      rulesCache = Array.isArray(rules) ? rules : [];
      cb(rulesCache);
    })
    .catch(function () { rulesCache = []; cb(rulesCache); });
}

function setRulesetEnabled(enabled, cb) {
  dnrAvailable(function (has, granted) {
    if (!has || !granted) { if (cb) cb(false, 'permission-not-granted'); return; }
    loadTelemetryRules(function (rules) {
      var removeRuleIds = [];
      for (var i = 0; i < Math.max(rules.length, 1); i++) {
        removeRuleIds.push(TELEMETRY_RULE_BASE_ID + i);
      }
      var addRules = enabled ? rules.map(function (r, i) {
        return Object.assign({}, r, { id: TELEMETRY_RULE_BASE_ID + i });
      }) : [];
      chrome.declarativeNetRequest.updateDynamicRules(
        { removeRuleIds: removeRuleIds, addRules: addRules },
        function () {
          var err = chrome.runtime.lastError;
          if (cb) cb(!err, err ? err.message : null);
        }
      );
    });
  });
}

function applyRulesetFromStorage() {
  chrome.storage.local.get({ settings: {} }, function (stored) {
    if (stored.settings && stored.settings.reduceRequests) setRulesetEnabled(true);
  });
}
