import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Music2, Play, Pause, Plus, Upload, Volume2, Square } from 'lucide-react';
import { PanelHeader } from './LeftPanels';
import { SearchBox, Chips, FavButton, Empty } from '../common';
import { useFavorites } from '@/services/favorites';
import { SFX, SFX_CATEGORIES, sfxUrl, type SfxDef, type SfxCategory, type SfxSource } from '@/library/sfx';
import { MUSIC, GENRES, MOODS, renderMusic, type MusicTrack, type Genre, type Mood } from '@/library/music';
import { renderRecipe, audioBufferToWav } from '@/library/synth';
import { importFile, useMedia, getAudioContext } from '@/engine/MediaManager';
import { addAssetToTimeline } from '@/services/clipActions';
import { toast } from '@/core/uiStore';
import { formatDuration } from '@/core/util';
import { pickFiles } from '../common';
import { importFiles } from '@/engine/MediaManager';

type Tab = 'sfx' | 'music' | 'imported';

/* ---------- tiny preview player (shared by both libraries) ---------- */
let currentSrc: AudioBufferSourceNode | null = null;
let currentKey: string | null = null;
const listeners = new Set<() => void>();
function stopPreview() {
  try {
    currentSrc?.stop();
  } catch {}
  currentSrc = null;
  currentKey = null;
  listeners.forEach((l) => l());
}
async function playBuffer(key: string, buf: AudioBuffer) {
  stopPreview();
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.onended = () => {
    if (currentSrc === src) {
      currentSrc = null;
      currentKey = null;
      listeners.forEach((l) => l());
    }
  };
  src.start();
  currentSrc = src;
  currentKey = key;
  listeners.forEach((l) => l());
}
function usePreviewKey() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
      stopPreview();
    };
  }, []);
  return currentKey;
}

