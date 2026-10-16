const $ = (id) => document.getElementById(id);
const audio = $("audio");
const tracks = [];
let current = -1,
  ctx,
  source,
  boostNode,
  volumeNode,
  analyser,
  compressor,
  filters;
let enginePromise,
  limiterReady = false,
  strongMode = false,
  playingRequest = 0,
  installPrompt;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const status = (text) => {
  $("status").textContent = text;
};
const time = (value) =>
  Number.isFinite(value)
    ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`
    : "0:00";
const dbGain = (db) => Math.pow(10, db / 20);

async function initializeAudio() {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass)
      throw new Error(
        "Web Audio is not available in this browser. Try a recent Chrome or Safari.",
      );
    ctx = new AudioContextClass();
    await ctx.resume();
    let limiter;
    try {
      await ctx.audioWorklet.addModule(
        new URL("./limiter-worklet.js", import.meta.url),
      );
      limiter = new AudioWorkletNode(ctx, "safi-limiter", {
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
      });
      limiterReady = true;
      $("strong-mode").disabled = false;
      $("mode-hint").textContent = "Up to +24 dB with dynamic compression.";
      $("protection-state").textContent = "ACTIVE";
      $("protection-copy").textContent =
        "5 ms look-ahead • −1 dBFS sample ceiling";
    } catch {
      // No pretend protection: prevent extra gain when the limiter is unavailable.
      $("strong-mode").disabled = true;
      $("mode-hint").textContent = "Strong lift needs a working limiter.";
      $("boost-max-label").textContent = "0 dB";
      $("boost").max = "0";
      $("boost").value = "0";
      updateBoost();
      $("protection-state").textContent = "UNAVAILABLE";
      $("protection-copy").textContent =
        "Boost & tone presets disabled in this browser";
      $("protection-label").textContent = "Basic playback only";
      document.querySelectorAll("[data-preset]").forEach((b) => {
        b.disabled = b.dataset.preset !== "balanced";
      });
      selectPreset("balanced");
      status(
        "Limiter unavailable. Positive boost is disabled. Try a recent Chrome or Safari over HTTPS.",
      );
    }
    source = ctx.createMediaElementSource(audio);
    filters = ["lowshelf", "peaking", "highshelf"].map((type, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = [160, 1800, 6500][i];
      filter.Q.value = 0.7;
      return filter;
    });
    boostNode = ctx.createGain();
    volumeNode = ctx.createGain();
    boostNode.gain.value = dbGain(Number($("boost").value));
    volumeNode.gain.value = Number($("volume").value) / 100;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    let last = source;
    for (const filter of filters) {
      last.connect(filter);
      last = filter;
    }
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = 0;
    compressor.knee.value = 0;
    compressor.ratio.value = 1;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.18;
    last.connect(compressor);
    compressor.connect(boostNode);
    if (limiter) {
      boostNode.connect(limiter);
      limiter.connect(volumeNode);
    } else boostNode.connect(volumeNode);
    volumeNode.connect(analyser);
    analyser.connect(ctx.destination);
    updateBoost();
    updateVolume();
    selectPreset(
      document.querySelector("[data-preset].selected").dataset.preset,
    );
    $("engine-status").textContent = limiterReady
      ? "Protected playback"
      : "Basic playback · no boost";
    return ctx;
  })();
  // Keep a failed context from being duplicated; surface the actionable error.
  return enginePromise;
}

function setStrongMode(enabled) {
  if (enabled && !limiterReady) return;
  strongMode = enabled;
  // Reset gain BEFORE changing processing mode; never silently retain a high gain.
  $("boost").value = "0";
  $("boost").max =
    limiterReady || !enginePromise ? (enabled ? "24" : "12") : "0";
  if (enabled)
    $("volume").value = String(Math.min(Number($("volume").value), 40));
  updateBoost();
  updateVolume();
  $("boost-max-label").textContent = `+${$("boost").max} dB`;
  $("strong-mode").setAttribute("aria-pressed", String(enabled));
  $("strong-mode").classList.toggle("selected", enabled);
  $("strong-mode").textContent = enabled ? "Strong lift: ON" : "Strong lift";
  $("boost-description").textContent = enabled
    ? "Quiet passages lifted. Peaks kept in check."
    : "A gentle lift for everyday listening.";
  $("compression-readout").hidden = !enabled;
  if (compressor) {
    const now = ctx.currentTime;
    compressor.threshold.setTargetAtTime(enabled ? -24 : 0, now, 0.04);
    compressor.knee.setTargetAtTime(enabled ? 12 : 0, now, 0.04);
    compressor.ratio.setTargetAtTime(enabled ? 3.5 : 1, now, 0.04);
  }
  status(
    enabled
      ? "Strong lift enabled at 0 dB. Output lowered to 40% or less. Raise gradually; compression changes dynamics."
      : "Gentle mode restored at 0 dB. Strong compression is off.",
  );
}
$("strong-mode").addEventListener("click", () => {
  if (strongMode) setStrongMode(false);
  else $("strong-dialog").showModal();
});
$("strong-cancel").addEventListener("click", () => $("strong-dialog").close());
$("strong-confirm").addEventListener("click", () => {
  $("strong-dialog").close();
  setStrongMode(true);
});

function updateBoost() {
  const value = Number($("boost").value);
  $("boost-value").textContent = `${value >= 0 ? "+" : ""}${value}`;
  if (boostNode)
    boostNode.gain.setTargetAtTime(dbGain(value), ctx.currentTime, 0.025);
}
function updateVolume() {
  const value = Number($("volume").value);
  $("volume-value").textContent = `${value}%`;
  if (volumeNode)
    volumeNode.gain.setTargetAtTime(value / 100, ctx.currentTime, 0.025);
}
function selectPreset(preset) {
  const gains = { balanced: [0, 0, 0], voice: [-3, 2, -1], warm: [3, -1, -2] }[
    preset
  ];
  if (!gains) return;
  document.querySelectorAll("[data-preset]").forEach((button) => {
    const active = button.dataset.preset === preset;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (filters)
    filters.forEach((filter, i) =>
      filter.gain.setTargetAtTime(gains[i], ctx.currentTime, 0.04),
    );
}
$("boost").addEventListener("input", updateBoost);
$("volume").addEventListener("input", updateVolume);
document
  .querySelectorAll("[data-preset]")
  .forEach((button) =>
    button.addEventListener("click", () => selectPreset(button.dataset.preset)),
  );
$("reset").addEventListener("click", () => {
  setStrongMode(false);
  $("boost").value = "0";
  $("volume").value = "70";
  updateBoost();
  updateVolume();
  selectPreset("balanced");
  status("Sound settings reset. Start low and increase gradually.");
});

function renderTracks() {
  $("track-list").replaceChildren();
  tracks.forEach((track, index) => {
    const li = document.createElement("li");
    li.classList.toggle("active", index === current);
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const button = document.createElement("button");
    button.className = "track-select";
    button.textContent = track.file.name;
    if (index === current) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => {
      selectTrack(index);
      play();
    });
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${track.file.name}`);
    remove.addEventListener("click", () => removeTrack(index));
    li.append(number, button, remove);
    $("track-list").append(li);
  });
  $("play").disabled = current < 0;
  $("previous").disabled = current <= 0;
  $("next").disabled = current < 0 || current >= tracks.length - 1;
}
function selectTrack(index) {
  if (index < 0 || index >= tracks.length) return;
  playingRequest++;
  audio.pause();
  current = index;
  const track = tracks[index];
  audio.src = track.url;
  audio.load();
  $("track-name").textContent = track.file.name.replace(/\.[^.]+$/, "");
  $("track-detail").textContent =
    `${(track.file.size / (1024 * 1024)).toFixed(1)} MB · On your device`;
  $("source-type").textContent = track.file.name
    .split(".")
    .pop()
    .slice(0, 8)
    .toUpperCase();
  $("seek").disabled = true;
  $("seek").value = "0";
  $("elapsed").textContent = "0:00";
  $("duration").textContent = "0:00";
  renderTracks();
  status("Track ready. Press play and start at a comfortable level.");
}
function removeTrack(index) {
  const active = current === index;
  if (active) {
    playingRequest++;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  URL.revokeObjectURL(tracks[index].url);
  tracks.splice(index, 1);
  if (active) {
    current = -1;
    if (tracks.length) selectTrack(Math.min(index, tracks.length - 1));
    else {
      $("track-name").textContent = "Make room for your music.";
      $("track-detail").textContent = "Open a track to get started";
      $("source-type").textContent = "LOCAL AUDIO";
      $("seek").value = "0";
      $("seek").disabled = true;
      $("elapsed").textContent = $("duration").textContent = "0:00";
      status("Library cleared. Your original files were not changed.");
    }
  } else if (index < current) current--;
  renderTracks();
}
function addFiles(files) {
  let added = 0,
    rejected = 0;
  for (const file of files) {
    if (tracks.length >= 50) {
      rejected++;
      continue;
    }
    if (
      !file.type.startsWith("audio/") &&
      !/\.(mp3|wav|m4a|ogg|flac|aac|opus|aiff|webm)$/i.test(file.name)
    ) {
      rejected++;
      continue;
    }
    tracks.push({ file, url: URL.createObjectURL(file) });
    added++;
  }
  if (current < 0 && tracks.length) selectTrack(0);
  renderTracks();
  status(
    `${added} audio file${added === 1 ? "" : "s"} added. Files stay on your device.${rejected ? ` ${rejected} skipped (audio only, up to 50 tracks).` : ""}`,
  );
}
async function play() {
  if (current < 0) return;
  const request = ++playingRequest;
  $("engine-status").textContent = "Preparing audio…";
  try {
    await initializeAudio();
    if (request !== playingRequest) return;
    await ctx.resume();
    if (request !== playingRequest) return;
    await audio.play();
    if (request !== playingRequest) return;
    $("engine-status").textContent = limiterReady
      ? "Protected playback"
      : "Basic playback · no boost";
    status(
      limiterReady
        ? "Playing locally. Increase boost gently; more gain can reduce dynamics."
        : "Playing without added boost. Limiter unavailable in this browser.",
    );
  } catch (error) {
    if (request !== playingRequest) return;
    $("engine-status").textContent = "Playback unavailable";
    status(
      `Could not play: ${error.message}. Try another supported audio file or browser.`,
    );
  }
}
$("play").addEventListener("click", () => {
  if (audio.paused) play();
  else {
    playingRequest++;
    audio.pause();
  }
});
$("previous").addEventListener("click", () => {
  if (current > 0) {
    selectTrack(current - 1);
    play();
  }
});
$("next").addEventListener("click", () => {
  if (current + 1 < tracks.length) {
    selectTrack(current + 1);
    play();
  }
});
audio.addEventListener("play", () => {
  $("play").textContent = "Ⅱ";
  $("play").setAttribute("aria-label", "Pause");
});
audio.addEventListener("pause", () => {
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "Play");
});
audio.addEventListener("ended", () => {
  if (current + 1 < tracks.length) {
    selectTrack(current + 1);
    play();
  } else {
    $("play").textContent = "▶";
    $("play").setAttribute("aria-label", "Play");
    status("End of your listening list.");
  }
});
audio.addEventListener("error", () => {
  if (audio.getAttribute("src"))
    status(
      "This file could not be played. It may be damaged or unsupported by your browser. Try MP3 or WAV.",
    );
});
function updateDuration() {
  const finite = Number.isFinite(audio.duration) && audio.duration > 0;
  $("duration").textContent = time(audio.duration);
  $("seek").disabled = !finite;
  if (finite) $("seek").max = String(audio.duration);
}
audio.addEventListener("loadedmetadata", updateDuration);
audio.addEventListener("durationchange", updateDuration);
audio.addEventListener("timeupdate", () => {
  $("elapsed").textContent = time(audio.currentTime);
  if (!$("seek").matches(":active"))
    $("seek").value = String(audio.currentTime);
});
$("seek").addEventListener("input", () => {
  if (Number.isFinite(audio.duration))
    audio.currentTime = Number($("seek").value);
});
$("files").addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});
$("add-files").addEventListener("click", () => $("files").click());
$("drop-zone").addEventListener("click", () => $("files").click());
$("drop-zone").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    $("files").click();
  }
});
for (const type of ["dragenter", "dragover"])
  $("drop-zone").addEventListener(type, (event) => {
    event.preventDefault();
    $("drop-zone").classList.add("dragging");
  });
