/* Etsy Insight Pro — namespace bootstrap.
 * All modules attach to the shared `EIP` namespace on globalThis so that
 * content scripts (classic scripts, no bundler), popup, dashboard and the
 * service worker can share one codebase without a build step.
 * Works in browsers, service workers and Node (for tests).
 */
(function initNamespace(root) {
  if (!root.EIP) {
    root.EIP = {
      __version: '1.0.0',
      __modules: [],
      register(name) {
        if (!this.__modules.includes(name)) this.__modules.push(name);
      }
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
