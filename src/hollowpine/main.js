import * as THREE from "three";
import {
  Survival,
  SPAWN,
  CAMP,
  FIRE_SITE,
  SHELTER_SITE,
  WATER_SITE,
  TREE_DEFS,
  RESOURCE_DEFS,
  RECIPES,
  SAVE_KEY,
  SETTINGS_KEY,
  INTERACT_RANGE,
  heightAt,
  shoreX,
  clamp,
  distance,
  movePlayer,
  collides,
  readStorage,
  writeStorage,
  formatClock,
  formatDuration,
} from "./rules.js";
import { buildWorld, createAtmosphere } from "./world.js";
import { buildSurvivor } from "./models.js";
import { drawMap, MAP_CENTER, MAP_SPAN } from "./map.js";
import { ModelViewer, MODEL_INFO, exportModel } from "./model-viewer.js";
import { ForestSound } from "./sound.js";

const $ = (id) => document.getElementById(id);
let storage;
try {
  storage = localStorage;
} catch {
  /* Storage may be unavailable in private / embedded browsers. */
}
const storedSettings = readStorage(storage, SETTINGS_KEY),
  settings = {
    quality: ["auto", "high", "low"].includes(storedSettings?.quality)
      ? storedSettings.quality
      : "auto",
    sound: storedSettings?.sound === true,
    threats: storedSettings?.threats !== false,
    sensitivity:
      typeof storedSettings?.sensitivity === "number" &&
      Number.isFinite(storedSettings.sensitivity)
        ? clamp(storedSettings.sensitivity, 0.4, 2)
        : 1,
  };
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const audio = new ForestSound();
let toastTimer;
function toast(title, message = "", warning = false) {
  $("toast-title").textContent = title;
  $("toast-message").textContent = message;
  $("toast").classList.toggle("warning", warning);
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 4100);
}
function saveSettings() {
  writeStorage(storage, SETTINGS_KEY, settings);
}

