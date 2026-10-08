# ADZAK EDIT — Data Models

Source of truth: `src/core/types/`. Nothing in this document is aspirational —
each shape below is the interface as it exists on disk.

## 1. `ProjectDocument` (`types/project.ts`)

The root object. It is what `.adzak` serialises.

```ts
interface ProjectDocument {
  magic: 'ADZAK';            // ADZAK_MAGIC
  version: number;
  appVersion: string;        // diagnostics only, never gating
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings; // width, height, fps, frame rate policy
  assets: MediaAsset[];
  sequence: Sequence;
  subtitles: SubtitleDocument[];
  decisions: EditDecision[]; // non-destructive AI/silence decisions
  exportSettings: ExportSettingsSnapshot | null;
  workspace: ProjectWorkspace;
  migrationsApplied: string[];
}
```

**`.adzak` never embeds media.** It stores references and metadata only. A
missing file is a *state* (`asset.isMissing`), not an error — the project still
opens, the clip renders as offline, and the Media panel offers Relink.

`deserializeProject` never throws for recoverable problems; it returns
`{ document, warnings }`. Only `not-adzak`, `bad-json` and
`unsupported-version` throw `ProjectFormatError`. `MIGRATIONS` is append-only,
keyed by `from`.

## 2. `MediaAsset` (`types/media.ts`)

```ts
interface MediaAsset {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'image' | 'gif' | 'unknown';
  location: { kind: 'file' | 'web' | 'proxy'; path: string };
  originalPath: string;      // the real file; never rewritten by an edit
  sizeBytes: number;
  importedAt: number;
  probe: MediaProbe | null;
  probeState: 'pending' | 'probing' | 'ready' | 'error';
  probeError?: string;
  isMissing: boolean;
  thumbnails?: { uri, tiles, times, tileWidth, tileHeight, generatedAt };
  waveform?: WaveformData;
}
```

`probeState` drives the skeleton shimmer in the Media panel. Thumbnails and
waveforms are **caches**, generated after the probe lands, so a clip appears on
the timeline immediately and fills in later. They are not part of the edit and
are regenerated on demand.

`WaveformData` stores interleaved `peaks` and `troughs` (`channels * buckets`
long) plus `secondsPerPeak`, `rmsDb`, `peakDb` and optional loudness stats. The
timeline painter buckets by `sourceTime / secondsPerPeak` — never by index
guesswork.

## 3. `Sequence` and `Track` (`types/timeline.ts`)

```ts
interface Sequence {
  id: string;
  fps: number;
  tracks: Track[];
  markers: Marker[];
  duration: number;   // derived; sequenceDuration() is authoritative
}

interface Track {
  id: string;
  kind: 'video' | 'audio';
  name: string;
  z: number;          // draw order for video
  muted: boolean;
  solo: boolean;
  locked: boolean;
  hidden: boolean;
  heightPx: number;   // UI only, never affects render
  expanded: boolean;
  clips: Clip[];
  gain: number;       // master volume (audio) / opacity (video)
}
```

`locked`, `hidden`, `heightPx` and `expanded` are UI state carried on the track
so they survive a project round trip. They never reach the render plan.

## 4. `Clip`

```ts
interface Clip {
  id: string;
  trackId: string;
  kind: 'media' | 'text' | 'subtitle' | 'adjustment' | 'solid';
  assetId?: string;              // media clips only
  name: string;
  timeline: { start: number; duration: number };  // sequence seconds
  source:   { in: number; out: number };          // source seconds
  speed: number;                 // > 0 always
  reverse: boolean;              // never encoded as negative speed
  transform: Transform;
  audio: AudioClipSettings;
  effects: EffectInstance[];
  keyframes: Record<string, Keyframe[]>;
  text?: TextStyle;
  subtitle?: SubtitleClipMeta;   // words, speaker, language, confidence
  color?: string;
  groupId?: string;              // A/V link: move/trim/delete together
  freezeStartSec?: number;
  isOffline?: boolean;
  createdAt: number;
}
```

Invariants the engine maintains:

1. `timeline.duration === (source.out - source.in) / speed`
2. `source.in` and `source.out` stay within `[0, probe.durationSec]` —
   trimming **clamps** rather than failing, so a drag simply stops.
3. Keyframe `time` is **clip-local**, so `splitClip` partitions and rebases
   them; `trimClip('in')` shifts them.
4. `reverse` is orthogonal to `speed`.

