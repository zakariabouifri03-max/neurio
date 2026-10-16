const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
(async () => {
  const fs = require("node:fs");
  const fixture = require("node:path").join(
    require("node:os").tmpdir(),
    "safi-browser-fixture.wav",
  );
  const rate = 44100,
    frames = rate * 10,
    data = Buffer.alloc(44 + frames * 4);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(2500 * Math.sin((i * 2 * Math.PI * 440) / rate));
    data.writeInt16LE(sample, 44 + i * 4);
    data.writeInt16LE(sample, 46 + i * 4);
  }
  fs.writeFileSync(fixture, data);

  const browser = await chromium.launch({
    executablePath: process.env.SAFI_CHROMIUM_PATH,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
    ],
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  await context.addInitScript(() => {
    const original = AudioContext.prototype.createDynamicsCompressor;
    AudioContext.prototype.createDynamicsCompressor = function () {
      const node = original.call(this);
      window.__safiCompressor = node;
      return node;
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.SAFI_TEST_URL || "http://127.0.0.1:8000/");

  assert.equal(await page.locator("#play").isDisabled(), true);
  await page
    .locator("#files")
    .setInputFiles(
      require("node:path").join(
        require("node:os").tmpdir(),
        "safi-browser-fixture.wav",
      ),
    );
  assert.equal(await page.locator("#track-list li").count(), 1);
  await page.locator("#play").click();
  await page.waitForFunction(
    () => document.querySelector("#protection-state").textContent === "ACTIVE",
  );
  await page.waitForFunction(
    () =>
      !document.querySelector("#audio").paused &&
      document.querySelector("#audio").currentTime > 0.1,
  );
  await page.locator("#boost").evaluate((el) => {
    el.value = "12";
    el.dispatchEvent(new Event("input"));
  });
  assert.equal(await page.locator("#boost-value").innerText(), "+12");
  await page.locator("[data-preset=voice]").click();
  assert.equal(
    await page.locator("[data-preset=voice]").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#play").click();
  assert.equal(await page.locator("#audio").evaluate((el) => el.paused), true);
  // Strong mode needs explicit consent; opening/cancelling must not change gain.
  await page.locator("#strong-mode").click();
  assert.equal(
    await page.locator("#strong-dialog").evaluate((el) => el.open),
    true,
  );
  await page.locator("#strong-cancel").click();
  assert.equal(await page.locator("#boost").getAttribute("max"), "12");
  await page.locator("#strong-mode").click();
  await page.locator("#strong-confirm").click();
  assert.equal(await page.locator("#boost").getAttribute("max"), "24");
  assert.equal(await page.locator("#boost").inputValue(), "0");
  assert.equal(await page.locator("#volume").inputValue(), "40");
  await page.waitForFunction(() => window.__safiCompressor.ratio.value > 3.4);
  await page.locator("#boost").evaluate((el) => {
    el.value = "24";
    el.dispatchEvent(new Event("input"));
  });
  assert.equal(await page.locator("#boost-value").innerText(), "+24");
  await page.locator("#play").click();
  await page.waitForFunction(() => !document.querySelector("#audio").paused);
  await page.waitForFunction(() => window.__safiCompressor.reduction < -0.1);
  await page.locator("#play").click();
  await page.locator("#strong-mode").click();
  assert.equal(await page.locator("#boost").getAttribute("max"), "12");
  assert.equal(await page.locator("#boost").inputValue(), "0");
  await page.locator("#strong-mode").click();
  await page.locator("#strong-confirm").click();
  await page.locator("#reset").click();
  assert.equal(
    await page.locator("#strong-mode").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await page.locator("#boost").getAttribute("max"), "12");
  assert.equal(await page.locator("#boost").inputValue(), "0");
  assert.equal(await page.locator("#volume").inputValue(), "70");
  await page.locator("#about").click();
  assert.equal(
    await page.locator("#about-dialog").evaluate((el) => el.open),
    true,
  );
  await page.locator("#close-about").click();
  await page.locator("#track-list button[aria-label^=Remove]").click();
  assert.equal(await page.locator("#play").isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "No horizontal overflow",
  );

  // Session-only local files: a reload must not silently persist them.
  await page.reload();
  assert.equal(await page.locator("#track-list li").count(), 0);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await page.locator("h1").waitFor();
  assert.equal(await page.locator("#track-list li").count(), 0);
  await context.setOffline(false);
  // Simulate an unsupported limiter: gain controls must be disabled, not falsely protected.
  const fallback = await context.newPage();
  await fallback.addInitScript(() => {
    if (window.AudioWorklet)
      AudioWorklet.prototype.addModule = async () => {
        throw new Error("test unavailable");
      };
  });
  await fallback.goto(process.env.SAFI_TEST_URL || "http://127.0.0.1:8000/");
  await fallback
    .locator("#files")
    .setInputFiles(
      require("node:path").join(
        require("node:os").tmpdir(),
        "safi-browser-fixture.wav",
      ),
    );
  await fallback.locator("#play").click();
  await fallback.waitForFunction(
    () =>
      document.querySelector("#protection-state").textContent === "UNAVAILABLE",
  );
  assert.equal(await fallback.locator("#boost").getAttribute("max"), "0");
  assert.equal(await fallback.locator("[data-preset=warm]").isDisabled(), true);
  assert.equal(await fallback.locator("#strong-mode").isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile, real AudioWorklet playback, gain/presets/reset, pause, remove, dialog, offline reload, safe fallback, Strong lift consent/cancel, +24 dB, real compressor reduction, and mode reset.",
  );
  await browser.close();
  fs.unlinkSync(fixture);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
