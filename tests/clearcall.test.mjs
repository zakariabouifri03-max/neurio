import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ADJUSTMENTS,
  QUALITY_PROFILES,
  autoLightGain,
  buildFilter,
  clamp,
  getOutputSize,
  meanLuminance,
} from '../src/clearcall/processing.js';

test('the three capture profiles are conservative and explicitly frame-capped', () => {
  assert.deepEqual(Object.values(QUALITY_PROFILES).map(({ label, width, height, fps }) => ({ label, width, height, fps })), [
    { label: '480p', width: 640, height: 480, fps: 24 },
    { label: '720p', width: 1280, height: 720, fps: 30 },
    { label: '1080p', width: 1920, height: 1080, fps: 30 },
  ]);
  assert.equal(DEFAULT_ADJUSTMENTS.autoLight, true);
});

test('low-data output scales down without inventing camera detail', () => {
  assert.deepEqual(getOutputSize(1920, 1080, 'low'), { width: 640, height: 360 });
  assert.deepEqual(getOutputSize(1280, 720, 'low'), { width: 640, height: 360 });
  assert.deepEqual(getOutputSize(640, 480, 'low'), { width: 640, height: 480 });
});

test('balanced and high profiles cap output dimensions while preserving source aspect ratio', () => {
  assert.deepEqual(getOutputSize(2560, 1440, 'balanced'), { width: 1280, height: 720 });
  assert.deepEqual(getOutputSize(3840, 2160, 'high'), { width: 1920, height: 1080 });
  const portrait = getOutputSize(1080, 1920, 'balanced');
  assert.ok(portrait.width <= 1280 && portrait.height <= 720);
  assert.equal(portrait.width % 2, 0);
  assert.equal(portrait.height % 2, 0);
  assert.ok(Math.abs(portrait.width / portrait.height - 1080 / 1920) < 0.01);
});

test('unknown profiles safely fall back to the low-data cap', () => {
  assert.deepEqual(getOutputSize(1920, 1080, 'not-a-profile'), { width: 640, height: 360 });
});

test('auto-light gain brightens dim frames gently and leaves bright frames alone', () => {
  assert.ok(autoLightGain(0.12) > autoLightGain(0.35));
  assert.ok(autoLightGain(0.35) > autoLightGain(0.8));
  assert.equal(autoLightGain(0.12), 1.24);
  assert.equal(autoLightGain(0.8), 0.92);
});

test('mean luminance uses Rec. 709 weights and ignores alpha', () => {
  assert.ok(Math.abs(meanLuminance(new Uint8ClampedArray([255, 255, 255, 10])) - 1) < 1e-9);
  assert.ok(meanLuminance(new Uint8ClampedArray([255, 0, 0, 255])) > meanLuminance(new Uint8ClampedArray([0, 0, 255, 255])));
  assert.equal(meanLuminance(new Uint8ClampedArray([1, 2, 3])), 0);
});

test('CSS camera filters combine bounded exposure, contrast, and warmth values', () => {
  const natural = buildFilter({ exposure: 0, gain: 1, contrast: 0, warmth: 0 });
  const enhanced = buildFilter({ exposure: 10, gain: 1.1, contrast: 15, warmth: 10 });
  assert.match(natural, /^brightness\(1\.000\) contrast\(1\.000\)/);
  assert.match(enhanced, /sepia\(0\.100\)/);
  assert.match(buildFilter({ exposure: 1000, gain: 99, contrast: -1000, warmth: -100 }), /brightness\(1\.650\) contrast\(0\.700\).*hue-rotate\(-6\.8deg\)/);
});

test('clamp supplies a safe fallback for invalid numeric input', () => {
  assert.equal(clamp(Number.NaN, -5, 5), -5);
  assert.equal(clamp(20, -5, 5), 5);
  assert.equal(clamp(-20, -5, 5), -5);
});
