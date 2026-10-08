import type { EffectDefinition } from '../../types/effects';

/** Neutral detection keeps filtergraphs short: a no-op effect emits nothing. */
const isNeutralEq = (p: Record<string, unknown>) =>
  p['brightness'] === 0 && p['contrast'] === 1 && p['saturation'] === 1 && p['gamma'] === 1;

export const brightnessContrast: EffectDefinition = {
  id: 'color.basic',
  name: 'Brightness / Contrast',
  category: 'color',
  description: 'Lift, contrast and saturation, mapped to the FFmpeg `eq` filter.',
  order: 10,
  previewable: true,
  isNeutral: isNeutralEq,
  params: [
    { id: 'brightness', label: 'Brightness', type: 'float', default: 0, min: -1, max: 1, step: 0.01, animatable: true },
    { id: 'contrast', label: 'Contrast', type: 'float', default: 1, min: 0, max: 3, step: 0.01, animatable: true },
    { id: 'saturation', label: 'Saturation', type: 'float', default: 1, min: 0, max: 4, step: 0.01, animatable: true },
    { id: 'gamma', label: 'Gamma', type: 'float', default: 1, min: 0.1, max: 3, step: 0.01, animatable: true },
  ],
  toFilter: (p) =>
    isNeutralEq(p)
      ? null
      : {
          filter: 'eq',
          args: {
            brightness: String(p['brightness'] ?? 0),
            contrast: String(p['contrast'] ?? 1),
            saturation: String(p['saturation'] ?? 1),
            gamma: String(p['gamma'] ?? 1),
          },
        },
  toCss: (p) =>
    `brightness(${1 + Number(p['brightness'] ?? 0)}) contrast(${p['contrast'] ?? 1}) saturate(${p['saturation'] ?? 1})`,
};

export const colorTemperature: EffectDefinition = {
  id: 'color.temperature',
  name: 'Colour Temperature',
  category: 'color',
  description: 'Warm/cool shift in Kelvin (FFmpeg `colortemperature`).',
  order: 12,
  previewable: true,
  isNeutral: (p) => p['temperature'] === 6500 && p['mix'] === 1,
  params: [
    { id: 'temperature', label: 'Temperature', type: 'float', default: 6500, min: 1000, max: 12000, step: 50, unit: 'K', animatable: true },
    { id: 'mix', label: 'Mix', type: 'float', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  toFilter: (p) => ({
    filter: 'colortemperature',
    args: { temperature: String(p['temperature'] ?? 6500), mix: String(p['mix'] ?? 1) },
  }),
  toCss: (p) => {
    const k = Number(p['temperature'] ?? 6500);
    const warm = k < 6500 ? (6500 - k) / 5500 : 0;
    const cool = k > 6500 ? (k - 6500) / 5500 : 0;
    return `sepia(${(warm * 0.6).toFixed(3)}) hue-rotate(${(-cool * 24).toFixed(1)}deg)`;
  },
};

export const hueRotate: EffectDefinition = {
  id: 'color.hue',
  name: 'Hue Rotate',
  category: 'color',
  description: 'Rotate the colour wheel.',
  order: 14,
  previewable: true,
  isNeutral: (p) => p['deg'] === 0,
  params: [{ id: 'deg', label: 'Angle', type: 'float', default: 0, min: -180, max: 180, step: 1, unit: '°', animatable: true }],
  toFilter: (p) => (p['deg'] === 0 ? null : { filter: 'hue', args: { h: String(p['deg']) } }),
  toCss: (p) => `hue-rotate(${p['deg'] ?? 0}deg)`,
};

export const curvesPresets: EffectDefinition = {
  id: 'color.curves',
  name: 'Curves Preset',
  category: 'color',
  description: 'Film-stock style tone curves (FFmpeg `curves`).',
  order: 16,
  previewable: false,
  params: [
    {
      id: 'preset',
      label: 'Preset',
      type: 'enum',
      default: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'color_negative', label: 'Colour Negative' },
        { value: 'cross_process', label: 'Cross Process' },
        { value: 'darker', label: 'Darker' },
        { value: 'increase_contrast', label: 'Increase Contrast' },
        { value: 'lighter', label: 'Lighter' },
        { value: 'linear_contrast', label: 'Linear Contrast' },
        { value: 'medium_contrast', label: 'Medium Contrast' },
        { value: 'negative', label: 'Negative' },
        { value: 'strong_contrast', label: 'Strong Contrast' },
        { value: 'vintage', label: 'Vintage' },
      ],
    },
  ],
  toFilter: (p) => {
    const preset = String(p['preset'] ?? 'none');
    return preset === 'none' ? null : { filter: 'curves', args: { preset } };
  },
};

export const lut3d: EffectDefinition = {
  id: 'color.lut3d',
  name: '3D LUT (.cube)',
  category: 'color',
  description: 'Apply a user supplied .cube LUT file.',
  order: 18,
  previewable: false,
  params: [{ id: 'file', label: 'LUT file', type: 'string', default: '' }],
  toFilter: (p) => {
    const file = String(p['file'] ?? '');
    return file ? { filter: 'lut3d', args: { file } } : null;
  },
};

export const colorEffects = [
  brightnessContrast,
  colorTemperature,
  hueRotate,
  curvesPresets,
  lut3d,
];
