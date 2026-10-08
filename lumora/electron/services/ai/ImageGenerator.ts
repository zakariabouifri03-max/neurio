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

    if (s.imageProvider === 'free') {
      // Key-less community endpoint (Pollinations): free, rate-limited, no account needed.
      const [w, h] = (req.size ?? '1024x1024').split('x').map((n) => parseInt(n, 10));
      const url =
        `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}` +
        `?width=${w || 1024}&height=${h || 1024}&nologo=true&model=flux&seed=${Math.floor(Math.random() * 1e6)}`;
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      } catch (err) {
        throw new AIError(
          `Could not reach the free image service. Check your connection. (${(err as Error).message})`,
          'network'
        );
      }
      if (!res.ok) {
        throw new AIError(`Free image service failed (HTTP ${res.status}). Try again in a moment.`, 'provider_error');
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new AIError('The free image service returned an empty image.', 'empty_response');
      const ct = res.headers.get('content-type');
      const mime = ct && ct.startsWith('image/') ? ct : 'image/jpeg';
      return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
    }

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
