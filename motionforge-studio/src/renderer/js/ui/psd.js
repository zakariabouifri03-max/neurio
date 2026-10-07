// Lazy PSD reader (ag-psd UMD) → [{name, canvas, x, y}]
let loading = null;
function loadScript() {
  if (window.agPsd) return Promise.resolve();
  if (!loading) loading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL('../../vendor/ag-psd.js', import.meta.url).href; s.onload = res; s.onerror = () => rej(new Error('Could not load the PSD reader.')); document.head.append(s); });
  return loading;
}
export async function loadPsd(bytes) {
  await loadScript();
  const psd = window.agPsd.readPsd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { skipCompositeImageData: true, skipThumbnail: true });
  const out = [];
  const walk = (nodes) => { for (const n of nodes || []) { if (n.children) walk(n.children); else if (n.canvas && !n.hidden) out.push({ name: n.name || 'Layer', canvas: n.canvas, x: n.left || 0, y: n.top || 0 }); } };
  walk(psd.children);
  if (!out.length) throw new Error('This PSD has no visible raster layers.');
  return out.reverse();
}
