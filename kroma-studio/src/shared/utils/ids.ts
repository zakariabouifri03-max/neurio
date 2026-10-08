const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Collision-resistant, URL-safe id. Uses the platform CSPRNG when available and
 * falls back to Math.random so the same helpers run in unit tests.
 */
export function newId(prefix = 'n'): string {
  const bytes = new Uint8Array(10)
  const c = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto
  if (c?.getRandomValues) {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length]
  return `${prefix}_${out}`
}

export const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64) || 'untitled'
