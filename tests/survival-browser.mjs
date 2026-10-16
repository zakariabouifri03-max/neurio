import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { expect } from "@playwright/test";
import { launchBrowser } from "./browser-helper.mjs";
import {
  RESOURCE_DEFS,
  TREE_DEFS,
  CAMP,
  FIRE_SITE,
  SHELTER_SITE,
  WATER_SITE,
  heightAt,
} from "../src/hollowpine/rules.js";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:3000/hollowpine.html";
const browser = await launchBrowser(),
  errors = [];
async function prepare(context, low = true) {
  if (low)
    await context.addInitScript(() => {
      if (!localStorage.getItem("hollowpine-settings-v1"))
        localStorage.setItem(
          "hollowpine-settings-v1",
          JSON.stringify({ quality: "low" }),
        );
    });
  const page = await context.newPage();
  page.setDefaultTimeout(35000);
  page.on("pageerror", (e) => errors.push(e.stack));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(baseURL);
  await page.waitForFunction(
    () => window.HOLLOWPINE?.ready && HOLLOWPINE.renderer.info.render.calls > 0,
    null,
    { timeout: 90000 },
  );
  await page.locator("#loading").waitFor({ state: "detached" });
  return page;
}
async function moveTo(page, x, z) {
  await page.evaluate(
    ({ x, z, y }) =>
      Object.assign(HOLLOWPINE.player, { x, z, y, speed: 0, verticalSpeed: 0 }),
    { x, z, y: heightAt(x, z) },
  );
}
const position = (page) =>
  page.evaluate(() => ({ x: HOLLOWPINE.player.x, z: HOLLOWPINE.player.z }));
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
    deviceScaleFactor: 1,
  });
  const page = await prepare(context);
  assert.ok(
    await page.evaluate(
      () => HOLLOWPINE.renderer.info.render.triangles > 30000,
    ),
  );
  await page.screenshot({
    path: ".cache/hollowpine-desktop.png",
    timeout: 60000,
  });
  await expect(
    page.getByRole("heading", { name: "The wild has no mercy." }),
  ).toBeVisible();
  console.log("✓ Original 3D woodland renders; desktop layout captured.");

  await page.locator("#begin-button").click();
  const start = await position(page);
  await page.keyboard.down("w");
  await page.waitForFunction(
    (start) =>
      Math.hypot(HOLLOWPINE.player.x - start.x, HOLLOWPINE.player.z - start.z) >
      0.8,
    start,
  );
  await page.keyboard.up("w");
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-dialog")).toBeVisible();
  const paused = await position(page);
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  assert.deepEqual(await position(page), paused);
  await page.getByRole("button", { name: "BACK TO THE WOODS" }).click();
  await page.keyboard.press("e");
  await page.waitForFunction(() => HOLLOWPINE.state.collected.has("wood-0"));
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.inventory.wood), 2);
  await page.keyboard.press("c");
  await page.locator('[data-recipe="fire"]').click();
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.waypoint.label),
    "CAMP CLEARING",
  );
  await moveTo(page, CAMP.x, CAMP.z + 2);
  await page.keyboard.press("c");
  await page.locator('[data-recipe="fire"]').click();
  await expect(page.locator("#craft-feedback")).toContainText("more");
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.inventory.wood), 2);
  await page.keyboard.press("Escape");
  console.log(
    "✓ Movement, pausing, gathering, camp distance guard, and atomic crafting failure.",
  );

  const tree = TREE_DEFS[0];
  await moveTo(page, tree.x, tree.z + 2.7);
  for (let i = 0; i < 4; i++) {
    await page.waitForFunction(() => HOLLOWPINE.chopCooldown === 0);
    await page.keyboard.press("f");
    await page.waitForFunction(
      (i) => (HOLLOWPINE.state.treeHits["pine-0"] || 0) >= i + 1,
      i,
    );
  }
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.state.felled.has("pine-0")),
    true,
  );
  await page.waitForFunction(
    () => !HOLLOWPINE.world.trees[0].root.visible,
    null,
    { timeout: 35000 },
  );
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.world.trees[0].stump.visible),
    true,
  );
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.inventory.wood), 7);
  for (const id of [
    "wood-1",
    "wood-2",
    "wood-3",
    "stone-0",
    "stone-1",
    "fiber-0",
    "fiber-1",
  ]) {
    const r = RESOURCE_DEFS.find((r) => r.id === id);
    await moveTo(page, r.x, r.z + 0.4);
    await page.keyboard.press("e");
    await page.waitForFunction((id) => HOLLOWPINE.state.collected.has(id), id);
  }
  assert.deepEqual(
    await page.evaluate(() => ({
      wood: HOLLOWPINE.state.inventory.wood,
      stone: HOLLOWPINE.state.inventory.stone,
      fiber: HOLLOWPINE.state.inventory.fiber,
    })),
    { wood: 13, stone: 4, fiber: 4 },
  );
  await moveTo(page, CAMP.x, CAMP.z + 2);
  await page.keyboard.press("2");
  await expect(page.locator("#toast-title")).toHaveText("AN UNLIT TORCH");
  await page.keyboard.press("c");
  await page.locator('[data-recipe="fire"]').click();
  await page.waitForFunction(() => HOLLOWPINE.state.built.fire);
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.inventory.wood), 9);
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.world.campfire.root.visible),
    true,
  );
  await page.waitForFunction(() => HOLLOWPINE.world.torchLight.intensity > 0);
  await page.keyboard.press("c");
  await page.locator('[data-recipe="shelter"]').click();
  await page.waitForFunction(() => HOLLOWPINE.state.built.shelter);
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.world.shelter.visible),
    true,
  );
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.inventory.wood), 1);
  console.log(
    "✓ Four-swing tree felling, visible stump, all resource types, campfire, torch, and shelter.",
  );

  await page.evaluate(() => {
    HOLLOWPINE.state.clockHours = 21;
  });
  await page.waitForFunction(
    () => HOLLOWPINE.world.waterMat.uniforms.night.value > 0.9,
  );
  await page.screenshot({
    path: ".cache/hollowpine-night.png",
    timeout: 60000,
  });
  const wolf = await page.evaluate(() => ({
    x: HOLLOWPINE.world.wolves[0].root.position.x,
    z: HOLLOWPINE.world.wolves[0].root.position.z,
  }));
  await moveTo(page, wolf.x, wolf.z + 0.7);
  await page.keyboard.press("1");
  const beforeWolf = await page.evaluate(() => HOLLOWPINE.state.health);
  await page.waitForFunction((hp) => HOLLOWPINE.state.health < hp, beforeWolf);
  await page.keyboard.press("2");
  const protectedHealth = await page.evaluate(() => HOLLOWPINE.state.health);
  await page.waitForTimeout(700);
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.state.health),
    protectedHealth,
  );
  console.log(
    "✓ Wolves cause damage at night; a lit torch prevents further attacks.",
  );
  await moveTo(page, SHELTER_SITE.x, SHELTER_SITE.z + 2.4);
  await page.keyboard.press("e");
  await expect(page.locator("#dawn-dialog")).toBeVisible();
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.completed), true);
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.day), 2);
  await expect(page.locator("#result-day")).toHaveText("02");
  await page.getByRole("button", { name: "KEEP EXPLORING" }).click();
  await page.keyboard.press("3");
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.state.inventory.berries),
    1,
  );
  await page.keyboard.press("3");
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.state.inventory.berries),
    1,
  );
  await page.keyboard.press("4");
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.bottle), 1);
  const berry = RESOURCE_DEFS.find((r) => r.type === "berries");
  await moveTo(page, berry.x, berry.z + 0.4);
  await page.keyboard.press("e");
  await page.waitForFunction(
    (id) => HOLLOWPINE.state.collected.has(id),
    berry.id,
  );
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.state.inventory.berries),
    4,
  );
  await moveTo(page, WATER_SITE.x, WATER_SITE.z);
  await page.keyboard.press("e");
  await page.waitForFunction(() => HOLLOWPINE.state.bottle === 3);
  console.log(
    "✓ Night lighting, successful dawn objective, food, water, and lakeside refill.",
  );

  await page.keyboard.press("m");
  await page.locator('[data-waypoint="camp"]').click();
  assert.equal(await page.evaluate(() => HOLLOWPINE.waypoint.key), "camp");
  await page.locator("#clear-waypoint").click();
  assert.equal(await page.evaluate(() => HOLLOWPINE.waypoint), null);
  const map = await page.locator("#forest-map").boundingBox();
  await page.mouse.click(
    map.x + map.width * ((CAMP.x + 15 + 75) / 150),
    map.y + map.height * ((CAMP.z - 7 + 75) / 150),
  );
  assert.ok(await page.evaluate(() => Math.abs(HOLLOWPINE.waypoint.x + 1) < 1));
  await page.screenshot({ path: ".cache/hollowpine-map.png", timeout: 60000 });
  await page.keyboard.press("Escape");

  await page.locator('.nav-link[data-open="models"]').click();
  await expect(page.locator("#model-stage canvas")).toBeVisible();
  await fs.mkdir("models", { recursive: true });
  for (const kind of ["camp", "survivor", "hatchet"]) {
    await page.locator(`[data-model="${kind}"]`).click();
    if (kind === "camp")
      await page.screenshot({
        path: ".cache/hollowpine-models.png",
        timeout: 60000,
      });
    const pending = page.waitForEvent("download");
    await page.locator("#download-model").click();
    const download = await pending;
    const path = "models/" + download.suggestedFilename();
    await download.saveAs(path);
    const data = await fs.readFile(path);
    assert.equal(data.readUInt32LE(0), 0x46546c67);
    assert.equal(data.readUInt32LE(4), 2);
    assert.equal(data.readUInt32LE(8), data.length);
    const gltf = JSON.parse(
      data.toString("utf8", 20, 20 + data.readUInt32LE(12)),
    );
    assert.ok(gltf.meshes.length > 0);
    assert.ok(gltf.nodes.length > 0);
    assert.equal(await download.failure(), null);
    console.log(
      `  Exported ${kind}: ${Math.round(data.length / 1024)} KB, ${gltf.meshes.length} meshes.`,
    );
  }
  await page.keyboard.press("Escape");
  console.log(
    "✓ Tactical map and waypoints; interactive model gallery; three valid, self-contained GLBs.",
  );

  await page.evaluate(() => {
    HOLLOWPINE.state.health = 0.01;
    HOLLOWPINE.state.thirst = 0;
  });
  await expect(page.locator("#death-dialog")).toBeVisible({ timeout: 35000 });
  await page.locator("#recover-button").click();
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.health), 85);
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.built.shelter), true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#threat-setting").uncheck();
  assert.equal(await page.evaluate(() => HOLLOWPINE.settings.threats), false);
  await page.locator("#sound-setting").check();
  await expect(page.locator("#sound-toggle")).toHaveAttribute(
    "aria-label",
    "Mute forest sounds",
  );
  await page.locator("#sound-setting").uncheck();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForFunction(() => window.HOLLOWPINE?.ready, null, {
    timeout: 90000,
  });
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.completed), true);
  assert.equal(await page.evaluate(() => HOLLOWPINE.settings.threats), false);
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.world.shelter.visible),
    true,
  );
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.world.trees[0].root.visible),
    false,
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.HOLLOWPINE?.ready, null, {
    timeout: 90000,
  });
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.completed), true);
  assert.equal(
    await page.evaluate(async () =>
      new DataView(await HOLLOWPINE.exportModel("hatchet")).getUint32(0, true),
    ),
    0x46546c67,
  );
  await context.setOffline(false);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#restart-button").click();
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.completed), true);
  await page.locator("#restart-button").click();
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.completed), false);
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.world.trees[0].root.visible),
    true,
  );
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.world.trees[0].stump.visible),
    false,
  );
  assert.equal(
    await page.evaluate(() => HOLLOWPINE.world.shelter.visible),
    false,
  );
  assert.equal(await page.evaluate(() => HOLLOWPINE.state.collected.size), 0);
  console.log(
    "✓ Death/recovery, settings, persistence of camp and felled trees, and offline reload.",
  );
  await context.close();

  const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    }),
    mobile = await prepare(mobileContext);
  await mobile.screenshot({
    path: ".cache/hollowpine-mobile.png",
    timeout: 60000,
  });
  await mobile.locator("#begin-button").tap();
  const p0 = await position(mobile),
    forward = await mobile.locator('[data-move="forward"]').boundingBox();
  const touchSession = await mobileContext.newCDPSession(mobile);
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      {
        x: forward.x + forward.width / 2,
        y: forward.y + forward.height / 2,
        id: 1,
      },
    ],
  });
  await mobile.waitForFunction(
    (p) =>
      Math.hypot(HOLLOWPINE.player.x - p.x, HOLLOWPINE.player.z - p.z) > 0.6,
    p0,
  );
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await mobile.locator("#touch-action").tap();
  await mobile.waitForFunction(() => HOLLOWPINE.state.collected.has("wood-0"));
  await mobile.locator(".minimap-heading").tap();
  await expect(mobile.locator("#map-dialog")).toBeVisible();
  await mobile.locator("#map-dialog .close-dialog").tap();
  await mobile.screenshot({
    path: ".cache/hollowpine-mobile-playing.png",
    timeout: 60000,
  });
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.screenshot({
    path: ".cache/hollowpine-landscape.png",
    timeout: 60000,
  });
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await mobileContext.close();
  console.log(
    "✓ Mobile touch movement, gathering, map, and portrait / landscape layouts.",
  );
  const autoContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    }),
    auto = await prepare(autoContext, false);
  await auto.screenshot({
    path: ".cache/hollowpine-auto-quality.png",
    timeout: 90000,
  });
  assert.equal(await auto.evaluate(() => HOLLOWPINE.settings.quality), "auto");
  console.log(
    "✓ Fresh default-quality boot and 1440×900 render:",
    await auto.evaluate(() => ({
      pixelRatio: HOLLOWPINE.renderer.getPixelRatio(),
      shadows: HOLLOWPINE.renderer.shadowMap.enabled,
      triangles: HOLLOWPINE.renderer.info.render.triangles,
      drawCalls: HOLLOWPINE.renderer.info.render.calls,
    })),
  );
  await autoContext.close();
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log("\nAll HOLLOWPINE browser checks passed.");
} finally {
  await browser.close();
}
