/// <reference lib="webworker" />
/**
 * Image worker — runs the pixel pipeline off the main thread so heavy
 * operations (4× upscale, background removal) never freeze the editor.
 */
import { runOp, type ImageOp } from '@/engine/image/process';

export type WorkerRequest = { id: number; image: ImageData; op: ImageOp };
export type WorkerResponse =
  | { id: number; ok: true; image?: ImageData; crop?: { x: number; y: number; width: number; height: number } }
  | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, image, op } = event.data;
  try {
    const result = runOp(image, op);
    if ('width' in result && 'data' in result) {
      const payload: WorkerResponse = { id, ok: true, image: result };
      (self as unknown as Worker).postMessage(payload);
    } else {
      const payload: WorkerResponse = { id, ok: true, crop: result as { x: number; y: number; width: number; height: number } };
      (self as unknown as Worker).postMessage(payload);
    }
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (error as Error).message } as WorkerResponse);
  }
};
