'use client';

/**
 * Live renderer for a scene node.
 *
 * The editing surface is DOM-based (crisp text, real CSS filters, native video),
 * while `engine/render/canvas2d.ts` renders the same scene for export. Both
 * consume identical style helpers from `engine/render/paint.ts`, so screen and
 * output match.
 */
import { memo, useMemo } from 'react';
import type { SceneNode, TextNode, TextStyle, ChartNode, TableNode, ImageNode } from '@/engine/types';
import {
  adjustmentsToCssFilter,
  blendModeCss,
  paintToCss,
  radiusToCss,
  shadowToCss,
  strokeToCss,
} from '@/engine/render/paint';
import { fontStack } from '@/data/fonts';
import { chartSvg } from '@/engine/render/chart';
import { parseColor, toRgbString, withAlpha } from '@/engine/color';

export type RenderMode = 'edit' | 'present' | 'thumb';

export type NodeViewProps = {
  node: SceneNode;
  mode?: RenderMode;
  zoom?: number;
  time?: number;
  editing?: boolean;
  animationKey?: number;
  onTextInput?: (nodeId: string, text: string) => void;
};

function NodeViewImpl({ node, mode = 'edit', zoom = 1, time = 0, editing = false, animationKey = 0, onTextInput }: NodeViewProps) {
  if (!node.visible) return null;

  const transform = `rotate(${node.rotation || 0}deg) scaleX(${node.flipX ? -1 : 1}) scaleY(${node.flipY ? -1 : 1})${
    node.skew ? ` skew(${node.skew.x || 0}deg, ${node.skew.y || 0}deg)` : ''
  }`;

  const filter = [
    node.adjustments ? adjustmentsToCssFilter(node.adjustments) : '',
    node.blur ? `blur(${node.blur}px)` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const inTimeline =
    node.timeline && (time < node.timeline.in || (node.timeline.out != null && time > node.timeline.out));

  const animation =
    mode !== 'edit' && node.animation && node.animation.preset !== 'none'
      ? {
          animationName: ANIMATION_MAP[node.animation.preset] ?? 'fadeIn',
          animationDuration: `${node.animation.duration}ms`,
          animationDelay: `${node.animation.delay}ms`,
          animationTimingFunction: EASING_MAP[node.animation.easing] ?? 'ease-out',
          animationFillMode: 'both' as const,
          animationIterationCount: node.animation.loop ? 'infinite' : 1,
          animationDirection: node.animation.direction === 'alternate' ? ('alternate' as const) : ('normal' as const),
        }
      : undefined;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    transform,
    transformOrigin: 'center center',
    opacity: node.opacity ?? 1,
    mixBlendMode: blendModeCss(node.blendMode) as React.CSSProperties['mixBlendMode'],
    filter: filter || undefined,
    display: inTimeline ? 'none' : undefined,
    pointerEvents: node.locked && mode === 'edit' ? 'none' : undefined,
    ...animation,
  };

  const isContainer = node.type === 'group' || node.type === 'frame';

  return (
    <div
      data-node-id={node.id}
      data-node-type={node.type}
      className="node-view"
      style={style}
      aria-label={node.ariaLabel || node.name}
      role={node.type === 'text' ? 'text' : 'img'}
    >
      {isContainer ? (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              overflow: node.clip ? 'hidden' : 'visible',
              borderRadius: radiusToCss(node.radius),
              background: paintToCss(node.fill, node.width, node.height),
              border: strokeToCss(node.stroke),
              boxShadow: shadowToCss(node.shadow),
            }}
          >
            {(node.children ?? []).map((child) => (
              <NodeView key={child.id} node={child} mode={mode} zoom={zoom} time={time} animationKey={animationKey} />
            ))}
          </div>
        </>
      ) : (
        <NodeVisual node={node} mode={mode} zoom={zoom} editing={editing} time={time} onTextInput={onTextInput} />
      )}
    </div>
  );
}

export const NodeView = memo(NodeViewImpl, (prev, next) => {
  return (
    prev.node === next.node &&
    prev.mode === next.mode &&
    prev.editing === next.editing &&
    prev.time === next.time &&
    prev.animationKey === next.animationKey &&
    Math.abs((prev.zoom ?? 1) - (next.zoom ?? 1)) < 0.001
  );
});

/* --------------------------------------------------------------- animation */

const ANIMATION_MAP: Record<string, string> = {
  fade: 'prismFade',
  rise: 'prismRise',
  drop: 'prismDrop',
  'pan-left': 'prismPanLeft',
  'pan-right': 'prismPanRight',
  'zoom-in': 'prismZoomIn',
  'zoom-out': 'prismZoomOut',
  flip: 'prismFlip',
  pop: 'prismPop',
  'blur-in': 'prismBlurIn',
  typewriter: 'prismTypewriter',
  reveal: 'prismReveal',
  float: 'prismFloat',
  pulse: 'prismPulse',
  spin: 'prismSpin',
  wipe: 'prismWipe',
};

