import * as fabric from 'fabric';
import { jsPDF } from 'jspdf';
import type { PageDoc } from '@/types';
import { bridge } from './bridge';

export interface ExportOptions {
  format: 'png' | 'jpeg' | 'webp' | 'pdf';
  scale: number;
  quality: number;
  transparent: boolean;
  pageIndexes: number[];
  width?: number | null;
  height?: number | null;
}

/** Render any page off-screen so background pages export without being opened. */
export async function renderPage(page: PageDoc, opts: ExportOptions): Promise<string> {
  const el = document.createElement('canvas');
  const canvas = new fabric.StaticCanvas(el, { width: page.width, height: page.height });
  await canvas.loadFromJSON((page.scene as any) ?? { objects: [] });
  canvas.backgroundColor = opts.transparent && opts.format !== 'jpeg' ? '' : (page.background ?? '#ffffff');
  canvas.renderAll();

  let multiplier = opts.scale;
  if (opts.width) multiplier = opts.width / page.width;
  else if (opts.height) multiplier = opts.height / page.height;

  const format = opts.format === 'pdf' ? 'png' : opts.format;
  const url = canvas.toDataURL({ format, quality: opts.quality, multiplier, enableRetinaScaling: false });
  canvas.dispose();
  return url;
}

const stripHeader = (dataUrl: string) => dataUrl.split(',')[1] ?? '';

export async function exportPages(
  projectName: string,
  pages: PageDoc[],
  opts: ExportOptions
): Promise<{ saved: string[]; skipped: number }> {
  const selected = opts.pageIndexes.map((i) => pages[i]).filter(Boolean);
  if (!selected.length) throw new Error('Select at least one page to export.');
  const safeName = projectName.replace(/[^\w\s-]/g, '').trim() || 'design';
  const saved: string[] = [];

  if (opts.format === 'pdf') {
    let pdf: jsPDF | null = null;
    for (const page of selected) {
      const url = await renderPage(page, opts);
      const orientation = page.width >= page.height ? 'landscape' : 'portrait';
      if (!pdf) {
        pdf = new jsPDF({ orientation, unit: 'px', format: [page.width, page.height], compress: true });
      } else {
        pdf.addPage([page.width, page.height], orientation);
      }
      pdf.addImage(url, 'PNG', 0, 0, page.width, page.height, undefined, 'FAST');
    }
    const base64 = pdf!.output('datauristring').split(',')[1];
    const file = await bridge.files.exportBinary(`${safeName}.pdf`, base64, 'pdf');
    if (file) saved.push(file);
    return { saved, skipped: 0 };
  }

  let skipped = 0;
  for (const [i, page] of selected.entries()) {
    const url = await renderPage(page, opts);
    const ext = opts.format === 'jpeg' ? 'jpg' : opts.format;
    const name = selected.length > 1 ? `${safeName}-${i + 1}.${ext}` : `${safeName}.${ext}`;
    const file = await bridge.files.exportBinary(name, stripHeader(url), opts.format);
    if (file) saved.push(file);
    else skipped++;
  }
  return { saved, skipped };
}

export const QUICK_PRESETS = [
  { label: '1080 × 1080', width: 1080, height: 1080 },
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: '1080 × 1920', width: 1080, height: 1920 },
  { label: '1280 × 720', width: 1280, height: 720 },
  { label: '4500 × 5400', width: 4500, height: 5400 }
];
