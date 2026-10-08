// @vitest-environment jsdom
/**
 * UI integration tests.
 *
 * These mount the real <App /> and drive it through the real store, real
 * timeline operations and real AI plan execution. Only the OS boundary is
 * doubled: `probe` / `generateThumbnails` / `generateWaveform` are replaced
 * because jsdom has no media decoder. Everything from the drop handler inward
 * is production code.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act, waitFor, cleanup, fireEvent } from '@testing-library/react';
import App from '../../src/App';
import { setBridge } from '../../src/core/bridge';
import { webBridge } from '../../src/core/bridge/webBridge';
import { useEditor } from '../../src/ui/store/editorStore';
import { useExport } from '../../src/ui/store/exportStore';
import { useAi } from '../../src/ui/store/aiStore';
import type { MediaProbe } from '../../src/core/types/media';
import type { WaveformData } from '../../src/core/types/waveform';

/* ---------------- jsdom gaps ---------------- */

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;

  if (!URL.createObjectURL) {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:stub';
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  }
});

/* ---------------- media double ---------------- */

function fakeProbe(name: string): MediaProbe {
  const isAudio = name.endsWith('.mp3') || name.endsWith('.wav');
  return {
    durationSec: 10,
    format: 'mp4',
    bitrateBps: 2_000_000,
    sizeBytes: 2_500_000,
    hasVideo: !isAudio,
    hasAudio: true,
    width: isAudio ? 0 : 1920,
    height: isAudio ? 0 : 1080,
    fps: isAudio ? 0 : 30,
    rotation: 0,
    videoCodec: isAudio ? '' : 'h264',
    pixelFormat: isAudio ? '' : 'yuv420p',
    audioCodec: 'aac',
    sampleRate: 48000,
    channels: 2,
    isProxy: false,
  };
}

function fakeWaveform(): WaveformData {
  const peaks: number[] = [];
  const troughs: number[] = [];
  for (let i = 0; i < 2000; i++) {
    peaks.push(0.5 + (i % 5) / 20);
    troughs.push(-(0.5 + (i % 3) / 20));
  }
  return {
    peaks,
    troughs,
    channels: 2,
    secondsPerPeak: 10 / 1000,
    durationSec: 10,
    sampleRate: 48000,
    rmsDb: -18,
    peakDb: -3,
    generatedAt: Date.now(),
  };
}

beforeEach(() => {
  setBridge(webBridge);
  webBridge.probe = vi.fn(async (path: string) => fakeProbe(path));
  webBridge.generateThumbnails = vi.fn(async () => ({
    uri: 'data:image/png;base64,',
    times: [0, 1.25, 2.5, 3.75, 5, 6.25, 7.5, 8.75],
  }));
  webBridge.generateWaveform = vi.fn(async () => fakeWaveform());
  useEditor.getState().newProject();
  useEditor.setState({ playheadSec: 0, toasts: [] });
  useExport.setState({ dialogOpen: false, running: false, lastError: null, progress: null });
  useAi.setState({ entries: [], pendingPlan: null, consentQueue: [], thinking: false });
});

afterEach(() => cleanup());

/* ---------------- helpers ---------------- */

async function importFile(name: string, type: string): Promise<string> {
  const file = new File([new Uint8Array([1, 2, 3, 4])], name, { type });
  const path = webBridge.register(file);
  await act(async () => {
    await useEditor.getState().importPaths([path]);
  });
  return path;
}

const clipCount = () => useEditor.getState().project.sequence.tracks.reduce((n, t) => n + t.clips.length, 0);

/* ---------------- tests ---------------- */

