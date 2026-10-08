import type { EffectDefinition } from '../../types/effects';

export const gaussianBlur: EffectDefinition = {
  id: 'blur.gaussian',
  name: 'Gaussian Blur',
  category: 'blur',
  description: 'Symmetric gaussian blur (`gblur`).',
  order: 30,
  previewable: true,
  isNeutral: (p) => Number(p['sigma']) === 0,
  params: [{ id: 'sigma', label: 'Radius', type: 'float', default: 0, min: 0, max: 100, step: 0.5, unit: 'px', animatable: true }],
  toFilter: (p) => {
    const sigma = Number(p['sigma'] ?? 0);
    return sigma <= 0 ? null : { filter: 'gblur', args: { sigma: String(sigma) } };
  },
  toCss: (p) => `blur(${Number(p['sigma'] ?? 0)}px)`,
};

export const sharpen: EffectDefinition = {
  id: 'sharpen.unsharp',
  name: 'Sharpen',
  category: 'stylize',
  description: 'Unsharp mask (`unsharp`).',
  order: 32,
  previewable: true,
  isNeutral: (p) => Number(p['amount']) === 0,
  params: [
    { id: 'amount', label: 'Amount', type: 'float', default: 0, min: -1.5, max: 3, step: 0.05, animatable: true },
    { id: 'size', label: 'Matrix', type: 'int', default: 5, min: 3, max: 23, step: 2 },
  ],
  toFilter: (p) => {
    const amount = Number(p['amount'] ?? 0);
    if (Math.abs(amount) < 1e-6) return null;
    const size = Math.max(3, Math.round(Number(p['size'] ?? 5) / 2) * 2 + 1);
    return {
      filter: 'unsharp',
      args: { luma_msize_x: String(size), luma_msize_y: String(size), luma_amount: String(amount) },
    };
  },
};

export const vignette: EffectDefinition = {
  id: 'stylize.vignette',
  name: 'Vignette',
  category: 'stylize',
  description: 'Darken the frame edges (`vignette`).',
  order: 40,
  previewable: true,
  isNeutral: (p) => Number(p['amount']) === 0,
  params: [
    { id: 'amount', label: 'Amount', type: 'float', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    {
      id: 'mode',
      label: 'Mode',
      type: 'enum',
      default: 'forward',
      // FFmpeg's vignette filter only accepts these two values.
      options: [
        { value: 'forward', label: 'Darken edges' },
        { value: 'backward', label: 'Lighten edges' },
      ],
    },
  ],
  toFilter: (p) => {
    const amount = Number(p['amount'] ?? 0);
    if (amount <= 0) return null;
    // vignette `angle` is in radians; PI/5 is the FFmpeg default look.
    const angle = ((Math.PI / 5) * amount).toFixed(5);
    const mode = p['mode'] === 'backward' ? 'backward' : 'forward';
    return { filter: 'vignette', args: { angle, mode } };
  },
  toCss: (p) => {
    const amount = Number(p['amount'] ?? 0);
    return amount > 0 ? `drop-shadow(0 0 0 rgba(0,0,0,0))` : '';
  },
};

export const filmGrain: EffectDefinition = {
  id: 'stylize.grain',
  name: 'Film Grain',
  category: 'stylize',
  description: 'Temporal noise (`noise`).',
  order: 42,
  previewable: false,
  isNeutral: (p) => Number(p['strength']) === 0,
  params: [{ id: 'strength', label: 'Strength', type: 'int', default: 0, min: 0, max: 100, step: 1, animatable: true }],
  toFilter: (p) => {
    const s = Math.round(Number(p['strength'] ?? 0));
    return s <= 0 ? null : { filter: 'noise', args: { alls: String(s), allf: 't+u' } };
  },
};

export const chromaKey: EffectDefinition = {
  id: 'composite.chromakey',
  name: 'Green Screen Key',
  category: 'composite',
  description: 'Remove a solid background colour (`chromakey`).',
  order: 20,
  previewable: false,
  isNeutral: (p) => !p['enabled'],
  params: [
    { id: 'enabled', label: 'Enable', type: 'bool', default: false },
    { id: 'color', label: 'Key colour', type: 'color', default: '#00b140' },
    { id: 'similarity', label: 'Similarity', type: 'float', default: 0.1, min: 0.01, max: 1, step: 0.01, animatable: true },
    { id: 'blend', label: 'Blend', type: 'float', default: 0.1, min: 0, max: 1, step: 0.01 },
  ],
  toFilter: (p) =>
    p['enabled']
      ? {
          filter: 'chromakey',
          args: {
            color: String(p['color'] ?? '#00b140'),
            similarity: String(p['similarity'] ?? 0.1),
            blend: String(p['blend'] ?? 0.1),
          },
        }
      : null,
};

export const mirror: EffectDefinition = {
  id: 'transform.mirror',
  name: 'Mirror',
  category: 'transform',
  description: 'Flip horizontally (`hflip`).',
  order: 22,
  previewable: true,
  isNeutral: (p) => !p['enabled'],
  params: [{ id: 'enabled', label: 'Flip horizontally', type: 'bool', default: false }],
  toFilter: (p) => (p['enabled'] ? { filter: 'hflip', args: {} } : null),
  toCss: (p) => (p['enabled'] ? 'scaleX(-1)' : ''),
};

export const lensDistort: EffectDefinition = {
  id: 'distort.lens',
  name: 'Lens Correction',
  category: 'distort',
  description: 'Barrel / pincushion distortion (`lenscorrection`).',
  order: 24,
  previewable: false,
  isNeutral: (p) => Number(p['k1']) === 0 && Number(p['k2']) === 0,
  params: [
    { id: 'k1', label: 'K1 (barrel)', type: 'float', default: 0, min: -1, max: 1, step: 0.01, animatable: true },
    { id: 'k2', label: 'K2 (pincushion)', type: 'float', default: 0, min: -1, max: 1, step: 0.01, animatable: true },
  ],
  toFilter: (p) => {
    const k1 = Number(p['k1'] ?? 0);
    const k2 = Number(p['k2'] ?? 0);
    if (k1 === 0 && k2 === 0) return null;
    return { filter: 'lenscorrection', args: { k1: String(k1), k2: String(k2) } };
  },
};

export const visualEffects = [
  gaussianBlur,
  sharpen,
  vignette,
  filmGrain,
  chromaKey,
  mirror,
  lensDistort,
];
