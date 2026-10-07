// Generates Android launcher icons + splash screens from assets/icon-*.png using sharp.
// (Replacement for `capacitor-assets`, whose pinned sharp needs a postinstall download.)
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const res = resolve('android/app/src/main/res');
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const bg = '#8b5cf6';

const round = (size) => Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);

for (const [d, k] of Object.entries(DENS)) {
  const dir = resolve(res, `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });
  const legacy = Math.round(48 * k);
  const adaptive = Math.round(108 * k);
  // legacy icon (rounded square)
  await sharp('electron/resources/icon.png').resize(legacy, legacy).png().toFile(resolve(dir, 'ic_launcher.png'));
  // round icon
  const sq = await sharp('assets/icon-only.png').resize(legacy, legacy).png().toBuffer();
  await sharp(sq).composite([{ input: round(legacy), blend: 'dest-in' }]).png().toFile(resolve(dir, 'ic_launcher_round.png'));
  // adaptive foreground (logo centred in safe zone)
  await sharp('assets/icon-foreground.png').resize(adaptive, adaptive).png().toFile(resolve(dir, 'ic_launcher_foreground.png'));
  // splash: dark background with centred logo
  for (const [orient, w, h] of [['port', 480, 800], ['land', 800, 480]]) {
    const W = Math.round(w * k), H = Math.round(h * k);
    const logo = await sharp('electron/resources/icon.png').resize(Math.round(Math.min(W, H) * 0.28)).png().toBuffer();
    const sdir = resolve(res, `drawable-${orient}-${d}`);
    mkdirSync(sdir, { recursive: true });
    await sharp({ create: { width: W, height: H, channels: 4, background: '#0c0e14' } }).composite([{ input: logo, gravity: 'centre' }]).png().toFile(resolve(sdir, 'splash.png'));
  }
}
const logo = await sharp('electron/resources/icon.png').resize(140).png().toBuffer();
await sharp({ create: { width: 480, height: 480, channels: 4, background: '#0c0e14' } }).composite([{ input: logo, gravity: 'centre' }]).png().toFile(resolve(res, 'drawable/splash.png'));
writeFileSync(resolve(res, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bg}</color>\n</resources>\n`);
console.log('android assets generated');
