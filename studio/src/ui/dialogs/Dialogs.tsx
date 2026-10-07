import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Settings, Keyboard, Plus, LayoutTemplate, Info, Film, Image as ImageIcon, Music2, Check, XCircle, Upload, Save } from 'lucide-react';
import { useUI, toast } from '@/core/uiStore';
import { useProject, usePlayback } from '@/core/store';
import { Modal, SelectRow, Slider, Toggle, pickFiles } from '../common';
import { ProjectSettingsPanel } from '../inspector/ProjectSettingsPanel';
import { SHORTCUTS } from '@/services/shortcuts';
import { SOCIAL_PRESETS } from '@/core/defaults';
import { createProject, openProject, saveCurrent, useProjects } from '@/services/projects';
import { Projects } from '@/services/db';
import { getTemplate, buildTemplateProject, mediaSlotsOf, type TemplateTheme } from '@/library/templates';
import { getTrack, renderMusic, MUSIC } from '@/library/music';
import { audioBufferToWav } from '@/library/synth';
import { importFile, importFiles, useMedia } from '@/engine/MediaManager';
import { FONTS, ensureFont } from '@/library/fonts';
import { projectDuration } from '@/core/commands';
import { formatBytes, formatDuration, downloadBlob } from '@/core/util';
import { exportProject, probeCodecs, estimateSize, recommendedBitrate, hasWebCodecs, hasMediaRecorder, CODECS, type ExportSettings, type ExportProgress, type Container, type VideoCodecId } from '@/engine/Exporter';
import { usePresets } from '@/services/favorites';
import type { MediaAsset } from '@/core/types';

export function Dialogs() {
  const dialog = useUI((s) => s.dialog);
  const close = useUI((s) => s.closeDialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'export':
      return <ExportDialog onClose={close} />;
    case 'settings':
      return (
        <Modal title="Project settings" icon={<Settings size={16} />} onClose={close}>
          <ProjectSettingsPanel />
        </Modal>
      );
    case 'shortcuts':
      return (
        <Modal title="Keyboard shortcuts" icon={<Keyboard size={16} />} onClose={close}>
          <div className="shortcut-grid">
            {SHORTCUTS.map((s) => (
              <React.Fragment key={s.keys}>
                <kbd>{s.keys}</kbd>
                <span>{s.label}</span>
              </React.Fragment>
            ))}
          </div>
        </Modal>
      );
    case 'newProject':
      return <NewProjectDialog onClose={close} />;
    case 'record':
      // recording lives in the left panel (needs to stay mounted while you edit)
      useUI.getState().setLeftPanel('record');
      close();
      return null;
    case 'template':
      return <TemplateDialog templateId={dialog.templateId} onClose={close} />;
    case 'about':
      return (
        <Modal title="About Neurio Studio" icon={<Info size={16} />} onClose={close}>
          <p><b>Neurio Studio</b> is a browser-native video editor: WebGL2 compositing, Web Audio mixing, WebCodecs export, IndexedDB projects. Your media never leaves your device.</p>
          <p className="muted small">Open-source building blocks: React, Zustand, idb, mp4-muxer, webm-muxer, lucide-react, Hugging Face Transformers.js (Whisper), MediaPipe Tasks Vision. Sound effects and music are synthesized in-app (royalty-free by construction). Built-in LUTs and stickers are generated, not licensed assets.</p>
          <p className="muted small">Feature availability depends on your browser: WebCodecs (export), WebGPU (faster captions), getDisplayMedia (screen recording).</p>
        </Modal>
      );
  }
  return null;
}

