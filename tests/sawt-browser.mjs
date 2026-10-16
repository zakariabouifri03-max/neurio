// SAWT+ real-browser checks: UI, boost chain, sources, mobile layout, offline install.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { expect } from "@playwright/test";
import { launchBrowser } from "./browser-helper.mjs";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:3000/";
const browser = await launchBrowser(),
  errors = [];

function watch(page) {
  page.setDefaultTimeout(35000);
  page.on("pageerror", (e) => errors.push(e.stack));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
}

async function boot(context, { mic = "ok" } = {}) {
  if (mic === "denied") {
    await context.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
  } else {
    await context.addInitScript(() => {
      const Original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints && !constraints.audio) return Original(constraints);
        // Fake mic: oscillator → MediaStreamDestination keeps the pipeline real.
        const Ctx = window.AudioContext || window.webkitAudioContext;
        window.__fakeCtx = window.__fakeCtx || new Ctx();
        const osc = window.__fakeCtx.createOscillator();
        const dest = window.__fakeCtx.createMediaStreamDestination();
        const gain = window.__fakeCtx.createGain();
        gain.gain.value = 0.4;
        osc.frequency.value = 220;
        osc.connect(gain).connect(dest);
        osc.start();
        return new MediaStream(
          dest.stream.getAudioTracks().map((t) => t.clone()),
        );
      };
    });
  }
  const page = await context.newPage();
  watch(page);
  await page.goto(baseURL);
  await page.waitForFunction(() => !!window.SAWT && !!window.SAWT.engine);
  return page;
}