for (const type of ["dragleave", "drop"])
  $("drop-zone").addEventListener(type, (event) => {
    event.preventDefault();
    $("drop-zone").classList.remove("dragging");
  });
$("drop-zone").addEventListener("drop", (event) =>
  addFiles(event.dataTransfer.files),
);
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

const canvas = $("visualizer"),
  painter = canvas.getContext("2d");
let frequency = new Uint8Array(256),
  samples = new Float32Array(512),
  lastDraw = 0;
function draw(now) {
  requestAnimationFrame(draw);
  if (now - lastDraw < (reducedMotion ? 250 : 50) || document.hidden) return;
  lastDraw = now;
  const width = canvas.clientWidth,
    height = canvas.clientHeight,
    ratio = Math.min(devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(width * ratio) ||
    canvas.height !== Math.round(height * ratio)
  ) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  painter.setTransform(ratio, 0, 0, ratio, 0, 0);
  painter.clearRect(0, 0, width, height);
  const active = analyser && !audio.paused;
  if (strongMode && compressor)
    $("reduction-value").textContent =
      `${(active ? Math.abs(compressor.reduction) : 0).toFixed(1)} dB reduction`;
  let peak = 0;
  if (active) {
    analyser.getByteFrequencyData(frequency);
    analyser.getFloatTimeDomainData(samples);
    for (const value of samples) peak = Math.max(peak, Math.abs(value));
  }
  $("viz-empty").hidden = !!active;
  const bars = Math.min(64, Math.floor(width / 6));
  for (let i = 0; i < bars; i++) {
    const level = active ? frequency[Math.floor((i * 190) / bars)] / 255 : 0;
    const barHeight = Math.max(2, level * (height - 12));
    painter.fillStyle = active
      ? `rgba(197,238,150,${0.35 + level * 0.65})`
      : "#384430";
    painter.fillRect(
      (i * width) / bars + 1,
      (height - barHeight) / 2,
      Math.max(2, width / bars - 3),
      barHeight,
    );
  }
  const db = peak > 0.00001 ? 20 * Math.log10(peak) : -100;
  $("meter-value").textContent = db < -60 ? "— dBFS" : `${db.toFixed(1)} dBFS`;
  $("meter-fill").style.width =
    `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
}
requestAnimationFrame(draw);
$("about").addEventListener("click", () => $("about-dialog").showModal());
$("close-about").addEventListener("click", () => $("about-dialog").close());
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("install").hidden = false;
  $("install-side").hidden = false;
});
async function install() {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("install").hidden = true;
  $("install-side").hidden = true;
}
$("install").addEventListener("click", install);
$("install-side").addEventListener("click", install);
window.addEventListener("appinstalled", () => {
  $("install").hidden = true;
  $("install-side").hidden = true;
  status("Safi is installed. Your audio stays local.");
});
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker
    .register("./sw.js", { scope: "./" })
    .catch(() =>
      status("Offline setup unavailable. Online playback still works."),
    );
}