const EASING_MAP: Record<string, string> = {
  linear: 'linear',
  ease: 'ease',
  'ease-in': 'cubic-bezier(0.4,0,1,1)',
  'ease-out': 'cubic-bezier(0,0,0.2,1)',
  'ease-in-out': 'cubic-bezier(0.4,0,0.2,1)',
  spring: 'cubic-bezier(0.34,1.56,0.64,1)',
};

/* ---------------------------------------------------------------- visuals */

function NodeVisual({
  node,
  mode,
  zoom,
  editing,
  time,
  onTextInput,
}: {
  node: SceneNode;
  mode: RenderMode;
  zoom: number;
  editing: boolean;
  time: number;
  onTextInput?: (nodeId: string, text: string) => void;
}) {
  const base: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    borderRadius: ['rect', 'image', 'video', 'frame'].includes(node.type) ? radiusToCss(node.radius) : undefined,
    boxShadow: shadowToCss(node.shadow) ?? undefined,
  };

  switch (node.type) {
    case 'text':
      return <TextVisual node={node as TextNode} mode={mode} editing={editing} zoom={zoom} onTextInput={onTextInput} />;

    case 'image':
      return <ImageVisual node={node as ImageNode} mode={mode} time={time} />;

    case 'video':
      return <VideoVisual node={node} time={time} playing={mode === 'present'} />;

    case 'chart':
      return <ChartVisual node={node as ChartNode} />;

    case 'table':
      return <TableVisual node={node as TableNode} />;

    case 'svg':
    case 'sticker': {
      const svg = ((node as { svg?: string }).svg ?? (node.data?.svg as string) ?? '') as string;
      return (
        <div
          style={{ ...base, overflow: 'visible' }}
          dangerouslySetInnerHTML={{ __html: svg }}
          aria-hidden={!node.ariaLabel}
        />
      );
    }

    case 'ellipse':
      return (
        <div
          style={{
            ...base,
            borderRadius: '50%',
            background: paintToCss(node.fill, node.width, node.height),
            border: strokeToCss(node.stroke),
            overflow: 'hidden',
          }}
        />
      );

    case 'line':
    case 'arrow':
    case 'polygon':
    case 'star':
    case 'path':
      return <ShapeVisual node={node} />;

    case 'rect':
    default:
      return (
        <div
          style={{
            ...base,
            background: paintToCss(node.fill, node.width, node.height),
            border: strokeToCss(node.stroke),
          }}
        />
      );
  }
}

/* ------------------------------------------------------------------- shapes */

