// SAWT+ UI controller — boost dial, meter, sources, presets, persistence.
import { SoundEngine } from "./audio.js";

const SETTINGS_KEY = "sawt-settings-v1";

// slider 0..100 → gain 0.5 × 2^(v/25): 0→0.5×, 25→1×, 50→2×, 75→4×, 100→8×
const gainFromSlider = (v) => 0.5 * 2 ** (v / 25);
const dbFromGain = (g) => 20 * Math.log10(Math.max(0.01, g));

const PRESETS = {
  clean: { boost: 25, bass: 0, treble: 0, master: 80, limiter: true },
  speech: { boost: 55, bass: -3, treble: 5, master: 85, limiter: true },
  music: { boost: 45, bass: 3, treble: 1, master: 85, limiter: true },
  bass: { boost: 50, bass: 8, treble: -2, master: 88, limiter: true },
  night: { boost: 35, bass: 0, treble: -4, master: 55, limiter: true },
};

const $ = (sel) => document.querySelector(sel);

function loadSettings() {
  try {
    return {
      ...structuredClone(defaults()),
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
    };
  } catch {
    return { ...defaults() };
  }
}
const defaults = () => ({
  boost: 50,
  bass: 0,
  treble: 0,
  master: 80,
  muted: false,
  limiter: true,
  mode: "sounds",
  loop: false,
});

const state = loadSettings();
const engine = new SoundEngine();

const els = {
  boost: $("#boost"),
  boostX: $("#boost-x"),
  boostDb: $("#boost-db"),
  meterFill: $("#meter-fill"),
  meterPeak: $("#meter-peak"),
  clip: $("#clip-led"),
  bass: $("#bass"),
  bassVal: $("#bass-val"),
  treble: $("#treble"),
  trebleVal: $("#treble-val"),
  limiter: $("#limiter"),
  mute: $("#mute-button"),
  master: $("#master"),
  masterVal: $("#master-val"),
  status: $("#status"),
  micToggle: $("#mic-toggle"),
  fileInput: $("#file-input"),
  fileName: $("#file-name"),
  filePlay: $("#file-play"),
  fileSeek: $("#file-seek"),
  fileTime: $("#file-time"),
  fileDuration: $("#file-duration"),
  fileLoop: $("#file-loop"),
  stopAll: $("#stop-all"),
  install: $("#install-button"),
  about: $("#about-dialog"),
};

function save() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state));
  } catch {}
}

function setStatus(text, warn = false) {
  els.status.textContent = text;
  els.status.classList.toggle("warn", warn);
}

