import * as fabric from 'fabric';
import { BUILT_IN_TEMPLATES } from '@/data/templates';
import { CUSTOM_PROPS } from '@/editor/engine';
import { bridge } from './bridge';
import type { BlueprintElement } from '@/types/design';
import type { PageDoc } from '@/types';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `s-${Math.random().toString(36).slice(2)}`);

/** Build a serialisable fabric scene from blueprint elements (no DOM canvas needed on screen). */
export async function elementsToPage(
  name: string,
  width: number,
  height: number,
  background: string | null,
  elements: BlueprintElement[]
): Promise<PageDoc> {
  const canvas = new fabric.StaticCanvas(document.createElement('canvas'), { width, height });
  canvas.backgroundColor = background ?? '';

  for (const el of elements) {
    let obj: fabric.FabricObject;
    if (el.type === 'text') {
      obj = new fabric.Textbox(el.text, {
        left: el.x,
        top: el.y,
        width: el.width,
        fontSize: el.fontSize,
        fontFamily: el.fontFamily,
        fontWeight: el.fontWeight,
        fill: el.fill,
        textAlign: el.align
      });
    } else if (el.type === 'image') {
      obj = new fabric.Rect({
        left: el.x,
        top: el.y,
        width: el.width,
        height: el.height,
        rx: 24,
        ry: 24,
        fill: 'rgba(255,255,255,0.08)',
        stroke: 'rgba(255,255,255,0.35)',
        strokeDashArray: [12, 10]
      });
    } else if (el.type === 'ellipse') {
      obj = new fabric.Ellipse({ left: el.x, top: el.y, rx: el.width / 2, ry: el.height / 2, fill: el.fill, opacity: el.opacity ?? 1, angle: el.angle ?? 0 });
    } else if (el.type === 'triangle') {
      obj = new fabric.Triangle({ left: el.x, top: el.y, width: el.width, height: el.height, fill: el.fill, opacity: el.opacity ?? 1, angle: el.angle ?? 0 });
    } else if (el.type === 'star') {
      const r = el.width / 2;
      const pts = Array.from({ length: 10 }, (_, i) => {
        const rr = i % 2 === 0 ? r : r / 2;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
      });
      obj = new fabric.Polygon(pts, { left: el.x, top: el.y, fill: el.fill, opacity: el.opacity ?? 1 });
    } else {
      obj = new fabric.Rect({
        left: el.x,
        top: el.y,
        width: el.width,
        height: el.height,
        rx: el.rx ?? 0,
        ry: el.rx ?? 0,
        fill: el.fill,
        opacity: el.opacity ?? 1,
        angle: el.angle ?? 0
      });
    }
    (obj as any).lid = uid();
    (obj as any).lname = el.type === 'text' ? el.text.slice(0, 20) : el.type;
    canvas.add(obj);
  }

  canvas.renderAll();
  const scene = canvas.toObject(CUSTOM_PROPS);
  const thumbnail = canvas.toDataURL({
    format: 'jpeg',
    quality: 0.6,
    multiplier: 400 / Math.max(width, height)
  });
  canvas.dispose();
  return { id: uid(), name, width, height, background, scene, thumbnail };
}

const HALLOWEEN: BlueprintElement[] = [
  { type: 'rect', id: 'bg', x: 0, y: 0, width: 4500, height: 5400, fill: '#1d1426', opacity: 1 },
  { type: 'ellipse', id: 'moon', x: 1500, y: 900, width: 1500, height: 1500, fill: '#ffd166', opacity: 0.9 },
  { type: 'triangle', id: 'tree1', x: 500, y: 3200, width: 900, height: 1400, fill: '#241a2e' },
  { type: 'triangle', id: 'tree2', x: 3100, y: 3400, width: 800, height: 1200, fill: '#241a2e' },
  {
    type: 'text',
    id: 'h',
    text: 'TRICK OR TREAT',
    x: 350,
    y: 2550,
    width: 3800,
    fontSize: 420,
    fontFamily: 'Impact',
    fontWeight: 'bold',
    fill: '#ff8c42',
    align: 'center',
    role: 'headline'
  },
  {
    type: 'text',
    id: 's',
    text: 'raccoon society · est. 1998',
    x: 350,
    y: 3100,
    width: 3800,
    fontSize: 170,
    fontFamily: 'Georgia',
    fontWeight: 'normal',
    fill: '#e8d8b9',
    align: 'center',
    role: 'subhead'
  }
];

const SAMPLES: { project: string; templateId?: string; elements?: BlueprintElement[]; size?: [number, number]; bg?: string }[] = [
  { project: 'Demo — YouTube Thumbnail', templateId: 'yt-bold-beam' },
  { project: 'Demo — Halloween T-Shirt', elements: HALLOWEEN, size: [4500, 5400], bg: '#1d1426' },
  { project: 'Demo — Instagram Post', templateId: 'ig-product-drop' },
  { project: 'Demo — Gig Poster', templateId: 'poster-gig' },
  { project: 'Demo — Business Flyer', templateId: 'flyer-service' }
];

/** Seed original demo projects the first time the app is launched. */
export async function seedSampleProjects(): Promise<void> {
  for (const sample of SAMPLES) {
    const tpl = sample.templateId ? BUILT_IN_TEMPLATES.find((t) => t.id === sample.templateId) : undefined;
    const width = tpl?.width ?? sample.size![0];
    const height = tpl?.height ?? sample.size![1];
    const background = tpl?.background ?? sample.bg ?? '#ffffff';
    const page = await elementsToPage('Page 1', width, height, background, tpl?.elements ?? sample.elements!);
    await bridge.projects.create({
      name: sample.project,
      pages: [page],
      brandKit: { colors: ['#7c5cff', '#ff3d9a', '#ffd166', '#ffffff', '#0d0d14'], fonts: ['Inter'], logos: [] }
    } as any);
  }
}
