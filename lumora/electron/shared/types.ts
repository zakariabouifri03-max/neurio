/** Shared contract between main and renderer (mirrored in src/types/index.ts). */

export interface PageDoc {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string | null; // null = transparent
  /** Serialized fabric.js scene graph. */
  scene: unknown;
  thumbnail?: string | null;
}

export interface ProjectDoc {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pages: PageDoc[];
  brandKit?: BrandKit;
  format: 'lumora/project@1';
}

export interface BrandKit {
  colors: string[];
  fonts: string[];
  logos: string[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  width: number;
  height: number;
  thumbnail?: string | null;
}

export type ProviderId = 'openai' | 'google' | 'custom';

export interface AIProviderSettings {
  textProvider: ProviderId;
  imageProvider: ProviderId | 'free';
  backgroundRemovalProvider: 'local' | 'custom';
  upscaleProvider: 'local' | 'custom';
  removeBgUrl: string;
  upscaleUrl: string;
  openaiBaseUrl: string;
  openaiTextModel: string;
  openaiImageModel: string;
  googleBaseUrl: string;
  googleTextModel: string;
  googleImageModel: string;
  customBaseUrl: string;
  customTextModel: string;
  customImageModel: string;
}

export interface AppSettings {
  theme: 'dark' | 'midnight' | 'light';
  accent: string;
  autoSave: boolean;
  autoSaveIntervalMs: number;
  defaultExportFormat: 'png' | 'jpeg' | 'webp' | 'pdf';
  defaultExportScale: number;
  defaultExportQuality: number;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  safeAreaGuides: boolean;
  hardwareAcceleration: boolean;
  maxUndoSteps: number;
  firstRunComplete: boolean;
  ai: AIProviderSettings;
}

export interface AIResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface GeneratedImage {
  /** data URL (png) */
  dataUrl: string;
}

export interface DesignBlueprint {
  title: string;
  width: number;
  height: number;
  background: string;
  palette: string[];
  elements: BlueprintElement[];
}

export type BlueprintElement =
  | {
      type: 'text';
      id: string;
      text: string;
      x: number;
      y: number;
      width: number;
      fontSize: number;
      fontFamily: string;
      fontWeight: 'normal' | 'bold';
      fill: string;
      align: 'left' | 'center' | 'right';
      role: 'headline' | 'subhead' | 'body' | 'caption';
    }
  | {
      type: 'rect' | 'ellipse' | 'triangle' | 'star';
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      opacity?: number;
      rx?: number;
      angle?: number;
    }
  | {
      type: 'image';
      id: string;
      prompt: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
