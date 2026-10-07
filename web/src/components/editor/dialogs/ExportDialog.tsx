'use client';

import { useMemo, useState } from 'react';
import { Download, FileImage, FileText, Film, FileCode, Loader2, Layers, Info } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { Button, Field, Modal, Segmented, Select, Slider, Toggle, ProgressBar } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import {
  downloadBlob,
  exportDocImages,
  exportDocZip,
  exportGif,
  exportPageImage,
  exportPageSvg,
  exportPdf,
  exportVideo,
  safeFilename,
  supportedVideoFormats,
  type ImageFormat,
} from '@/engine/export';

type Format = ImageFormat | 'svg' | 'pdf' | 'zip' | 'gif' | 'video';

const FORMATS: { id: Format; label: string; hint: string; icon: any }[] = [
  { id: 'png', label: 'PNG', hint: 'Lossless · transparent background supported', icon: FileImage },
  { id: 'jpg', label: 'JPG', hint: 'Smaller files · no transparency', icon: FileImage },
  { id: 'webp', label: 'WebP', hint: 'Modern web format', icon: FileImage },
  { id: 'svg', label: 'SVG', hint: 'Vector · editable in other tools', icon: FileCode },
  { id: 'pdf', label: 'PDF', hint: 'Print-ready, multi-page', icon: FileText },
  { id: 'zip', label: 'ZIP', hint: 'One image file per page', icon: Layers },
  { id: 'gif', label: 'GIF', hint: 'Animated preview of page 1', icon: Film },
  { id: 'video', label: 'Video', hint: 'Timeline render (WebM/MP4)', icon: Film },
];

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const toast = useToast();
  const [format, setFormat] = useState<Format>('png');
  const [scale, setScale] = useState(2);
  const [quality, setQuality] = useState(92);
  const [transparent, setTransparent] = useState(false);
  const [pages, setPages] = useState<'all' | 'current'>('all');
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const videoFormats = useMemo(() => supportedVideoFormats(), []);
  const [videoFormat, setVideoFormat] = useState<'webm' | 'mp4'>('webm');
  const [fps, setFps] = useState(30);

  const pageIndexes = pages === 'all' ? doc.pages.map((_, index) => index) : [useEditor.getState().activePage];

  async function run() {
    setBusy(true);
    setProgress(0);
    try {
      const name = safeFilename(doc.title);

      if (format === 'png' || format === 'jpg' || format === 'webp') {
        if (pageIndexes.length === 1) {
          const page = doc.pages[pageIndexes[0]!]!;
          const blob = await exportPageImage(page, { format, scale, quality: quality / 100, transparent });
          downloadBlob(blob, `${name}.${format}`);
        } else {
          const blob = await exportDocZip(doc, { format, scale, quality: quality / 100, transparent, pages: pageIndexes });
          downloadBlob(blob, `${name}.zip`);
        }
      } else if (format === 'svg') {
        const page = doc.pages[pageIndexes[0]!]!;
        downloadBlob(await exportPageSvg(page), `${name}.svg`);
      } else if (format === 'pdf') {
        setProgress(10);
        const blob = await exportPdf(doc, { pages: pageIndexes, scale });
        setProgress(100);
        downloadBlob(blob, `${name}.pdf`);
      } else if (format === 'zip') {
        const blob = await exportDocZip(doc, { format: 'png', scale, quality: quality / 100, pages: pageIndexes });
        downloadBlob(blob, `${name}.zip`);
      } else if (format === 'gif') {
        const blob = await exportGif(doc, { fps: 12, scale: Math.max(0.25, scale / 4), duration: 4000, onProgress: setProgress });
        downloadBlob(blob, `${name}.gif`);
      } else if (format === 'video') {
        const blob = await exportVideo(doc, {
          fps,
          scale: Math.min(2, Math.max(0.5, scale / 2)),
          quality: scale >= 2 ? 'high' : 'standard',
          includeAudio: true,
          format: videoFormat,
          onProgress: setProgress,
        });
        downloadBlob(blob, `${name}.${videoFormat === 'mp4' ? 'mp4' : 'webm'}`);
      } else {
        const blobs = await exportDocImages(doc, { format: 'png', scale, pages: pageIndexes });
        blobs.forEach((blob, index) => downloadBlob(blob, `${name}-${index + 1}.png`));
      }

      toast.success('Export complete', `${format.toUpperCase()} · ${scale}×`);
      onClose();
    } catch (error) {
      toast.error('Export failed', (error as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const estimated = useMemo(() => {
    const page = doc.pages[0];
    if (!page) return '';
    return `${Math.round(page.width * scale)} × ${Math.round(page.height * scale)} px`;
  }, [doc.pages, scale]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export design"
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} icon={<Download size={14} />} onClick={run}>
            Export
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {FORMATS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFormat(item.id)}
              className="rounded-xl p-3 text-start transition-transform hover:-translate-y-0.5"
              style={{
                border: `1px solid ${format === item.id ? 'var(--brand)' : 'var(--border)'}`,
                background: format === item.id ? 'var(--brand-soft)' : 'var(--bg-panel)',
              }}
            >
              <item.icon size={16} style={{ color: format === item.id ? 'var(--brand)' : 'var(--text-muted)' }} />
              <div className="mt-1.5 text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
                {item.label}
              </div>
              <div className="text-[10.5px] leading-tight" style={{ color: 'var(--text-faint)' }}>
                {item.hint}
              </div>
            </button>
          ))}
        </div>

        {(format === 'png' || format === 'jpg' || format === 'webp' || format === 'pdf' || format === 'zip' || format === 'gif' || format === 'video') ? (
          <Field label={`Resolution — ${estimated}`}>
            <Segmented
              value={String(scale)}
              onChange={(value) => setScale(Number(value))}
              options={[
                { value: '1', label: '1×' },
                { value: '2', label: '2×' },
                { value: '3', label: '3×' },
                { value: '4', label: '4×' },
              ]}
            />
          </Field>
        ) : null}

        {format === 'png' ? (
          <label className="flex items-center justify-between text-[13px]" style={{ color: 'var(--text-muted)' }}>
            <span>Transparent background</span>
            <Toggle checked={transparent} onChange={setTransparent} label="Transparent background" />
          </label>
        ) : null}

        {(format === 'jpg' || format === 'webp') ? (
          <Field label="Quality">
            <Slider value={quality} min={40} max={100} onChange={setQuality} suffix="%" />
          </Field>
        ) : null}

        {doc.pages.length > 1 && format !== 'video' && format !== 'gif' ? (
          <Field label="Pages">
            <Segmented
              value={pages}
              onChange={setPages}
              options={[
                { value: 'all', label: `All pages (${doc.pages.length})` },
                { value: 'current', label: 'Current page' },
              ]}
            />
          </Field>
        ) : null}

        {format === 'video' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Format">
              <Select
                value={videoFormat}
                onChange={(value) => setVideoFormat(value as 'webm' | 'mp4')}
                options={
                  videoFormats.length
                    ? videoFormats.map((item) => ({ value: item.extension as 'webm' | 'mp4', label: item.label }))
                    : [{ value: 'webm', label: 'WebM' }]
                }
              />
            </Field>
            <Field label="Frame rate">
              <Select
                value={String(fps)}
                onChange={(value) => setFps(Number(value))}
                options={[
                  { value: '24', label: '24 fps' },
                  { value: '30', label: '30 fps' },
                  { value: '60', label: '60 fps' },
                ]}
              />
            </Field>
            {!videoFormats.length ? (
              <p className="col-span-2 text-[11.5px]" style={{ color: 'var(--warning)' }}>
                This browser does not support in-browser recording. Use a Chromium-based browser or Safari to render video.
              </p>
            ) : null}
          </div>
        ) : null}

        {progress !== null ? (
          <ProgressBar value={progress} label={format === 'video' ? 'Rendering frames' : 'Preparing export'} />
        ) : null}

        <div className="flex items-start gap-2 rounded-xl p-3 text-[11.5px] leading-relaxed" style={{ background: 'var(--bg-panel-2)', color: 'var(--text-muted)' }}>
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Exports are rendered from the live document with the same engine that paints the canvas, so what you see is what
            you get — at up to 4× resolution. Video is encoded in your browser; no upload is required.
          </span>
        </div>

        {busy ? (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={13} className="animate-spin" /> Rendering…
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