function fillRange(input) {
  const min = Number(input.min || 0),
    max = Number(input.max || 100);
  const pct = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${pct}%`);
}

function syncBoost() {
  const gain = gainFromSlider(Number(els.boost.value));
  els.boostX.textContent = `×${gain < 1 ? gain.toFixed(2) : gain.toFixed(2)}`;
  els.boostDb.textContent = `${dbFromGain(gain) >= 0 ? "+" : ""}${dbFromGain(gain).toFixed(1)} dB`;
  fillRange(els.boost);
  engine.setBoost(gain);
}

function syncTone() {
  els.bassVal.textContent = `${Number(els.bass.value) > 0 ? "+" : ""}${els.bass.value} dB`;
  els.trebleVal.textContent = `${Number(els.treble.value) > 0 ? "+" : ""}${els.treble.value} dB`;
  fillRange(els.bass);
  fillRange(els.treble);
  engine.setBassDb(Number(els.bass.value));
  engine.setTrebleDb(Number(els.treble.value));
}

function syncMaster() {
  fillRange(els.master);
  els.masterVal.textContent = `${els.master.value}%`;
  engine.setMaster(Number(els.master.value) / 100);
  engine.setMuted(state.muted);
}

function applyState() {
  els.boost.value = state.boost;
  els.bass.value = state.bass;
  els.treble.value = state.treble;
  els.master.value = state.master;
  els.limiter.checked = state.limiter;
  els.fileLoop.checked = state.loop;
  els.mute.setAttribute("aria-pressed", String(state.muted));
  els.mute.querySelector("b").textContent = state.muted ? "MUTED" : "MUTE";
  syncBoost();
  syncTone();
  syncMaster();
  engine.setLimiter(state.limiter);
  setMode(state.mode, false);
  document
    .querySelectorAll(".preset")
    .forEach((b) => b.setAttribute("aria-pressed", "false"));
}

function setMode(mode, saveState = true) {
  state.mode = mode;
  for (const tab of document.querySelectorAll(".mode-tab")) {
    const on = tab.dataset.mode === mode;
    tab.setAttribute("aria-selected", String(on));
  }
  for (const panel of document.querySelectorAll(".mode-panel")) {
    panel.hidden = panel.id !== `panel-${mode}`;
  }
  if (saveState) save();
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  Object.assign(state, preset);
  applyState();
  save();
  document
    .querySelectorAll(".preset")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.preset === name)),
    );
  setStatus(`Preset ${name.toUpperCase()} — clean boost, bla tachawch.`);
}

// ── meter loop ─────────────────────────────────────────────────────────
let clipUntil = 0;
let peakHold = 0;
function meterLoop() {
  const { peak, rms } = engine.tickLevels();
  const shown = Math.min(1, rms * 2.6);
  peakHold = Math.max(shown, peakHold * 0.94);
  els.meterFill.style.width = `${(shown * 100).toFixed(1)}%`;
  els.meterPeak.style.left = `min(${(peakHold * 100).toFixed(1)}%, calc(100% - 3px))`;
  if (peak >= 0.985) clipUntil = performance.now() + 1400;
  els.clip.classList.toggle("on", performance.now() < clipUntil);

  const file = engine.fileState;
  if (file) {
    if (!seeking) {
      els.fileSeek.value = String(Math.floor(file.time));
      fillRange(els.fileSeek);
      els.fileTime.textContent = fmt(file.time);
    }
    els.fileDuration.textContent = fmt(file.duration);
  }
  requestAnimationFrame(meterLoop);
}

const fmt = (s) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60),
    sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

// ── events ─────────────────────────────────────────────────────────────
let seeking = false;

els.boost.addEventListener("input", () => {
  state.boost = Number(els.boost.value);
  syncBoost();
  save();
  document
    .querySelectorAll(".preset")
    .forEach((b) => b.setAttribute("aria-pressed", "false"));
});
els.bass.addEventListener("input", () => {
  state.bass = Number(els.bass.value);
  syncTone();
  save();
});
els.treble.addEventListener("input", () => {
  state.treble = Number(els.treble.value);
  syncTone();
  save();
});
els.master.addEventListener("input", () => {
  state.master = Number(els.master.value);
  if (state.muted) {
    state.muted = false;
    els.mute.setAttribute("aria-pressed", "false");
    els.mute.querySelector("b").textContent = "MUTE";
  }
  syncMaster();
  save();
});
els.limiter.addEventListener("change", () => {
  state.limiter = els.limiter.checked;
  engine.setLimiter(state.limiter);
  save();
  setStatus(
    state.limiter
      ? "Limiter on — loud stays clean, bla tachawch."
      : "Limiter off — watch the CLIP light.",
    !state.limiter,
  );
});
els.mute.addEventListener("click", () => {
  state.muted = !state.muted;
  els.mute.setAttribute("aria-pressed", String(state.muted));
  els.mute.querySelector("b").textContent = state.muted ? "MUTED" : "MUTE";
  engine.setMuted(state.muted);
  save();
});

for (const tab of document.querySelectorAll(".mode-tab")) {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
}

document.querySelectorAll(".preset").forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
});

// sound tiles
for (const tile of document.querySelectorAll(".tile")) {
  tile.addEventListener("click", async () => {
    await engine.ensure();
    const id = tile.dataset.sound;
    const playing = tile.getAttribute("aria-pressed") === "true";
    if (playing) {
      engine.stopSound(id);
      tile.setAttribute("aria-pressed", "false");
    } else {
      engine.startSound(id);
      tile.setAttribute("aria-pressed", "true");
    }
    const live = engine.playingSounds;
    setStatus(
      live.length
        ? `Playing: ${live.join(" + ")} — through the boost chain.`
        : "All sounds stopped.",
    );
    save();
  });
}

els.stopAll.addEventListener("click", () => {
  engine.stopAllSounds();
  for (const tile of document.querySelectorAll(".tile"))
    tile.setAttribute("aria-pressed", "false");
  setStatus("All sounds stopped.");
});

// microphone
els.micToggle.addEventListener("click", async () => {
  try {
    if (engine.micActive) {
      engine.stopMic();
      els.micToggle.classList.remove("active");
      els.micToggle.querySelector("b").textContent = "START MIC";
      setStatus("Microphone off.");
      return;
    }
    await engine.startMic();
    els.micToggle.classList.add("active");
    els.micToggle.querySelector("b").textContent = "STOP MIC";
    setStatus(
      "Mic live — boosted, headphones recommended to avoid feedback.",
      true,
    );
  } catch {
    setStatus(
      "Microphone blocked. Allow mic access in your browser to use speaker mode.",
      true,
    );
  }
});

// file mode
els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files?.[0];
  if (!file) return;
  try {
    await engine.loadFile(file);
    els.fileName.textContent = file.name;
    els.fileSeek.value = "0";
    els.fileSeek.max = String(Math.floor(engine.fileState?.duration || 0));
    fillRange(els.fileSeek);
    els.filePlay.classList.add("amber");
    engine.filePlay();
    setStatus(`Playing ${file.name} through the boost chain.`);
  } catch {
    setStatus(
      "That file could not be decoded. Try MP3, WAV, OGG, or M4A.",
      true,
    );
  }
});

els.filePlay.addEventListener("click", () => {
  const file = engine.fileState;
  if (!file) {
    els.fileInput.click();
    return;
  }
  if (file.playing) {
    engine.filePause();
    els.filePlay.classList.remove("amber");
  } else {
    engine.filePlay();
    els.filePlay.classList.add("amber");
  }
});

els.fileSeek.addEventListener("pointerdown", () => (seeking = true));
window.addEventListener("pointerup", () => {
  if (seeking) {
    seeking = false;
    engine.fileSeek(Number(els.fileSeek.value));
  }
});
els.fileSeek.addEventListener("input", () => {
  fillRange(els.fileSeek);
  els.fileTime.textContent = fmt(Number(els.fileSeek.value));
});
els.fileLoop.addEventListener("change", () => {
  state.loop = els.fileLoop.checked;
  engine.setFileLoop(state.loop);
  save();
});

// about dialog
$("#about-button").addEventListener("click", () => els.about.showModal());
els.about.querySelector("form").addEventListener("submit", (e) => {
  e.preventDefault();
  els.about.close();
});

// install prompt
let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  els.install.hidden = false;
});
els.install.addEventListener("click", async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  els.install.hidden = true;
});

// visibility: keep meter honest when tab returns
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) engine.tickLevels();
});

// first touch anywhere unlocks the audio clock (autoplay policy)
window.addEventListener(
  "pointerdown",
  () => {
    engine.ensure().catch(() => {});
  },
  { once: true },
);

// expose for tests + power users
applyState();
window.SAWT = { engine, state, gainFromSlider, applyPreset, setMode };
requestAnimationFrame(meterLoop);
setStatus("Ready — pick a source and raise the boost.");
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("sw.js").catch(() => {});
