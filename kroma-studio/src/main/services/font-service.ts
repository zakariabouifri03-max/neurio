import { app } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import type { FontFamily } from '../../shared/ipc'
import { ACCEPTED_FONT_EXTENSIONS } from '../../shared/constants'
import { sanitizeFileName } from '../../shared/utils/validation'
import { log } from '../logger'
import { ensureStorageDirs } from './storage/paths'

interface NameRecord {
  platformID: number
  nameID: number
  value: string
}

/** Parse the `name` table of a TTF/OTF file to recover family + subfamily. */
function parseFontNames(buffer: Buffer): { family: string; subfamily: string; weight?: number; italic?: boolean } | null {
  try {
    const version = buffer.readUInt32BE(0)
    const isTrueType = version === 0x00010000 || buffer.subarray(0, 4).toString('ascii') === 'true'
    const isCff = buffer.subarray(0, 4).toString('ascii') === 'OTTO'
    if (!isTrueType && !isCff) return null
    const numTables = buffer.readUInt16BE(4)
    const tables: Record<string, { offset: number; length: number }> = {}
    for (let i = 0; i < numTables; i += 1) {
      const at = 12 + i * 16
      const tag = buffer.subarray(at, at + 4).toString('ascii')
      tables[tag] = { offset: buffer.readUInt32BE(at + 8), length: buffer.readUInt32BE(at + 12) }
    }
    const name = tables.name
    if (!name) return null
    const count = buffer.readUInt16BE(name.offset + 2)
    const stringOffset = buffer.readUInt16BE(name.offset + 4)
    const stringsBase = name.offset + stringOffset
    const records: NameRecord[] = []
    for (let i = 0; i < count; i += 1) {
      const at = name.offset + 6 + i * 12
      const platformID = buffer.readUInt16BE(at)
      const languageID = buffer.readUInt16BE(at + 4)
      const nameID = buffer.readUInt16BE(at + 6)
      const length = buffer.readUInt16BE(at + 8)
      const offset = buffer.readUInt16BE(at + 10)
      const slice = buffer.subarray(stringsBase + offset, stringsBase + offset + length)
      let value = ''
      if (platformID === 3 || platformID === 0) value = slice.swap16?.() ? slice.swap16().toString('utf16le') : slice.toString('utf16le')
      else value = slice.toString('latin1')
      // English only (0x0409 / 0), to keep the list predictable.
      if (languageID === 0x0409 || languageID === 0) records.push({ platformID, nameID, value: value.trim() })
    }
    const pick = (id: number): string | undefined =>
      records.find((r) => r.nameID === id && r.platformID === 3)?.value ?? records.find((r) => r.nameID === id)?.value
    const family = pick(16) ?? pick(1)
    const subfamily = pick(17) ?? pick(2)
    if (!family) return null

    let weight: number | undefined
    let italic: boolean | undefined
    const os2 = tables['OS/2']
    if (os2) weight = buffer.readUInt16BE(os2.offset + 4)
    const head = tables.head
    if (head) italic = (buffer.readUInt16BE(head.offset + 44) & 0x02) !== 0
    return { family, subfamily: subfamily ?? '', weight, italic }
  } catch {
    return null
  }
}

function systemFontDirs(): string[] {
  switch (process.platform) {
    case 'win32': {
      const windir = process.env.WINDIR ?? 'C:\\Windows'
      const local = process.env.LOCALAPPDATA
      return [
        join(windir, 'Fonts'),
        ...(local ? [join(local, 'Microsoft', 'Windows', 'Fonts')] : [])
      ]
    }
    case 'darwin':
      return ['/System/Library/Fonts', '/Library/Fonts', join(homedir(), 'Library', 'Fonts')]
    default:
      return ['/usr/share/fonts', '/usr/local/share/fonts', join(homedir(), '.fonts'), join(homedir(), '.local', 'share', 'fonts')]
  }
}

