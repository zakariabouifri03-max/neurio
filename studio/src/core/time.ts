export const frameDuration = (fps: number) => 1 / fps;
export const toFrame = (sec: number, fps: number) => Math.round(sec * fps);
export const fromFrame = (frame: number, fps: number) => frame / fps;
export const snapToFrame = (sec: number, fps: number) => Math.round(sec * fps) / fps;
export const floorFrame = (sec: number, fps: number) => Math.floor(sec * fps + 1e-6) / fps;
