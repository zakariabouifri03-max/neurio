/** Built-in color "filters" (adjustment + LUT combinations). User presets live in services/favorites (usePresets). */
import type { ColorGrade, AdjustmentKey } from '@/core/types';

export interface ColorPreset {
  id: string;
  name: string;
  category: 'Cinematic' | 'Vibrant' | 'Vintage' | 'Mood' | 'B&W' | 'Creative';
  grade: Omit<Partial<ColorGrade>, 'adjustments'> & { adjustments?: Partial<Record<AdjustmentKey, number>> };
}

const g = (id: string, name: string, category: ColorPreset['category'], adjustments: Partial<Record<AdjustmentKey, number>>, lutId?: string, lutIntensity = 1): ColorPreset => ({ id, name, category, grade: { adjustments, lutId, lutIntensity } });

export const COLOR_PRESETS: ColorPreset[] = [
  g('none', 'Original', 'Cinematic', {}),
  g('cine_teal', 'Teal Orange', 'Cinematic', { contrast: 8, saturation: 5 }, 'teal_orange', 0.8),
  g('cine_block', 'Blockbuster', 'Cinematic', { contrast: 12, shadows: -6, vignette: 20 }, 'blockbuster', 0.9),
  g('cine_matte', 'Matte', 'Cinematic', { fade: 20, contrast: -8, saturation: -10 }),
  g('cine_dark', 'Dark Cinema', 'Cinematic', { exposure: -10, contrast: 18, vignette: 35, saturation: -8 }),
  g('vib_pop', 'Pop', 'Vibrant', { vibrance: 35, contrast: 10, clarity: 15 }, 'punchy', 0.5),
  g('vib_summer', 'Summer', 'Vibrant', { vibrance: 25, temperature: 10, brightness: 5 }, 'summer', 0.7),
  g('vib_hdr', 'HDR', 'Vibrant', { clarity: 45, shadows: 30, highlights: -25, vibrance: 20, sharpness: 20 }),
  g('vib_food', 'Food', 'Vibrant', { vibrance: 30, temperature: 8, contrast: 6, sharpness: 15 }),
  g('vin_faded', 'Faded Film', 'Vintage', { fade: 30, grain: 25, saturation: -15 }, 'faded', 0.8),
  g('vin_warm', 'Warm Film', 'Vintage', { grain: 18, temperature: 12 }, 'kodak_warm', 0.9),
  g('vin_sepia', 'Sepia', 'Vintage', { grain: 15, vignette: 25 }, 'sepia', 0.85),
  g('vin_vhs', 'VHS', 'Vintage', { saturation: 20, contrast: -5, grain: 40, sharpness: -30 }),
  g('mood_blue', 'Moody Blue', 'Mood', { contrast: 8, saturation: -10 }, 'moody_blue', 0.9),
  g('mood_golden', 'Golden Hour', 'Mood', { temperature: 15, highlights: -10 }, 'golden_hour', 0.9),
  g('mood_pastel', 'Pastel', 'Mood', { brightness: 6, contrast: -12 }, 'pastel', 0.9),
  g('mood_winter', 'Winter', 'Mood', { temperature: -12, brightness: 4 }, 'winter', 0.8),
  g('mood_horror', 'Horror', 'Mood', { exposure: -8, vignette: 50, grain: 20 }, 'horror', 0.9),
  g('bw_noir', 'Noir', 'B&W', { contrast: 20, vignette: 30 }, 'noir', 1),
  g('bw_soft', 'Soft Mono', 'B&W', { saturation: -100, contrast: -5, fade: 15 }),
  g('bw_grit', 'Gritty', 'B&W', { saturation: -100, contrast: 30, clarity: 40, grain: 35 }),
  g('cre_cyber', 'Cyberpunk', 'Creative', { contrast: 10, saturation: 15 }, 'cyber', 0.8),
  g('cre_matrix', 'Matrix', 'Creative', { contrast: 15 }, 'matrix', 0.9),
  g('cre_cross', 'Cross Process', 'Creative', { contrast: 10 }, 'cross_process', 0.9),
  g('cre_bleach', 'Bleach Bypass', 'Creative', { contrast: 15, saturation: -20 }, 'bleach', 0.9),
];
export const COLOR_PRESET_CATEGORIES: ColorPreset['category'][] = ['Cinematic', 'Vibrant', 'Vintage', 'Mood', 'B&W', 'Creative'];
export const getColorPreset = (id: string) => COLOR_PRESETS.find((p) => p.id === id);
