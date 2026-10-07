'use client';

import { useEffect } from 'react';
import { useEditor } from '@/store/editor';
import type { SceneNode } from '@/engine/types';

/**
 * Professional keyboard map (Figma/Illustrator style) with the Canva-style
 * additions users expect. Shortcuts are ignored while typing in inputs.
 */
export function useShortcuts(handlers: {
  onExport: () => void;
  onShare: () => void;
  onResize: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const state = useEditor.getState();
      const meta = event.metaKey || event.ctrlKey;

      // Global even while typing
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handlers.onSave();
        return;
      }
      if (meta && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        handlers.onExport();
        return;
      }

      if (isTyping()) return;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        state.redo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        state.duplicateNodesById(state.selection);
        return;
      }
      if (meta && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) state.ungroupSelection();
        else state.groupSelection();
        return;
      }
      if (meta && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        const page = state.doc.pages[state.activePage];
        const ids: string[] = [];
        const walk = (nodes: SceneNode[]) => {
          for (const node of nodes) {
            if (node.visible && !node.locked) ids.push(node.id);
          }
        };
        if (page) walk(page.nodes);
        state.setSelection(ids);
        return;
      }
      if (meta && event.key.toLowerCase() === 'c') {
        state.copySelection();
        return;
      }
      if (meta && event.key.toLowerCase() === 'v') {
        state.paste();
        return;
      }
      if (meta && event.key.toLowerCase() === 'x') {
        state.cutSelection();
        return;
      }
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        handlers.onShare();
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        handlers.onResize();
        return;
      }

      switch (event.key) {
        case 'Backspace':
        case 'Delete':
          if (state.selection.length) {
            event.preventDefault();
            state.deleteNodes(state.selection);
          }
          break;
        case 'Escape':
          if (state.editingTextId) state.setEditingText(null);
          else state.clearSelection();
          break;
        case 'v':
          state.setTool('select');
          break;
        case 'h':
          state.setTool('hand');
          break;
        case 't':
          state.setTool('text');
          break;
        case 'c':
          state.setTool('comment');
          break;
        case '[':
          state.zMove('backward');
          break;
        case ']':
          state.zMove('forward');
          break;
        case 'Home':
          state.zMove('front');
          break;
        case 'End':
          state.zMove('back');
          break;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!state.selection.length) return;
          event.preventDefault();
          const distance = event.shiftKey ? 10 : 1;
          const dx = event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0;
          const dy = event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0;
          state.updateNodes(
            state.selection,
            (node) => ({ x: node.x + dx, y: node.y + dy }),
            { label: 'Nudge', coalesce: 'nudge' },
          );
          break;
        }
        case 'Enter': {
          const node = state.doc.pages[state.activePage]?.nodes.find((n) => state.selection.includes(n.id));
          if (node?.type === 'text') {
            event.preventDefault();
            state.setEditingText(node.id);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}

export const SHORTCUT_HELP: { keys: string; description: string }[] = [
  { keys: 'V', description: 'Select tool' },
  { keys: 'H', description: 'Hand / pan tool' },
  { keys: 'T', description: 'Text tool' },
  { keys: 'C', description: 'Comment tool' },
  { keys: '⌘Z / ⌘⇧Z', description: 'Undo / redo' },
  { keys: '⌘D', description: 'Duplicate' },
  { keys: '⌘G / ⌘⇧G', description: 'Group / ungroup' },
  { keys: '⌘A', description: 'Select all' },
  { keys: '⌘C / ⌘V / ⌘X', description: 'Copy / paste / cut' },
  { keys: '⌘S', description: 'Save now' },
  { keys: '⌘E', description: 'Export' },
  { keys: '⌘K', description: 'Share' },
  { keys: '⌘⇧R', description: 'Resize design' },
  { keys: 'Arrows / ⇧Arrows', description: 'Nudge 1px / 10px' },
  { keys: '[ / ]', description: 'Send backward / bring forward' },
  { keys: 'Space + drag', description: 'Pan canvas' },
  { keys: '⌘ + scroll', description: 'Zoom' },
  { keys: 'Shift + drag', description: 'Constrain axis or aspect ratio' },
  { keys: 'Esc', description: 'Deselect / exit text' },
];