/* ------------------------------------ New project ------------------------------------ */
function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('Untitled project');
  const [preset, setPreset] = useState('tiktok');
  const [custom, setCustom] = useState<{ w: number; h: number; fps: number } | null>(null);
  const p = SOCIAL_PRESETS.find((x) => x.id === preset)!;
  const create = async () => {
    const proj = await createProject({ name: name.trim() || 'Untitled project', presetId: preset, width: custom?.w, height: custom?.h, fps: custom?.fps ?? p.fps });
    onClose();
    await openProject(proj.id);
  };
  return (
    <Modal title="New project" icon={<Plus size={16} />} onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={create}>Create</button></>}>
      <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && create()} /></label>
      <div className="muted small" style={{ margin: '10px 0 6px' }}>Format</div>
      <div className="preset-grid">
        {SOCIAL_PRESETS.map((s) => (
          <button key={s.id} className={`preset-card ${preset === s.id && !custom ? 'active' : ''}`} onClick={() => { setPreset(s.id); setCustom(null); }}>
            <div className="ratio-box"><div style={{ aspectRatio: `${s.width}/${s.height}` }} /></div>
            <b>{s.label}</b>
            <span>{s.ratio} · {s.width}×{s.height} · {s.fps}fps</span>
          </button>
        ))}
      </div>
      <details style={{ marginTop: 10 }} open={!!custom}>
        <summary className="muted small" style={{ cursor: 'pointer' }}>Custom size & frame rate</summary>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <label className="field"><span>Width</span><input type="number" min={16} step={2} value={custom?.w ?? p.width} onChange={(e) => setCustom({ w: +e.target.value, h: custom?.h ?? p.height, fps: custom?.fps ?? p.fps })} /></label>
          <label className="field"><span>Height</span><input type="number" min={16} step={2} value={custom?.h ?? p.height} onChange={(e) => setCustom({ w: custom?.w ?? p.width, h: +e.target.value, fps: custom?.fps ?? p.fps })} /></label>
          <label className="field"><span>FPS</span><select value={custom?.fps ?? p.fps} onChange={(e) => setCustom({ w: custom?.w ?? p.width, h: custom?.h ?? p.height, fps: +e.target.value })}>{[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
        </div>
      </details>
    </Modal>
  );
}

