import { engine } from '@/editor/engine';
import type { BlueprintElement } from '@/types/design';

/** Place blueprint/template elements onto the live canvas. */
export async function applyElements(elements: BlueprintElement[], opts?: { clear?: boolean }): Promise<void> {
  const canvas = engine.canvas;
  if (!canvas) return;
  if (opts?.clear) {
    canvas.remove(...canvas.getObjects());
  }
  for (const el of elements) {
    if (el.type === 'text') {
      engine.addText(el.text, el.role === 'headline' ? 'heading' : el.role === 'subhead' ? 'subheading' : 'body', {
        left: el.x + el.width / 2,
        top: el.y,
        originX: 'center',
        originY: 'top',
        width: el.width,
        fontSize: el.fontSize,
        fontFamily: el.fontFamily,
        fontWeight: el.fontWeight,
        fill: el.fill,
        textAlign: el.align
      });
    } else if (el.type === 'image') {
      // Placeholder frame; the AI image step (or an upload) fills it in.
      engine.addShape('rounded', {
        left: el.x + el.width / 2,
        top: el.y + el.height / 2,
        width: el.width,
        height: el.height,
        rx: 24,
        ry: 24,
        fill: 'rgba(255,255,255,0.08)',
        stroke: 'rgba(255,255,255,0.35)',
        strokeWidth: 2,
        strokeDashArray: [12, 10]
      });
      const obj = engine.canvas?.getActiveObject() as any;
      if (obj) {
        obj.lname = 'Image slot';
        obj.imageSlot = el.prompt;
      }
    } else {
      const kind = el.type === 'star' ? 'star' : el.type;
      engine.addShape(kind, {
        left: el.x + el.width / 2,
        top: el.y + el.height / 2,
        width: el.width,
        height: el.height,
        rx: el.rx ?? 0,
        ry: el.rx ?? 0,
        radius: el.width / 2,
        fill: el.fill,
        opacity: el.opacity ?? 1,
        angle: el.angle ?? 0,
        scaleX: 1,
        scaleY: el.type === 'ellipse' ? el.height / el.width : 1
      });
    }
  }
  engine.canvas?.discardActiveObject();
  engine.canvas?.requestRenderAll();
}

/** Lightweight SVG preview used by the template/AI panels (no canvas needed). */
export function previewSvg(
  width: number,
  height: number,
  background: string | null,
  elements: BlueprintElement[]
): string {
  const parts = elements
    .map((el) => {
      if (el.type === 'text') {
        const lines = el.text.split('\n');
        const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
        const x = el.align === 'center' ? el.x + el.width / 2 : el.align === 'right' ? el.x + el.width : el.x;
        return lines
          .map(
            (line, i) =>
              `<text x="${x}" y="${el.y + el.fontSize * (0.9 + i * 1.15)}" fill="${el.fill}" font-size="${el.fontSize}" font-weight="${el.fontWeight}" font-family="${el.fontFamily}, sans-serif" text-anchor="${anchor}">${escapeXml(line)}</text>`
          )
          .join('');
      }
      if (el.type === 'image') {
        return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="24" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.35)" stroke-dasharray="12 10"/>`;
      }
      const opacity = el.opacity ?? 1;
      const transform = el.angle ? ` transform="rotate(${el.angle} ${el.x + el.width / 2} ${el.y + el.height / 2})"` : '';
      if (el.type === 'ellipse') {
        return `<ellipse cx="${el.x + el.width / 2}" cy="${el.y + el.height / 2}" rx="${el.width / 2}" ry="${el.height / 2}" fill="${el.fill}" opacity="${opacity}"${transform}/>`;
      }
      if (el.type === 'triangle') {
        return `<polygon points="${el.x + el.width / 2},${el.y} ${el.x + el.width},${el.y + el.height} ${el.x},${el.y + el.height}" fill="${el.fill}" opacity="${opacity}"${transform}/>`;
      }
      if (el.type === 'star') {
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        const R = el.width / 2;
        const pts = Array.from({ length: 10 }, (_, i) => {
          const r = i % 2 === 0 ? R : R / 2;
          const a = (i * Math.PI) / 5 - Math.PI / 2;
          return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
        }).join(' ');
        return `<polygon points="${pts}" fill="${el.fill}" opacity="${opacity}"${transform}/>`;
      }
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="${el.rx ?? 0}" fill="${el.fill}" opacity="${opacity}"${transform}/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><rect width="${width}" height="${height}" fill="${background ?? 'transparent'}"/>${parts}</svg>`;
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}
