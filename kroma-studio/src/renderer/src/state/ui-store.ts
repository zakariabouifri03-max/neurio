import { create } from 'zustand'
import { newId } from '../../../shared/utils/ids'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  details?: string
  /** ms; 0 keeps it until dismissed */
  duration: number
}

export type PanelRoute =
  | 'templates'
  | 'elements'
  | 'text'
  | 'uploads'
  | 'ai'
  | 'backgrounds'
  | 'shapes'
  | 'icons'
  | 'projects'
  | 'brand'
  | 'layers'
  | 'design'
  | 'image'

export type ModalId =
  | null
  | 'export'
  | 'settings'
  | 'new-design'
  | 'preview'
  | 'ai-image'
  | 'ai-design'
  | 'ai-text'
  | 'image'
  | 'shortcuts'
  | 'rename-project'
  | 'ai-api-key'

export interface UiState {
  leftPanel: PanelRoute
  rightPanelOpen: boolean
  leftPanelOpen: boolean
  pagesOpen: boolean
  modal: ModalId
  modalData: unknown
  toasts: Toast[]
  /** Bumped to request the canvas engine to re-fit the page. */
  fitRequest: number
  clipboard: unknown

  setLeftPanel: (panel: PanelRoute) => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  togglePages: () => void
  openModal: (modal: ModalId, data?: unknown) => void
  closeModal: () => void
  toast: (kind: ToastKind, message: string, options?: { details?: string; duration?: number }) => void
  dismissToast: (id: string) => void
  requestFit: () => void
  setClipboard: (value: unknown) => void
}

export const useUiStore = create<UiState>((set) => ({
  leftPanel: 'templates',
  rightPanelOpen: true,
  leftPanelOpen: true,
  pagesOpen: true,
  modal: null,
  modalData: undefined,
  toasts: [],
  fitRequest: 0,
  clipboard: null,

  setLeftPanel: (panel) => set((state) => ({ leftPanel: panel, leftPanelOpen: state.leftPanel === panel ? !state.leftPanelOpen : true })),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  togglePages: () => set((state) => ({ pagesOpen: !state.pagesOpen })),
  openModal: (modal, data) => set({ modal, modalData: data }),
  closeModal: () => set({ modal: null, modalData: undefined }),

  toast: (kind, message, options) => {
    const toast: Toast = { id: newId('ts'), kind, message, details: options?.details, duration: options?.duration ?? (kind === 'error' ? 7000 : 3800) }
    set((state) => ({ toasts: [...state.toasts.slice(-4), toast] }))
    if (toast.duration > 0) {
      setTimeout(() => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== toast.id) })), toast.duration)
    }
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  requestFit: () => set((state) => ({ fitRequest: state.fitRequest + 1 })),
  setClipboard: (value) => set({ clipboard: value })
}))

/** Convenience helpers usable outside React components. */
export const notify = {
  success: (message: string, details?: string): void => useUiStore.getState().toast('success', message, { details }),
  error: (message: string, details?: string): void => useUiStore.getState().toast('error', message, { details }),
  info: (message: string, details?: string): void => useUiStore.getState().toast('info', message, { details }),
  warning: (message: string, details?: string): void => useUiStore.getState().toast('warning', message, { details })
}
