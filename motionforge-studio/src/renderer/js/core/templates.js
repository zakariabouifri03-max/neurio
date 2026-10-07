// Project templates.
import { S, scene } from './state.js';
import { newLayer } from './model.js';
import { createStarterCharacter } from './charbuild.js';
import { drawBackground } from './scenegen.js';
import { createCel, celCanvas } from './model.js';

function bgLayer(kind) {
  const P = S.project; const l = newLayer('draw', 'Background', 'background');
  const id = l.cels[0].id; const cv = celCanvas(id, true); cv.getContext('2d').drawImage(drawBackground(kind, P.width, P.height), 0, 0);
  return l;
}
export const TEMPLATES = [
  { id: 'cartoon', name: '2D Cartoon', w: 1280, h: 720, fps: 24, bg: '#ffffff', desc: 'Classic cartoon animation with a ready-to-animate character on a studio backdrop.', setup(sc) { sc.layers.push(bgLayer('studio')); sc.layers.push(createStarterCharacter('cartoon')); sc.layers.push(newLayer('draw', 'Ink')); } },
  { id: 'anime', name: 'Anime', w: 1920, h: 1080, fps: 24, bg: '#f4f1ff', desc: 'Full-HD 24 fps anime layout with a stylised character and a clean ink layer.', setup(sc) { sc.layers.push(newLayer('draw', 'Paint')); sc.layers.push(createStarterCharacter('anime')); sc.layers.push(newLayer('draw', 'Line art')); } },
  { id: 'stick', name: 'Stick Figure', w: 1280, h: 720, fps: 24, bg: '#ffffff', desc: 'Fast, minimal stick-figure animation — rigged and ready.', setup(sc) { sc.layers.push(createStarterCharacter('stick')); sc.layers.push(newLayer('draw', 'Drawing 1')); } },
  { id: 'motion', name: 'Motion Graphics', w: 1920, h: 1080, fps: 30, bg: '#10131c', desc: '30 fps dark canvas for shapes, text and keyframed graphics.', setup(sc) { sc.layers.push(newLayer('draw', 'Shapes')); sc.layers.push(newLayer('draw', 'Text')); } },
  { id: 'explainer', name: 'Explainer', w: 1920, h: 1080, fps: 30, bg: '#ffffff', desc: 'Whiteboard-style explainer with a presenter character and a drawing layer.', setup(sc) { sc.layers.push(bgLayer('room')); sc.layers.push(createStarterCharacter('cartoon', { pos: [S.project.width * 0.3, S.project.height * 0.78] })); sc.layers.push(newLayer('draw', 'Notes')); } },
  { id: 'character', name: 'Character Animation', w: 1280, h: 720, fps: 24, bg: '#e9edf5', desc: 'Rigged character on a neutral stage — ideal for walk cycles, poses and acting.', setup(sc) { sc.layers.push(createStarterCharacter('cartoon')); } },
  { id: 'social', name: 'Social Media (9:16)', w: 1080, h: 1920, fps: 30, bg: '#ffffff', desc: 'Vertical 1080×1920 at 30 fps for Reels, Shorts and TikTok.', setup(sc) { sc.layers.push(newLayer('draw', 'Background', 'background')); sc.layers.push(createStarterCharacter('cartoon', { pos: [540, 1500] })); sc.layers.push(newLayer('draw', 'Drawing 1')); } },
  { id: 'blank', name: 'Blank Canvas', w: 1280, h: 720, fps: 24, bg: '#ffffff', desc: 'Empty drawing layer. Start from scratch.', setup(sc) { sc.layers.push(newLayer('draw', 'Drawing 1')); } },
];
export function applyTemplate(t) { const sc = scene(); sc.layers.length = 0; t.setup(sc); const last = sc.layers[sc.layers.length - 1]; const char = sc.layers.find((l) => l.char); const sel = char || sc.layers.find((l) => l.type === 'draw' && l.cat !== 'background') || last; S.selection.layerId = sel ? sel.id : null; }