async function boot() {
  await Promise.all([
    document.fonts.load("500 20px Space"),
    document.fonts.load("400 40px Instrument"),
    document.fonts.load("italic 400 40px Instrument"),
    document.fonts.load("400 12px Plex"),
  ]);
  $("loading-message").textContent =
    "GROWING THE FOREST / PACKING YOUR HATCHET...";
  await new Promise((r) => requestAnimationFrame(r));
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $("world").appendChild(renderer.domElement);
  const scene = new THREE.Scene(),
    atmosphere = createAtmosphere(scene),
    world = buildWorld(scene),
    survivor = buildSurvivor();
  scene.add(survivor.root);
  const camera = new THREE.PerspectiveCamera(
    57,
    innerWidth / innerHeight,
    0.08,
    360,
  );
  const checkpoint = readStorage(storage, SAVE_KEY);
  let state = new Survival(checkpoint);
  const player = {
    x: SPAWN.x,
    y: heightAt(SPAWN.x, SPAWN.z),
    z: SPAWN.z,
    angle: -0.22,
    speed: 0,
    verticalSpeed: 0,
  };
  if (
    Number.isFinite(checkpoint?.position?.x) &&
    Number.isFinite(checkpoint?.position?.z)
  ) {
    const z = clamp(checkpoint.position.z, -58, 62),
      x = clamp(checkpoint.position.x, -58, shoreX(z) - 1.1);
    if (!world.obstacles.some((o) => collides(x, z, 0.32, o))) {
      player.x = x;
      player.z = z;
      player.y = heightAt(x, z);
    }
  }
  let yaw = Number.isFinite(checkpoint?.yaw) ? checkpoint.yaw : -0.22,
    pitch = 0.27,
    time = 0,
    gear = "axe",
    attackAge = 1,
    chopCooldown = 0,
    waypoint = null,
    viewer = null,
    modelKind = "camp",
    needsRender = true,
    contextLost = false;
  let hudTimer = 0,
    saveTimer = 0,
    adaptiveSeconds = 0,
    adaptiveFrames = 0,
    slowFrames = 0,
    adaptiveLow = false,
    lastWarning = -100,
    lastNight = state.night,
    deadShown = false,
    pointer = null;
  const keys = new Set(),
    touch = new Set(),
    velocity = new THREE.Vector2(),
    focus = new THREE.Vector3(),
    desired = new THREE.Vector3();
  const dialogs = () => [...document.querySelectorAll("dialog[open]")];
  const paused = () => contextLost || document.hidden || dialogs().length > 0;
  const torchLit = () => gear === "torch" && state.fireLit;
  const save = () =>
    writeStorage(storage, SAVE_KEY, {
      ...state.snapshot(),
      position: { x: player.x, z: player.z },
      yaw,
    });
  function clearInput() {
    keys.clear();
    touch.clear();
    velocity.set(0, 0);
    pointer = null;
    document
      .querySelectorAll(".held")
      .forEach((e) => e.classList.remove("held"));
  }
  function quality() {
    const low =
      settings.quality === "low" ||
      (settings.quality === "auto" && adaptiveLow);
    renderer.setPixelRatio(
      Math.min(
        devicePixelRatio || 1,
        low ? 0.8 : settings.quality === "high" ? 1.65 : 1.25,
      ),
    );
    renderer.shadowMap.enabled = !low;
    atmosphere.sun.castShadow = !low;
    renderer.setSize(innerWidth, innerHeight);
    world.quality(low);
    needsRender = true;
  }
  quality();
  function closePanels(force = false) {
    dialogs().forEach((d) => d.close());
    clearInput();
    document
      .querySelectorAll(".nav-link")
      .forEach((b) => b.classList.toggle("active", b.id === "nav-survival"));
    if (state.active && state.dead && !force) $("death-dialog").showModal();
  }
  function openPanel(name) {
    const dialog = $(`${name}-dialog`);
    if (!dialog) return;
    const wasOpen = dialog.open;
    closePanels(true);
    if (wasOpen) return;
    if (name === "craft" && !state.active) deploy();
    dialog.showModal();
    clearInput();
    audio.play("click");
    if (name === "craft") renderRecipes();
    if (name === "models") {
      if (!viewer) viewer = new ModelViewer($("model-stage"), reducedMotion);
      selectModel(modelKind);
      viewer.resize();
    }
    if (["models", "guide"].includes(name))
      document
        .querySelectorAll(".nav-link")
        .forEach((b) => b.classList.toggle("active", b.dataset.open === name));
    if (name === "map") renderMapLocations();
  }
  function deploy() {
    if (state.active) return;
    closePanels(true);
    state.start();
    document.body.classList.add("playing");
    $("welcome").inert = true;
    refreshJournal();
    if (state.dead) {
      openPanel("death");
      deadShown = true;
      return;
    }
    toast(
      state.completed ? "BACK TO THE WILD" : "YOUR STORY STARTS HERE",
      state.completed
        ? "Your camp is waiting. Keep exploring."
        : "Gather nearby branches with E. Make a fire before nightfall.",
    );
    audio.play("build");
    save();
  }
  function reset() {
    state = new Survival();
    state.start();
    deadShown = false;
    gear = "axe";
    waypoint = null;
    chopCooldown = 0;
    attackAge = 1;
    Object.assign(player, {
      x: SPAWN.x,
      z: SPAWN.z,
      y: heightAt(SPAWN.x, SPAWN.z),
      verticalSpeed: 0,
      speed: 0,
      angle: -0.22,
    });
    yaw = -0.22;
    pitch = 0.27;
    world.trees.forEach((t) => {
      t.root.visible = true;
      t.root.rotation.set(0, 0, 0);
      t.root.position.set(t.x, heightAt(t.x, t.z), t.z);
      t.fall = null;
      t.stump.visible = t.cap.visible = false;
    });
    world.wolves.forEach((w) =>
      w.root.position.set(
        w.origin.x,
        heightAt(w.origin.x, w.origin.z),
        w.origin.z,
      ),
    );
    document.body.classList.add("playing");
    $("welcome").inert = true;
    closePanels(true);
    world.sync(state);
    refreshJournal();
    syncGear();
    updateCamera(1, true);
    needsRender = true;
    save();
    toast(
      "A NEW TRAIL. A NEW CHANCE.",
      "Your pack is light. Keep your eyes open.",
    );
  }
  function recover() {
    state.recover();
    deadShown = false;
    Object.assign(player, {
      x: CAMP.x,
      z: CAMP.z + 3,
      y: heightAt(CAMP.x, CAMP.z + 3),
      verticalSpeed: 0,
      speed: 0,
    });
    world.wolves.forEach((w) =>
      w.root.position.set(
        w.origin.x,
        heightAt(w.origin.x, w.origin.z),
        w.origin.z,
      ),
    );
    closePanels(true);
    world.sync(state);
    updateCamera(1, true);
    needsRender = true;
    save();
    toast(
      "ANOTHER SUNRISE",
      "Your camp and supplies are still here. Take it slowly.",
    );
  }
  function equip(tool) {
    if (paused()) return;
    if (!state.active) deploy();
    if (state.dead) return;
    gear = tool;
    syncGear();
    audio.play("click");
    if (tool === "torch" && !state.fireLit)
      toast("AN UNLIT TORCH", "Build a campfire to light your torch.");
    else if (tool === "torch")
      toast(
        "A LITTLE LIGHT GOES A LONG WAY",
        "Your torch keeps you warm and makes wolves keep their distance.",
      );
  }
  function syncGear() {
    survivor.equip(gear, torchLit());
    for (const k of ["axe", "torch"]) {
      $(`${k}-button`).classList.toggle("selected", gear === k);
      $(`${k}-button`).setAttribute("aria-pressed", String(gear === k));
    }
  }

  const vitalInfo = [
    ["health", "heart", "#c49c83"],
    ["stamina", "stamina", "#c5c899"],
    ["hunger", "food", "#adc08d"],
    ["thirst", "water", "#99b9b8"],
    ["warmth", "warmth", "#d2b27b"],
  ];
  $("vitals").innerHTML = vitalInfo
    .map(
      ([key, icon, color]) =>
        `<div class="vital" id="vital-${key}" role="meter" aria-label="${key}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" title="${key[0].toUpperCase() + key.slice(1)}" style="--meter:${color}"><svg class="meter" viewBox="0 0 48 48" aria-hidden="true"><circle class="track" cx="24" cy="24" r="21"/><circle class="value" cx="24" cy="24" r="21" pathLength="100" stroke-dasharray="100"/></svg><svg class="meter-icon" aria-hidden="true"><use href="#${icon}"/></svg><b>100</b></div>`,
    )
    .join("");
  const vitalNodes = vitalInfo.map(([key]) => ({
    key,
    root: $(`vital-${key}`),
    circle: $(`vital-${key}`).querySelector(".value"),
    text: $(`vital-${key}`).querySelector("b"),
  }));
  function refreshJournal() {
    const labels = [
        "Gather essentials",
        "Light a campfire",
        "Build a shelter",
        "Rest until morning",
      ],
      done = state.objectives,
      next = done.findIndex((v) => !v);
    $("objectives").innerHTML = labels
      .map(
        (label, i) =>
          `<div class="objective-row ${done[i] ? "done" : i === next ? "current" : ""}"><i>${done[i] ? '<svg><use href="#check"/></svg>' : String(i + 1).padStart(2, "0")}</i><span>${label}</span><span>${done[i] ? "DONE" : i === next ? "→" : ""}</span></div>`,
      )
      .join("");
    $("journal-progress").textContent =
      `${done.filter(Boolean).length} OF 4 COMPLETED`;
    $("journal-description").textContent = state.completed
      ? "You have a place in the wilderness now. Keep your fire going, your pack stocked, and your eyes open."
      : state.built.shelter
        ? "You have a roof. Keep the fire lit, eat and drink, then rest by your shelter until morning."
        : state.built.fire
          ? "The fire is lit. Gather 8 wood and 4 fiber, then build a shelter at camp."
          : "The sun is setting. A warm fire and a roof over your head could make all the difference.";
    $("begin-button").firstChild.textContent = state.completed
      ? "RETURN TO THE WILD "
      : state.playTime > 0
        ? "CONTINUE YOUR STORY "
        : "BEGIN YOUR STORY ";
    updateInventory();
  }
  function updateInventory() {
    for (const k of ["wood", "stone", "fiber"])
      $(`${k}-count`).textContent = String(state.inventory[k]).padStart(2, "0");
    $("berry-count").textContent = state.inventory.berries;
    $("bottle-count").textContent = state.bottle;
  }
  function renderRecipes() {
    $("craft-inventory").innerHTML =
      ["wood", "stone", "fiber"]
        .map(
          (k) =>
            `<span><svg><use href="#${k}"/></svg>${k.toUpperCase()} <b>${state.inventory[k]}</b></span>`,
        )
        .join("") + "<span>YOUR PACK</span>";
    $("recipe-cards").innerHTML = Object.entries(RECIPES)
      .map(([key, r], i) => {
        const built = state.built[key],
          affordable = state.canAfford(key),
          near = distance(player, CAMP) <= 11;
        return `<article class="recipe-card ${built ? "built" : ""}"><div class="recipe-illustration"><svg><use href="#${key === "fire" ? "fire" : "tent"}"/></svg></div><div class="eyebrow">${key === "fire" ? "01 / WARMTH & PROTECTION" : "02 / REST & RECOVERY"}</div><h3>${r.name}</h3><p>${r.description}</p><div class="recipe-cost">${Object.entries(
          r.cost,
        )
          .map(
            ([k, n]) =>
              `<span class="${state.inventory[k] < n ? "missing" : ""}"><svg><use href="#${k}"/></svg><b>${state.inventory[k]} / ${n}</b> ${k}</span>`,
          )
          .join(
            "",
          )}</div><button class="primary-button" data-recipe="${key}" ${built ? "disabled" : ""}>${built ? "BUILT AT CAMP" : !near ? "RETURN TO CAMP" : affordable ? "BUILD " + r.name.toUpperCase() : "GATHER MORE MATERIALS"}<svg><use href="#${built ? "check" : "arrow"}"/></svg></button></article>`;
      })
      .join("");
    $("craft-note-text").textContent =
      distance(player, CAMP) <= 11
        ? "You are in the camp clearing. Ready to build."
        : `Camp is ${Math.round(distance(player, CAMP))} m away. Structures must be built within 11 m of camp.`;
    $("recipe-cards")
      .querySelectorAll("[data-recipe]")
      .forEach((b) => (b.onclick = () => craft(b.dataset.recipe)));
  }
  function craft(key) {
    const result = state.craft(key, player);
    if (!result.ok) {
      if (result.reason === "camp") {
        waypoint = { ...CAMP, label: "CAMP CLEARING" };
        closePanels();
        toast(
          "BACK TO THE CLEARING",
          `Follow the waypoint. You are ${Math.round(distance(player, CAMP))} m from camp.`,
        );
      } else if (result.reason === "materials") {
        $("craft-feedback").textContent =
          "You need " +
          Object.entries(RECIPES[key].cost)
            .filter(([k, n]) => state.inventory[k] < n)
            .map(([k, n]) => `${n - state.inventory[k]} more ${k}`)
            .join(" and ") +
          ". Gather resources nearby, then try again.";
        audio.play("warn");
      }
      return;
    }
    world.sync(state);
    syncGear();
    refreshJournal();
    save();
    needsRender = true;
    closePanels();
    audio.play("build");
    toast(
      key === "fire"
        ? "A LITTLE LIGHT. A LITTLE HOPE."
        : "A ROOF OVER YOUR HEAD",
      key === "fire"
        ? "Your campfire is lit. Stay close to recover warmth."
        : "Keep your fire lit and press E near the shelter to rest.",
    );
  }
  function nearest() {
    const candidates = [];
    for (const r of world.resources)
      if (!state.collected.has(r.id) && distance(player, r) <= INTERACT_RANGE)
        candidates.push({ ...r, kind: "resource", dist: distance(player, r) });
    for (const t of world.trees)
      if (!state.felled.has(t.id) && distance(player, t) <= INTERACT_RANGE)
        candidates.push({ ...t, kind: "tree", dist: distance(player, t) });
    if (distance(player, FIRE_SITE) < 3.5)
      candidates.push({
        ...FIRE_SITE,
        id: "fire-site",
        kind: state.built.fire ? "fire" : "build-fire",
        name: state.built.fire ? "Campfire" : "Campfire site",
        dist: distance(player, FIRE_SITE),
      });
    if (distance(player, SHELTER_SITE) < 4)
      candidates.push({
        ...SHELTER_SITE,
        id: "shelter-site",
        kind: state.built.shelter ? "rest" : "build-shelter",
        name: state.built.shelter ? "Your shelter" : "Shelter site",
        dist: distance(player, SHELTER_SITE),
      });
    if (distance(player, WATER_SITE) < 4)
      candidates.push({
        ...WATER_SITE,
        id: "water-site",
        kind: "water",
        name: "Lakeside spring",
        dist: distance(player, WATER_SITE),
      });
    return candidates.sort((a, b) => a.dist - b.dist)[0] || null;
  }
  function swing(force = false) {
    if (paused()) return;
    if (!state.active) deploy();
    if (state.dead || chopCooldown > 0) return;
    if (gear !== "axe") {
      if (force) {
        gear = "axe";
        syncGear();
      } else {
        toast(
          "YOU NEED YOUR HATCHET",
          "Press 1 or select the hatchet in your pack.",
          true,
        );
        return;
      }
    }
    attackAge = 0;
    chopCooldown = 0.62;
    const tree = world.trees
      .filter(
        (t) => !state.felled.has(t.id) && distance(player, t) <= INTERACT_RANGE,
      )
      .sort((a, b) => distance(player, a) - distance(player, b))[0];
    if (!tree) {
      audio.rustle(0.2, 0.2);
      return;
    }
    const result = state.chop(tree.id, player);
    if (!result.ok) {
      if (result.reason === "tired")
        toast(
          "CATCH YOUR BREATH",
          "Let your stamina recover before swinging again.",
          true,
        );
      return;
    }
    player.angle = Math.atan2(-(tree.x - player.x), -(tree.z - player.z));
    world.burst(tree);
    audio.play("chop");
    if (result.felled) {
      world.fallTree(tree.id);
      audio.play("fall");
      refreshJournal();
      save();
      toast("TIMBER.", "+5 wood. Put it to good use.");
    }
  }
  function interact() {
    if (paused()) return;
    if (!state.active) deploy();
    if (state.dead) return;
    const target = nearest();
    if (!target) {
      toast(
        "KEEP YOUR EYES ON THE GROUND",
        "Look for branches, loose stones, flax, and berry bushes.",
      );
      return;
    }
    if (target.kind === "resource") {
      const result = state.gather(target.id, player);
      if (!result.ok) {
        toast(
          "YOUR PACK IS FULL",
          "Use some materials before gathering more.",
          true,
        );
        return;
      }
      target.root.visible = false;
      audio.play("gather");
      world.burst(target, "gather");
      refreshJournal();
      save();
      toast(
        `+${result.amount} ${result.type.toUpperCase()}`,
        result.type === "berries"
          ? "A little food for the road. Press 3 to eat."
          : `${result.name} collected.`,
      );
      return;
    }
    if (target.kind === "tree") {
      swing();
      return;
    }
    if (target.kind === "build-fire" || target.kind === "build-shelter") {
      openPanel("craft");
      return;
    }
    if (target.kind === "water") {
      state.refill(player);
      audio.play("drink");
      updateInventory();
      save();
      toast("FRESH WATER", "Thirst restored. Your flask has 3 drinks.");
      return;
    }
    if (target.kind === "fire") {
      const r = state.tendFire(player);
      if (r.ok) {
        world.sync(state);
        syncGear();
        updateInventory();
        audio.play("build");
        save();
        toast(
          "KEEP THE EMBERS ALIVE",
          "One wood added. Three more minutes of warmth.",
        );
      } else
        toast(
          r.reason === "wood" ? "THE FIRE NEEDS WOOD" : "THE FIRE IS WELL FED",
          r.reason === "wood"
            ? "Gather a branch and bring it back."
            : "Stay nearby to restore your warmth.",
          r.reason === "wood",
        );
      return;
    }
    if (target.kind === "rest") {
      const r = state.rest(player);
      if (!r.ok) {
        toast(
          r.reason === "fire"
            ? "THE NIGHT NEEDS A FIRE"
            : "DON’T SLEEP ON AN EMPTY STOMACH",
          r.reason === "fire"
            ? "Build or refuel your campfire before resting."
            : "Bring food and water above 20 before turning in.",
          true,
        );
        return;
      }
      world.sync(state);
      refreshJournal();
      save();
      needsRender = true;
      audio.play("dawn");
      if (r.first) {
        $("result-time").textContent = formatDuration(state.playTime);
        $("result-day").textContent = String(state.day).padStart(2, "0");
        openPanel("dawn");
      } else
        toast("ANOTHER MORNING", "Rested, warmer, and ready for the trail.");
    }
  }
  function consume(type) {
    if (paused()) return;
    if (!state.active) deploy();
    if (state.dead) return;
    const r = type === "food" ? state.eat() : state.drink();
    if (r.ok) {
      audio.play(type === "food" ? "eat" : "drink");
      toast(
        type === "food" ? "A SMALL MEAL" : "A MOMENT TO RECOVER",
        type === "food"
          ? "+32 food. A little energy for the next step."
          : "+42 water. Find the lakeside spring to refill.",
      );
      updateInventory();
      save();
    } else
      toast(
        r.reason === "full"
          ? "YOU’RE GOOD FOR NOW"
          : type === "food"
            ? "NO FOOD LEFT"
            : "YOUR FLASK IS EMPTY",
        r.reason === "full"
          ? "Save your supplies for when you need them."
          : type === "food"
            ? "Look for red berries growing on the low bushes."
            : "The spring is east of camp, by the jetty.",
        r.reason !== "full",
      );
  }
  function jump() {
    if (paused() || !state.active || state.dead) return;
    if (player.y <= heightAt(player.x, player.z) + 0.04)
      player.verticalSpeed = 5.1;
  }

  function selectModel(kind) {
    modelKind = Object.hasOwn(MODEL_INFO, kind) ? kind : "camp";
    const info = MODEL_INFO[modelKind];
    document.querySelectorAll("[data-model]").forEach((b) => {
      const active = b.dataset.model === modelKind;
      b.classList.toggle("selected", active);
      b.setAttribute("aria-selected", String(active));
    });
    $("model-code").textContent = info.code;
    $("model-category").textContent = info.category;
    $("model-name").textContent = info.name;
    $("model-name").style.whiteSpace = "pre-line";
    $("model-description").textContent = info.description;
    $("model-footnote").textContent = info.note;
    $("model-footnote").style.whiteSpace = "pre-line";
    $("export-status").textContent = "";
    if (viewer)
      $("model-triangles").textContent =
        `${viewer.setModel(modelKind).toLocaleString()} triangles`;
  }
  document.querySelectorAll("[data-model]").forEach(
    (b) =>
      (b.onclick = () => {
        selectModel(b.dataset.model);
        audio.play("click");
      }),
  );
  $("download-model").onclick = async () => {
    const button = $("download-model");
    button.disabled = true;
    const kind = modelKind;
    $("export-status").textContent = "Packing the wilderness into a model...";
    try {
      const buffer = await exportModel(kind),
        url = URL.createObjectURL(
          new Blob([buffer], { type: "model/gltf-binary" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = MODEL_INFO[kind].filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      $("export-status").textContent =
        "Your model is ready. See you out there.";
      audio.play("build");
    } catch (error) {
      console.error("Model export failed:", error);
      $("export-status").textContent = "Could not export. Please try again.";
    } finally {
      button.disabled = false;
    }
  };
  function renderMapLocations() {
    document
      .querySelectorAll("[data-waypoint]")
      .forEach((b) =>
        b.classList.toggle("selected", waypoint?.key === b.dataset.waypoint),
      );
  }
  document.querySelectorAll("[data-waypoint]").forEach(
    (b) =>
      (b.onclick = () => {
        const key = b.dataset.waypoint;
        waypoint = {
          ...(key === "camp" ? CAMP : WATER_SITE),
          key,
          label: key === "camp" ? "CAMP CLEARING" : "LAKESIDE SPRING",
        };
        renderMapLocations();
        audio.play("click");
        $("map-instruction").textContent = "WAYPOINT SET. FOLLOW THE MARKER.";
      }),
  );
  $("clear-waypoint").onclick = () => {
    waypoint = null;
    renderMapLocations();
    audio.play("click");
    $("map-instruction").textContent = "CLICK THE LAND TO SET A WAYPOINT";
  };
  $("forest-map").onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect(),
      x =
        ((e.clientX - r.left) / r.width) * MAP_SPAN -
        MAP_SPAN / 2 +
        MAP_CENTER.x,
      z =
        ((e.clientY - r.top) / r.height) * MAP_SPAN -
        MAP_SPAN / 2 +
        MAP_CENTER.z;
    if (
      x < -58 ||
      x > shoreX(z) - 1 ||
      z < -58 ||
      z > 62 ||
      world.obstacles.some((o) => collides(x, z, 0.35, o))
    ) {
      $("map-instruction").textContent =
        "CHOOSE WALKABLE LAND, AWAY FROM TREES AND WATER.";
      audio.play("warn");
      return;
    }
    waypoint = { x, z, label: "YOUR WAYPOINT" };
    renderMapLocations();
    $("map-instruction").textContent = "WAYPOINT SET. WATCH YOUR STEP.";
    audio.play("click");
  };

  function soundUI() {
    $("sound-toggle")
      .querySelector("use")
      .setAttribute("href", settings.sound ? "#sound" : "#mute");
    $("sound-toggle").setAttribute(
      "aria-label",
      settings.sound ? "Mute forest sounds" : "Enable forest sounds",
    );
    $("sound-setting").checked = settings.sound;
  }
  async function toggleSound(on) {
    settings.sound = on;
    try {
      await audio.enable(on);
      settings.sound = audio.enabled;
    } catch {
      settings.sound = false;
      toast(
        "THE FOREST IS QUIET",
        "Audio could not start on this device.",
        true,
      );
    }
    soundUI();
    saveSettings();
  }
  soundUI();
  $("sound-toggle").onclick = () => toggleSound(!settings.sound);
  $("sound-setting").onchange = (e) => toggleSound(e.target.checked);
  const unlock = () => {
    if (settings.sound) audio.enable(true).catch(() => {});
  };
  addEventListener("pointerdown", unlock, { once: true });
  addEventListener("keydown", unlock, { once: true });
  $("quality-setting").value = settings.quality;
  $("threat-setting").checked = settings.threats;
  $("sensitivity-setting").value = settings.sensitivity;
  $("quality-setting").onchange = (e) => {
    settings.quality = e.target.value;
    adaptiveLow = false;
    adaptiveSeconds = adaptiveFrames = slowFrames = 0;
    quality();
    saveSettings();
  };
  $("threat-setting").onchange = (e) => {
    settings.threats = e.target.checked;
    saveSettings();
  };
  $("sensitivity-setting").oninput = (e) => {
    settings.sensitivity = Number(e.target.value);
    saveSettings();
  };
  let confirmRestart = false,
    confirmTimeout;
  $("restart-button").onclick = () => {
    if (confirmRestart) {
      reset();
      confirmRestart = false;
      clearTimeout(confirmTimeout);
      $("restart-button").textContent = "START A NEW SURVIVAL";
    } else {
      confirmRestart = true;
      $("restart-button").textContent =
        "CLICK AGAIN TO LEAVE THIS STORY BEHIND";
      confirmTimeout = setTimeout(() => {
        confirmRestart = false;
        $("restart-button").textContent = "START A NEW SURVIVAL";
      }, 5000);
    }
  };
  $("fullscreen-button").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast(
        "STAY IN THIS WINDOW",
        "Fullscreen is unavailable in this browser.",
        true,
      );
    }
  };
  document
    .querySelectorAll("[data-open]")
    .forEach((b) => (b.onclick = () => openPanel(b.dataset.open)));
  document.querySelectorAll(".close-dialog").forEach(
    (b) =>
      (b.onclick = () => {
        audio.play("click");
        closePanels();
      }),
  );
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      closePanels();
    });
    d.addEventListener("click", (e) => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        closePanels();
    });
  });
  $("begin-button").onclick = deploy;
  $("nav-survival").onclick = () => {
    closePanels();
    if (!state.active) deploy();
  };
  $("pause-guide").onclick = () => openPanel("guide");
  $("dawn-restart").onclick = reset;
  $("death-restart").onclick = reset;
  $("recover-button").onclick = recover;
  $("axe-button").onclick = () => equip("axe");
  $("torch-button").onclick = () => equip("torch");
  $("eat-button").onclick = () => consume("food");
  $("drink-button").onclick = () => consume("water");
  $("interact-button").onclick = interact;
  $("touch-action").onclick = () => (nearest() ? interact() : swing(true));

  addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (
      ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) &&
      e.code !== "Escape"
    )
      return;
    if (e.code === "Escape") {
      e.preventDefault();
      if (dialogs().length) closePanels();
      else if (state.active) openPanel("pause");
      return;
    }
    if (e.code === "KeyM" || e.code === "KeyC") {
      e.preventDefault();
      if (!e.repeat) openPanel(e.code === "KeyM" ? "map" : "craft");
      return;
    }
    if (paused()) return;
    if (
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
      ].includes(e.code)
    ) {
      e.preventDefault();
      if (!state.active) deploy();
    }
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code === "KeyE") interact();
    if (e.code === "KeyF") swing(true);
    if (e.code === "Space") jump();
    if (e.code === "Digit1") equip("axe");
    if (e.code === "Digit2") equip("torch");
    if (e.code === "Digit3") consume("food");
    if (e.code === "Digit4") consume("water");
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", clearInput);
  document.addEventListener("visibilitychange", () => {
    clearInput();
    if (document.hidden && state.active) {
      save();
      if (!dialogs().length) openPanel(state.dead ? "death" : "pause");
    }
  });
  addEventListener("pagehide", save);
  const canvas = renderer.domElement;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    if (paused()) return;
    pointer = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointer || pointer.id !== e.pointerId || paused()) return;
    const dx = e.clientX - pointer.x,
      dy = e.clientY - pointer.y;
    if (Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) > 5)
      pointer.moved = true;
    yaw -= dx * 0.0045 * settings.sensitivity;
    pitch = clamp(pitch + dy * 0.0032 * settings.sensitivity, 0.02, 0.9);
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  });
  canvas.addEventListener("pointerup", () => {
    if (pointer && !pointer.moved && state.active && !paused()) swing();
    pointer = null;
  });
  canvas.addEventListener("pointercancel", () => (pointer = null));
  canvas.addEventListener("lostpointercapture", () => (pointer = null));
  document.querySelectorAll("[data-move]").forEach((b) => {
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (paused()) return;
      if (!state.active) deploy();
      b.setPointerCapture(e.pointerId);
      touch.add(b.dataset.move);
      b.classList.add("held");
    });
    const off = () => {
      touch.delete(b.dataset.move);
      b.classList.remove("held");
    };
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((n) =>
      b.addEventListener(n, off),
    );
  });
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    contextLost = true;
    clearInput();
    toast(
      "THE WORLD LOST ITS CONNECTION",
      "Waiting for your browser to restore graphics.",
      true,
    );
  });
  canvas.addEventListener("webglcontextrestored", () => {
    save();
    location.reload();
  });
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    needsRender = true;
    viewer?.resize();
  });

  let sprinting = false;
  function updatePlayer(dt) {
    const f =
        (keys.has("KeyW") || keys.has("ArrowUp") || touch.has("forward")
          ? 1
          : 0) -
        (keys.has("KeyS") || keys.has("ArrowDown") || touch.has("back")
          ? 1
          : 0),
      r =
        (keys.has("KeyD") || keys.has("ArrowRight") || touch.has("right")
          ? 1
          : 0) -
        (keys.has("KeyA") || keys.has("ArrowLeft") || touch.has("left")
          ? 1
          : 0);
    sprinting =
      !!(f || r) &&
      (keys.has("ShiftLeft") ||
        keys.has("ShiftRight") ||
        touch.has("sprint")) &&
      state.stamina > 7;
    const v = new THREE.Vector2(
      -Math.sin(yaw) * f + Math.cos(yaw) * r,
      -Math.cos(yaw) * f - Math.sin(yaw) * r,
    );
    if (v.lengthSq()) v.normalize().multiplyScalar(sprinting ? 6.4 : 3.35);
    velocity.lerp(v, 1 - Math.exp(-dt * 11));
    const p = movePlayer(
      player,
      velocity.x * dt,
      velocity.y * dt,
      world.obstacles,
    );
    player.speed =
      Math.hypot(p.x - player.x, p.z - player.z) / Math.max(dt, 0.001);
    player.x = p.x;
    player.z = p.z;
    if (v.lengthSq() > 0.01) {
      const a = Math.atan2(-v.x, -v.y),
        delta = Math.atan2(
          Math.sin(a - player.angle),
          Math.cos(a - player.angle),
        );
      player.angle += delta * (1 - Math.exp(-dt * 12));
    }
    player.verticalSpeed -= dt * 13;
    player.y += player.verticalSpeed * dt;
    const floor = heightAt(player.x, player.z);
    if (player.y < floor) {
      player.y = floor;
      player.verticalSpeed = 0;
    }
  }
  function updateCamera(dt, instant = false) {
    const d = innerWidth < 601 ? 8.4 : 7.5,
      dx = Math.sin(yaw) * Math.cos(pitch) * d,
      dz = Math.cos(yaw) * Math.cos(pitch) * d,
      length = Math.hypot(dx, dz);
    let fraction = 1;
    for (const o of world.obstacles) {
      const ox = o.x - player.x,
        oz = o.z - player.z,
        t = (ox * dx + oz * dz) / (length * length);
      if (t <= 0 || t > 1) continue;
      const nearX = dx * t - ox,
        nearZ = dz * t - oz,
        rr = (o.radius + 0.27) ** 2,
        dd = nearX * nearX + nearZ * nearZ;
      if (dd < rr)
        fraction = Math.min(
          fraction,
          Math.max(0.2, t - Math.sqrt(rr - dd) / length - 0.03),
        );
    }
    desired.set(
      player.x + dx * fraction,
      player.y + 1.4 + Math.sin(pitch) * d * fraction,
      player.z + dz * fraction,
    );
    desired.y = Math.max(desired.y, heightAt(desired.x, desired.z) + 0.45);
    focus.set(
      player.x - Math.sin(yaw) * 1.8,
      player.y + 1.28,
      player.z - Math.cos(yaw) * 1.8,
    );
    if (instant) camera.position.copy(desired);
    else camera.position.lerp(desired, 1 - Math.exp(-dt * 12));
    camera.lookAt(focus);
    camera.updateMatrixWorld();
  }

  const markers = [];
  function marker(id, icon, label, pos) {
    const el = document.createElement("div");
    el.className = "world-label";
    el.innerHTML = `<svg><use href="#${icon}"/></svg><span><span>${label}</span><b></b></span>`;
    $("world-labels").appendChild(el);
    markers.push({
      id,
      el,
      pos,
      anchor: new THREE.Vector3(pos.x, heightAt(pos.x, pos.z) + 1.8, pos.z),
    });
  }
  marker("camp", "tent", "CAMP CLEARING", CAMP);
  marker("water", "water", "LAKESIDE SPRING", WATER_SITE);
  marker("waypoint", "pin", "WAYPOINT", { x: 0, z: 0 });
  const proj = new THREE.Vector3();
  function updateMarkers() {
    const top = $("hud").offsetTop;
    for (const m of markers) {
      let show = true;
      if (m.id === "waypoint") {
        show = !!waypoint;
        if (waypoint) {
          m.pos = waypoint;
          m.anchor.set(
            waypoint.x,
            heightAt(waypoint.x, waypoint.z) + 1.2,
            waypoint.z,
          );
        }
      }
      const dist = distance(player, m.pos);
      if (dist > 90 || dist < 3.5) show = false;
      proj.copy(m.anchor).project(camera);
      const x = (proj.x * 0.5 + 0.5) * innerWidth,
        y = (-proj.y * 0.5 + 0.5) * innerHeight - top;
      if (
        proj.z > 1 ||
        proj.z < -1 ||
        x < 25 ||
        x > innerWidth - 25 ||
        y < 55 ||
        y > innerHeight - top - 100
      )
        show = false;
      if (!state.active && x < (innerWidth < 601 ? 305 : 445) && y < 415)
        show = false;
      if (innerWidth < 601 && state.active && y < 205) show = false;
      m.el.hidden = !show;
      if (show) {
        m.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
        m.el.querySelector("b").textContent = `${Math.round(dist)}m`;
        m.el.classList.toggle("far", dist > 45);
      }
    }
  }
  function updateHUD() {
    for (const n of vitalNodes) {
      const val = Math.ceil(state[n.key]);
      n.text.textContent = val;
      n.circle.style.strokeDashoffset = 100 - val;
      n.root.setAttribute("aria-valuenow", val);
      n.root.classList.toggle("low", val < 25);
    }
    $("clock").textContent = formatClock(state.hour);
    $("day-label").textContent = `DAY ${String(state.day).padStart(2, "0")}`;
    $("day-icon")
      .querySelector("use")
      .setAttribute("href", state.night ? "#moon" : "#sun");
    document.querySelector(".temperature").textContent = state.night
      ? "6°C"
      : "14°C";
    $("survivor-status").textContent = state.dead
      ? "HOLDING ON"
      : state.health < 30
        ? "TAKE CARE OF YOURSELF"
        : state.night
          ? "KEEP CLOSE TO THE LIGHT"
          : state.completed
            ? "ANOTHER DAY IN THE WILD"
            : "A LONG WAY FROM HOME";
    const degree = ((THREE.MathUtils.radToDeg(-yaw) % 360) + 360) % 360;
    $("heading").textContent = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
      Math.round(degree / 45) % 8
    ];
    const target = state.active && !state.dead ? nearest() : null;
    $("interaction").hidden = !target;
    if (target) {
      let kind = "GATHER RESOURCE",
        detail = target.type ? `+${target.amount} ${target.type}` : "";
      if (target.kind === "tree") {
        kind = "USE YOUR HATCHET";
        detail = `${state.treeHits[target.id] || 0} / 4 strikes · +5 wood`;
      }
      if (target.kind === "build-fire" || target.kind === "build-shelter") {
        kind = "ESTABLISH YOUR CAMP";
        detail = "Open crafting";
      }
      if (target.kind === "fire") {
        kind = state.fireLit ? "TEND THE FIRE" : "RELIGHT THE FIRE";
        detail = state.fireLit
          ? `${Math.ceil(state.fuel / 60)} min of fuel · add 1 wood`
          : "Add 1 wood to rekindle";
      }
      if (target.kind === "rest") {
        kind = "REST UNTIL DAWN";
        detail = "Fire must be lit · food & water above 20";
      }
      if (target.kind === "water") {
        kind = "DRINK & REFILL";
        detail = "Restore water · fill your flask";
      }
      $("interaction-kind").textContent = kind;
      $("interaction-title").textContent = target.name;
      $("interaction-detail").textContent = detail;
    }
    $("damage-overlay").style.opacity =
      state.active && state.health < 30
        ? String((30 - state.health) / 80)
        : "0";
    drawMap($("minimap"), world, player, state, yaw, { waypoint, time });
    if ($("map-dialog").open)
      drawMap($("forest-map"), world, player, state, yaw, {
        large: true,
        waypoint,
        time,
      });
    syncGear();
  }

  world.sync(state);
  refreshJournal();
  updateCamera(1, true);
  updateHUD();
  window.HOLLOWPINE = {
    ready: true,
    player,
    world,
    renderer,
    camera,
    settings,
    get state() {
      return state;
    },
    get gear() {
      return gear;
    },
    get waypoint() {
      return waypoint;
    },
    get chopCooldown() {
      return chopCooldown;
    },
    exportModel,
  };
  let previous = performance.now();
  renderer.setAnimationLoop((now) => {
    const raw = Math.min((now - previous) / 1000, 0.5);
    previous = now;
    const dt = Math.min(Math.max(raw, 0.001), 0.06),
      isPaused = paused();
    if (!isPaused) {
      time += dt;
      attackAge += dt;
      chopCooldown = Math.max(0, chopCooldown - dt);
      if (state.active && !state.dead) updatePlayer(dt);
      const danger = world.update(dt, time, player, state, {
        torch: torchLit(),
        threats: settings.threats,
        reducedMotion,
        paused: false,
      });
      if (state.active && !state.dead) {
        const event = state.tick(dt, {
          sprinting,
          torch: torchLit(),
          nearFire: distance(player, FIRE_SITE) < 6,
          wolfDanger: danger,
        });
        if (event?.type === "death" && !deadShown) {
          deadShown = true;
          save();
          audio.play("warn");
          openPanel("death");
        }
        if (
          (danger ||
            state.hunger < 22 ||
            state.thirst < 22 ||
            state.warmth < 18) &&
          time - lastWarning > 18
        ) {
          lastWarning = time;
          audio.play("warn");
          toast(
            danger
              ? "SOMETHING IS TOO CLOSE"
              : state.thirst < 22
                ? "YOUR THROAT IS DRY"
                : state.hunger < 22
                  ? "YOU NEED TO EAT"
                  : "THE COLD IS SETTLING IN",
            danger
              ? "Get to the campfire or equip your lit torch."
              : state.thirst < 22
                ? "Drink from your flask or find the lakeside spring."
                : state.hunger < 22
                  ? "Eat some berries. Press 3."
                  : "Find your fire. A torch will help, too.",
            true,
          );
        }
        if (state.night !== lastNight) {
          lastNight = state.night;
          if (state.night)
            toast(
              "THE WOODS CHANGE AFTER DARK",
              "Keep your fire lit. Stay warm. Carry your torch.",
              true,
            );
        }
      }
      if (waypoint && distance(player, waypoint) < 2.7) {
        waypoint = null;
        toast("YOU FOUND YOUR WAY", "Take a look around.");
      }
      updateCamera(dt);
      saveTimer += dt;
      if (state.active && saveTimer > 5) {
        save();
        saveTimer = 0;
      }
      audio.update(
        dt,
        time,
        state.night,
        distance(player, FIRE_SITE),
        state.fireLit,
      );
    }
    atmosphere.update(state.hour, world);
    survivor.root.position.set(player.x, player.y, player.z);
    survivor.root.rotation.y = player.angle;
    survivor.animate(
      time,
      isPaused ? 0 : player.speed,
      attackAge < 0.65 ? Math.max(0.001, attackAge / 0.65) : 0,
      gear,
      player.y > heightAt(player.x, player.z) + 0.06,
    );
    if (!contextLost && (!isPaused || needsRender)) {
      renderer.render(scene, camera);
      needsRender = false;
    }
    if ($("models-dialog").open && viewer) viewer.update(dt);
    updateMarkers();
    hudTimer += dt;
    if (hudTimer > 0.1) {
      updateHUD();
      hudTimer = 0;
    }
    if (!isPaused) {
      adaptiveSeconds += raw;
      adaptiveFrames++;
      slowFrames = raw > 0.15 ? slowFrames + 1 : 0;
    }
    if (slowFrames >= 3 && settings.quality === "auto" && !adaptiveLow) {
      adaptiveLow = true;
      quality();
    }
    if (adaptiveSeconds > 4 && settings.quality === "auto" && !adaptiveLow) {
      if (adaptiveFrames / adaptiveSeconds < 25) {
        adaptiveLow = true;
        quality();
      }
      adaptiveSeconds = adaptiveFrames = 0;
    }
  });
  requestAnimationFrame(() => {
    $("loading").classList.add("loaded");
    setTimeout(() => $("loading").remove(), 700);
  });
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot().catch((error) => {
  console.error("HOLLOWPINE could not start:", error);
  $("loading")?.classList.remove("loaded");
  $("loading-message").textContent =
    "THE FOREST COULD NOT START. Enable WebGL / hardware acceleration and reload. A current Chrome, Edge, Firefox, or Safari browser is recommended.";
  const retry = document.createElement("button");
  retry.className = "primary-button";
  retry.textContent = "TRY THE TRAIL AGAIN";
  retry.onclick = () => location.reload();
  $("loading")?.appendChild(retry);
});
