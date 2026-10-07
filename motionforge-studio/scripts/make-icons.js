// Renders the app icon (SVG → PNG sizes via headless Chromium) and packs .ico files. Run: node scripts/make-icons.js
const fs = require('fs'), path = require('path');
const { launch } = require('../test/launch');
const app = (doc) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b8cff"/><stop offset="1" stop-color="#7c4dff"/></linearGradient>
<linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2030"/><stop offset="1" stop-color="#0c0f17"/></linearGradient></defs>
${doc ? `<path d="M96 24h224l96 96v368H96z" fill="url(#d)" stroke="#5b8cff" stroke-width="12"/><path d="M320 24v96h96" fill="#2a3150"/>` : `<rect x="24" y="24" width="464" height="464" rx="104" fill="url(#d)"/><rect x="24" y="24" width="464" height="464" rx="104" fill="none" stroke="#5b8cff" stroke-width="10" opacity=".6"/>`}
<g transform="${doc ? 'translate(96 150) scale(.69)' : ''}">
<path d="M104 372V150l152 150 152-150v222" fill="none" stroke="url(#g)" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="256" cy="372" r="26" fill="#ffd166"/><circle cx="104" cy="150" r="22" fill="#fff"/><circle cx="408" cy="150" r="22" fill="#fff"/></g></svg>`;
function ico(pngs) { // pngs: [{size, buf}]
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = 6 + 16 * pngs.length; const dir = [], data = [];
  for (const p of pngs) { const e = Buffer.alloc(16); e[0] = p.size >= 256 ? 0 : p.size; e[1] = e[0]; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(p.buf.length, 8); e.writeUInt32LE(off, 12); off += p.buf.length; dir.push(e); data.push(p.buf); }
  return Buffer.concat([head, ...dir, ...data]);
}
(async () => {
  const br = await launch(); const page = await br.newPage(); const out = path.join(__dirname, '..', 'build'); fs.mkdirSync(out, { recursive: true });
  const render = async (svg, size) => { await page.setViewport({ width: size, height: size }); await page.setContent(`<body style="margin:0;background:transparent"><img style="width:${size}px;height:${size}px;display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`); await new Promise((r) => setTimeout(r, 150)); return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }); };
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  for (const [name, doc] of [['icon', false], ['mfs', true]]) {
    const pngs = []; for (const s of sizes) pngs.push({ size: s, buf: Buffer.from(await render(app(doc), s)) });
    fs.writeFileSync(path.join(out, name + '.ico'), ico(pngs));
    if (!doc) fs.writeFileSync(path.join(out, 'icon.png'), Buffer.from(await render(app(false), 512)));
  }
  await br.close(); console.log('icons written to build/');
})();
