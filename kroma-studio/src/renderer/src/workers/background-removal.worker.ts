/// <reference lib="webworker" />

/**
 * Offline background removal (flood-fill from the border).
 *
 * Runs on a worker thread so a 4000×4000 photo never blocks the UI. This is the
 * "Local engine" — hosted providers (remove.bg / Clipdrop / OpenAI) are used
 * when a key is configured.
 */

export interface RemovalRequest {
  type: 'remove-background'
  /** RGBA pixels of the source image. */
  width: number
  height: number
  buffer: ArrayBuffer
  tolerance: number
  /** Also clear pixels similar to the corner colours. */
  feather: number
  /** Anti-alias the resulting alpha edge. */
  smoothEdges: boolean
}

export interface RemovalResponse {
  type: 'done' | 'error'
  width?: number
  height?: number
  buffer?: ArrayBuffer
  message?: string
}

type Incoming = RemovalRequest

self.onmessage = (event: MessageEvent<Incoming>): void => {
  const request = event.data
  try {
    if (request.type !== 'remove-background') throw new Error('Unknown request')
    const result = removeBackground(request)
    const message: RemovalResponse = { type: 'done', width: result.width, height: result.height, buffer: result.buffer }
    ;(self as unknown as Worker).postMessage(message, [result.buffer])
  } catch (error) {
    const message: RemovalResponse = { type: 'error', message: error instanceof Error ? error.message : 'Background removal failed' }
    ;(self as unknown as Worker).postMessage(message)
  }
}

function removeBackground(request: RemovalRequest): { width: number; height: number; buffer: ArrayBuffer } {
  const { width, height, tolerance, smoothEdges } = request
  const data = new Uint8ClampedArray(request.buffer)
  const total = width * height
  const visited = new Uint8Array(total)
  const removed = new Uint8Array(total)
  const stack = new Int32Array(total)
  let stackTop = 0

  // Seed colours from all four borders so mixed/gradient backgrounds work.
  const seeds: Array<[number, number, number]> = []
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 64))) {
    seeds.push(sample(data, x, 0, width), sample(data, x, height - 1, width))
  }
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 64))) {
    seeds.push(sample(data, 0, y, width), sample(data, width - 1, y, width))
  }
  void seeds
  const seedCount = seeds.length

  const threshold = Math.max(0, Math.min(255, tolerance))
  const push = (index: number): void => {
    if (visited[index]) return
    visited[index] = 1
    stack[stackTop] = index
    stackTop += 1
  }

  // Flood in from the entire border.
  for (let x = 0; x < width; x += 1) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width)
    push(y * width + width - 1)
  }

  while (stackTop > 0) {
    stackTop -= 1
    const index = stack[stackTop]
    if (removed[index]) continue
    const at = index * 4
    const r = data[at]
    const g = data[at + 1]
    const b = data[at + 2]

    // Compare against the closest border seed colour.
    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < seedCount; i += 1) {
      const seed = seeds[i]
      const distance = Math.abs(seed[0] - r) + Math.abs(seed[1] - g) + Math.abs(seed[2] - b)
      if (distance < best) best = distance
      if (best === 0) break
    }
    if (best > threshold) continue

    removed[index] = 1
    data[at + 3] = 0

    const x = index % width
    const y = (index - x) / width
    if (x > 0) push(index - 1)
    if (x < width - 1) push(index + 1)
    if (y > 0) push(index - width)
    if (y < height - 1) push(index + width)
  }

  if (smoothEdges) postProcess(data, removed, width, height)

  return { width, height, buffer: data.buffer }
}

function sample(data: Uint8ClampedArray, x: number, y: number, width: number): [number, number, number] {
  const at = (y * width + x) * 4
  return [data[at], data[at + 1], data[at + 2]]
}

/**
 * Softens the alpha cut: pixels adjacent to a removed area get partial alpha,
 * which removes the hard "sticker" outline on detailed edges.
 */
function postProcess(data: Uint8ClampedArray, removed: Uint8Array, width: number, height: number): void {
  const copy = new Uint8ClampedArray(data)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      if (removed[index]) continue
      const at = index * 4
      let removedNeighbours = 0
      let r = 0
      let g = 0
      let b = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const neighbour = (y + dy) * width + (x + dx)
          if (!removed[neighbour]) continue
          removedNeighbours += 1
          const nAt = neighbour * 4
          r += copy[nAt]
          g += copy[nAt + 1]
          b += copy[nAt + 2]
        }
      }
      if (removedNeighbours === 0) continue
      const ratio = removedNeighbours / 8
      if (ratio > 0.6) {
        data[at + 3] = Math.round(255 * (1 - ratio))
      } else if (ratio > 0.25) {
        // Blend toward the removed colour to kill the halo.
        data[at] = Math.round(data[at] * 0.7 + (r / removedNeighbours) * 0.3)
        data[at + 1] = Math.round(data[at + 1] * 0.7 + (g / removedNeighbours) * 0.3)
        data[at + 2] = Math.round(data[at + 2] * 0.7 + (b / removedNeighbours) * 0.3)
      }
    }
  }
}
