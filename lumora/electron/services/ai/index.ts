import { TextGenerator } from './TextGenerator';
import { ImageGenerator } from './ImageGenerator';
import { BackgroundRemover } from './BackgroundRemover';
import { DesignGenerator } from './DesignGenerator';
import { Upscaler } from './Upscaler';
import { AIError, hasKey } from './providers';
import type { AIResult } from '../../shared/types';

/**
 * AIService
 * ├── TextGenerator
 * ├── ImageGenerator
 * ├── BackgroundRemover
 * ├── DesignGenerator
 * └── Upscaler
 *
 * Every capability is a swappable class behind a stable interface, so a new
 * provider can be dropped in without touching the editor.
 */
export class AIService {
  readonly text = new TextGenerator();
  readonly image = new ImageGenerator();
  readonly background = new BackgroundRemover();
  readonly design = new DesignGenerator();
  readonly upscale = new Upscaler();

  status() {
    return {
      openai: hasKey('openai'),
      google: hasKey('google'),
      custom: hasKey('custom'),
      removebg: hasKey('removebg')
    };
  }
}

export const aiService = new AIService();

/** Never throw across IPC — always return a typed result. */
export async function guard<T>(fn: () => Promise<T>): Promise<AIResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    const message =
      err instanceof AIError ? err.message : `Unexpected error: ${(err as Error)?.message ?? 'unknown'}`;
    return { ok: false, error: message };
  }
}
