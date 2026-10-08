import { settings } from '../settings';
import { AIError, keyFor } from './providers';

/**
 * Remote background removal.
 *
 * Offline/local removal (border flood-fill matting) runs in the renderer where
 * pixel data already lives — see src/lib/imageOps.ts. This class handles the
 * configurable *cloud* provider: any endpoint that accepts an image and returns
 * a cut-out PNG (remove.bg compatible by default).
 */
export class BackgroundRemover {
  async remove(dataUrl: string): Promise<string> {
    const s = settings.get().ai;
    const url = s.removeBgUrl?.trim();
    if (!url) {
      throw new AIError(
        'No cloud background-removal endpoint configured. Add one in Settings → AI Providers, or switch the provider to "Local (offline)".',
        'missing_endpoint'
      );
    }
    const key = keyFor('removebg');
    const base64 = dataUrl.split(',')[1] ?? '';
    if (!base64) throw new AIError('The selected image could not be read.', 'bad_image');

    const form = new FormData();
    form.append('image_file_b64', base64);
    form.append('size', 'auto');
    form.append('format', 'png');

    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'X-Api-Key': key }, body: form });
    } catch (err) {
      throw new AIError(`Could not reach the background-removal service. (${(err as Error).message})`, 'network');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AIError(`Background removal failed (HTTP ${res.status}). ${detail.slice(0, 200)}`, 'provider_error');
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new AIError('The service returned an empty image.', 'empty_response');
    return `data:image/png;base64,${buf.toString('base64')}`;
  }
}