`SubtitleClipMeta` carries the word-level timings from Whisper. They survive
trim and split because the operations rebase them with the clip — that is what
makes karaoke-style highlight possible later without re-running ASR.

## 5. `Transform`

```ts
interface Transform {
  x: number; y: number;      // normalised, -1..1 from centre
  scale: number;
  rotationDeg: number;
  opacity: number;           // 0..1
  flipX: boolean; flipY: boolean;
  crop: { top: number; right: number; bottom: number; left: number }; // 0..0.49 each
  anchor: { x: number; y: number };
}
```

Crop is capped at 0.49 per side so no combination can produce a zero-area frame.
The AI validator enforces even output dimensions separately.

## 6. Effects

Data-first by design:

```ts
interface EffectDefinition {
  id: string; name: string; category: EffectCategory;
  description: string;
  params: EffectParam[];
  build: (params) => FilterSpec[];   // neutral
  previewable: boolean;              // can the canvas compositor approximate it?
}

interface FilterSpec { filter: string; args: Record<string, string> }
```

`core/effects/filtergraph.ts` is the only place `FilterSpec` becomes FFmpeg
syntax. Effects that are not `previewable` are labelled in the Inspector as
"applied at export" rather than silently showing nothing.

**12 effects** are registered, verified at runtime from `effectRegistry.all()`:
colour 5, stylize 3, composite 1, transform 1, distort 1, blur 1. They are
declared across `builtin/color.ts` and `builtin/visual.ts`.

## 7. Audio

```ts
interface AudioClipSettings {
  volume: number;      // LINEAR gain, 1 = 0 dB. The UI shows dB.
  pan: number;         // -1..1
  fadeInSec: number;
  fadeOutSec: number;
  chain: AudioProcessId[];
  muted: boolean;
}
```

`volume` is stored linear because that is what FFmpeg wants, and converted at
the UI boundary with `gainToDb` / `dbToGain`. Normalisation caps boost at
**+12 dB** — deliberate, to stop a whisper becoming noise.

`AudioProcessId` is a closed union (`noise-reduce`, `normalize`, `enhance-voice`,
`de-esser`, …) mapped to filter arrays by `AUDIO_PROCESS_FILTERS`. Non-destructive
by construction: the source file is never touched.

## 8. Subtitles

```ts
interface SubtitleCue {
  id: string;
  start: number; end: number;   // seconds
  text: string;
  words?: WordTiming[];         // { word, start, end, confidence? }
  speaker?: string;
  style?: Partial<SubtitleStyle>;
}

interface SubtitleDocument {
  format: 'srt' | 'vtt' | 'ass';
  language: string;
  cues: SubtitleCue[];
  style: SubtitleStyle;
  referenceWidth: number;       // ASS is resolution-relative
  referenceHeight: number;
}
```

`core/subtitles/codecs.ts` is the **only** parser/serialiser. Round-tripping
`parse → serialize → parse` is asserted in `tests/unit/subtitles.test.ts` for
all three formats.

Timeline subtitle clips project back to cues via
`core/subtitles/fromTimeline.ts::cuesFromSequence` — the clips stay the source
of truth, nothing mutates the sequence.

## 9. Export

```ts
interface ExportSettings {
  presetId: string;
  width: number; height: number; fps: number;
  videoCodec: 'h264' | 'h265' | 'vp9';
  audioCodec: 'aac' | 'opus' | 'mp3';
  container: 'mp4' | 'mov' | 'webm' | 'mkv';
  videoBitrateKbps: number;   // 0 = CRF mode
  crf: number;
  audioBitrateKbps: number;
  hardwareEncoder?: string;
  twoPass: boolean;
  encoderPreset: EncoderPreset;
  burnSubtitles: boolean;
  subtitleTrackIndex?: number;
  outputPath: string;
  overwrite: boolean;
}
```

Nine presets ship (`core/export/presets.ts`): YouTube 1080p, YouTube 4K,
Shorts 1080×1920, TikTok 1080×1920, Instagram Reel 1080×1920, Instagram Square
1080×1080, WebM (VP9), Archive/Master (H.265), Custom.

## 10. Settings

`Settings` (`src/ui/store/settingsStore.ts`) is persisted under the key
`adzak.settings.v1` and **deep-merged on load**, so adding a field in a later
version does not wipe a user's existing preferences. Sections: `general`,
`appearance`, `performance`, `ai`, `storage`, `export`, `shortcuts`.

Shortcuts are user-rebindable and stored as combo strings (`'Ctrl+Shift+Z'`).
