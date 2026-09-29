/* ============================================================================
 * Scam Baqi — audio.js
 * 100% offline audio: every sound is synthesised with the WebAudio API.
 * Voices use the browser's built-in offline TTS (speechSynthesis).
 * If no Arabic voice exists on the device, callers speak in retro "blips"
 * (Animal-Crossing style) so the game still feels alive with no internet.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util;

  var AC = null, master = null, sfxGain = null, musGain = null, ambGain = null;
  var enabled = true, voiceOn = true, musOn = true;
  var voices = [], arVoice = null, voiceReady = false;
  var musicTimer = null, ambNodes = null;

  function init() {
    if (AC) return AC;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { enabled = false; return null; }
    try {
      AC = new Ctx();
      master = AC.createGain(); master.gain.value = 0.9; master.connect(AC.destination);
      sfxGain = AC.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master);
      musGain = AC.createGain(); musGain.gain.value = 0.0; musGain.connect(master);
      ambGain = AC.createGain(); ambGain.gain.value = 0.0; ambGain.connect(master);
    } catch (e) { enabled = false; }
    return AC;
  }
  function resume() { if (AC && AC.state === 'suspended') AC.resume(); }

  // ---------------------------------------------------------------- primitives
  function now() { return AC ? AC.currentTime : 0; }
  function tone(freq, dur, type, vol, when, endFreq) {
    if (!AC || !enabled) return;
    var t = (when || now());
    var o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol == null ? 0.3 : vol), t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, when, filterFrom, filterTo) {
    if (!AC || !enabled) return;
    var t = (when || now());
    var len = Math.max(1, Math.floor(AC.sampleRate * dur));
    var buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = AC.createBufferSource(); src.buffer = buf;
    var f = AC.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFrom || 1200, t);
    if (filterTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, filterTo), t + dur);
    var g = AC.createGain(); g.gain.setValueAtTime(vol == null ? 0.3 : vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- sound bank
  var S = {
    click: function () { tone(880, 0.05, 'square', 0.12); },
    hover: function () { tone(1500, 0.03, 'sine', 0.05); },
    open: function () { tone(420, 0.09, 'triangle', 0.18, null, 900); },
    close: function () { tone(700, 0.1, 'triangle', 0.15, null, 300); },
    error: function () { tone(180, 0.18, 'sawtooth', 0.2, null, 90); },
    success: function () { tone(660, 0.1, 'triangle', 0.2); tone(990, 0.16, 'triangle', 0.18, now() + 0.1); },
    chime: function () { [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.35, 'sine', 0.16, now() + i * 0.09); }); },
    cash: function () {
      tone(1200, 0.06, 'square', 0.16); tone(1800, 0.07, 'square', 0.14, now() + 0.06);
      tone(2400, 0.22, 'square', 0.12, now() + 0.13);
    },
    coin: function () { tone(1568, 0.08, 'square', 0.13); tone(2093, 0.1, 'square', 0.11, now() + 0.06); },
    ring: function () { // Moroccan phone ring
      var t = now();
      for (var i = 0; i < 2; i++) {
        tone(440, 0.35, 'sine', 0.22, t + i * 0.5);
        tone(480, 0.35, 'sine', 0.2, t + i * 0.5);
      }
    },
    dial: function () { tone(350, 0.5, 'sine', 0.12); tone(440, 0.5, 'sine', 0.1); },
    keypad: function (n) { tone(600 + ((n || 1) % 10) * 60, 0.07, 'square', 0.14); },
    connect: function () { tone(900, 0.05, 'square', 0.12); tone(1200, 0.06, 'square', 0.1, now() + 0.05); },
    hangup: function () { tone(300, 0.12, 'square', 0.16, null, 150); noise(0.1, 0.1); },
    typing: function () { tone(U.rnd(1400, 2200), 0.02, 'square', 0.05); },
    notify: function () { tone(784, 0.1, 'triangle', 0.16); tone(1175, 0.14, 'triangle', 0.14, now() + 0.1); },
    virus: function () {
      for (var i = 0; i < 8; i++) tone(U.irnd(120, 900), 0.09, 'sawtooth', 0.16, now() + i * 0.07, U.irnd(80, 400));
      noise(0.7, 0.2, null, 3000, 200);
    },
    siren: function () {
      var t = now();
      for (var i = 0; i < 6; i++) {
        tone(700, 0.3, 'sine', 0.16, t + i * 0.34, 1100);
        tone(1100, 0.3, 'sine', 0.14, t + i * 0.34 + 0.17, 700);
      }
    },
    boom: function () { noise(1.1, 0.5, null, 2500, 60); tone(90, 0.9, 'sine', 0.35, null, 35); },
    stapler: function () { noise(0.08, 0.3, null, 4000, 800); tone(220, 0.1, 'square', 0.2, null, 120); },
    whoosh: function () { noise(0.35, 0.25, null, 600, 2500); },
    alarm: function () { for (var i = 0; i < 4; i++) tone(1000, 0.16, 'square', 0.2, now() + i * 0.22, 700); },
    door: function () { noise(0.25, 0.14, null, 500, 120); tone(120, 0.2, 'sine', 0.12, null, 80); },
    step: function () { noise(0.05, 0.05, null, 900, 300); },
    camera: function () { noise(0.06, 0.2, null, 5000, 2000); tone(1600, 0.05, 'square', 0.1, now() + 0.07); },
    power: function () { tone(60, 0.5, 'sawtooth', 0.22, null, 25); noise(0.4, 0.1, null, 800, 200); },
    boo: function () { tone(140, 0.5, 'sawtooth', 0.22, null, 70); noise(0.3, 0.14); },
    blip: function (p, len) {
      // used for retro "voice" when no TTS voice is installed
      var f = 220 + (p || 0.5) * 380;
      tone(f, Math.max(0.05, len || 0.08), 'square', 0.09, null, f * 1.06);
    }
  };

  // `sfx` works both ways: sfx('click') and sfx.click()
  function sfxPlay(name, arg) {
    var f = S[name];
    if (typeof f === 'function') return f(arg);
  }
  Object.keys(S).forEach(function (k) { sfxPlay[k] = S[k]; });

  // ------------------------------------------------------------------- voices
  function refreshVoices() {
    if (!('speechSynthesis' in window)) { voiceReady = true; return; }
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
    var ar = voices.filter(function (v) { return /^ar/i.test(v.lang || ''); });
    // Prefer Moroccan / MSA voices, then any Arabic voice
    arVoice = ar.filter(function (v) { return /MA|ar-SA|ar-EG|ar-XA/i.test(v.lang); })[0] || ar[0] || null;
    voiceReady = true;
  }
  if ('speechSynthesis' in window) {
    refreshVoices();
    try { window.speechSynthesis.onvoiceschanged = refreshVoices; } catch (e) {}
    setTimeout(refreshVoices, 400); setTimeout(refreshVoices, 1500);
  } else { voiceReady = true; }

  var speaking = false;
  function stopSpeech() {
    if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    speaking = false;
  }

  /**
   * Speak a line out loud. Works with any installed system voice; if the device
   * has no Arabic voice (or the user turned voice off) falls back to blips.
   * opts: {gender:'m'|'f', pitch:1, rate:1, style:'caller'|'boss'|'co', onEnd, blipOnly}
   */
  function speak(text, opts) {
    opts = opts || {};
    var done = opts.onEnd || function () {};
    if (!enabled || !text) { setTimeout(done, 30); return; }
    var clean = String(text).replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

    if (voiceOn && !opts.blipOnly && 'speechSynthesis' in window && (voices.length === 0 || arVoice)) {
      try {
        var u = new SpeechSynthesisUtterance(clean);
        if (arVoice) u.voice = arVoice;
        u.lang = (arVoice && arVoice.lang) || 'ar';
        u.pitch = U.clamp((opts.pitch == null ? (opts.gender === 'f' ? 1.25 : 0.85) : opts.pitch), 0.1, 2);
        u.rate = U.clamp(opts.rate == null ? 1 : opts.rate, 0.5, 2);
        u.volume = 1;
        var finished = false, tf = null;
        var end = function () {
          if (finished) return; finished = true;
          if (tf) clearTimeout(tf);
          speaking = false; done();
        };
        u.onend = end; u.onerror = end;
        speaking = true;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        // safety net: some browsers never fire onend
        tf = setTimeout(end, 900 + clean.length * 105 / (u.rate || 1));
        return;
      } catch (e) { /* fall through to blips */ }
    }
    // blips
    var n = U.clamp(Math.round(clean.length / 3.2), 6, 60);
    var pitch = opts.pitch == null ? (opts.gender === 'f' ? 1.4 : 0.8) : opts.pitch;
    var i = 0;
    var id = setInterval(function () {
      if (i++ >= n) { clearInterval(id); done(); return; }
      S.blip(pitch * U.rnd(0.9, 1.1), U.rnd(0.05, 0.1));
    }, 62);
  }

  // ------------------------------------------------------------------ ambience
  function ambienceOn(on) {
    if (!AC) return;
    var t = now();
    if (on && !ambNodes) {
      // air-con hum + faint office chatter
      var o = AC.createOscillator(); o.type = 'sine'; o.frequency.value = 58;
      var g = AC.createGain(); g.gain.value = 0.16;
      var o2 = AC.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 117;
      var g2 = AC.createGain(); g2.gain.value = 0.05;
      var len = Math.floor(AC.sampleRate * 3);
      var buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
      var src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
      var f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.7;
      var g3 = AC.createGain(); g3.gain.value = 0.05;
      o.connect(g); o2.connect(g2); src.connect(f); f.connect(g3);
      g.connect(ambGain); g2.connect(ambGain); g3.connect(ambGain);
      o.start(); o2.start(); src.start();
      ambNodes = { o: o, o2: o2, src: src, g: g, g2: g2, g3: g3 };
      ambGain.gain.cancelScheduledValues(t);
      ambGain.gain.setValueAtTime(ambGain.gain.value, t);
      ambGain.gain.linearRampToValueAtTime(0.5, t + 1.2);
    } else if (!on && ambNodes) {
      ambGain.gain.linearRampToValueAtTime(0.0, t + 0.6);
      var nodes = ambNodes; ambNodes = null;
      setTimeout(function () {
        try { nodes.o.stop(); nodes.o2.stop(); nodes.src.stop(); } catch (e) {}
      }, 900);
    }
  }

  // --------------------------------------------------------------------- music
  // A tiny procedural "oud + darbuka" loop (hijaz-ish scale) for menus & radio.
  var HIJAZ = [0, 1, 4, 5, 7, 8, 11, 12];
  function midi(f) { return 440 * Math.pow(2, (f - 69) / 12); }
  var musicStep = 0;
  function musicStart() {
    if (!AC || musicTimer) return;
    musGain.gain.cancelScheduledValues(now());
    musGain.gain.linearRampToValueAtTime(musOn ? 0.34 : 0, now() + 1.0);
    musicTimer = setInterval(function () {
      if (!AC || !musOn) return;
      var base = 45 + (musicStep % 4 === 2 ? 2 : 0);
      var deg = HIJAZ[(musicStep * 3 + Math.floor(musicStep / 4)) % HIJAZ.length];
      // melody pluck
      var t = now() + 0.02;
      var o = AC.createOscillator(), g = AC.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(midi(base + 12 + deg), t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(g); g.connect(musGain); o.start(t); o.stop(t + 0.6);
      // bass
      if (musicStep % 4 === 0) {
        var o2 = AC.createOscillator(), g2 = AC.createGain();
        o2.type = 'sine'; o2.frequency.setValueAtTime(midi(base - 12), t);
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        o2.connect(g2); g2.connect(musGain); o2.start(t); o2.stop(t + 1.2);
      }
      // darbuka-ish tick
      if (musicStep % 2 === 1) {
        var len = Math.floor(AC.sampleRate * 0.08);
        var buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        var s = AC.createBufferSource(); s.buffer = buf;
        var f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 380;
        var gg = AC.createGain(); gg.gain.value = 0.5;
        s.connect(f); f.connect(gg); gg.connect(musGain); s.start(now());
      }
      musicStep++;
    }, 300);
  }
  function musicStop() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } if (AC) musGain.gain.linearRampToValueAtTime(0, now() + 0.4); }
  function setMusic(on) { musOn = !!on; if (AC) musGain.gain.linearRampToValueAtTime(musOn && musicTimer ? 0.34 : 0, now() + 0.3); }

  SWYF.audio = {
    init: init, resume: resume, sfx: sfxPlay, bank: S, speak: speak, stopSpeech: stopSpeech,
    ambience: ambienceOn, music: { start: musicStart, stop: musicStop, set: setMusic, isOn: function () { return musOn; } },
    setEnabled: function (v) { enabled = !!v; if (master) master.gain.value = enabled ? 0.9 : 0; },
    isEnabled: function () { return enabled; },
    setVoice: function (v) { voiceOn = !!v; if (!v) stopSpeech(); },
    isVoiceOn: function () { return voiceOn; },
    hasArabicVoice: function () { return !!arVoice; },
    hasTTS: function () { return 'speechSynthesis' in window; }
  };
})();