describe('app shell', () => {
  it('boots and shows the empty media state', async () => {
    render(<App />);
    expect((await screen.findAllByText(/ADZAK EDIT/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/No media yet/i)).toBeTruthy();
    // Every primary action is reachable in the first paint.
    expect(screen.getByTitle('Split at playhead (S)')).toBeTruthy();
    expect(screen.getByTitle('Export (Ctrl+E)')).toBeTruthy();
  });

  it('renders the browser-runtime notice when FFmpeg is absent', async () => {
    render(<App />);
    // The web bridge reports no ffmpeg, so the shell must say so rather than
    // silently offering an MP4 export that cannot happen.
    expect((await screen.findAllByText(/browser/i)).length).toBeGreaterThan(0);
  });
});

describe('import → timeline → undo', () => {
  it('imports a file and shows it in the media panel', async () => {
    render(<App />);
    await importFile('interview.mp4', 'video/mp4');
    expect(await screen.findByText('interview.mp4')).toBeTruthy();
    expect(useEditor.getState().project.assets).toHaveLength(1);
    expect(useEditor.getState().project.assets[0]?.kind).toBe('video');
  });

  it('adds the asset to the timeline and splits it at the playhead', async () => {
    render(<App />);
    await importFile('interview.mp4', 'video/mp4');
    await act(async () => {
      useEditor.getState().addAssetToTimeline(useEditor.getState().project.assets[0]!.id, 0);
    });
    expect(clipCount()).toBe(1);

    useEditor.setState({ playheadSec: 4 });
    await act(async () => {
      useEditor.getState().splitAtPlayhead();
    });
    expect(clipCount()).toBe(2);
  });

  it('undoes and redoes a split through the toolbar', async () => {
    render(<App />);
    await importFile('interview.mp4', 'video/mp4');
    await act(async () => {
      useEditor.getState().addAssetToTimeline(useEditor.getState().project.assets[0]!.id, 0);
    });
    useEditor.setState({ playheadSec: 4 });
    await act(async () => {
      useEditor.getState().splitAtPlayhead();
    });
    expect(clipCount()).toBe(2);

    const undoButton = screen.getByTitle(/^Undo/);
    await act(async () => {
      fireEvent.click(undoButton);
    });
    expect(clipCount()).toBe(1);

    const redoButton = screen.getByTitle(/^Redo/);
    await act(async () => {
      fireEvent.click(redoButton);
    });
    expect(clipCount()).toBe(2);
  });

  it('deletes the selection with the Delete key and restores it with undo', async () => {
    render(<App />);
    await importFile('interview.mp4', 'video/mp4');
    await act(async () => {
      useEditor.getState().addAssetToTimeline(useEditor.getState().project.assets[0]!.id, 0);
    });
    const clipId = useEditor.getState().project.sequence.tracks.flatMap((t) => t.clips)[0]!.id;
    await act(async () => {
      useEditor.getState().select([clipId]);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Delete' });
    });
    expect(clipCount()).toBe(0);
    await act(async () => {
      useEditor.getState().undo();
    });
    expect(clipCount()).toBe(1);
  });

  it('adds a text layer that the inspector can rename', async () => {
    render(<App />);
    await act(async () => {
      useEditor.getState().addTextLayer('Hello world');
    });
    const clip = useEditor.getState().project.sequence.tracks.flatMap((t) => t.clips)[0];
    expect(clip?.kind).toBe('text');
    expect(clip?.text?.text).toBe('Hello world');

    await act(async () => {
      useEditor.getState().select([clip!.id]);
    });
    expect(await screen.findByDisplayValue('Hello world')).toBeTruthy();
  });
});

describe('export dialog', () => {
  it('opens with the preset list and refuses to export an empty timeline', async () => {
    render(<App />);
    await act(async () => {
      useExport.getState().openDialog();
    });
    expect(await screen.findByText(/MP4 · H.264/i)).toBeTruthy();
    expect(screen.getByText(/The timeline is empty/i)).toBeTruthy();

    const footerExport = screen.getAllByText('Export').pop()!.closest('button')!;
    expect(footerExport.disabled).toBe(true);
  });

  it('lists the vertical presets required by the spec', async () => {
    render(<App />);
    await act(async () => {
      useExport.getState().openDialog();
    });
    await screen.findByText(/MP4 · H.264/i);
    expect(screen.getByText(/Shorts 1080×1920/i)).toBeTruthy();
    expect(screen.getByText(/TikTok/i)).toBeTruthy();
    expect(screen.getByText(/YouTube 4K/i)).toBeTruthy();
  });

  it('states plainly that the browser build records in real time', async () => {
    render(<App />);
    await act(async () => {
      useExport.getState().openDialog();
    });
    await screen.findByText(/MP4 · H.264/i);
    expect(screen.getByText(/no FFmpeg/i)).toBeTruthy();
  });
});

describe('AI panel', () => {
  it('produces a plan for a natural-language request and applies it', async () => {
    render(<App />);
    await importFile('interview.mp4', 'video/mp4');
    await act(async () => {
      useEditor.getState().addAssetToTimeline(useEditor.getState().project.assets[0]!.id, 0);
    });

    await act(async () => {
      await useAi.getState().sendMessage('split the clip at 5 seconds');
    });

    await waitFor(() => expect(useAi.getState().pendingPlan).not.toBeNull());
    const plan = useAi.getState().pendingPlan!;
    expect(plan.steps.length).toBeGreaterThan(0);
    // The planner reads the timeline before touching it, so the split is not the
    // first step — assert it is present and targets a real clip id.
    const splitStep = plan.steps.find((step) => step.command.action === 'split_clip');
    expect(splitStep).toBeTruthy();
    if (splitStep?.command.action !== 'split_clip') throw new Error('no split step');
    expect(splitStep.command.time).toBe(5);
    expect(splitStep.command.clipId).not.toContain('__primary__');

    // split_clip is a `confirm-once` tool, so the plan pauses for approval
    // instead of editing silently. Answer it, then the split must land.
    const running = useAi.getState().runPendingPlan();
    await waitFor(() => expect(useAi.getState().consentQueue.length).toBeGreaterThan(0));
    expect(clipCount()).toBe(1);
    const splitRequest = useAi.getState().consentQueue[0]!;
    await act(async () => {
      useAi.getState().respondConsent(splitRequest.id, true);
    });
    await running;
    expect(clipCount()).toBe(2);

    // The same tool must not ask again in this session.
    await act(async () => {
      // 2s falls inside the first half that the previous split produced.
      await useAi.getState().sendMessage('split the clip at 2 seconds');
    });
    await waitFor(() => expect(useAi.getState().pendingPlan).not.toBeNull());
    await act(async () => {
      await useAi.getState().runPendingPlan();
    });
    expect(clipCount()).toBe(3);
    expect(useAi.getState().consentQueue).toHaveLength(0);
  });

  it('queues consent instead of running a destructive command silently', async () => {
    render(<App />);
    await act(async () => {
      useEditor.getState().setActivePanel('ai');
    });
    await importFile('interview.mp4', 'video/mp4');
    await act(async () => {
      useEditor.getState().addAssetToTimeline(useEditor.getState().project.assets[0]!.id, 0);
    });

    const promise = act(async () => {
      await useAi.getState().sendMessage('remove silence from my video');
    });
    await promise;
    await waitFor(() => expect(useAi.getState().pendingPlan).not.toBeNull());

    const runPromise = useAi.getState().runPendingPlan();
    // Nothing has happened yet: the plan is waiting on the user.
    await waitFor(() => expect(useAi.getState().consentQueue.length).toBeGreaterThan(0));
    expect(clipCount()).toBe(1);
    expect(screen.getByText(/Needs your approval/i)).toBeTruthy();

    const request = useAi.getState().consentQueue[0]!;
    await act(async () => {
      useAi.getState().respondConsent(request.id, true);
    });
    await runPromise;

    // remove_silence is planned as a dry run: the agent proposes an analysis for
    // review and never deletes material on its own authority.
    expect(clipCount()).toBe(1);
    expect(useAi.getState().consentQueue).toHaveLength(0);
  });
});

describe('project round trip', () => {
  it('saves and reloads without losing the timeline', async () => {
    await importFile('interview.mp4', 'video/mp4');
    await act(async () => {
      useEditor.getState().addAssetToTimeline(useEditor.getState().project.assets[0]!.id, 0);
    });
    useEditor.setState({ playheadSec: 4 });
    await act(async () => {
      useEditor.getState().splitAtPlayhead();
    });
    expect(clipCount()).toBe(2);

    const savedPath = `idb:${useEditor.getState().project.id}`;
    await act(async () => {
      await useEditor.getState().saveProject(savedPath);
    });
    expect(useEditor.getState().dirty).toBe(false);

    const raw = await webBridge.readTextFile(savedPath);
    expect(raw).toContain('interview.mp4');

    useEditor.getState().newProject();
    expect(clipCount()).toBe(0);

    await act(async () => {
      useEditor.getState().loadProjectFromText(raw, savedPath);
    });
    expect(clipCount()).toBe(2);
    const names = useEditor.getState().project.sequence.tracks.flatMap((t) => t.clips).map((c) => c.name);
    expect(names.every((n) => n.includes('interview'))).toBe(true);
  });
});
