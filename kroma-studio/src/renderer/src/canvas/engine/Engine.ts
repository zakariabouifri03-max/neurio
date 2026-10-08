import type { DesignDocument, Page, SceneNode } from '../../../../shared/types/document'
import { aabbOf, bboxOf, computeSnap, round, type SnapGuide } from '../../../../shared/utils/geometry'
import { flattenNodes } from '../../../../shared/utils/document'
import { drawNode, drawPageBackground } from './draw'
import { hitTest, hitTestAny, isPointInNode, nodesInRect, toLocalPoint, type Point } from './hit-test'
import {
  DEFAULT_OVERLAY_STYLE,
  drawGrid,
  drawHoverOutline,
  drawMarquee,
  drawSafeArea,
  drawSelection,
  drawSizeBadge,
  drawSnapGuides,
  handleAtPoint,
  type HandleId,
  type OverlayStyle
} from './overlays'
import { imageCache } from './image-cache'

export type { OverlayStyle } from './overlays'

export interface EngineOptions {
  canvas: HTMLCanvasElement
  overlay: HTMLCanvasElement
  onSelectionChange: (ids: string[]) => void
  onNodesChange: (patches: Array<{ id: string; patch: Partial<SceneNode> }>, options?: { label?: string; coalesceMs?: number }) => void
  onHoverChange: (id: string | null) => void
  onRequestTextEdit: (id: string) => void
  onDropFiles: (paths: string[], point: Point) => void
  onContextMenu: (point: Point, nodeId: string | null) => void
  getSettings: () => {
    showGrid: boolean
    showGuides: boolean
    showSafeArea: boolean
    snapToGrid: boolean
    snapToObjects: boolean
    gridSize: number
  }
  getStyle: () => OverlayStyle
}

export interface EngineState {
  document: DesignDocument | null
  pageId: string
  selection: string[]
  editingNodeId: string | null
  zoom: number
  panX: number
  panY: number
  viewportWidth: number
  viewportHeight: number
}

export interface DragState {
  mode: 'none' | 'move' | 'resize' | 'rotate' | 'marquee' | 'pan'
  handle: HandleId | null
  startPage: Point
  lastPage: Point
  startNodes: Map<string, SceneNode>
  startBounds: { x: number; y: number; width: number; height: number } | null
  marquee: { x: number; y: number; width: number; height: number } | null
  guides: SnapGuide[]
  moved: boolean
  additive: boolean
  shift: boolean
  alt: boolean
}

const CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
  rotate: 'grab'
}

/**
 * The editor's canvas controller: owns the render loop, pointer interaction,
 * snapping and overlays. React owns documents; this class owns pixels.
 */
export class Engine {
  private ctx: CanvasRenderingContext2D
  private overlayCtx: CanvasRenderingContext2D
  private raf = 0
  private dirty = true
  private state: EngineState = {
    document: null,
    pageId: '',
    selection: [],
    editingNodeId: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    viewportWidth: 0,
    viewportHeight: 0
  }
  private drag: DragState = {
    mode: 'none',
    handle: null,
    startPage: { x: 0, y: 0 },
    lastPage: { x: 0, y: 0 },
    startNodes: new Map(),
    startBounds: null,
    marquee: null,
    guides: [],
    moved: false,
    additive: false,
    shift: false,
    alt: false
  }
  private hoverId: string | null = null
  private pointer: Point = { x: 0, y: 0 }
  private spaceDown = false
  private disposed = false

  constructor(private readonly options: EngineOptions) {
    const ctx = options.canvas.getContext('2d')
    const overlayCtx = options.overlay.getContext('2d')
    if (!ctx || !overlayCtx) throw new Error('Canvas 2D context unavailable')
    this.ctx = ctx
    this.overlayCtx = overlayCtx
    imageCache.subscribe(() => this.invalidate())
    this.attach()
    this.loop()
  }

