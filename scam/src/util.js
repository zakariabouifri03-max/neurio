/* ============================================================================
 * Scam Baqi — util.js
 * Small helpers: DOM, RNG, math, Arabic/number formatting, storage, events.
 * 100% offline, no dependencies. Exposes window.SWYF.util
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});

  // ---- DOM helpers ----------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function on(node, ev, fn, opts) { if (node) node.addEventListener(ev, fn, opts); return node; }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }
  function toggle(node, v) { if (!node) return; if (v) show(node); else hide(node); }

  // ---- math / rng -----------------------------------------------------------
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function irnd(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function picks(arr, n) {
    var copy = arr.slice(), out = [];
    n = Math.min(n, copy.length);
    while (out.length < n) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
  }
  function chance(p) { return Math.random() < p; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function round(v, step) { step = step || 1; return Math.round(v / step) * step; }

  // ---- formatting -----------------------------------------------------------
  function money(v) {
    v = Math.round(v || 0);
    return v.toLocaleString('fr-FR').replace(/\u202f/g, ' ') + ' درهم';
  }
  function clampText(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  // Strips Arabic diacritics + normalises letters so free-text matching is forgiving
  var AR_DIAC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
  function normAr(s) {
    return String(s || '')
      .replace(AR_DIAC, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[\u0660-\u0669]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48); })
      .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
  function minutes(n) {
    n = Math.max(0, Math.round(n));
    var h = Math.floor(n / 60), m = n % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // ---- tiny event bus -------------------------------------------------------
  var listeners = {};
  function fire(name, payload) {
    var l = listeners[name];
    if (!l) return;
    for (var i = 0; i < l.length; i++) {
      try { l[i](payload); } catch (e) { console.warn('[bus]', name, e); }
    }
  }
  function listen(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }

  // ---- storage --------------------------------------------------------------
  var KEY = 'scam-baqi-save-v1';
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function save(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  function wipe() { try { localStorage.removeItem(KEY); } catch (e) {} }

  // ---- text templating: "{name} ربح {amount}" -------------------------------
  function tpl(str, ctx) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      var v = ctx && ctx[k];
      if (v === undefined || v === null) return m;
      return typeof v === 'number' ? money(v) : String(v);
    });
  }

  // ---- error overlay --------------------------------------------------------
  function fail(msg) {
    var box = document.getElementById('errLog');
    if (!box) { console.error(msg); return; }
    box.classList.add('on');
    box.textContent = '⚠️ ' + msg;
    console.error(msg);
  }

  SWYF.util = {
    $: $, $$: $$, el: el, on: on, clear: clear, show: show, hide: hide, toggle: toggle,
    rnd: rnd, irnd: irnd, pick: pick, picks: picks, chance: chance, clamp: clamp, lerp: lerp, round: round,
    money: money, clampText: clampText, normAr: normAr, minutes: minutes, tpl: tpl,
    fire: fire, listen: listen, load: load, save: save, wipe: wipe, fail: fail
  };
})();