/* ------------------------------------ Template setup ------------------------------------ */
function TemplateDialog({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const def = getTemplate(templateId);
  const assets = useMedia((s) => s.assets);
  const current = useProject((s) => s.project);
  const [name, setName] = useState(def?.name || 'Template project');
  const [theme, setTheme] = useState<TemplateTheme>(def ? { ...def.theme } : ({} as TemplateTheme));
  const [media, setMedia] = useState<(MediaAsset | null)[]>(() => (def ? mediaSlotsOf(def).map(() => null) : []));
  const [musicId, setMusicId] = useState<string | null>(def ? (def.slots.find((s) => s.kind === 'music') as any)?.musicId ?? null : null);
  const [musicVol, setMusicVol] = useState(0.7);
  const [mode, setMode] = useState<'new' | 'insert'>(current ? 'insert' : 'new');
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const mediaList = useMemo(() => Object.values(assets).filter((a) => (a.type === 'video' || a.type === 'image') && !a.isProxy).sort((a, b) => b.createdAt - a.createdAt), [assets]);
  useEffect(() => {
    if (def) [theme.font, theme.headingFont].forEach((f) => void ensureFont(f));
  }, [theme.font, theme.headingFont]);
  if (!def) return null;
  const slots = mediaSlotsOf(def);
  const fontOpts = FONTS.map((f) => ({ value: f.family, label: f.family }));
  const uploadFor = async (i: number) => {
    const files = await pickFiles('video/*,image/*', true);
    if (!files.length) return;
    const r = await importFiles(files);
    const next = [...media];
    let j = i;
    for (const a of r.assets) if (j < next.length) next[j++] = a;
    setMedia(next);
  };
  const autoFill = async () => {
    const files = await pickFiles('video/*,image/*', true);
    if (!files.length) return;
    const r = await importFiles(files);
    setMedia(slots.map((_, i) => r.assets[i % Math.max(1, r.assets.length)] ?? null));
  };
  const build = async () => {
    setBusy('Preparing…');
    try {
      let musicAsset: MediaAsset | null = null;
      if (musicId) {
        const track = getTrack(musicId);
        if (track) {
          setBusy(`Rendering music "${track.name}"…`);
          const buf = await renderMusic(track, Math.ceil(def.duration / (240 / track.bpm)) * (240 / track.bpm) + 1);
          musicAsset = await importFile(audioBufferToWav(buf), { name: `${track.name} (${track.bpm} BPM).wav`, type: 'audio', tags: ['music', track.genre.toLowerCase()] });
        }
      }
      setBusy('Building project…');
      const proj = buildTemplateProject(def, { name: name.trim() || def.name, theme, media, musicAsset, musicVolume: musicVol });
      if (mode === 'insert' && current) {
        // append template tracks' clips after the current end, onto matching tracks (create when missing)
        const offset = projectDuration(current);
        useProject.getState().apply(`Insert template: ${def.name}`, (p) => {
          let out = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
          const ids = new Set(out.mediaIds);
          for (const tt of proj.tracks) {
            if (!tt.clips.length) continue;
            let target = out.tracks.find((t) => t.kind === tt.kind && !t.locked && !t.clips.some((c) => tt.clips.some((n) => n.start + offset < c.start + c.duration && n.start + n.duration + offset > c.start)));
            if (!target) {
              target = { ...tt, clips: [] };
              out = { ...out, tracks: tt.kind === 'audio' ? [...out.tracks, target] : [target, ...out.tracks] };
            }
            const tid = target.id;
            const added = tt.clips.map((c) => ({ ...c, trackId: tid, start: c.start + offset }));
            out = { ...out, tracks: out.tracks.map((t) => (t.id !== tid ? t : { ...t, clips: [...t.clips, ...added].sort((a, b) => a.start - b.start) })) };
          }
          proj.mediaIds.forEach((m) => ids.add(m));
          return { ...out, mediaIds: [...ids] };
        });
        usePlayback.getState().seek(offset);
        toast('Template inserted', 'success', 'Placeholder clips are labelled — select one and use Replace media.');
        onClose();
      } else {
        await Projects.put(proj);
        await useProjects.getState().refresh();
        onClose();
        await openProject(proj.id);
        toast('Project created from template', 'success', slots.some((_, i) => !media[i]) ? 'Grey placeholder clips show where to drop media (right-click → Replace media).' : undefined);
      }
    } catch (e: any) {
      toast('Could not build template', 'error', String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };
  const preset = SOCIAL_PRESETS.find((p) => p.id === def.presetId);
  return (
    <Modal title={`Use template: ${def.name}`} icon={<LayoutTemplate size={16} />} onClose={onClose} wide footer={<><span className="muted small" style={{ flex: 1 }}>{preset?.label} · {preset?.ratio} · {def.duration}s · every element stays editable</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={build} disabled={!!busy}>{busy ? busy : mode === 'insert' ? 'Insert into project' : 'Create project'}</button></>}>
      <div className="tpl-setup">
        <div className="tpl-setup-preview" style={{ background: def.cover }}>
          <div className="tpl-preview"><span style={{ fontFamily: `"${theme.headingFont}", sans-serif`, fontSize: 26, color: theme.text }}>{def.name}</span></div>
        </div>
        <div className="tpl-setup-form">
          <div className="muted small" style={{ marginBottom: 8 }}>{def.description}</div>
          {current && (
            <div className="seg" style={{ marginBottom: 10 }}>
              <button className={mode === 'insert' ? 'active' : ''} onClick={() => setMode('insert')}>Insert into current project</button>
              <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>New project</button>
            </div>
          )}
          {mode === 'new' && <label className="field"><span>Project name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>}

          <h4 className="muted small" style={{ margin: '12px 0 6px' }}>Media slots ({slots.length}) <button className="link" onClick={autoFill}>Auto-fill from files…</button></h4>
          <div className="slot-list">
            {slots.map((s, i) => (
              <div key={i} className="slot">
                <div className="slot-thumb" onClick={() => setPicking(picking === i ? null : i)} title="Choose from library">
                  {media[i]?.thumbnail ? <img src={media[i]!.thumbnail} alt="" /> : media[i] ? <Film size={16} /> : <ImageIcon size={16} className="muted" />}
                </div>
                <div className="slot-info">
                  <b>{s.label}</b>
                  <span className="muted small">{formatDuration(s.duration)} at {formatDuration(s.start)} · {media[i] ? media[i]!.name : 'placeholder (replace later)'}</span>
                </div>
                <button className="icon-btn sm" title="Upload file" onClick={() => uploadFor(i)}><Upload size={13} /></button>
                {media[i] && <button className="icon-btn sm" title="Clear" onClick={() => setMedia(media.map((m, j) => (j === i ? null : m)))}><XCircle size={13} /></button>}
                {picking === i && (
                  <div className="slot-picker">
                    {!mediaList.length && <div className="muted small" style={{ padding: 8 }}>Library is empty — upload a file instead.</div>}
                    {mediaList.map((a) => (
                      <button key={a.id} onClick={() => { setMedia(media.map((m, j) => (j === i ? a : m))); setPicking(null); }}>
                        {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <Film size={14} />} <span>{a.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <h4 className="muted small" style={{ margin: '12px 0 6px' }}>Look</h4>
          <div className="row" style={{ gap: 8 }}>
            <label className="field"><span>Primary</span><input type="color" value={theme.primary} onChange={(e) => setTheme({ ...theme, primary: e.target.value })} /></label>
            <label className="field"><span>Secondary</span><input type="color" value={theme.secondary} onChange={(e) => setTheme({ ...theme, secondary: e.target.value })} /></label>
            <label className="field"><span>Text</span><input type="color" value={theme.text} onChange={(e) => setTheme({ ...theme, text: e.target.value })} /></label>
          </div>
          <SelectRow label="Heading font" value={theme.headingFont} options={fontOpts} onChange={(v) => setTheme({ ...theme, headingFont: v })} />
          <SelectRow label="Body font" value={theme.font} options={fontOpts} onChange={(v) => setTheme({ ...theme, font: v })} />

          <h4 className="muted small" style={{ margin: '12px 0 6px' }}><Music2 size={12} /> Music</h4>
          <SelectRow label="Track" value={musicId ?? ''} options={[{ value: '', label: 'No music' }, ...MUSIC.map((m) => ({ value: m.id, label: `${m.name} · ${m.genre} · ${m.bpm} BPM` }))]} onChange={(v) => setMusicId(v || null)} />
          {musicId && <Slider label="Music volume" value={musicVol} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setMusicVol} />}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------ Export ------------------------------------ */
const RES = [
  { id: '720', label: '720p (HD)', short: 720 },
  { id: '1080', label: '1080p (Full HD)', short: 1080 },
  { id: '1440', label: '1440p (2K)', short: 1440 },
  { id: '2160', label: '2160p (4K)', short: 2160 },
  { id: 'project', label: 'Project size', short: 0 },
];
function dimsFor(pw: number, ph: number, short: number) {
  if (!short) return { w: pw & ~1, h: ph & ~1 };
  const landscape = pw >= ph;
  const s = Math.min(short, Math.min(pw, ph) * 2); // allow mild upscaling only
  const scale = s / Math.min(pw, ph);
  return { w: Math.round((pw * scale) / 2) * 2, h: Math.round((ph * scale) / 2) * 2, landscape };
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project)!;
  const inPoint = usePlayback((s) => s.inPoint);
  const outPoint = usePlayback((s) => s.outPoint);
  const presets = usePresets((s) => s.presets.filter((p) => p.kind === 'export'));
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('neurio.export') || 'null');
    } catch {
      return null;
    }
  }, []);
  const [res, setRes] = useState<string>(saved?.res || '1080');
  const [fps, setFps] = useState<number>(saved?.fps || project.settings.fps);
  const [container, setContainer] = useState<Container>(saved?.container || 'mp4');
  const [codec, setCodec] = useState<VideoCodecId>(saved?.codec || 'avc');
  const [bitrateMode, setBitrateMode] = useState<'auto' | 'custom'>(saved?.bitrateMode || 'auto');
  const [bitrateMbps, setBitrateMbps] = useState<number>(saved?.bitrateMbps || 10);
  const [audioKbps, setAudioKbps] = useState<number>(saved?.audioKbps || 192);
  const [includeAudio, setIncludeAudio] = useState(saved?.includeAudio ?? true);
  const [useRange, setUseRange] = useState(inPoint !== null && outPoint !== null);
  const [hw, setHw] = useState<'no-preference' | 'prefer-hardware' | 'prefer-software'>(saved?.hw || 'no-preference');
  const [probe, setProbe] = useState<Awaited<ReturnType<typeof probeCodecs>> | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<{ blob: Blob; filename: string; method: string; seconds: number } | null>(null);
  const handle = useRef<{ cancel: () => void }>({ cancel: () => {} });
  const dur = projectDuration(project);
  const { w, h } = dimsFor(project.settings.width, project.settings.height, RES.find((r) => r.id === res)?.short ?? 1080);
  const autoBitrate = recommendedBitrate(w, h, fps, codec);
  const bitrate = bitrateMode === 'auto' ? autoBitrate : Math.round(bitrateMbps * 1e6);
  const range = useRange && inPoint !== null && outPoint !== null ? { start: inPoint, end: outPoint } : { start: 0, end: dur };
  const settings: ExportSettings = { width: w, height: h, fps, container, codec, bitrate, audioBitrate: audioKbps * 1000, includeAudio, range, hardwareAcceleration: hw };
  const size = estimateSize(settings);
  const webcodecs = hasWebCodecs();
  const codecOptions = CODECS.filter((c) => c.container === container);

  useEffect(() => {
    let alive = true;
    setProbe(null);
    if (webcodecs) probeCodecs(w, h, fps, bitrate).then((r) => alive && setProbe(r));
    return () => {
      alive = false;
    };
  }, [w, h, fps, container]);
  useEffect(() => {
    // keep codec valid for container
    if (!codecOptions.some((c) => c.id === codec)) setCodec(codecOptions[0].id);
  }, [container]);
  useEffect(() => {
    localStorage.setItem('neurio.export', JSON.stringify({ res, fps, container, codec, bitrateMode, bitrateMbps, audioKbps, includeAudio, hw }));
  }, [res, fps, container, codec, bitrateMode, bitrateMbps, audioKbps, includeAudio, hw]);

  const supportedFor = (id: VideoCodecId) => probe?.find((p) => p.option.id === id && p.option.container === container);
  const codecOk = !webcodecs || !probe || supportedFor(codec)?.supported;

  const run = async () => {
    if (dur <= 0) return toast('Timeline is empty', 'info');
    setResult(null);
    setProgress({ phase: 'preparing', progress: 0, frame: 0, totalFrames: 0, fps: 0, etaSec: null });
    try {
      await saveCurrent();
      const r = await exportProject(project, settings, setProgress, handle.current as any);
      setResult(r);
      downloadBlob(r.blob, r.filename);
      toast('Export complete', 'success', `${r.filename} · ${formatBytes(r.blob.size)} in ${formatDuration(r.seconds)}`);
    } catch (e: any) {
      if (String(e?.message) !== 'Cancelled') toast('Export failed', 'error', String(e?.message || e));
      setProgress(null);
    }
  };
  const busy = progress && progress.phase !== 'done';

  return (
    <Modal title="Export video" icon={<Download size={16} />} onClose={busy ? () => {} : onClose} wide footer={
      busy ? (
        <><span className="muted small" style={{ flex: 1 }}>{progress!.note || 'Rendering frame by frame — keep this tab open.'}</span><button className="btn" onClick={() => handle.current.cancel()}>Cancel</button></>
      ) : (
        <>
          <button className="btn sm ghost" title="Save these settings as a preset" onClick={() => { const n = prompt('Preset name', `${RES.find((r) => r.id === res)?.label} ${container.toUpperCase()}`); if (n) usePresets.getState().add('export', n, { res, fps, container, codec, bitrateMode, bitrateMbps, audioKbps, includeAudio, hw }); }}><Save size={13} /></button>
          <span className="muted small" style={{ flex: 1 }}>≈ {formatBytes(size)} · {formatDuration(range.end - range.start)} · {Math.round((range.end - range.start) * fps)} frames</span>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={run} disabled={!codecOk || dur <= 0 || (!webcodecs && !hasMediaRecorder())}><Download size={14} /> Export</button>
        </>
      )
    }>
      {!webcodecs && (
        <div className="ai-card" style={{ marginBottom: 10 }}>
          <div className="head"><span className="ico">⚠️</span><div><b>WebCodecs not available</b><div className="muted small">{hasMediaRecorder() ? 'Falling back to realtime recording (WebM only, export takes as long as the video). For fast MP4 export use Chrome, Edge or Safari 16.4+.' : 'This browser cannot export video. Use Chrome, Edge or Safari 16.4+.'}</div></div></div>
        </div>
      )}
      <div className="export-grid">
        <div>
          {presets.length > 0 && <SelectRow label="Preset" value="" options={[{ value: '', label: 'Choose a saved preset…' }, ...presets.map((p) => ({ value: p.id, label: p.name }))]} onChange={(id) => { const p = presets.find((x) => x.id === id); if (!p) return; const d = p.data; setRes(d.res); setFps(d.fps); setContainer(d.container); setCodec(d.codec); setBitrateMode(d.bitrateMode); setBitrateMbps(d.bitrateMbps); setAudioKbps(d.audioKbps); setIncludeAudio(d.includeAudio); setHw(d.hw); }} />}
          <SelectRow label="Resolution" value={res} options={RES.map((r) => ({ value: r.id, label: r.id === 'project' ? `${r.label} (${project.settings.width}×${project.settings.height})` : r.label }))} onChange={setRes} />
          <div className="muted small" style={{ marginTop: -4, marginBottom: 6 }}>Output {w}×{h}{w * h > project.settings.width * project.settings.height ? ' (upscaled from project size)' : ''}</div>
          <SelectRow label="Frame rate" value={String(fps)} options={[24, 25, 30, 50, 60].map((f) => ({ value: String(f), label: `${f} fps${f === project.settings.fps ? ' (project)' : ''}` }))} onChange={(v) => setFps(+v)} />
          <SelectRow label="Format" value={container} options={[{ value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }]} onChange={(v) => setContainer(v as Container)} />
          <div className="muted small" style={{ marginTop: -4, marginBottom: 6 }}>MOV is not produced in-browser; MP4 (H.264) plays everywhere MOV does.</div>
          <SelectRow label="Codec" value={codec} options={codecOptions.map((c) => { const s = supportedFor(c.id); return { value: c.id, label: `${c.label}${webcodecs && probe ? (s?.supported ? '' : ' — not supported here') : ''}` }; })} onChange={(v) => setCodec(v as VideoCodecId)} />
          {webcodecs && probe && !codecOk && <div className="small" style={{ color: 'var(--danger)', marginBottom: 6 }}>This codec can't be encoded by your browser/GPU at {w}×{h}. {supportedFor('avc')?.supported && container === 'mp4' ? 'Try H.264.' : ''}</div>}
          {webcodecs && !probe && <div className="muted small">Checking codec support…</div>}
        </div>
        <div>
          <SelectRow label="Video bitrate" value={bitrateMode} options={[{ value: 'auto', label: `Auto (${(autoBitrate / 1e6).toFixed(0)} Mbps)` }, { value: 'custom', label: 'Custom' }]} onChange={(v) => setBitrateMode(v as any)} />
          {bitrateMode === 'custom' && <Slider label="Mbps" value={bitrateMbps} min={1} max={120} step={1} onChange={setBitrateMbps} />}
          <Toggle label="Include audio" value={includeAudio} onChange={setIncludeAudio} />
          {includeAudio && <SelectRow label="Audio bitrate" value={String(audioKbps)} options={[96, 128, 160, 192, 256, 320].map((k) => ({ value: String(k), label: `${k} kbps` }))} onChange={(v) => setAudioKbps(+v)} />}
          {inPoint !== null && outPoint !== null && <Toggle label={`Export in→out only (${formatDuration(inPoint)}–${formatDuration(outPoint)})`} value={useRange} onChange={setUseRange} />}
          {webcodecs && <SelectRow label="Encoder" value={hw} options={[{ value: 'no-preference', label: 'Auto' }, { value: 'prefer-hardware', label: 'Prefer hardware (GPU)' }, { value: 'prefer-software', label: 'Prefer software' }]} onChange={(v) => setHw(v as any)} />}
          <div className="export-summary">
            <div><span className="muted">Duration</span><b>{formatDuration(range.end - range.start)}</b></div>
            <div><span className="muted">Frames</span><b>{Math.round((range.end - range.start) * fps)}</b></div>
            <div><span className="muted">Est. size</span><b>{formatBytes(size)}</b></div>
            <div><span className="muted">Pipeline</span><b>{webcodecs ? 'WebCodecs' : 'MediaRecorder'}</b></div>
          </div>
        </div>
      </div>

      {progress && (
        <div className="export-progress">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{progress.phase === 'preparing' ? 'Preparing…' : progress.phase === 'audio' ? 'Mixing audio…' : progress.phase === 'video' ? `Encoding frame ${progress.frame} / ${progress.totalFrames}` : progress.phase === 'muxing' ? 'Writing file…' : 'Done'}</span>
            <span className="muted small">{progress.phase === 'video' && progress.fps > 0 ? `${progress.fps.toFixed(1)} fps · ETA ${progress.etaSec !== null ? formatDuration(progress.etaSec) : '—'}` : `${Math.round(progress.progress * 100)}%`}</span>
          </div>
          <div className="progress big"><div style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div>
          {result && (
            <div className="row" style={{ marginTop: 8, gap: 8, alignItems: 'center' }}>
              <Check size={16} color="var(--ok)" />
              <span>{result.filename} · {formatBytes(result.blob.size)} · {result.method === 'webcodecs' ? 'WebCodecs' : 'MediaRecorder (realtime)'} · {formatDuration(result.seconds)}</span>
              <span style={{ flex: 1 }} />
              <button className="btn sm" onClick={() => downloadBlob(result.blob, result.filename)}><Download size={13} /> Download again</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
