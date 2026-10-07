import React, { useEffect, useRef, useState } from 'react';
import { Monitor, Camera, Mic, Square, Circle, Plus, Trash2, Play } from 'lucide-react';
import { PanelHeader } from './LeftPanels';
import { Toggle, SelectRow, Empty } from '../common';
import { importFile, getAudioContext } from '@/engine/MediaManager';
import { addAssetToTimeline } from '@/services/clipActions';
import { useProject, usePlayback } from '@/core/store';
import { toast } from '@/core/uiStore';
import { formatDuration } from '@/core/util';
import * as cmd from '@/core/commands';
import { makeTrack, makeVideoClip } from '@/core/defaults';
import type { MediaAsset } from '@/core/types';

type Mode = 'screen' | 'camera' | 'voice';
interface Take {
  id: string;
  blob: Blob;
  url: string;
  duration: number;
  mode: Mode;
  createdAt: number;
  cameraBlob?: Blob; // PiP companion
}

const supported = {
  screen: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia,
  camera: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  recorder: typeof MediaRecorder !== 'undefined',
};
function pickMime(video: boolean) {
  const c = video ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return c.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export function RecordPanel() {
  const [mode, setMode] = useState<Mode>('screen');
  const [mic, setMic] = useState(true);
  const [systemAudio, setSystemAudio] = useState(true);
  const [pip, setPip] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [quality, setQuality] = useState<'720' | '1080' | 'source'>('1080');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState('');
  const [camId, setCamId] = useState('');
  const [state, setState] = useState<'idle' | 'preparing' | 'countdown' | 'recording'>('idle');
  const [count, setCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [takes, setTakes] = useState<Take[]>([]);
  const [addAtPlayhead, setAddAtPlayhead] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const camRef = useRef<HTMLVideoElement>(null);
  const streams = useRef<MediaStream[]>([]);
  const recs = useRef<{ main: MediaRecorder; cam?: MediaRecorder } | null>(null);
  const chunks = useRef<{ main: Blob[]; cam: Blob[] }>({ main: [], cam: [] });
  const startedAt = useRef(0);
  const raf = useRef(0);
  const analyser = useRef<AnalyserNode | null>(null);
  const audioSrc = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then(setDevices).catch(() => {});
    return () => stopAll();
  }, []);

  const stopAll = () => {
    cancelAnimationFrame(raf.current);
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    try {
      audioSrc.current?.disconnect();
    } catch {}
    audioSrc.current = null;
    analyser.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (camRef.current) camRef.current.srcObject = null;
  };

  const meter = () => {
    const a = analyser.current;
    if (a) {
      const d = new Uint8Array(a.fftSize);
      a.getByteTimeDomainData(d);
      let sum = 0;
      for (let i = 0; i < d.length; i++) {
        const v = (d[i] - 128) / 128;
        sum += v * v;
      }
      setLevel(Math.min(1, Math.sqrt(sum / d.length) * 3));
    }
    if (startedAt.current) setElapsed((performance.now() - startedAt.current) / 1000);
    raf.current = requestAnimationFrame(meter);
  };

  const start = async () => {
    if (!supported.recorder) return toast('Recording unavailable', 'error', 'MediaRecorder is not supported in this browser.');
    setState('preparing');
    try {
      const h = quality === '720' ? 720 : quality === '1080' ? 1080 : undefined;
      let main: MediaStream;
      let cam: MediaStream | null = null;
      let micStream: MediaStream | null = null;
      if ((mode !== 'screen' && mic) || (mode === 'screen' && mic) || mode === 'voice') {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        streams.current.push(micStream);
      }
      if (mode === 'screen') {
        main = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, height: h ? { ideal: h } : undefined } as any, audio: systemAudio });
        streams.current.push(main);
        if (micStream) {
          // mix mic + system audio into one track
          const ctx = getAudioContext();
          const dest = ctx.createMediaStreamDestination();
          const micSrc = ctx.createMediaStreamSource(micStream);
          micSrc.connect(dest);
          if (main.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(main.getAudioTracks())).connect(dest);
          const mixed = new MediaStream([...main.getVideoTracks(), ...dest.stream.getAudioTracks()]);
          main = mixed;
        }
        if (pip && supported.camera) {
          cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: camId ? { exact: camId } : undefined, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
          streams.current.push(cam);
        }
        main.getVideoTracks()[0]?.addEventListener('ended', () => stop());
      } else if (mode === 'camera') {
        cam = null;
        const v = await navigator.mediaDevices.getUserMedia({ video: { deviceId: camId ? { exact: camId } : undefined, width: { ideal: h === 720 ? 1280 : 1920 }, height: { ideal: h ?? 1080 }, frameRate: { ideal: 30 } }, audio: false });
        streams.current.push(v);
        main = new MediaStream([...v.getVideoTracks(), ...(micStream?.getAudioTracks() ?? [])]);
      } else {
        main = micStream!;
      }
      // meter
      const at = main.getAudioTracks();
      if (at.length) {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        audioSrc.current = ctx.createMediaStreamSource(new MediaStream(at));
        analyser.current = ctx.createAnalyser();
        analyser.current.fftSize = 1024;
        audioSrc.current.connect(analyser.current);
      }
      if (videoRef.current && mode !== 'voice') {
        videoRef.current.srcObject = main;
        videoRef.current.muted = true;
        void videoRef.current.play().catch(() => {});
      }
      if (camRef.current && cam) {
        camRef.current.srcObject = cam;
        void camRef.current.play().catch(() => {});
      }
      raf.current = requestAnimationFrame(meter);
      // countdown
      if (countdown > 0) {
        setState('countdown');
        for (let i = countdown; i > 0; i--) {
          setCount(i);
          await new Promise((r) => setTimeout(r, 1000));
          if (!streams.current.length) return; // cancelled
        }
      }
      const mime = pickMime(mode !== 'voice');
      chunks.current = { main: [], cam: [] };
      const mr = new MediaRecorder(main, { mimeType: mime || undefined, videoBitsPerSecond: quality === '720' ? 4_000_000 : 8_000_000 });
      mr.ondataavailable = (e) => e.data.size && chunks.current.main.push(e.data);
      let camRec: MediaRecorder | undefined;
      if (cam) {
        camRec = new MediaRecorder(cam, { mimeType: pickMime(true) || undefined, videoBitsPerSecond: 2_000_000 });
        camRec.ondataavailable = (e) => e.data.size && chunks.current.cam.push(e.data);
      }
      recs.current = { main: mr, cam: camRec };
      mr.start(500);
      camRec?.start(500);
      startedAt.current = performance.now();
      setElapsed(0);
      setState('recording');
    } catch (e: any) {
      stopAll();
      setState('idle');
      const msg = e?.name === 'NotAllowedError' ? 'Permission denied. Allow access to your screen/camera/microphone and try again.' : e?.name === 'NotFoundError' ? 'No matching device found.' : String(e?.message || e);
      toast('Could not start recording', 'error', msg);
    }
  };

  const stop = () => {
    const r = recs.current;
    if (!r) {
      stopAll();
      setState('idle');
      return;
    }
    const duration = (performance.now() - startedAt.current) / 1000;
    const finish = new Promise<void>((resolve) => {
      let pending = 1 + (r.cam ? 1 : 0);
      const done = () => --pending === 0 && resolve();
      r.main.onstop = done;
      if (r.cam) r.cam.onstop = done;
      r.main.state !== 'inactive' ? r.main.stop() : done();
      if (r.cam) r.cam.state !== 'inactive' ? r.cam.stop() : done();
    });
    finish.then(() => {
      const type = r.main.mimeType || (mode === 'voice' ? 'audio/webm' : 'video/webm');
      const blob = new Blob(chunks.current.main, { type });
      const camBlob = chunks.current.cam.length ? new Blob(chunks.current.cam, { type: r.cam?.mimeType || 'video/webm' }) : undefined;
      const take: Take = { id: `take_${Date.now()}`, blob, url: URL.createObjectURL(blob), duration, mode, createdAt: Date.now(), cameraBlob: camBlob };
      setTakes((t) => [take, ...t]);
      recs.current = null;
      startedAt.current = 0;
      stopAll();
      setState('idle');
      if (blob.size === 0) toast('Recording was empty', 'error');
    });
  };

  const addTake = async (t: Take) => {
    try {
      const ext = t.blob.type.includes('mp4') ? 'mp4' : t.mode === 'voice' ? 'webm' : 'webm';
      const name = `${t.mode === 'screen' ? 'Screen recording' : t.mode === 'camera' ? 'Camera recording' : 'Voice take'} ${new Date(t.createdAt).toLocaleTimeString()}.${ext}`;
      const asset = await importFile(t.blob, { name, type: t.mode === 'voice' ? 'audio' : 'video', tags: ['recording', t.mode] });
      const at = addAtPlayhead ? usePlayback.getState().time : undefined;
      // WebM from MediaRecorder often lacks a duration header → fall back to the measured one
      const fixed: MediaAsset = asset.duration > 0 && isFinite(asset.duration) ? asset : { ...asset, duration: t.duration };
      if (fixed !== asset) {
        const { updateAsset } = await import('@/engine/MediaManager');
        await updateAsset(asset.id, { duration: t.duration });
      }
      const clip = addAssetToTimeline(fixed, { at });
      if (t.cameraBlob && clip) {
        const camAsset = await importFile(t.cameraBlob, { name: `Camera PiP ${new Date(t.createdAt).toLocaleTimeString()}.webm`, type: 'video', tags: ['recording', 'camera'] });
        const camFixed = camAsset.duration > 0 ? camAsset : { ...camAsset, duration: t.duration };
        // place camera on an overlay track, bottom-right, 28% size
        useProject.getState().apply('Add camera PiP', (p) => {
          let proj = p;
          let overlay = proj.tracks.find((tr) => tr.kind === 'overlay');
          if (!overlay) {
            overlay = makeTrack('overlay', 'PiP');
            proj = { ...proj, tracks: [overlay, ...proj.tracks] };
          }
          const c = makeVideoClip({ trackId: overlay.id, mediaId: camFixed.id, name: camFixed.name, start: clip.start, duration: Math.min(camFixed.duration || t.duration, clip.duration), hasAudio: false });
          c.transform.scale = { value: { x: 0.28, y: 0.28 } };
          c.transform.position = { value: { x: proj.settings.width * 0.34, y: proj.settings.height * 0.34 } };
          return cmd.addClip(proj, c, overlay.id).project;
        });
      }
      toast('Recording added to timeline', 'success');
    } catch (e) {
      toast('Could not import recording', 'error', String((e as Error).message || e));
    }
  };

  const unavailable = !supported.recorder || (mode === 'screen' && !supported.screen) || (mode !== 'screen' && !supported.camera);

  return (
    <>
      <PanelHeader title="Record" />
      <div className="panel-body scroll">
        <div className="seg" style={{ width: '100%' }}>
          <button className={mode === 'screen' ? 'active' : ''} onClick={() => setMode('screen')} disabled={state !== 'idle'}><Monitor size={14} /> Screen</button>
          <button className={mode === 'camera' ? 'active' : ''} onClick={() => setMode('camera')} disabled={state !== 'idle'}><Camera size={14} /> Camera</button>
          <button className={mode === 'voice' ? 'active' : ''} onClick={() => setMode('voice')} disabled={state !== 'idle'}><Mic size={14} /> Voice</button>
        </div>

        {unavailable && (
          <div className="ai-card" style={{ marginTop: 10 }}>
            <div className="head"><span className="ico">⚠️</span> <b>Unavailable in this browser</b></div>
            <div className="muted small">{!supported.recorder ? 'MediaRecorder API is missing.' : mode === 'screen' ? 'Screen capture (getDisplayMedia) is not supported here — try Chrome, Edge or Firefox on desktop, served over HTTPS.' : 'Camera/microphone access (getUserMedia) is not available — the page must be served over HTTPS or localhost.'}</div>
          </div>
        )}

        <div className="recorder-preview" style={{ marginTop: 10, position: 'relative', display: mode === 'voice' ? 'none' : undefined }}>
          <video ref={videoRef} playsInline muted />
          {pip && mode === 'screen' && <video ref={camRef} playsInline muted style={{ position: 'absolute', right: 8, bottom: 8, width: '28%', borderRadius: 8, border: '1px solid var(--line)', background: '#000' }} />}
          {state === 'countdown' && <div className="rec-count">{count}</div>}
          {state === 'recording' && <div className="rec-dot" title="Recording" />}
          {state === 'idle' && !takes.length && <div className="muted small" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{mode === 'screen' ? 'Your screen appears here' : 'Camera preview'}</div>}
        </div>
        <div className="level-meter" style={{ marginTop: 8 }}><div style={{ width: `${Math.round(level * 100)}%` }} /></div>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
          <span className="muted small">{state === 'recording' ? `● REC ${formatDuration(elapsed)}` : state === 'preparing' ? 'Preparing…' : state === 'countdown' ? 'Starting…' : 'Ready'}</span>
          <span className="muted small">{quality === 'source' ? 'Source res' : `${quality}p`} · {pickMime(mode !== 'voice').split(';')[0] || 'webm'}</span>
        </div>

        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          {state === 'recording' ? (
            <button className="btn primary" style={{ flex: 1 }} onClick={stop}><Square size={14} /> Stop</button>
          ) : state === 'idle' ? (
            <button className="btn primary" style={{ flex: 1 }} onClick={start} disabled={unavailable}><Circle size={14} fill="currentColor" /> Start recording</button>
          ) : (
            <button className="btn" style={{ flex: 1 }} onClick={() => { stopAll(); recs.current = null; setState('idle'); }}>Cancel</button>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          {mode !== 'voice' && <SelectRow label="Quality" value={quality} options={[{ value: '720', label: '720p' }, { value: '1080', label: '1080p' }, { value: 'source', label: 'Source' }]} onChange={(v) => setQuality(v as any)} />}
          <SelectRow label="Countdown" value={String(countdown)} options={[0, 3, 5, 10].map((n) => ({ value: String(n), label: n ? `${n}s` : 'Off' }))} onChange={(v) => setCountdown(+v)} />
          {mode !== 'voice' && <Toggle label="Record microphone" value={mic} onChange={setMic} />}
          {mode === 'screen' && <Toggle label="System / tab audio" value={systemAudio} onChange={setSystemAudio} hint="Browser asks for it in the share dialog" />}
          {mode === 'screen' && supported.camera && <Toggle label="Camera picture-in-picture" value={pip} onChange={setPip} hint="Recorded as a separate overlay clip" />}
          {(mic || mode === 'voice') && devices.some((d) => d.kind === 'audioinput') && <SelectRow label="Microphone" value={micId} options={[{ value: '', label: 'Default' }, ...devices.filter((d) => d.kind === 'audioinput').map((d) => ({ value: d.deviceId, label: d.label || 'Microphone' }))]} onChange={setMicId} />}
          {(mode === 'camera' || pip) && devices.some((d) => d.kind === 'videoinput') && <SelectRow label="Camera" value={camId} options={[{ value: '', label: 'Default' }, ...devices.filter((d) => d.kind === 'videoinput').map((d) => ({ value: d.deviceId, label: d.label || 'Camera' }))]} onChange={setCamId} />}
          <Toggle label="Insert at playhead" value={addAtPlayhead} onChange={setAddAtPlayhead} hint="Off = append at the end of the track" />
        </div>

        <h4 className="muted small" style={{ margin: '14px 0 6px' }}>Takes ({takes.length})</h4>
        {!takes.length && <Empty icon={<Mic />}>Recordings appear here. Keep the best take and add it to the timeline.</Empty>}
        {takes.map((t) => (
          <div key={t.id} className="list-item">
            <span className="ico">{t.mode === 'screen' ? <Monitor size={14} /> : t.mode === 'camera' ? <Camera size={14} /> : <Mic size={14} />}</span>
            <div className="info">
              <div className="title">{t.mode === 'voice' ? 'Voice take' : t.mode === 'screen' ? 'Screen' : 'Camera'} · {formatDuration(t.duration)}</div>
              <div className="sub">{new Date(t.createdAt).toLocaleTimeString()} · {(t.blob.size / 1e6).toFixed(1)} MB{t.cameraBlob ? ' · +PiP' : ''}</div>
              {t.mode === 'voice' ? <audio src={t.url} controls style={{ width: '100%', height: 28, marginTop: 4 }} /> : null}
            </div>
            <div className="acts">
              {t.mode !== 'voice' && <button className="icon-btn sm" title="Preview" onClick={() => window.open(t.url, '_blank')}><Play size={13} /></button>}
              <button className="icon-btn sm" title="Add to timeline" onClick={() => addTake(t)}><Plus size={13} /></button>
              <button className="icon-btn sm" title="Discard" onClick={() => { URL.revokeObjectURL(t.url); setTakes((x) => x.filter((y) => y.id !== t.id)); }}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
