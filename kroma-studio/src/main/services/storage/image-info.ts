/**
 * Dependency-free image dimension/mime sniffing from file headers.
 * Supports PNG, JPEG, GIF, BMP and WebP (VP8/VP8L/VP8X).
 */
export interface ImageInfo {
  mime: string
  width: number
  height: number
}

const readU32BE = (buf: Buffer, offset: number): number => buf.readUInt32BE(offset)
const readU16LE = (buf: Buffer, offset: number): number => buf.readUInt16LE(offset)

export function sniffImage(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 24) return null

  // PNG
  if (buffer[0] === 0x89 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
    return { mime: 'image/png', width: readU32BE(buffer, 16), height: readU32BE(buffer, 20) }
  }
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]
      const size = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      offset += 2 + size
    }
    return { mime: 'image/jpeg', width: 0, height: 0 }
  }
  // GIF
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') {
    return { mime: 'image/gif', width: readU16LE(buffer, 6), height: readU16LE(buffer, 8) }
  }
  // BMP
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return { mime: 'image/bmp', width: buffer.readInt32LE(18), height: Math.abs(buffer.readInt32LE(22)) }
  }
  // WebP
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    const fourcc = buffer.subarray(12, 16).toString('ascii')
    if (fourcc === 'VP8 ') {
      return { mime: 'image/webp', width: readU16LE(buffer, 26) & 0x3fff, height: readU16LE(buffer, 28) & 0x3fff }
    }
    if (fourcc === 'VP8L') {
      const bits = buffer.readUInt32LE(21)
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (fourcc === 'VP8X') {
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16))
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16))
      return { mime: 'image/webp', width, height }
    }
  }
  return null
}

export const mimeToExtension: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg'
}

export const extensionToMime: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml'
}