function ShapeVisual({ node }: { node: SceneNode }) {
  const svg = useMemo(() => shapeToSvg(node), [node]);
  return <div style={{ position: 'absolute', inset: 0, overflow: 'visible' }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function shapeToSvg(node: SceneNode): string {
  const w = node.width;
  const h = node.height;
  const paint = node.fill;
  const gradientId = `grad_${node.id}`;
  const defs =
    paint?.type === 'gradient'
      ? `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">${paint.stops
          .slice()
          .sort((a, b) => a.offset - b.offset)
          .map((s) => `<stop offset="${s.offset * 100}%" stop-color="${withAlpha(s.color, s.opacity ?? 1)}"/>`)
          .join('')}</linearGradient></defs>`
      : paint?.type === 'image'
        ? `<defs><pattern id="${gradientId}" patternUnits="userSpaceOnUse" width="${w}" height="${h}"><image href="${paint.src}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/></pattern></defs>`
        : '';

  const fill = paint?.type === 'solid' ? withAlpha(paint.color, paint.opacity ?? 1) : `url(#${gradientId})`;
  const stroke = node.stroke
    ? `stroke="${withAlpha(node.stroke.color, node.stroke.opacity ?? 1)}" stroke-width="${node.stroke.width}" stroke-dasharray="${
        node.stroke.style === 'dashed' ? `${node.stroke.width * 3} ${node.stroke.width * 2}` : node.stroke.style === 'dotted' ? `${node.stroke.width} ${node.stroke.width * 1.6}` : ''
      }"`
    : '';

  let body = '';
  switch (node.type) {
    case 'line':
      body = `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="${fill}" stroke-width="${h}" stroke-linecap="round"/>`;
      break;
    case 'arrow': {
      const head = Math.min(h, w * 0.5);
      body = `<path d="M0 ${h / 2 - h * 0.16} L${w - head * 0.5} ${h / 2 - h * 0.16} L${w - head * 0.5} ${h / 2 - h * 0.42} L${w} ${h / 2} L${w - head * 0.5} ${h / 2 + h * 0.42} L${w - head * 0.5} ${h / 2 + h * 0.16} L0 ${h / 2 + h * 0.16} Z" fill="${fill}" ${stroke}/>`;
      break;
    }
    case 'polygon':
    case 'star': {
      const points = node.type === 'star' ? (node.points ?? 5) : (node.points ?? 6);
      const inner = node.type === 'star' ? (node.innerRadius ?? 0.42) : 1;
      const total = node.type === 'star' ? points * 2 : points;
      const coords: string[] = [];
      for (let i = 0; i < total; i++) {
        const r = node.type === 'star' ? (i % 2 === 0 ? 1 : inner) : 1;
        const angle = ((i / total) * 360 - 90) * (Math.PI / 180);
        coords.push(`${(w / 2 + (w / 2) * r * Math.cos(angle)).toFixed(2)},${(h / 2 + (h / 2) * r * Math.sin(angle)).toFixed(2)}`);
      }
      body = `<polygon points="${coords.join(' ')}" fill="${fill}" ${stroke} stroke-linejoin="round"/>`;
      break;
    }
    case 'path':
      body = `<path d="${node.d ?? ''}" fill="${fill}" ${stroke}/>`;
      break;
    default:
      body = `<rect x="0" y="0" width="${w}" height="${h}" rx="${typeof node.radius === 'number' ? node.radius : 0}" fill="${fill}" ${stroke}/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${body}</svg>`;
}

/* --------------------------------------------------------------------- text */

function TextVisual({
  node,
  mode,
  editing,
  zoom,
  onTextInput,
}: {
  node: TextNode;
  mode: RenderMode;
  editing: boolean;
  zoom: number;
  onTextInput?: (nodeId: string, text: string) => void;
}) {
  const style = node.style ?? {};
  const spans = node.spans?.length ? node.spans : [{ text: '' }];

  if (style.path?.d) {
    return <CurvedText node={node} />;
  }

  const alignItems = style.verticalAlign === 'middle' ? 'center' : style.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';

  return (
    <div
      data-text-editing={editing ? 'true' : undefined}
      contentEditable={editing && mode === 'edit'}
      suppressContentEditableWarning
      spellCheck={editing}
      onInput={
        editing
          ? (event) => {
              const text = (event.currentTarget as HTMLElement).innerText;
              onTextInput?.(node.id, text);
            }
          : undefined
      }
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: alignItems,
        textAlign: style.textAlign ?? 'left',
        padding: style.padding ?? 0,
        background: style.background ?? undefined,
        borderRadius: radiusToCss(node.radius),
        outline: editing ? '2px solid var(--brand)' : undefined,
        outlineOffset: editing ? 2 : undefined,
        cursor: editing ? 'text' : undefined,
        overflow: 'visible',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        direction: /[\u0600-\u06FF]/.test(spans.map((s) => s.text).join('')) ? 'rtl' : 'ltr',
      }}
    >
      <span style={{ display: 'block', width: '100%' }}>
        {spans.map((span, index) => {
          const s: TextStyle = { ...(style as TextStyle), ...(span.style ?? {}) };
          const textShadow = [
            s.shadow ? `${s.shadow.x}px ${s.shadow.y}px ${s.shadow.blur}px ${s.shadow.color}` : '',
            s.glow ? `0 0 ${s.glow.blur}px ${s.glow.color}` : '',
          ]
            .filter(Boolean)
            .join(', ');

          const gradientText = s.gradient
            ? {
                backgroundImage: `linear-gradient(${s.gradient.angle}deg, ${s.gradient.stops
                  .map((stop) => `${withAlpha(stop.color, 1)} ${Math.round(stop.offset * 100)}%`)
                  .join(', ')})`,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }
            : {};

          return (
            <span
              key={index}
              style={{
                fontFamily: fontStack(s.fontFamily ?? 'Inter'),
                fontSize: s.fontSize ?? 32,
                fontWeight: s.fontWeight ?? 400,
                fontStyle: s.fontStyle ?? 'normal',
                color: s.color ?? '#111827',
                letterSpacing: s.letterSpacing ?? 0,
                lineHeight: s.lineHeight ?? 1.3,
                textTransform: s.textTransform ?? 'none',
                textDecoration: `${s.underline ? 'underline' : ''} ${s.strike ? 'line-through' : ''}`.trim() || undefined,
                background: s.highlight ?? undefined,
                textShadow: textShadow || undefined,
                WebkitTextStroke: s.outline ? `${s.outline.width}px ${s.outline.color}` : undefined,
                paintOrder: s.outline ? 'stroke fill' : undefined,
                ...gradientText,
              }}
            >
              {span.text}
            </span>
          );
        })}
      </span>
    </div>
  );
}

function CurvedText({ node }: { node: TextNode }) {
  const style = node.style ?? {};
  const text = (node.spans ?? []).map((s) => s.text).join('');
  const path = style.path!;
  const id = `curve_${node.id}`;
  return (
    <svg width={node.width} height={node.height} viewBox={`0 0 ${node.width} ${node.height}`} style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <path id={id} d={path.d} fill="none" />
      </defs>
      <text
        style={{
          fontFamily: fontStack(style.fontFamily ?? 'Inter'),
          fontSize: style.fontSize ?? 32,
          fontWeight: style.fontWeight ?? 700,
          fill: style.color ?? '#111827',
          letterSpacing: style.letterSpacing ?? 0,
        }}
      >
        <textPath href={`#${id}`} startOffset={`${path.startOffset * 100}%`}>
          {text}
        </textPath>
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------- media */

function ImageVisual({ node, mode, time }: { node: ImageNode; mode: RenderMode; time: number }) {
  const crop = node.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const fill = node.fill;
  const fit = (fill && fill.type === 'image' ? fill.fit : 'cover') ?? 'cover';
  const src = node.src || (fill && fill.type === 'image' ? fill.src : '');

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: radiusToCss(node.radius) }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={node.ariaLabel ?? node.name}
          draggable={false}
          style={{
            position: 'absolute',
            left: `${-crop.x * 100}%`,
            top: `${-crop.y * 100}%`,
            width: `${100 / Math.max(0.01, crop.width)}%`,
            height: `${100 / Math.max(0.01, crop.height)}%`,
            objectFit: fit === 'fill' ? 'fill' : fit === 'tile' ? 'cover' : fit,
            opacity: (fill && fill.type === 'image' ? fill.opacity ?? 1 : 1) * (node.opacity ?? 1),
            filter: adjustmentsToCssFilter(node.adjustments),
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'repeating-linear-gradient(45deg, rgba(120,120,160,.16) 0 12px, rgba(120,120,160,.06) 12px 24px)',
            border: '1px dashed rgba(120,120,180,.5)',
          }}
        />
      )}
    </div>
  );
}

