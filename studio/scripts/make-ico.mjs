// Builds electron/resources/icon.ico (PNG-compressed ICO, Vista+) from electron/resources/icon.png using sharp.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
const sizes = [256, 128, 64, 48, 32, 16];
const pngs = await Promise.all(sizes.map((s) => sharp('electron/resources/icon.png').resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
pngs.forEach((png, i) => {
  const s = sizes[i];
  const o = i * 16;
  dir.writeUInt8(s === 256 ? 0 : s, o); dir.writeUInt8(s === 256 ? 0 : s, o + 1);
  dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
  dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(png.length, o + 8); dir.writeUInt32LE(offset, o + 12);
  offset += png.length;
});
writeFileSync('electron/resources/icon.ico', Buffer.concat([header, dir, ...pngs]));
console.log('electron/resources/icon.ico written');
