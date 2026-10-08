import { LIMITS } from '../../../../shared/constants'
import { loadImage } from './filters'

interface Entry {
  image: HTMLImageElement
  width: number
  height: number
  bytes: number
  lastUsed: number
  status: 'loading' | 'ready' | 'error'
  error?: string
}

/**
 * Decoded-image cache keyed by source. Images are decoded once and reused for
 * every frame and every page, which keeps large documents responsive.
 */
class ImageCache {
  private entries = new Map<string, Entry>()
  private pending = new Map<string, Promise<Entry>>()
  private budget = LIMITS.imageCacheSizeMbDefault ?? 512 * 1024 * 1024
  private listeners = new Set<() => void>()

  setBudget(megabytes: number): void {
    this.budget = Math.max(32, megabytes) * 1024 * 1024
    this.evict()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  get(src: string): Entry | undefined {
    const entry = this.entries.get(src)
    if (entry) entry.lastUsed = Date.now()
    return entry
  }

  peek(src: string): Entry | undefined {
    return this.entries.get(src)
  }

  /** Fire-and-forget prefetch used for lazy loading. */
  warm(src: string): void {
    void this.load(src)
  }

  load(src: string): Promise<Entry> {
    const existing = this.entries.get(src)
    if (existing && existing.status !== 'error') return Promise.resolve(existing)
    const inFlight = this.pending.get(src)
    if (inFlight) return inFlight

    const entry: Entry = { image: new Image(), width: 0, height: 0, bytes: 0, lastUsed: Date.now(), status: 'loading' }
    this.entries.set(src, entry)

    const promise = loadImage(src)
      .then((image) => {
        const width = image.naturalWidth || image.width
        const height = image.naturalHeight || image.height
        if (width * height > LIMITS.MAX_IMAGE_EDGE * LIMITS.MAX_IMAGE_EDGE) {
          throw new Error('Image is too large to render')
        }
        entry.image = image
        entry.width = width
        entry.height = height
        entry.bytes = width * height * 4
        entry.status = 'ready'
        this.pending.delete(src)
        this.evict()
        this.notify()
        return entry
      })
      .catch((error: unknown) => {
        entry.status = 'error'
        entry.error = error instanceof Error ? error.message : 'Could not load image'
        this.pending.delete(src)
        this.notify()
        return entry
      })

    this.pending.set(src, promise)
    return promise
  }

  /** Decode synchronously-known data URLs before a frame (used by exporter). */
  async ensure(srcs: string[]): Promise<void> {
    await Promise.all(srcs.map((src) => this.load(src)))
  }

  private evict(): void {
    let total = 0
    for (const entry of this.entries.values()) total += entry.bytes
    if (total <= this.budget) return
    const entries = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [key, entry] of entries) {
      if (total <= this.budget * 0.8) break
      if (entry.status === 'loading') continue
      entry.image.src = ''
      this.entries.delete(key)
      total -= entry.bytes
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.image.src = ''
    this.entries.clear()
    this.pending.clear()
  }

  get size(): number {
    return this.entries.size
  }

  get memoryBytes(): number {
    let total = 0
    for (const entry of this.entries.values()) total += entry.bytes
    return total
  }
}

export const imageCache = new ImageCache()