const walk = (dir: string, depth = 0): string[] => {
  if (depth > 4 || !existsSync(dir)) return []
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      const stat = statSync(full)
      if (stat.isDirectory()) out.push(...walk(full, depth + 1))
      else if ((ACCEPTED_FONT_EXTENSIONS as readonly string[]).includes(extname(entry).toLowerCase())) out.push(full)
    } catch {
      /* skip unreadable */
    }
  }
  return out
}

export class FontService {
  private cache: FontFamily[] | null = null

  private scanSystem(): FontFamily[] {
    const found = new Map<string, FontFamily>()
    for (const dir of systemFontDirs()) {
      for (const file of walk(dir)) {
        const ext = extname(file).toLowerCase()
        let entry: FontFamily
        if (ext === '.ttf' || ext === '.otf') {
          try {
            const parsed = parseFontNames(readFileSync(file))
            entry = {
              family: parsed?.family ?? file.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''),
              subfamily: parsed?.subfamily,
              weight: parsed?.weight,
              style: parsed?.italic ? 'italic' : 'normal',
              file,
              source: 'system'
            }
          } catch {
            continue
          }
        } else {
          entry = { family: file.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''), file, source: 'system' }
        }
        const key = `${entry.family}|${entry.subfamily ?? ''}`
        if (!found.has(key)) found.set(key, entry)
        if (found.size >= 600) return [...found.values()]
      }
    }
    return [...found.values()].sort((a, b) => a.family.localeCompare(b.family))
  }

  private scanUser(): FontFamily[] {
    const dir = ensureStorageDirs().fonts
    const out: FontFamily[] = []
    for (const file of walk(dir, 0)) {
      try {
        const buffer = readFileSync(file)
        const parsed = extname(file).toLowerCase() === '.woff2' ? null : parseFontNames(buffer)
        out.push({
          family: parsed?.family ?? file.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''),
          subfamily: parsed?.subfamily,
          weight: parsed?.weight,
          style: parsed?.italic ? 'italic' : 'normal',
          file,
          source: 'user',
          dataUrl: `data:font/${extname(file).replace('.', '')};base64,${buffer.toString('base64')}`
        })
      } catch (error) {
        log.warn('Could not read user font', file, error)
      }
    }
    return out
  }

  list(force = false): FontFamily[] {
    if (!this.cache || force) this.cache = [...this.scanUser(), ...this.scanSystem()]
    return this.cache
  }

  importFiles(paths: string[]): FontFamily[] {
    const dir = ensureStorageDirs().fonts
    const imported: FontFamily[] = []
    for (const source of paths) {
      const ext = extname(source).toLowerCase()
      if (!(ACCEPTED_FONT_EXTENSIONS as readonly string[]).includes(ext)) {
        throw Object.assign(new Error('Unsupported font format. Use TTF, OTF, WOFF or WOFF2.'), { code: 'INVALID_INPUT' })
      }
      const buffer = readFileSync(source)
      if (buffer.length > 20 * 1024 * 1024) throw Object.assign(new Error('Font file too large'), { code: 'TOO_LARGE' })
      const parsed = ext === '.woff2' ? null : parseFontNames(buffer)
      const family = parsed?.family ?? source.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
      const target = join(dir, `${sanitizeFileName(family)}${ext}`)
      const { writeFileSync } = require('node:fs') as typeof import('node:fs')
      writeFileSync(target, buffer)
      imported.push({
        family,
        subfamily: parsed?.subfamily,
        weight: parsed?.weight,
        style: parsed?.italic ? 'italic' : 'normal',
        file: target,
        source: 'user',
        dataUrl: `data:font/${ext.replace('.', '')};base64,${buffer.toString('base64')}`
      })
    }
    this.cache = null
    return imported
  }

  /** Families guaranteed to render everywhere (used as safe defaults). */
  static readonly webSafe = ['Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Trebuchet MS', 'Segoe UI', 'Impact', 'Comic Sans MS']
}

let instance: FontService | null = null
export const getFontService = (): FontService => {
  if (!instance) instance = new FontService()
  return instance
}

export const appVersion = (): string => app.getVersion()
