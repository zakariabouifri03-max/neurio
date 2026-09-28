// Node module-resolution hook: every `three` import resolves to the headless stub.
export async function resolve(specifier, context, next) {
  if (specifier === 'three') {
    return { url: new URL('./three-stub.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