const sfxCache = new Map<string, Promise<AudioBuffer>>();
const sfxBlobCache = new Map<string, Promise<Blob>>();
/** Fetches the original sample file (kept as-is so the timeline asset is the real .ogg). */
const getSfxBlob = (s: SfxDef) => {
  const url = sfxUrl(s);
  if (!url) throw new Error('Not a sample sound');
  if (!sfxBlobCache.has(s.id))
    sfxBlobCache.set(
      s.id,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Sound file missing (${r.status})`);
        return r.blob();
      }),
    );
  return sfxBlobCache.get(s.id)!;
};
const getSfxBuffer = (s: SfxDef) => {
  if (!sfxCache.has(s.id)) {
    if (s.source === 'sample') {
      sfxCache.set(
        s.id,
        getSfxBlob(s)
          .then((b) => b.arrayBuffer())
          .then((ab) => getAudioContext().decodeAudioData(ab))
          .catch((e) => {
            sfxCache.delete(s.id);
            throw new Error(`Could not decode this sound (${(e as Error).message || 'Ogg Vorbis not supported by this browser'})`);
          }),
      );
    } else sfxCache.set(s.id, renderRecipe(s.recipe!));
  }
  return sfxCache.get(s.id)!;
};
const musicCache = new Map<string, Promise<AudioBuffer>>();
const getMusicBuffer = (m: MusicTrack, seconds: number) => {
  const k = `${m.id}:${seconds}`;
  if (!musicCache.has(k)) musicCache.set(k, renderMusic(m, seconds));
  return musicCache.get(k)!;
};

/** Small waveform drawn from an AudioBuffer (only after it has been rendered). */
function Wave({ buf, color = 'var(--accent)' }: { buf: AudioBuffer | null; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !buf) return;
    const w = (c.width = c.clientWidth * 2), h = (c.height = c.clientHeight * 2);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    const d = buf.getChannelData(0);
    const n = 100;
    const step = Math.floor(d.length / n);
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      let p = 0;
      for (let j = 0; j < step; j += 16) p = Math.max(p, Math.abs(d[i * step + j]));
      const bh = Math.max(2, p * h);
      g.fillRect((i / n) * w, (h - bh) / 2, (w / n) * 0.6, bh);
    }
  }, [buf, color]);
  return <canvas ref={ref} style={{ width: '100%', height: 22, display: 'block', opacity: buf ? 1 : 0.3 }} />;
}

export function AudioLibraryPanel() {
  const [tab, setTab] = useState<Tab>('sfx');
  return (
    <>
      <PanelHeader title="Audio" sub="All royalty-free">
        <div className="tabs" style={{ marginLeft: 8 }}>
          <button className={tab === 'sfx' ? 'active' : ''} onClick={() => setTab('sfx')}>SFX</button>
          <button className={tab === 'music' ? 'active' : ''} onClick={() => setTab('music')}>Music</button>
          <button className={tab === 'imported' ? 'active' : ''} onClick={() => setTab('imported')}>Imported</button>
        </div>
      </PanelHeader>
      {tab === 'sfx' && <SfxTab />}
      {tab === 'music' && <MusicTab />}
      {tab === 'imported' && <ImportedTab />}
    </>
  );
}

/* ------------------------------ SFX ------------------------------ */
function SfxTab() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<SfxCategory | 'Favorites' | null>(null);
  const [source, setSource] = useState<SfxSource | 'all'>('all');
  const [limit, setLimit] = useState(150);
  const fav = useFavorites();
  const playing = usePreviewKey();
  const [bufs, setBufs] = useState<Record<string, AudioBuffer>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const words = t.split(/\s+/).filter(Boolean);
    return SFX.filter((s) => source === 'all' || s.source === source)
      .filter((s) => (cat === null ? true : cat === 'Favorites' ? fav.is('sfx', s.id) : s.category === cat))
      .filter((s) => !words.length || words.every((w) => s.name.toLowerCase().includes(w) || s.tags.some((x) => x.includes(w)) || s.category.toLowerCase().includes(w)));
  }, [q, cat, source, fav.favs]);
  useEffect(() => setLimit(150), [q, cat, source]);
  const list = filtered.length > limit ? filtered.slice(0, limit) : filtered;
  const counts = useMemo(() => ({ sample: SFX.filter((s) => s.source === 'sample').length, synth: SFX.filter((s) => s.source === 'synth').length }), []);

  const preview = async (s: SfxDef) => {
    if (playing === s.id) return stopPreview();
    try {
      const b = await getSfxBuffer(s);
      setBufs((m) => (m[s.id] ? m : { ...m, [s.id]: b }));
      void playBuffer(s.id, b);
    } catch (e) {
      toast('Could not preview sound', 'error', String((e as Error).message || e));
    }
  };
  const add = async (s: SfxDef) => {
    setBusy(s.id);
    try {
      const tags = ['sfx', s.category.toLowerCase(), s.source === 'sample' ? 'kenney' : 'synth'];
      let asset;
      if (s.source === 'sample') {
        // Real sample: import the original file untouched (small .ogg) so the asset stays lossless-to-source.
        const blob = await getSfxBlob(s);
        const safe = s.name.replace(/[^\w\s'"!-]+/g, '').trim();
        asset = await importFile(blob, { name: `${safe}.ogg`, type: 'audio', tags });
      } else {
        const b = await getSfxBuffer(s);
        asset = await importFile(audioBufferToWav(b), { name: `${s.name}.wav`, type: 'audio', tags });
      }
      addAssetToTimeline(asset);
      fav.touch('sfx', s.id);
    } catch (e) {
      toast('Could not add sound', 'error', String((e as Error).message || e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="panel-body" style={{ paddingBottom: 0, flex: '0 0 auto' }}>
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${SFX.length}+ sound effects…`} />
        <div className="tabs" style={{ marginBottom: 6 }}>
          <button className={source === 'all' ? 'active' : ''} onClick={() => setSource('all')} title="Real recordings and synthesized sounds">All</button>
          <button className={source === 'sample' ? 'active' : ''} onClick={() => setSource('sample')} title="Real recorded / produced samples by Kenney (CC0 public domain)">Recorded ({counts.sample})</button>
          <button className={source === 'synth' ? 'active' : ''} onClick={() => setSource('synth')} title="Generated in-app with Web Audio">Synth ({counts.synth})</button>
        </div>
        <Chips items={['Favorites', ...SFX_CATEGORIES] as (SfxCategory | 'Favorites')[]} value={cat} onChange={setCat} all="All" />
      </div>
      <div className="panel-body flush scroll" style={{ flex: 1 }}>
        {!list.length && <Empty icon={<Volume2 />}>No sounds match.</Empty>}
        {!!list.length && <div className="hint" style={{ padding: '4px 12px' }}>{filtered.length} sounds · all royalty-free (Kenney CC0 + in-app synth)</div>}
        {list.map((s) => (
          <div key={s.id} className={`list-item ${playing === s.id ? 'active' : ''}`} onDoubleClick={() => add(s)} title="Double-click to add to timeline">
            <button className="icon-btn" onClick={() => preview(s)} title={playing === s.id ? 'Stop' : 'Preview'}>
              {playing === s.id ? <Square size={14} /> : <Play size={14} />}
            </button>
            <div className="info">
              <div className="title">{s.name}</div>
              <div className="sub">
                {s.category} · {s.duration < 10 ? `${s.duration.toFixed(1)}s` : formatDuration(s.duration)} · {s.source === 'sample' ? 'recorded' : 'synth'}
              </div>
              {bufs[s.id] && <Wave buf={bufs[s.id]} />}
            </div>
            <div className="acts">
              <FavButton on={fav.is('sfx', s.id)} onToggle={() => fav.toggle('sfx', s.id)} />
              <button className="icon-btn sm" onClick={() => add(s)} disabled={busy === s.id} title="Add to timeline at playhead">
                <Plus size={14} />
              </button>
            </div>
          </div>
        ))}
        {filtered.length > limit && (
          <div style={{ padding: 10, textAlign: 'center' }}>
            <button className="btn" onClick={() => setLimit((n) => n + 200)}>Show more ({filtered.length - limit} remaining)</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------ Music ------------------------------ */
function MusicTab() {
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState<Genre | 'Favorites' | null>(null);
  const [mood, setMood] = useState<Mood | null>(null);
  const [length, setLength] = useState(30);
  const fav = useFavorites();
  const playing = usePreviewKey();
  const [bufs, setBufs] = useState<Record<string, AudioBuffer>>({});
  const [rendering, setRendering] = useState<Record<string, number>>({});
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return MUSIC.filter((m) => (genre === null ? true : genre === 'Favorites' ? fav.is('music', m.id) : m.genre === genre))
      .filter((m) => !mood || m.mood.includes(mood))
      .filter((m) => !t || m.name.toLowerCase().includes(t) || m.genre.toLowerCase().includes(t) || m.tags.some((x) => x.includes(t)) || m.mood.some((x) => x.toLowerCase().includes(t)));
  }, [q, genre, mood, fav.favs]);

  const ensure = async (m: MusicTrack, seconds: number) => {
    const key = `${m.id}:${seconds}`;
    if (bufs[key]) return bufs[key];
    setRendering((r) => ({ ...r, [m.id]: 0.01 }));
    try {
      const b = await getMusicBuffer(m, seconds);
      setBufs((x) => ({ ...x, [key]: b }));
      return b;
    } finally {
      setRendering((r) => {
        const n = { ...r };
        delete n[m.id];
        return n;
      });
    }
  };
  const preview = async (m: MusicTrack) => {
    if (playing === m.id) return stopPreview();
    const b = await ensure(m, 16); // short preview render (fast), full length when adding
    void playBuffer(m.id, b);
  };
  const add = async (m: MusicTrack) => {
    try {
      const b = await ensure(m, length);
      const blob = audioBufferToWav(b);
      const asset = await importFile(blob, { name: `${m.name} (${m.bpm} BPM, ${length}s).wav`, type: 'audio', tags: ['music', m.genre.toLowerCase(), ...m.mood.map((x) => x.toLowerCase())] });
      addAssetToTimeline(asset);
      fav.touch('music', m.id);
      toast(`Added "${m.name}"`, 'success', 'Trim it on the timeline or loop by duplicating (Ctrl+D).');
    } catch (e) {
      toast('Could not add track', 'error', String((e as Error).message || e));
    }
  };
  return (
    <>
      <div className="panel-body" style={{ paddingBottom: 0, flex: '0 0 auto' }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search by genre, mood, BPM…" />
        <Chips items={['Favorites', ...GENRES] as (Genre | 'Favorites')[]} value={genre} onChange={setGenre} all="All genres" />
        <Chips items={MOODS} value={mood} onChange={setMood} all="Any mood" />
        <div className="row" style={{ gap: 8, alignItems: 'center', margin: '6px 0' }}>
          <span className="muted small">Length</span>
          <div className="seg">
            {[15, 30, 60, 120].map((s) => (
              <button key={s} className={length === s ? 'active' : ''} onClick={() => setLength(s)}>
                {s}s
              </button>
            ))}
          </div>
          <span className="muted small" style={{ marginLeft: 'auto' }}>Generated royalty-free</span>
        </div>
      </div>
      <div className="panel-body flush scroll" style={{ flex: 1 }}>
        {!list.length && <Empty icon={<Music2 />}>No tracks match.</Empty>}
        {list.map((m) => {
          const prog = rendering[m.id];
          return (
            <div key={m.id} className={`list-item ${playing === m.id ? 'active' : ''}`} onDoubleClick={() => add(m)} title="Double-click to add to timeline">
              <button className="icon-btn" onClick={() => preview(m)} title={playing === m.id ? 'Stop' : 'Preview'} disabled={prog !== undefined}>
                {prog !== undefined ? <span className="spinner" style={{ width: 12, height: 12 }} /> : playing === m.id ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <div className="info">
                <div className="title">{m.name}</div>
                <div className="sub">
                  {m.genre} · {m.bpm} BPM · {m.mood.join(', ')}
                </div>
                <Wave buf={bufs[`${m.id}:16`] || bufs[`${m.id}:${length}`] || null} />
              </div>
              <div className="acts">
                <FavButton on={fav.is('music', m.id)} onToggle={() => fav.toggle('music', m.id)} />
                <button className="icon-btn sm" onClick={() => add(m)} title={`Render ${length}s and add to timeline`} disabled={prog !== undefined}>
                  <Plus size={14} />
                </button>
              </div>
            </div>
          );
        })}
        <div className="muted small" style={{ padding: 12 }}>
          All music here is synthesized inside the editor from generative patterns (Web Audio). No third-party recordings are used, so it is safe to publish anywhere.
        </div>
      </div>
    </>
  );
}

/* ------------------------------ Imported ------------------------------ */
function ImportedTab() {
  const assets = useMedia((s) => s.assets);
  const audio = useMemo(() => Object.values(assets).filter((a) => a.type === 'audio' && !a.isProxy).sort((a, b) => b.createdAt - a.createdAt), [assets]);
  const [q, setQ] = useState('');
  const list = audio.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()));
  const playing = usePreviewKey();
  const preview = async (id: string) => {
    if (playing === id) return stopPreview();
    const { getAudioBuffer } = await import('@/engine/MediaManager');
    const b = await getAudioBuffer(id);
    if (b) void playBuffer(id, b);
  };
  return (
    <>
      <div className="panel-body" style={{ paddingBottom: 0, flex: '0 0 auto' }}>
        <div className="row" style={{ gap: 8 }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search imported audio…" />
          <button className="btn" onClick={async () => importFiles(await pickFiles('audio/*'))} title="Import audio files">
            <Upload size={14} /> Import
          </button>
        </div>
      </div>
      <div className="panel-body flush scroll" style={{ flex: 1 }}>
        {!list.length && (
          <Empty icon={<Music2 />}>
            No imported audio yet. Import your own music/voice-overs, or use the SFX & Music tabs.
          </Empty>
        )}
        {list.map((a) => (
          <div key={a.id} className={`list-item ${playing === a.id ? 'active' : ''}`} onDoubleClick={() => addAssetToTimeline(a)}>
            <button className="icon-btn" onClick={() => preview(a.id)}>{playing === a.id ? <Square size={14} /> : <Play size={14} />}</button>
            <div className="info">
              <div className="title">{a.name}</div>
              <div className="sub">{formatDuration(a.duration)}</div>
            </div>
            <div className="acts">
              <button className="icon-btn sm" onClick={() => addAssetToTimeline(a)} title="Add to timeline">
                <Plus size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
