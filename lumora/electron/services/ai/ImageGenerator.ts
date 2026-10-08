import { settings } from '../settings';
import { AIError, httpJSON, keyFor } from './providers';
import type { GeneratedImage } from '../../shared/types';

export interface ImageRequest {
  prompt: string;
  size?: string; // e.g. "1024x1024"
  style?: string;
}

export class ImageGenerator {
  async generate(req: ImageRequest): Promise<GeneratedImage> {
    const prompt = (req.prompt ?? '').trim();
    if (!prompt) throw new AIError('Enter a prompt describing the image.', 'empty_input');
    const fullPrompt = req.style ? `${prompt}. Style: ${req.style}.` : prompt;
    const s = settings.get().ai;

    if (s.imageProvider === 'google') {
      const key = keyFor('google');
      const url = `${s.googleBaseUrl.replace(/\/$/, '')}/models/${s.googleImageModel}:predict?key=${encodeURIComponent(key)}`;
      const res = await httpJSON<any>(url, {
        body: { instances: [{ prompt: fullPrompt }], parameters: { sampleCount: 1 } }
      });
      const b64 = res?.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) throw new AIError('The image provider returned no image.', 'empty_response');
      return { dataUrl: `data:image/png;base64,${b64}` };
    }

    const provider = s.imageProvider === 'custom' ? 'custom' : 'openai';
    const base = (provider === 'custom' ? s.customBaseUrl : s.openaiBaseUrl).replace(/\/$/, '');
    const model = provider === 'custom' ? s.customImageModel : s.openaiImageModel;
    if (!base) throw new AIError('No base URL configured for the custom provider.', 'missing_base_url');
    const key = keyFor(provider);
    const res = await httpJSON<any>(`${base}/images/generations`, {
      headers: { authorization: `Bearer ${key}` },
      body: { model, prompt: fullPrompt, size: req.size ?? '1024x1024', n: 1 }
    });
    const item = res?.data?.[0];
    if (item?.b64_json) return { dataUrl: `data:image/png;base64,${item.b64_json}` };
    if (item?.url) {
      const bin = await fetch(item.url).then((r) => r.arrayBuffer());
      return { dataUrl: `data:image/png;base64,${Buffer.from(bin).toString('base64')}` };
    }
    throw new AIError('The image provider returned no image.', 'empty_response');
  }
}