function VideoVisual({ node, time, playing }: { node: SceneNode; time: number; playing: boolean }) {
  const src = node.src ?? '';
  const crop = node.crop;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: radiusToCss(node.radius), background: '#000' }}>
      {src ? (
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          style={{
            position: 'absolute',
            left: crop ? `${-crop.x * 100}%` : 0,
            top: crop ? `${-crop.y * 100}%` : 0,
            width: crop ? `${100 / Math.max(0.01, crop.width)}%` : '100%',
            height: crop ? `${100 / Math.max(0.01, crop.height)}%` : '100%',
            objectFit: 'cover',
            filter: adjustmentsToCssFilter(node.adjustments),
          }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#888', fontSize: 14 }}>
          Video
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- chart */

function ChartVisual({ node }: { node: ChartNode }) {
  const svg = useMemo(() => chartSvg(node.data, node.width, node.height), [node.data, node.width, node.height]);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: radiusToCss(node.radius),
        background: paintToCss(node.fill, node.width, node.height),
        border: strokeToCss(node.stroke),
        overflow: 'hidden',
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/* ------------------------------------------------------------------- table */

function TableVisual({ node }: { node: TableNode }) {
  const { cells, rows, cols, header, style } = node.data;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        borderRadius: radiusToCss(node.radius),
        border: `${style.borderWidth}px solid ${style.border}`,
        overflow: 'hidden',
        fontFamily: fontStack(style.fontFamily),
        fontSize: style.fontSize,
        color: style.color,
        background: style.cellFill,
      }}
    >
      {cells.slice(0, rows).map((row, r) =>
        row.slice(0, cols).map((cell, c) => (
          <div
            key={`${r}-${c}`}
            style={{
              padding: style.padding,
              background: header && r === 0 ? style.headerFill : r % 2 ? style.altFill : style.cellFill,
              color: header && r === 0 ? style.headerColor : style.color,
              fontWeight: header && r === 0 ? 700 : 400,
              borderRight: c < cols - 1 ? `${style.borderWidth}px solid ${style.border}` : undefined,
              borderBottom: r < rows - 1 ? `${style.borderWidth}px solid ${style.border}` : undefined,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {cell}
          </div>
        )),
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

/** Recolors a bundled SVG element by swapping its palette entries. */
export function recolorSvg(svg: string, from: string[], to: string): string {
  let out = svg;
  from.forEach((color, index) => {
    const target = Array.isArray(to) ? to[index % to.length] : to;
    const regex = new RegExp(color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(regex, Array.isArray(target) ? target[0]! : target);
  });
  return out;
}

export function averageColorOfNode(node: SceneNode): string {
  if (node.fill?.type === 'solid') return node.fill.color;
  if (node.fill?.type === 'gradient') return node.fill.stops[0]?.color ?? '#6C5CE7';
  return toRgbString({ ...parseColor('#6C5CE7'), a: 1 });
}
