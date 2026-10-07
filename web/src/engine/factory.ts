/**
 * Node factories + cloning. Every node created anywhere in the app goes through
 * here so defaults stay consistent (and so new node kinds only need one edit).
 */
import type {
  Animation,
  ChartData,
  ChartNode,
  EllipseNode,
  FrameNode,
  GroupNode,
  ID,
  ImageNode,
  LineNode,
  NodeType,
  Paint,
  PathNode,
  RectNode,
  SceneNode,
  StarNode,
  SvgNode,
  TableData,
  TableNode,
  TextNode,
  TextStyle,
  TextSpan,
  VideoNode,
} from './types';
import { defaultTextStyle } from './types';

let counter = 0;

/** Collision-free, sortable ids (short enough to stay readable in JSON). */
export function uid(prefix = 'n'): ID {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

type BaseOpts = Partial<SceneNode> & { name?: string };

function base(type: NodeType, opts: BaseOpts = {}): SceneNode {
  return {
    id: opts.id ?? uid(),
    type,
    name: opts.name ?? prettyName(type),
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    width: opts.width ?? 200,
    height: opts.height ?? 200,
    rotation: opts.rotation ?? 0,
    opacity: opts.opacity ?? 1,
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    flipX: opts.flipX ?? false,
    flipY: opts.flipY ?? false,
    blendMode: opts.blendMode ?? 'normal',
    fill: opts.fill !== undefined ? opts.fill : { type: 'solid', color: '#6C5CE7' },
    stroke: opts.stroke ?? null,
    shadow: opts.shadow ?? null,
    blur: opts.blur ?? 0,
    clip: opts.clip ?? false,
    animation: opts.animation ?? defaultAnimation(),
    meta: opts.meta ?? {},
    ...(opts.children ? { children: opts.children } : {}),
    ...(opts.data ? { data: opts.data } : {}),
    ...(opts.timeline ? { timeline: opts.timeline } : {}),
    ...(opts.keyframes ? { keyframes: opts.keyframes } : {}),
    ...(opts.radius !== undefined ? { radius: opts.radius } : {}),
  };
}

export function prettyName(type: NodeType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function defaultAnimation(): Animation {
  return { preset: 'none', duration: 600, delay: 0, easing: 'ease-out', loop: false, direction: 'normal' };
}

export function solid(color: string, opacity = 1): Paint {
  return { type: 'solid', color, opacity };
}

export function linearGradient(stops: string[], angle = 90): Paint {
  return {
    type: 'gradient',
    kind: 'linear',
    angle,
    stops: stops.map((color, i) => ({ offset: stops.length === 1 ? 0 : i / (stops.length - 1), color })),
  };
}

/* ------------------------------------------------------------------ shapes */

export function createRect(opts: BaseOpts = {}): RectNode {
  return { ...base('rect', opts) } as RectNode;
}

export function createEllipse(opts: BaseOpts = {}): EllipseNode {
  return { ...base('ellipse', opts) } as EllipseNode;
}

export function createLine(opts: BaseOpts & { height?: number } = {}): LineNode {
  const node = base('line', { height: 4, radius: 2, fill: solid('#2D3436'), ...opts }) as LineNode;
  return node;
}

export function createArrow(opts: BaseOpts = {}): SceneNode {
  return base('arrow', { height: 40, radius: 0, fill: solid('#2D3436'), ...opts });
}

export function createStar(points = 5, opts: BaseOpts = {}): StarNode {
  const node = base('star', opts) as StarNode;
  node.points = points;
  node.innerRadius = 0.42;
  return node;
}

export function createPolygon(points = 6, opts: BaseOpts = {}): SceneNode {
  const node = base('polygon', opts);
  node.points = points;
  return node;
}

export function createPath(d: string, opts: BaseOpts = {}): PathNode {
  const node = base('path', opts) as PathNode;
  node.d = d;
  return node;
}

export function createSvg(svg: string, opts: BaseOpts & { width?: number; height?: number } = {}): SvgNode {
  const node = base('svg', { ...opts }) as SvgNode;
  node.svg = svg;
  return node;
}

/* -------------------------------------------------------------------- text */

export function createText(text = 'Double click to edit', style: Partial<TextStyle> = {}, opts: BaseOpts = {}): TextNode {
  const node = base('text', {
    width: 520,
    height: 80,
    fill: null,
    ...opts,
  }) as TextNode;
  node.style = { ...defaultTextStyle(), ...style };
  node.spans = [{ text, style: undefined }];
  return node;
}

export function createHeading(text: string, style: Partial<TextStyle> = {}, opts: BaseOpts = {}): TextNode {
  return createText(text, { fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, ...style }, { name: 'Heading', height: 90, ...opts });
}

export function createBody(text: string, style: Partial<TextStyle> = {}, opts: BaseOpts = {}): TextNode {
  return createText(text, { fontSize: 28, fontWeight: 400, lineHeight: 1.45, ...style }, { name: 'Body', height: 60, ...opts });
}

export function spansFromText(text: string, style?: Partial<TextStyle>): TextSpan[] {
  return [{ text, style }];
}

/* ------------------------------------------------------------------- media */

export function createImage(src: string, opts: BaseOpts & { natural?: { width: number; height: number } } = {}): ImageNode {
  const node = base('image', { fill: { type: 'image', src, fit: 'cover' }, ...opts }) as ImageNode;
  node.src = src;
  if (opts.natural) node.natural = opts.natural;
  return node;
}

export function createVideo(src: string, opts: BaseOpts = {}): VideoNode {
  const node = base('video', { fill: solid('#000000'), ...opts }) as VideoNode;
  node.src = src;
  return node;
}

export function createSticker(svg: string, opts: BaseOpts = {}): SceneNode {
  const node = base('sticker', opts);
  node.data = { svg };
  return node;
}

/* ------------------------------------------------------------------ frames */

export function createFrame(opts: BaseOpts & { children?: SceneNode[] } = {}): FrameNode {
  const node = base('frame', { fill: solid('#FFFFFF', 0), clip: true, children: [], ...opts }) as FrameNode;
  return node;
}

export function createGroup(children: SceneNode[], opts: BaseOpts = {}): GroupNode {
  const node = base('group', { fill: null, children, ...opts }) as GroupNode;
  return node;
}

/* ------------------------------------------------------------------- chart */

export function defaultChartData(kind: ChartData['kind'] = 'bar'): ChartData {
  return {
    kind,
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    series: [{ name: 'Revenue', values: [32, 48, 39, 62, 78, 91] }],
    options: {
      showLegend: true,
      showGrid: true,
      showValues: false,
      smooth: true,
      stacked: false,
      palette: ['#6C5CE7', '#00B894', '#FD79A8', '#FDCB6E', '#0984E3', '#E17055'],
      labelColor: '#6B7280',
      gridColor: '#E5E7EB',
      fontFamily: 'Inter',
      fontSize: 14,
    },
  };
}

export function createChart(kind: ChartData['kind'] = 'bar', opts: BaseOpts = {}): ChartNode {
  const node = base('chart', { width: 640, height: 400, fill: solid('#FFFFFF'), radius: 16, ...opts }) as ChartNode;
  node.data = defaultChartData(kind);
  return node;
}

/* ------------------------------------------------------------------- table */

export function defaultTableData(rows = 4, cols = 3): TableData {
  const cells: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(r === 0 ? `Header ${c + 1}` : `Cell ${r}.${c + 1}`);
    }
    cells.push(row);
  }
  return {
    rows,
    cols,
    cells,
    header: true,
    style: {
      headerFill: '#6C5CE7',
      headerColor: '#FFFFFF',
      cellFill: '#FFFFFF',
      altFill: '#F4F4FB',
      border: '#E5E7EB',
      borderWidth: 1,
      fontFamily: 'Inter',
      fontSize: 18,
      color: '#1F2937',
      padding: 12,
    },
  };
}

export function createTable(rows = 4, cols = 3, opts: BaseOpts = {}): TableNode {
  const node = base('table', { width: 640, height: 260, fill: solid('#FFFFFF'), radius: 12, ...opts }) as TableNode;
  node.data = defaultTableData(rows, cols);
  return node;
}

/* -------------------------------------------------------------------- clone */

export function cloneNode(node: SceneNode, offset = { x: 24, y: 24 }): SceneNode {
  const copy: SceneNode = JSON.parse(JSON.stringify(node));
  copy.id = uid();
  copy.x += offset.x;
  copy.y += offset.y;
  if (copy.children?.length) copy.children = copy.children.map((c) => cloneNode(c, { x: 0, y: 0 }));
  return copy;
}

export function cloneNodes(nodes: SceneNode[], offset = { x: 24, y: 24 }): SceneNode[] {
  return nodes.map((n) => cloneNode(n, offset));
}
