/*
 * YouTube Smooth 1080p — page.js  (MAIN world)
 * ---------------------------------------------------------------------------
 * Injected by the service worker with chrome.scripting.executeScript({world:'MAIN'})
 * because YouTube's player object (#movie_player) and its methods live in the
 * page's JavaScript world; an isolated-world content script cannot see them.
 *
 * This script is READ-ONLY by default. The single write it is capable of is
 * setPlaybackQuality() and it only ever runs when the content script explicitly
 * asks for it (the opt-in "pin quality" feature) — and only to put the quality
 * back to the one the user chose. It never lowers quality.
 *
 * No chrome.* APIs exist in this world; everything goes through postMessage.
 */
(function () {
  'use strict';

  if (window.__ytSmoothPageLoaded) return;
  window.__ytSmoothPageLoaded = true;

  var CHANNEL = 'ytsmooth-1080p';
  var token = null;
  var timer = null;
  var lastPayload = '';

  function post(type, payload) {
    try {
      window.postMessage({ channel: CHANNEL, token: token, type: type, payload: payload }, '*');
    } catch (e) {}
  }

  /** The YouTube HTML5 player element, on watch pages, embeds and Shorts. */
  function player() {
    return document.getElementById('movie_player') ||
      document.querySelector('.html5-video-player') ||
      document.querySelector('ytd-player #movie_player') ||
      null;
  }

  function call(obj, name) {
    try {
      if (obj && typeof obj[name] === 'function') return obj[name]();
    } catch (e) {}
    return null;
  }

  function read() {
    var p = player();
    if (!p) return null;

    var data = call(p, 'getVideoData') || {};
    var quality = call(p, 'getPlaybackQuality');
    var available = call(p, 'getAvailableQualityLevels') || [];

    // Some builds expose the label on the data object instead.
    if (!quality && data && data.qualityLabel) quality = data.qualityLabel;
    if (!quality) {
      // Last resort: derive from videoHeight (never used to *change* anything).
      var v = document.querySelector('video');
      if (v && v.videoHeight) quality = v.videoHeight + 'p';
    }

    return {
      quality: quality || null,
      available: Array.prototype.slice.call(available || []),
      videoId: (data && (data.video_id || data.videoId)) || null,
      title: (data && data.title) || null,
      playerState: call(p, 'getPlayerState'),
      fullscreen: !!call(p, 'isFullscreen')
    };
  }

  function push(force) {
    var snap = read();
    if (!snap) return;
    var sig = JSON.stringify(snap);
    if (!force && sig === lastPayload) return;
    lastPayload = sig;
    post('player', snap);
  }

  function start() {
    if (timer) clearInterval(timer);
    post('hello', null);
    push(true);
    // 1s is enough: the content script samples at its own cadence.
    timer = setInterval(function () { push(false); }, 1000);
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.channel !== CHANNEL) return;

    if (d.type === 'start' && d.payload && d.payload.token) {
      token = d.payload.token;
      start();
      return;
    }
    if (d.token !== token) return;

    if (d.type === 'setQuality') {
      var want = d.payload && d.payload.quality;
      var p = player();
      if (!want || !p) return;
      var cur = call(p, 'getPlaybackQuality');
      // Guard: only ever move UP to the user's own choice, never down.
      if (cur && heightOf(cur) >= heightOf(want)) return;
      try {
        if (typeof p.setPlaybackQuality === 'function') p.setPlaybackQuality(want);
      } catch (e) {}
    }
  });

  function heightOf(label) {
    var m = String(label || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // The player element appears after the initial document parse; poll for it.
  if (document.getElementById('movie_player')) start();
  else {
    var tries = 0;
    var probe = setInterval(function () {
      if (document.getElementById('movie_player')) { clearInterval(probe); if (token) start(); }
      else if (++tries > 120) clearInterval(probe);
    }, 500);
  }
})();
