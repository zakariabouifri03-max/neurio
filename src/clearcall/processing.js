export const QUALITY_PROFILES = Object.freeze({
  low: Object.freeze({ id: 'low', label: '480p', width: 640, height: 480, fps: 24 }),
  balanced: Object.freeze({ id: 'balanced', label: '720p', width: 1280, height: 720, fps: 30 }),
  high: Object.freeze({ id: 'high', label: '1080p', width: 1920, height: 1080, fps: 30 }),
});

export const DEFAULT_ADJUSTMENTS = Object.freeze({ exposure: 0, contrast: 8, warmth: 5, autoLight: true, mirror: true });

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
}

export function getOutputSize(sourceWidth, sourceHeight, profileId = 'low') {
  const profile = QUALITY_PROFILES[profileId] || QUALITY_PROFILES.low;
  const width = Math.max(1, Number(sourceWidth) || 1);
  const height = Math.max(1, Number(sourceHeight) || 1);
  const scale = Math.min(1, profile.width / width, profile.height / height);
  return {
    width: evenFloor(width * scale),
    height: evenFloor(height * scale),
  };
}

export function evenFloor(value) {
  const safe = Math.max(2, Math.floor(Number(value) || 2));
  return safe - (safe % 2);
}

export function autoLightGain(meanLuminance) {
  const luminance = clamp(meanLuminance, 0.02, 1);
  return clamp(0.38 / luminance, 0.92, 1.24);
}

export function meanLuminance(rgba) {
  if (!rgba || rgba.length < 4) return 0;
  let total = 0;
  let count = 0;
  for (let index = 0; index + 2 < rgba.length; index += 4) {
    total += (0.2126 * rgba[index] + 0.7152 * rgba[index + 1] + 0.0722 * rgba[index + 2]) / 255;
    count++;
  }
  return count ? total / count : 0;
}

export function buildFilter({ exposure = 0, gain = 1, contrast = 0, warmth = 0 } = {}) {
  const brightness = clamp((1 + Number(exposure) / 100) * Number(gain), 0.65, 1.65);
  const contrastFactor = clamp(1 + Number(contrast) / 100, 0.7, 1.45);
  const warm = clamp(warmth, -15, 20);
  const sepia = warm > 0 ? warm / 100 : 0;
  const hueRotation = warm < 0 ? warm * 0.45 : 0;
  return `brightness(${brightness.toFixed(3)}) contrast(${contrastFactor.toFixed(3)}) saturate(1.04) sepia(${sepia.toFixed(3)}) hue-rotate(${hueRotation.toFixed(1)}deg)`;
}
