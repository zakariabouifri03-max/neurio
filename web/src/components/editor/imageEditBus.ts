/**
 * Tiny event bus so the inspector can ask the shell to open the image editor
 * for the current selection without prop-drilling through the layout.
 */
export type ImageEditAction = 'crop' | 'background' | 'upscale' | 'enhance' | 'filters' | 'adjust';

const listeners = new Set<(action: ImageEditAction) => void>();

export function onRequestImageEdit(action: ImageEditAction): void {
  for (const listener of listeners) listener(action);
}

export function subscribeImageEdit(listener: (action: ImageEditAction) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
