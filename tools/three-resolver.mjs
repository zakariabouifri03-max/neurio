// Node resolution hook so the headless tests can import the same vendored build
// the browser gets from the <script type="importmap"> in swindle/index.html —
// except `three`, which points at the headless wrapper (stub renderer) so the
// real client modules can boot inside node without a GPU.
//   node tools/smoke-3d.mjs        (each smoke test registers this itself)
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const MAP = {
  three: pathToFileURL(path.join(ROOT, 'tools', 'three-headless.mjs')).href,
};
export function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  if (specifier.startsWith('three/addons/')) {
    return { url: pathToFileURL(path.join(ROOT, 'vendor', specifier.slice('three/addons/'.length))).href, shortCircuit: true };
  }
  return next(specifier, context);
}
