import { engine } from '@/editor/engine';
import { useEditor } from '@/state/editorStore';
import { useApp } from '@/state/appStore';

export const SHORTCUTS = [
  { keys: 'Ctrl + Z', label: 'Undo' },
  { keys: 'Ctrl + Shift + Z', label: 'Redo' },
  { keys: 'Ctrl + S', label: 'Save project' },
  { keys: 'Ctrl + C', label: 'Copy selection' },
  { keys: 'Ctrl + V', label: 'Paste' },
  { keys: 'Ctrl + D', label: 'Duplicate selection' },
  { keys: 'Delete', label: 'Delete selection' },
  { keys: 'Ctrl + A', label: 'Select all' },
  { keys: 'Ctrl + G', label: 'Group' },
  { keys: 'Ctrl + Shift + G', label: 'Ungroup' },
  { keys: 'Ctrl + E', label: 'Export' },
  { keys: 'Ctrl + P', label: 'Preview' },
  { keys: 'Space + drag', label: 'Pan the canvas' },
  { keys: 'Ctrl + scroll', label: 'Zoom' },
  { keys: 'Arrow keys', label: 'Nudge selection' }
];

function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return true;
  // Fabric puts an invisible textarea on the page while editing text on canvas.
  const obj = engine.canvas?.getActiveObject() as any;
  return Boolean(obj?.isEditing);
}

/** Global shortcut handler — returns a cleanup function. */
export function installShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    const editor = useEditor.getState();
    const app = useApp.getState();
    if (app.route !== 'editor') return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (typing() && !(mod && key === 's')) return;

    const run = (fn: () => void | Promise<void>) => {
      e.preventDefault();
      void fn();
      editor.syncFromEngine();
    };

    if (mod && key === 'z' && !e.shiftKey) return run(() => engine.undo());
    if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) return run(() => engine.redo());
    if (mod && key === 's') return run(() => editor.save());
    if (mod && key === 'c') return run(() => engine.copy());
    if (mod && key === 'v') return run(() => engine.paste());
    if (mod && key === 'd') return run(() => engine.duplicateSelection());
    if (mod && key === 'a') return run(() => engine.selectAll());
    if (mod && key === 'g') return run(() => (e.shiftKey ? engine.ungroup() : engine.group()));
    if (mod && key === 'e') return run(() => editor.setExport(true));
    if (mod && key === 'p') return run(() => editor.setPreview(true));
    if (mod && (key === '=' || key === '+')) return run(() => engine.zoomBy(1.15));
    if (mod && key === '-') return run(() => engine.zoomBy(1 / 1.15));
    if (key === 'delete' || key === 'backspace') return run(() => engine.deleteSelection());

    if (key.startsWith('arrow')) {
      const step = e.shiftKey ? 10 : 1;
      const delta =
        key === 'arrowleft'
          ? { left: -step }
          : key === 'arrowright'
            ? { left: step }
            : key === 'arrowup'
              ? { top: -step }
              : { top: step };
      const obj = engine.canvas?.getActiveObject();
      if (!obj) return;
      e.preventDefault();
      engine.update({
        left: (obj.left ?? 0) + (delta.left ?? 0),
        top: (obj.top ?? 0) + (delta.top ?? 0)
      });
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
