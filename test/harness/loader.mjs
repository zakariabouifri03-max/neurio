// module loader: bare 'three' -> shim with stub renderer
const root = typeof __dirname !== 'undefined' ? __dirname : '';
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: new URL('./three-shim.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
