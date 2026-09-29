// Redirects imports of src/scene.js to the WebGL-free stub, so main.js's real
// boot + enter-the-hall path can run in Node.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(resolvePath(HERE, 'sceneStub.mjs')).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/(^|\/)scene\.js$/.test(specifier) && context.parentURL && /pool\/src\//.test(context.parentURL)) {
      return { url: STUB, shortCircuit: true };
    }
    if (specifier === 'three') {
      return { url: pathToFileURL(resolvePath(HERE, '..', '..', 'vendor', 'three.module.js')).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