  /* ------------------------------- lifecycle ------------------------------ */

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.detach()
  }

  private attach(): void {
    const { overlay } = this.options
    overlay.addEventListener('pointerdown', this.onPointerDown)
    overlay.addEventListener('pointermove', this.onPointerMove)
    overlay.addEventListener('pointerup', this.onPointerUp)
    overlay.addEventListener('pointercancel', this.onPointerUp)
    overlay.addEventListener('wheel', this.onWheel, { passive: false })
    overlay.addEventListener('dblclick', this.onDoubleClick)
    overlay.addEventListener('contextmenu', this.onContextMenu)
    overlay.addEventListener('dragover', this.onDragOver)
    overlay.addEventListener('drop', this.onDrop)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  private detach(): void {
    const { overlay } = this.options
    overlay.removeEventListener('pointerdown', this.onPointerDown)
    overlay.removeEventListener('pointermove', this.onPointerMove)
    overlay.removeEventListener('pointerup', this.onPointerUp)
    overlay.removeEventListener('pointercancel', this.onPointerUp)
    overlay.removeEventListener('wheel', this.onWheel)
    overlay.removeEventListener('dblclick', this.onDoubleClick)
    overlay.removeEventListener('contextmenu', this.onContextMenu)
    overlay.removeEventListener('dragover', this.onDragOver)
    overlay.removeEventListener('drop', this.onDrop)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
  }

  /* -------------------------------- getters ------------------------------ */

  get page(): Page | null {
    const { document, pageId } = this.state
    if (!document) return null
    return document.pages.find((page) => page.id === pageId) ?? document.pages[0] ?? null
  }

  get zoom(): number {
    return this.state.zoom
  }

  get viewport(): { zoom: number; panX: number; panY: number } {
    return { zoom: this.state.zoom, panX: this.state.panX, panY: this.state.panY }
  }

  /* -------------------------------- updates ------------------------------ */

  setState(patch: Partial<EngineState>): void {
    const previous = this.state
    this.state = { ...previous, ...patch }
    if (
      previous.document !== this.state.document ||
      previous.pageId !== this.state.pageId ||
      previous.selection !== this.state.selection ||
      previous.editingNodeId !== this.state.editingNodeId ||
      previous.zoom !== this.state.zoom ||
      previous.panX !== this.state.panX ||
      previous.panY !== this.state.panY
    ) {
      this.invalidate()
    }
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.state.viewportWidth = width
    this.state.viewportHeight = height
    for (const canvas of [this.options.canvas, this.options.overlay]) {
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    this.invalidate()
  }

  invalidate(): void {
    this.dirty = true
  }

  /** Page coordinates → screen coordinates. */
  toScreen(point: Point): Point {
    return { x: point.x * this.state.zoom + this.state.panX, y: point.y * this.state.zoom + this.state.panY }
  }

  toPage(screen: Point): Point {
    return { x: (screen.x - this.state.panX) / this.state.zoom, y: (screen.y - this.state.panY) / this.state.zoom }
  }

  /* ------------------------------- rendering ----------------------------- */

  private loop = (): void => {
    if (this.disposed) return
    if (this.dirty) {
      this.dirty = false
      this.render()
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  private render(): void {
    const page = this.page
    const { canvas, overlay } = this.options
    const ctx = this.ctx
    const overlayCtx = this.overlayCtx
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const style = this.options.getStyle()

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height)
    if (!page) return

    const settings = this.options.getSettings()

    // Page shadow + page area
    ctx.save()
    ctx.translate(this.state.panX, this.state.panY)
    ctx.scale(this.state.zoom, this.state.zoom)

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 32
    ctx.shadowOffsetY = 12
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, page.width, page.height)
    ctx.restore()

    drawPageBackground(ctx, page, 1)
    if (settings.showGrid) drawGrid(ctx, page, this.state.zoom, settings.gridSize)

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, page.width, page.height)
    ctx.clip()
    for (const node of page.nodes) {
      drawNode(ctx, node, { scale: 1, onImageNeeded: (src) => imageCache.warm(src) })
    }
    ctx.restore()
    ctx.restore()

    // ------------------------------ overlays ------------------------------
    overlayCtx.save()
    overlayCtx.translate(this.state.panX, this.state.panY)
    overlayCtx.scale(this.state.zoom, this.state.zoom)

    if (settings.showSafeArea) drawSafeArea(overlayCtx, page, this.state.zoom)
    if (settings.showGuides && this.drag.guides.length) drawSnapGuides(overlayCtx, this.drag.guides, page, this.state.zoom, style)

    if (this.hoverId && !this.state.selection.includes(this.hoverId)) {
      const hovered = this.findNode(this.hoverId)
      if (hovered) drawHoverOutline(overlayCtx, hovered, this.state.zoom, style)
    }

    if (this.drag.marquee) drawMarquee(overlayCtx, this.drag.marquee, this.state.zoom, style)

    const selected = this.state.selection.map((id) => this.findNode(id)).filter((n): n is SceneNode => Boolean(n))
    const hideHandles = this.drag.mode !== 'none' || selected.length > 1
    for (const node of selected) {
      drawSelection(overlayCtx, node, this.state.zoom, style, { showHandles: !hideHandles, dashed: selected.length > 1 })
    }

    if (selected.length === 1 && !hideHandles) {
      const node = selected[0]
      drawSizeBadge(overlayCtx, node, this.state.zoom, `${Math.round(node.width)} × ${Math.round(node.height)}`)
    }

    if (this.drag.mode === 'move' && this.drag.moved && this.drag.startBounds) {
      const bounds = bboxOf([...this.drag.startNodes.values()])
      if (bounds) {
        overlayCtx.save()
        overlayCtx.fillStyle = 'rgba(124,92,255,0.08)'
        overlayCtx.strokeStyle = style.accent
        overlayCtx.lineWidth = 1 / this.state.zoom
        const dx = this.drag.lastPage.x - this.drag.startPage.x
        const dy = this.drag.lastPage.y - this.drag.startPage.y
        const snappedX = bounds.x + dx + (this.drag.guides.length ? 0 : 0)
        const snappedY = bounds.y + dy
        overlayCtx.strokeRect(snappedX, snappedY, bounds.width, bounds.height)
        overlayCtx.restore()
      }
    }

    overlayCtx.restore()
  }

  private findNode(id: string): SceneNode | null {
    const page = this.page
    if (!page) return null
    return flattenNodes(page.nodes).find((node) => node.id === id) ?? null
  }

  /* ------------------------------ interaction ---------------------------- */

  private pointerToPage(event: PointerEvent | MouseEvent | DragEvent): Point {
    const rect = this.options.overlay.getBoundingClientRect()
    return this.toPage({ x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button === 1 || this.spaceDown) {
      this.drag.mode = 'pan'
      this.options.overlay.setPointerCapture(event.pointerId)
      return
    }
    if (event.button !== 0) return

    const point = this.pointerToPage(event)
    this.pointer = point
    this.drag.startPage = point
    this.drag.lastPage = point
    this.drag.moved = false
    this.drag.additive = event.shiftKey
    this.drag.alt = event.altKey
    this.drag.shift = event.shiftKey
    this.options.overlay.setPointerCapture(event.pointerId)

    const selected = this.state.selection.map((id) => this.findNode(id)).filter((n): n is SceneNode => Boolean(n))

    // 1. Handle on the single selected node
    if (selected.length === 1 && !this.state.editingNodeId) {
      const handle = handleAtPoint(selected[0], point, this.state.zoom)
      if (handle) {
        this.drag.mode = handle === 'rotate' ? 'rotate' : 'resize'
        this.drag.handle = handle
        this.drag.startNodes = new Map([[selected[0].id, { ...selected[0] }]])
        this.drag.startBounds = aabbOf(selected[0])
        return
      }
    }

    // 2. Hit a node
    const page = this.page
    if (!page) return
    const hit = event.ctrlKey || event.metaKey ? hitTestAny(page.nodes, point) : hitTest(page.nodes, point)
    if (hit) {
      const alreadySelected = this.state.selection.includes(hit.id)
      if (this.drag.additive) {
        this.options.onSelectionChange(
          alreadySelected ? this.state.selection.filter((id) => id !== hit.id) : [...this.state.selection, hit.id]
        )
      } else if (!alreadySelected) {
        this.options.onSelectionChange([hit.id])
      }
      this.drag.mode = 'move'
      const ids = this.drag.additive
        ? this.state.selection.filter((id) => id !== hit.id).concat(alreadySelected ? [] : [hit.id])
        : alreadySelected
          ? this.state.selection
          : [hit.id]
      this.drag.startNodes = new Map()
      for (const id of ids) {
        const node = this.findNode(id)
        if (node && !node.locked) this.drag.startNodes.set(id, { ...node })
      }
      this.drag.startBounds = bboxOf([...this.drag.startNodes.values()])
      return
    }

    // 3. Empty space → marquee
    this.drag.mode = 'marquee'
    this.drag.marquee = { x: point.x, y: point.y, width: 0, height: 0 }
    if (!this.drag.additive) this.options.onSelectionChange([])
  }

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.pointerToPage(event)
    this.pointer = point

    if (this.drag.mode === 'none') {
      const page = this.page
      if (page) {
        const hit = hitTest(page.nodes, point)
        const nextHover = hit?.id ?? null
        if (nextHover !== this.hoverId) {
          this.hoverId = nextHover
          this.options.onHoverChange(nextHover)
          this.invalidate()
        }
        this.updateCursor(hit)
      }
      return
    }

    this.drag.lastPage = point
    if (Math.abs(point.x - this.drag.startPage.x) > 0.5 || Math.abs(point.y - this.drag.startPage.y) > 0.5) this.drag.moved = true

    switch (this.drag.mode) {
      case 'pan': {
        const dx = event.movementX
        const dy = event.movementY
        this.state.panX += dx
        this.state.panY += dy
        this.invalidate()
        return
      }
      case 'marquee': {
        const rect = {
          x: Math.min(this.drag.startPage.x, point.x),
          y: Math.min(this.drag.startPage.y, point.y),
          width: Math.abs(point.x - this.drag.startPage.x),
          height: Math.abs(point.y - this.drag.startPage.y)
        }
        this.drag.marquee = rect
        const page = this.page
        if (page) {
          const hits = nodesInRect(page.nodes, rect).map((n) => n.id)
          this.options.onSelectionChange(this.drag.additive ? Array.from(new Set([...this.state.selection, ...hits])) : hits)
        }
        this.invalidate()
        return
      }
      case 'move':
        this.handleMove(point, event)
        return
      case 'resize':
        this.handleResize(point, event)
        return
      case 'rotate':
        this.handleRotate(point, event)
        return
      default:
        return
    }
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (this.options.overlay.hasPointerCapture(event.pointerId)) this.options.overlay.releasePointerCapture(event.pointerId)
    if (this.drag.mode === 'move' && this.drag.moved) {
      const patches = [...this.drag.startNodes.entries()].map(([id, start]) => {
        const current = this.findNode(id)
        return { id, patch: current ? { x: current.x, y: current.y } : { x: start.x, y: start.y } }
      })
      // Commit final positions as one undo step.
      this.options.onNodesChange(
        patches.map(({ id }) => {
          const current = this.findNode(id)
          const start = this.drag.startNodes.get(id)
          return {
            id,
            patch: { x: current?.x ?? start?.x ?? 0, y: current?.y ?? start?.y ?? 0 }
          }
        }),
        { label: 'move', coalesceMs: 400 }
      )
    }
    if (this.drag.mode === 'resize' || this.drag.mode === 'rotate') {
      const patches = [...this.drag.startNodes.keys()].map((id) => {
        const current = this.findNode(id)
        const start = this.drag.startNodes.get(id)
        return {
          id,
          patch: {
            x: current?.x ?? start?.x,
            y: current?.y ?? start?.y,
            width: current?.width ?? start?.width,
            height: current?.height ?? start?.height,
            rotation: current?.rotation ?? start?.rotation
          } as Partial<SceneNode>
        }
      })
      this.options.onNodesChange(patches, { label: this.drag.mode === 'rotate' ? 'rotate' : 'resize', coalesceMs: 400 })
    }
    this.drag.mode = 'none'
    this.drag.handle = null
    this.drag.marquee = null
    this.drag.guides = []
    this.drag.startNodes = new Map()
    this.invalidate()
  }

  private handleMove(point: Point, event: PointerEvent): void {
    if (this.drag.startNodes.size === 0) return
    let dx = point.x - this.drag.startPage.x
    let dy = point.y - this.drag.startPage.y

    const settings = this.options.getSettings()
    const page = this.page
    if (page && (settings.snapToObjects || settings.snapToGrid)) {
      const staticBoxes = flattenNodes(page.nodes)
        .filter((node) => !this.drag.startNodes.has(node.id) && node.visible)
        .map((node) => aabbOf(node))
      const movingBoxes = [...this.drag.startNodes.values()].map((node) => aabbOf({ ...node, x: node.x + dx, y: node.y + dy }))
      const snap = computeSnap({
        threshold: 6 / this.state.zoom,
        grid: settings.snapToGrid ? settings.gridSize : null,
        page: { width: page.width, height: page.height },
        staticBoxes,
        movingBoxes
      })
      dx += snap.dx
      dy += snap.dy
      this.drag.guides = settings.showGuides ? snap.guides : []
    }

    if (event.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy) * 2) dy = 0
      else if (Math.abs(dy) > Math.abs(dx) * 2) dx = 0
    }

    const patches = [...this.drag.startNodes.entries()].map(([id, start]) => ({
      id,
      patch: { x: round(start.x + dx), y: round(start.y + dy) } as Partial<SceneNode>
    }))
    this.options.onNodesChange(patches, { label: 'move', coalesceMs: 350 })
  }

  private handleResize(point: Point, event: PointerEvent): void {
    const entry = [...this.drag.startNodes.entries()][0]
    if (!entry) return
    const [id, start] = entry
    const handle = this.drag.handle
    if (!handle) return

    // Work in the node's rotated local space so resizing feels natural.
    const center = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
    const angle = -((start.rotation ?? 0) * Math.PI) / 180
    const local = (p: Point): Point => {
      const dx = p.x - center.x
      const dy = p.y - center.y
      return {
        x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
        y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle)
      }
    }
    const startLocal = local(this.drag.startPage)
    const pointLocal = local(point)

    let left = start.x
    let top = start.y
    let right = start.x + start.width
    let bottom = start.y + start.height

    if (handle.includes('w')) left = pointLocal.x
    if (handle.includes('e')) right = pointLocal.x
    if (handle.includes('n')) top = pointLocal.y
    if (handle.includes('s')) bottom = pointLocal.y
    void startLocal

    let width = Math.abs(right - left)
    let height = Math.abs(bottom - top)

    const lockRatio = start.lockRatio || event.shiftKey || (start.kind === 'image' && !event.altKey)
    if (lockRatio && start.width > 0 && start.height > 0) {
      const ratio = start.width / start.height
      if (handle === 'n' || handle === 's') width = height * ratio
      else if (handle === 'e' || handle === 'w') height = width / ratio
      else {
        const scale = Math.max(width / start.width, height / start.height)
        width = start.width * scale
        height = start.height * scale
      }
    }

    if (event.altKey) {
      // Resize around the centre
      width *= 2
      height *= 2
    }

    width = Math.max(2, width)
    height = Math.max(2, height)

    // Keep the opposite edge anchored in the rotated frame.
    const nextLeft = handle.includes('w') ? right - width : left
    const nextTop = handle.includes('n') ? bottom - height : top
    const nextCenter = { x: nextLeft + width / 2, y: nextTop + height / 2 }
    const deltaX = nextCenter.x - center.x
    const deltaY = nextCenter.y - center.y
    const cos = Math.cos((start.rotation * Math.PI) / 180)
    const sin = Math.sin((start.rotation * Math.PI) / 180)

    const patch: Partial<SceneNode> = {
      x: round(center.x + deltaX * cos - deltaY * sin - width / 2),
      y: round(center.y + deltaX * sin + deltaY * cos - height / 2),
      width: round(width),
      height: round(height)
    }

    if (start.kind === 'text' && event.ctrlKey) {
      // Ctrl + resize scales the font with the box.
      const scale = height / Math.max(1, start.height)
      ;(patch as Partial<import('../../../../shared/types/document').TextNode>).fontSize = Math.max(4, round(start.fontSize * scale))
    }

    this.options.onNodesChange([{ id, patch }], { label: 'resize', coalesceMs: 120 })
  }

  private handleRotate(point: Point, event: PointerEvent): void {
    const entry = [...this.drag.startNodes.entries()][0]
    if (!entry) return
    const [id, start] = entry
    const center = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
    const angle = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90
    let rotation = Math.round(angle)
    if (event.shiftKey) rotation = Math.round(rotation / 15) * 15
    this.options.onNodesChange([{ id, patch: { rotation } as Partial<SceneNode> }], { label: 'rotate', coalesceMs: 120 })
  }

  private updateCursor(hit: SceneNode | null): void {
    const { overlay } = this.options
    if (this.spaceDown) {
      overlay.style.cursor = 'grab'
      return
    }
    const selected = this.state.selection.length === 1 ? this.findNode(this.state.selection[0]) : null
    if (selected) {
      const handle = handleAtPoint(selected, this.pointer, this.state.zoom)
      if (handle) {
        overlay.style.cursor = CURSORS[handle]
        return
      }
    }
    overlay.style.cursor = hit ? 'move' : 'default'
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const { overlay } = this.options
    const rect = overlay.getBoundingClientRect()
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }

    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.0015)
      const next = Math.max(0.02, Math.min(64, this.state.zoom * factor))
      const before = this.toPage(screen)
      this.state.zoom = next
      this.state.panX = screen.x - before.x * next
      this.state.panY = screen.y - before.y * next
      this.invalidate()
      return
    }
    this.state.panX -= event.shiftKey ? event.deltaY : event.deltaX
    this.state.panY -= event.shiftKey ? 0 : event.deltaY
    this.invalidate()
  }

  private onDoubleClick = (event: MouseEvent): void => {
    const point = this.pointerToPage(event)
    const page = this.page
    if (!page) return
    const hit = hitTestAny(page.nodes, point)
    if (!hit) return
    if (hit.kind === 'text') {
      this.options.onRequestTextEdit(hit.id)
      return
    }
    if (hit.kind === 'group') {
      const local = toLocalPoint(hit, point)
      const child = hitTestAny(hit.children, local)
      if (child) this.options.onSelectionChange([child.id])
    }
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    const point = this.pointerToPage(event)
    const page = this.page
    const hit = page ? hitTestAny(page.nodes, point) : null
    this.options.onContextMenu(point, hit?.id ?? null)
  }

  private onDragOver = (event: DragEvent): void => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  private onDrop = (event: DragEvent): void => {
    event.preventDefault()
    const point = this.pointerToPage(event)
    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      // Electron exposes the absolute path on File; browsers fall back to object URLs.
      const paths = Array.from(files).map((file) => (file as File & { path?: string }).path ?? URL.createObjectURL(file))
      this.options.onDropFiles(paths, point)
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      this.spaceDown = true
      this.options.overlay.style.cursor = 'grab'
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      this.spaceDown = false
      this.options.overlay.style.cursor = 'default'
    }
  }

  /* -------------------------------- helpers ------------------------------ */

  /** Nodes currently under the pointer (used by the context menu). */
  nodeAt(point: Point): SceneNode | null {
    const page = this.page
    if (!page) return null
    return hitTestAny(page.nodes, point)
  }

  isPointOnPage(point: Point): boolean {
    const page = this.page
    if (!page) return false
    return isPointInNode({ ...page, x: 0, y: 0, rotation: 0, visible: true, locked: false, kind: 'shape' } as unknown as SceneNode, point)
  }

  getOverlayStyle(): OverlayStyle {
    return this.options.getStyle() || DEFAULT_OVERLAY_STYLE
  }
}