const levels = (page) => page.evaluate(() => window.SAWT.engine.tickLevels());

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
    deviceScaleFactor: 1,
  });

  // ── 1. Desktop shell ────────────────────────────────────────────────
  let page = await boot(context);
  await expect(page).toHaveTitle(/SAWT/);
  assert.ok(await page.locator(".tagline").isVisible());
  assert.match(
    await page.locator(".tagline-sub").innerText(),
    /ktar mn l-9yas/i,
  );
  await page.locator("#about-button").click();
  await expect(page.locator("#about-dialog")).toBeVisible();
  assert.match(
    (await page.locator("#about-dialog").innerText()).toLowerCase(),
    /cannot raise the system volume/,
  );
  await page.locator("#about-dialog .chip-button").click();
  await page.screenshot({ path: ".cache/sawt-desktop.png", fullPage: true });
  console.log("✔ SAWT+ desktop shell and about dialog");

  // ── 2. Boost chain math + limiter ───────────────────────────────────
  await page.evaluate(() => {
    const el = document.querySelector("#boost");
    el.value = "80";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(180);
  const gain80 = await page.evaluate(() => window.SAWT.engine.boost.gain.value);
  assert.ok(Math.abs(gain80 - window_gain(80)) < 0.06, `boost gain ${gain80}`);
  assert.match(await page.locator("#boost-x").innerText(), /×4\./);
  assert.match(await page.locator("#boost-db").innerText(), /\+13\.2 dB/);
  await page.locator("#limiter").uncheck();
  await page.waitForTimeout(180);
  assert.ok(
    await page.evaluate(() => window.SAWT.engine.limiter.ratio.value < 1.2),
  );
  await page.locator("#limiter").check();
  await page.waitForTimeout(180);
  assert.ok(
    await page.evaluate(() => window.SAWT.engine.limiter.ratio.value > 10),
  );
  console.log("✔ boost gain mapping and limiter switch");

  // ── 3. Sounds run through the chain; meter moves ────────────────────
  await page.locator("#tab-sounds").click();
  await page.locator("#sound-white").click();
  await page.waitForTimeout(700);
  const lvl = await levels(page);
  assert.ok(lvl.rms > 0.002, `rms ${lvl.rms} should move with noise playing`);
  assert.equal(
    await page.evaluate(() => window.SAWT.engine.playingSounds.join(",")),
    "white",
  );
  await page.locator("#sound-rain").click();
  assert.equal(
    await page.evaluate(() =>
      window.SAWT.engine.playingSounds.includes("rain"),
    ),
    true,
  );
  await page.locator("#stop-all").click();
  await page.waitForTimeout(250);
  assert.equal(
    await page.evaluate(() => window.SAWT.engine.playingSounds.length),
    0,
  );
  console.log("✔ ambient tiles run through the boost chain");

  // ── 4. Presets + persistence ────────────────────────────────────────
  await page.locator('.preset[data-preset="bass"]').click();
  assert.equal(await page.locator("#bass").inputValue(), "8");
  await page.evaluate(() => {
    const el = document.querySelector("#boost");
    el.value = "63";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.reload();
  await page.waitForFunction(() => !!window.SAWT);
  assert.equal(await page.locator("#boost").inputValue(), "63");
  assert.equal(await page.locator("#bass").inputValue(), "8");
  console.log("✔ presets and settings persistence");

  // ── 5. Mic amplifier (fake stream) + denial path ────────────────────
  await page.locator("#tab-speaker").click();
  await page.locator("#mic-toggle").click();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.SAWT.engine.micActive), true);
  const micLvl = await levels(page);
  assert.ok(micLvl.peak > 0.002, `mic peak ${micLvl.peak}`);
  await page.locator("#mic-toggle").click();
  assert.equal(await page.evaluate(() => window.SAWT.engine.micActive), false);

  const deniedContext = await browser.newContext({
    viewport: { width: 1280, height: 850 },
  });
  const deniedPage = await boot(deniedContext, { mic: "denied" });
  await deniedPage.locator("#tab-speaker").click();
  await deniedPage.locator("#mic-toggle").click();
  await expect(deniedPage.locator("#status")).toContainText(/blocked/i);
  await deniedContext.close();
  console.log("✔ microphone amplification and denial feedback");

  // ── 6. File booster with a real WAV ─────────────────────────────────
  const wav = makeWav();
  await fs.mkdir(".cache", { recursive: true });
  await fs.writeFile(".cache/sawt-test-tone.wav", wav);
  await page.locator("#tab-file").click();
  await page.setInputFiles("#file-input", ".cache/sawt-test-tone.wav");
  await expect(page.locator("#file-name")).toContainText("sawt-test-tone.wav");
  await page.waitForFunction(
    () => window.SAWT.engine.fileState?.duration > 0.4,
  );
  if (!(await page.evaluate(() => window.SAWT.engine.fileState.playing)))
    await page.locator("#file-play").click();
  await page.waitForFunction(
    () =>
      window.SAWT.engine.fileState.playing &&
      window.SAWT.engine.fileState.time > 0.2,
  );
  await page.locator("#file-loop").check();
  assert.equal(
    await page.evaluate(() => window.SAWT.engine.fileState.loop),
    true,
  );
  console.log("✔ local file boost and loop");

  // ── 7. Mobile layout + touch tiles ──────────────────────────────────
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mp = await boot(mobile);
  await mp.evaluate(() => {
    document.querySelector("#tab-sounds").click();
    document.querySelector("#sound-ocean").click();
    document.querySelector("#sound-fire").click();
  });
  await mp.waitForTimeout(500);
  const noOverflow = await mp.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  assert.ok(noOverflow, "no horizontal overflow on phone viewport");
  assert.equal(
    await mp.evaluate(() => window.SAWT.engine.playingSounds.length),
    2,
  );
  await mp.screenshot({ path: ".cache/sawt-mobile.png", fullPage: true });
  await mp.locator("#mute-button").click();
  assert.equal(await mp.evaluate(() => window.SAWT.state.muted), true);
  await mp.locator("#mute-button").click();
  console.log("✔ mobile layout, touch tiles, and mute");

  // ── 8. Offline install: shell + audio still work with no network ────
  await mp.evaluate(() => navigator.serviceWorker.ready);
  await mp.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
    timeout: 30000,
  });
  await mobile.setOffline(true);
  await mp.reload();
  await mp.waitForFunction(() => !!window.SAWT);
  await mp.locator("#sound-white").click();
  await mp.waitForTimeout(500);
  const offlineLvl = await levels(mp);
  assert.ok(offlineLvl.rms > 0.001, "offline audio still runs");
  await mp.screenshot({ path: ".cache/sawt-offline.png", fullPage: true });
  await mobile.setOffline(false);
  console.log("✔ offline boot and offline audio");

  await mobile.close();
  await context.close();
  assert.deepEqual(errors, [], `console errors: ${errors.join("\n")}`);
  console.log("\nSAWT+ browser checks passed.");
} finally {
  await browser.close();
}

function window_gain(v) {
  return 0.5 * 2 ** (v / 25);
}

// 1s 440 Hz 16-bit mono WAV
function makeWav(sampleRate = 22050) {
  const n = sampleRate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.round(
      Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.4 * 32767,
    );
    data.writeInt16LE(v, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
