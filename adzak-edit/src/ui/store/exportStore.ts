import { create } from 'zustand';
import type { ExportSettings, ExportProgress } from '../../core/types/export';
import { presetToSettings, getPreset } from '../../core/export/presets';

/**
 * Export dialog + job state.
 *
 * Kept separate from the editor store because an export is a long-lived job
 * with its own lifecycle, and re-rendering the timeline on every progress tick
 * would be wasteful.
 */

export interface ExportState {
  dialogOpen: boolean;
  /** Settings currently shown in the dialog. */
  settings: ExportSettings;
  /** Progress of the running job, or null when idle. */
  progress: ExportProgress | null;
  running: boolean;
  /** Set when the last job failed; drives the error panel. */
  lastError: string | null;
  lastWarnings: string[];
  /** Populated after a successful browser export so the UI can link the file. */
  lastOutputPath: string | null;
  /** True when the run was stopped by the user. */
  cancelled: boolean;

  openDialog: (presetId?: string, suggestedPath?: string | null) => void;
  closeDialog: () => void;
  selectPreset: (presetId: string) => void;
  patchSettings: (patch: Partial<ExportSettings>) => void;
  start: () => void;
  reportProgress: (progress: ExportProgress) => void;
  finish: (result: { ok: boolean; error?: string; warnings?: string[]; outputPath?: string; cancelled?: boolean }) => void;
  reset: () => void;
}

const DEFAULT_OUTPUT = 'export.mp4';

export const useExport = create<ExportState>((set, get) => ({
  dialogOpen: false,
  settings: presetToSettings('youtube-1080', DEFAULT_OUTPUT),
  progress: null,
  running: false,
  lastError: null,
  lastWarnings: [],
  lastOutputPath: null,
  cancelled: false,

  openDialog: (presetId, suggestedPath) =>
    set((state) => ({
      dialogOpen: true,
      lastError: null,
      cancelled: false,
      settings: presetId
        ? { ...presetToSettings(presetId, suggestedPath ?? (state.settings.outputPath || DEFAULT_OUTPUT)) }
        : state.settings,
    })),

  closeDialog: () => set({ dialogOpen: false }),

  selectPreset: (presetId) =>
    set((state) => {
      const preset = getPreset(presetId);
      if (!preset) return state;
      return {
        settings: {
          ...preset.settings,
          presetId: preset.id,
          outputPath: state.settings.outputPath,
          overwrite: state.settings.overwrite,
          burnSubtitles: state.settings.burnSubtitles,
        },
      };
    }),

  patchSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

  start: () => set({ running: true, lastError: null, lastWarnings: [], lastOutputPath: null, cancelled: false }),

  reportProgress: (progress) => set({ progress }),

  finish: ({ ok, error, warnings, outputPath, cancelled }) =>
    set({
      running: false,
      lastError: ok ? null : error ?? 'The export failed for an unknown reason.',
      lastWarnings: warnings ?? [],
      lastOutputPath: ok ? outputPath ?? get().settings.outputPath : null,
      cancelled: Boolean(cancelled),
      progress: null,
    }),

  reset: () => set({ progress: null, running: false, lastError: null, lastWarnings: [], cancelled: false }),
}));
