/**
 * Builds the Windows icon set from `build/icon-source.png`.
 * Produces `build/icon.ico` (multi-size) and `build/icon.png` (512²).
 */
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = process.cwd()
const buildDir = join(root, 'build')
const resourcesDir = join(root, 'resources')
const source = join(buildDir, 'icon-source.png')

if (!existsSync(source)) {
  console.error('Missing build/icon-source.png')
  process.exit(1)
}

mkdirSync(buildDir, { recursive: true })
mkdirSync(resourcesDir, { recursive: true })

/** Sizes Windows actually requests, largest first. */
const ICO_SIZES = [256, 128, 64, 48, 32, 16]

async function pngBuffer(size) {
  return sharp(source).resize(size, size, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer()
}

function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = 6 + images.length * 16
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // palette
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)])
}

const images = []
for (const size of ICO_SIZES) {
  images.push({ size, data: await pngBuffer(size) })
}

writeFileSync(join(buildDir, 'icon.ico'), buildIco(images))
await sharp(source).resize(512, 512, { fit: 'cover' }).png({ compressionLevel: 9 }).toFile(join(buildDir, 'icon.png'))
copyFileSync(join(buildDir, 'icon.png'), join(resourcesDir, 'icon.png'))

console.log(`Built build/icon.ico (${ICO_SIZES.join(', ')}), build/icon.png (512²) and resources/icon.png`)
void dirname(fileURLToPath(import.meta.url))
