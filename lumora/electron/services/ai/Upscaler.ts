import { settings } from '../settings';
import { AIError, httpJSON, keyFor } from './providers';

/**
 * Cloud upscaling. The offline path (high-quality stepped bicubic resample)
 * lives in the renderer (src/lib/imageOps.ts) and always works.
 */
export class Upscaler {
  async upscale(dataUrl: string, scale: 2 | 4 = 2): Promise<string> {
    const s = settings.get().ai;
    const url = s.upscaleUrl?.trim();
    if (!url) {
      throw new AIError(
        'No cloud upscaler endpoint configured. Add one in Settings → AI Providers, or switch the provider to "Local (offline)".',
        'missing_endpoint'
      );
    }
    const key = keyFor('custom');
    const res = await httpJSON<any>(url, {
      headers: { authorization: `Bearer ${key}` },
      body: { image: dataUrl, scale }
    });
    const out = res?.image ?? res?.data?.[0]?.b64_json;
    if (!out) throw new AIError('The upscaler returned no image.', 'empty_response');
    return String(out).startsWith('data:') ? String(out) : `data:image/png;base64,${out}`;
  }
}
