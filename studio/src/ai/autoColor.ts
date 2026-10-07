/**
 * Auto color: histogram + gray-world analysis of the clip's current frame.
 * Produces adjustment values (same -100..100 scale as the UI) and a white balance correction.
 * This is deterministic signal processing — no neural network involved.
 */
import type { Clip } from '@/core/types';
import { usePlayback } from '@/core/store';
import { openGrabber, clipSourceTime, mediaIdOf, lumaStats } from './frames';

export interface AutoColorResult {
  adjustments: Partial<Record<'exposure' | 'contrast' | 'brightness' | 'saturation' | 'vibrance' | 'shadows' | 'highlights', number>>;
  whiteBalance: { temperature: number; tint: number; auto: boolean };
  note: string;
}

export async function autoColor(clip: Clip): Promise<AutoColorResult | null> {
  const mediaId = mediaIdOf(clip);
  if (!mediaId) return null;
  const g = await openGrabber(mediaId, 192);
  if (!g) return null;
  try {
    const t = clipSourceTime(clip, usePlayback.getState().time);
    const img = await g.grab(t);
    const s = lumaStats(img);
    // exposure: push median toward ~0.45
    const med = s.p50 / 255;
    const exposure = Math.max(-40, Math.min(40, (0.45 - med) * 120));
    // contrast: stretch so p1..p99 cover more range
    const range = (s.p99 - s.p1) / 255;
    const contrast = Math.max(-20, Math.min(35, (0.9 - range) * 60));
    const shadows = s.p1 / 255 > 0.12 ? -10 : s.p1 / 255 < 0.02 ? 12 : 0;
    const highlights = s.p99 / 255 > 0.98 ? -15 : 0;
    // gray-world white balance
    const { r, g: gg, b } = s.mean;
    const avg = (r + gg + b) / 3 || 1;
    const temperature = Math.max(-40, Math.min(40, ((b - r) / avg) * 60)); // blue cast -> warm up
    const tint = Math.max(-30, Math.min(30, ((gg - (r + b) / 2) / avg) * -60));
    // saturation estimate
    let satAcc = 0, n = 0;
    const d = img.data;
    for (let i = 0; i < d.length; i += 16) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      satAcc += mx ? (mx - mn) / mx : 0;
      n++;
    }
    const sat = satAcc / n;
    const vibrance = sat < 0.2 ? 20 : sat < 0.35 ? 8 : 0;
    return {
      adjustments: { exposure: Math.round(exposure), contrast: Math.round(contrast), shadows, highlights, vibrance },
      whiteBalance: { temperature: Math.round(temperature), tint: Math.round(tint), auto: true },
      note: `Median luma ${(med * 100).toFixed(0)}%, dynamic range ${(range * 100).toFixed(0)}%, gray-world WB ${temperature.toFixed(0)}/${tint.toFixed(0)}`,
    };
  } finally {
    g.dispose();
  }
}
