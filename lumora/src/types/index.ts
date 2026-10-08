export interface PageDoc {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string | null;
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

export interface AIEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface TemplateDef {
  id: string;
  name: string;
  category: TemplateCategory;
  width: number;
  height: number;
  background: string | null;
  scene: unknown;
  custom?: boolean;
  thumbnail?: string | null;
}

export type TemplateCategory =
  | 'YouTube'
  | 'Instagram'
  | 'TikTok'
  | 'Facebook'
  | 'Posters'
  | 'Flyers'
  | 'Business'
  | 'T-Shirts'
  | 'Logos'
  | 'Presentations'
  | 'Wallpapers'
  | 'Custom';

export interface LayerInfo {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  selected: boolean;
  isGroup: boolean;
  children?: LayerInfo[];
}

export interface SelectionProps {
  count: number;
  type: string | null;
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  rx: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  blur: number;
  brightness: number;
  contrast: number;
  saturation: number;
  isText: boolean;
  isImage: boolean;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  underline: boolean;
  textAlign: string;
  charSpacing: number;
  lineHeight: number;
  curve: number;
  name: string;
  locked: boolean;
}

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  message: string;
}
