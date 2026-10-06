// Integration harness: execute the shipped core.js + content.js in a sandboxed
// VM with a fake DOM/chrome, drive a real clock, and verify the Smart Buffer
// Protection loop actually pauses and resumes a <video> element. This exercises
// the production code paths, not a copy.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreSrc = readFileSync(join(root, 'core.js'), 'utf8');
const contentSrc = readFileSync(join(root, 'content.js'), 'utf8');

const { test, section } = globalThis.__test;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeVideo() {
  const handlers = {};
  const v = {
    id: 'test-video',
    paused: false,
    ended: false,
    muted: false,
    readyState: 3,
    playbackRate: 1,
    preload: '',
    duration: 100,
    currentTime: 0,
    bufferedEnd: 3,
    pauseCalls: 0,
    playCalls: 0,
    _buffered: null,
    get buffered() {
      const end = Math.max(0, this.bufferedEnd);
      const start = Math.max(0, Math.min(this.currentTime - 2, end));
      const pairs = end > start ? [[start, end]] : [];
      return {
        length: pairs.length,
        start: i => pairs[i][0],
        end: i => pairs[i][1]
      };
    },
    getBoundingClientRect() { return { width: 640, height: 360 }; },
    closest() { return null; },
    getVideoPlaybackQuality() { return { totalVideoFrames: 600, droppedVideoFrames: 2 }; },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    removeEventListener() {},
    dispatch(type) { (handlers[type] || []).slice().forEach(fn => fn.call(v, { type })); },
    pause() {
      if (this.paused) return;
      this.pauseCalls++;
      this.paused = true;
      this.dispatch('pause');
    },
    play() {
      this.playCalls++;
      this.paused = false;
      this.dispatch('play');
      this.dispatch('playing');
      return Promise.resolve();
    }
  };
  return v;
}

function buildSandbox(video) {
  const messages = [];
  const sandbox = {};

  const documentStub = {
    title: 'Test video',
    hidden: false,
    body: {},
    documentElement: { appendChild() {} },
    addEventListener() {},
    querySelectorAll(sel) { return sel === 'video' ? [video] : []; },
    getElementById() { return null; },
    querySelector() { return null; },
    createElement() { return { addEventListener() {}, style: {}, classList: { toggle() {}, add() {} }, appendChild() {}, querySelector() { return { addEventListener() {} }; }, remove() {}, setPointerCapture() {} }; }
  };

  const chromeStub = {
    runtime: {
      lastError: undefined,
      getURL: x => 'chrome-extension://test/' + x,
      sendMessage(msg, cb) { messages.push(msg); if (cb) cb({ ok: true }); },
      onMessage: { addListener() {} }
    },
    storage: {
      local: {
        get(q, cb) {
          cb({ settings: {
            smartBuffer: true, hudEnabled: false, maxSmoothness: false, rateAdapt: false,
            pinQuality: false, reduceRequests: false, debugLog: false,
            pollMs: 100, pushMs: 200, sampleWindowMs: 4000,
            lowWaterSec: 3, resumeSec: 6, maxPauseMs: 2500, minPauseMs: 300,
            cooldownSec: 1, maxInterventionsPerMin: 20, graceSec: 0, protectHiddenTab: false
          } });
        },
        set(o, cb) { if (cb) cb(); }
      },
      onChanged: { addListener() {} }
    }
  };

  class PerformanceObserverStub { constructor(cb) {} observe() {} }
  class MutationObserverStub { constructor(cb) {} observe() {} disconnect() {} }

  sandbox.window = {
    addEventListener() {},
    postMessage() {},
    __ytSmoothContentLoaded: false
  };
  sandbox.document = documentStub;
  sandbox.location = {
    href: 'https://www.youtube.com/watch?v=abc123def',
    host: 'www.youtube.com',
    pathname: '/watch',
    search: '?v=abc123def'
  };
  sandbox.navigator = {
    onLine: true,
    connection: { effectiveType: '4g', downlink: 10, saveData: false }
  };
  sandbox.chrome = chromeStub;
  sandbox.PerformanceObserver = PerformanceObserverStub;
  sandbox.MutationObserver = MutationObserverStub;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = setInterval;
  sandbox.clearInterval = clearInterval;

  vm.createContext(sandbox);
  return { sandbox, messages };
}

export default async function run() {
  section('content.js integration (VM harness)');

  const video = makeVideo();
  const { sandbox, messages } = buildSandbox(video);

  vm.runInContext(coreSrc, sandbox, { filename: 'core.js' });
  vm.runInContext(contentSrc, sandbox, { filename: 'content.js' });

  // Drive playback time forward while "playing" (1× realtime).
  const driver = setInterval(() => { if (!video.paused && video.currentTime < video.bufferedEnd) video.currentTime += 0.05; }, 50);

  // Let the real clock run the protection loop.
  await sleep(5200);
  clearInterval(driver);

  const lastSnapshot = [...messages].reverse().find(m => m && m.type === 'ytsmooth:snapshot');

  test('boots and attaches to the video', () => {
    ok(lastSnapshot, 'a snapshot was published');
    ok(lastSnapshot.payload.ok === true, 'snapshot.ok');
  });

  test('produces a well-formed snapshot', () => {
    const p = lastSnapshot.payload;
    ok(p.quality && typeof p.quality.selected === 'string', 'quality.selected');
    ok(p.buffer && typeof p.buffer.ahead === 'number', 'buffer.ahead');
    ok(p.playback && typeof p.playback.state === 'string', 'playback.state');
    ok(p.connection && typeof p.connection.level === 'string', 'connection.level');
    ok(p.protection && typeof p.protection.enabled === 'boolean', 'protection.enabled');
  });

  test('Smart Buffer Protection paused the video', () => {
    ok(video.pauseCalls >= 1, `expected >=1 pause, got ${video.pauseCalls}`);
  });

  test('then automatically resumed it', () => {
    ok(video.playCalls >= 1, `expected >=1 play, got ${video.playCalls}`);
  });

  test('protection counters recorded the pause', () => {
    const p = lastSnapshot.payload;
    ok(p.protection.totalPauses >= 1, 'totalPauses >= 1');
  });
}
