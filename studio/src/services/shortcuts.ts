import { useEffect } from 'react';
import { useProject, usePlayback, addMarker } from '@/core/store';
import { useUI } from '@/core/uiStore';
import { engine } from '@/engine/PlaybackEngine';
import * as act from './clipActions';
import { saveCurrent } from './projects';
import { isMac } from '@/core/util';

export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Space', label: 'Play / Pause' },
  { keys: 'J / K / L', label: 'Shuttle back / pause / forward' },
  { keys: '← / →', label: 'Previous / next frame' },
  { keys: 'Shift+← / →', label: 'Jump 1 second' },
  { keys: '↑ / ↓', label: 'Previous / next edit point' },
  { keys: 'Home / End', label: 'Go to start / end' },
  { keys: 'S  or  Ctrl+B', label: 'Split at playhead' },
  { keys: 'Delete / Backspace', label: 'Delete selection' },
  { keys: 'Shift+Delete', label: 'Ripple delete' },
  { keys: 'Ctrl+Z / Ctrl+Shift+Z', label: 'Undo / Redo' },
  { keys: 'Ctrl+C / X / V', label: 'Copy / Cut / Paste' },
  { keys: 'Ctrl+D', label: 'Duplicate' },
  { keys: 'Ctrl+A', label: 'Select all' },
  { keys: 'Ctrl+G / Ctrl+Shift+G', label: 'Group / Ungroup' },
  { keys: 'Ctrl+L', label: 'Lock / unlock clips' },
  { keys: 'Ctrl+S', label: 'Save project' },
  { keys: 'Ctrl+E', label: 'Export' },
  { keys: 'Ctrl+Shift+F', label: 'Freeze frame' },
  { keys: 'T', label: 'Add text' },
  { keys: 'M', label: 'Add marker' },
  { keys: 'I / O', label: 'Set in / out point' },
  { keys: 'Alt+X', label: 'Clear in / out' },
  { keys: 'N', label: 'Toggle snapping' },
  { keys: '+ / -', label: 'Zoom timeline' },
  { keys: 'Shift+Z', label: 'Zoom to fit' },
  { keys: ', / .', label: 'Nudge selection 1 frame' },
  { keys: 'Tab', label: 'Toggle side panels' },
  { keys: 'F', label: 'Fullscreen preview' },
  { keys: '?', label: 'Show shortcuts' },
];

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function useEditorShortcuts(opts: { zoomFit: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      if (ui.dialog) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const typing = isTyping(e);
      if (typing && !(mod && ['s', 'z', 'y'].includes(e.key.toLowerCase()))) return;
      const k = e.key;
      const lower = k.toLowerCase();
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (mod) {
        switch (lower) {
          case 'z':
            stop();
            if (e.shiftKey) useProject.getState().redo();
            else useProject.getState().undo();
            return;
          case 'y':
            stop();
            useProject.getState().redo();
            return;
          case 's':
            stop();
            void saveCurrent().then(() => ui.toast({ title: 'Project saved', kind: 'success', timeout: 1500 }));
            return;
          case 'c':
            stop();
            act.copySelection();
            return;
          case 'x':
            stop();
            act.cutSelection();
            return;
          case 'v':
            stop();
            act.pasteClipboard();
            return;
          case 'd':
            stop();
            act.duplicateSelection();
            return;
          case 'a':
            stop();
            act.selectAll();
            return;
          case 'b':
            stop();
            act.splitAtPlayhead();
            return;
          case 'g':
            stop();
            if (e.shiftKey) act.ungroupSelection();
            else act.groupSelection();
            return;
          case 'l':
            stop();
            act.toggleLockSelection();
            return;
          case 'e':
            stop();
            ui.openDialog({ kind: 'export' });
            return;
          case 'f':
            if (e.shiftKey) {
              stop();
              act.freezeAtPlayhead();
            }
            return;
          case '=':
          case '+':
            stop();
            ui.setZoom(ui.timelineZoom * 1.25);
            return;
          case '-':
            stop();
            ui.setZoom(ui.timelineZoom / 1.25);
            return;
        }
        return;
      }
      switch (k) {
        case ' ':
          stop();
          engine.toggle();
          return;
        case 'k':
        case 'K':
          engine.pause();
          return;
        case 'l':
        case 'L':
          stop();
          if (!usePlayback.getState().playing) void engine.play();
          return;
        case 'j':
        case 'J':
          stop();
          act.stepFrames(-Math.round(useProject.getState().project!.settings.fps / 2));
          return;
        case 'ArrowLeft':
          stop();
          if (e.shiftKey) act.stepFrames(-useProject.getState().project!.settings.fps);
          else act.stepFrames(-1);
          return;
        case 'ArrowRight':
          stop();
          if (e.shiftKey) act.stepFrames(useProject.getState().project!.settings.fps);
          else act.stepFrames(1);
          return;
        case 'ArrowUp':
          stop();
          act.jumpToEdge(-1);
          return;
        case 'ArrowDown':
          stop();
          act.jumpToEdge(1);
          return;
        case 'Home':
          stop();
          act.goToStart();
          return;
        case 'End':
          stop();
          act.goToEnd();
          return;
        case 'Delete':
        case 'Backspace':
          stop();
          act.deleteSelection(e.shiftKey || ui.ripple);
          return;
        case 's':
        case 'S':
          stop();
          act.splitAtPlayhead();
          return;
        case 't':
        case 'T':
          stop();
          act.addTextClip();
          return;
        case 'm':
        case 'M': {
          stop();
          addMarker(usePlayback.getState().time);
          return;
        }
        case 'i':
        case 'I':
          stop();
          act.setInPoint();
          return;
        case 'o':
        case 'O':
          stop();
          act.setOutPoint();
          return;
        case 'x':
        case 'X':
          if (e.altKey) {
            stop();
            act.clearInOut();
          }
          return;
        case 'n':
        case 'N':
          stop();
          ui.set({ snapping: !ui.snapping });
          return;
        case '+':
        case '=':
          stop();
          ui.setZoom(ui.timelineZoom * 1.25);
          return;
        case '-':
        case '_':
          stop();
          ui.setZoom(ui.timelineZoom / 1.25);
          return;
        case 'Z':
          if (e.shiftKey) {
            stop();
            opts.zoomFit();
          }
          return;
        case ',':
          stop();
          act.nudgeSelection(-1);
          return;
        case '.':
          stop();
          act.nudgeSelection(1);
          return;
        case 'Tab':
          stop();
          ui.set({ leftOpen: !(ui.leftOpen || ui.rightOpen), rightOpen: !(ui.leftOpen || ui.rightOpen) });
          return;
        case 'f':
        case 'F': {
          stop();
          const el = document.querySelector('.preview-stage');
          if (el) {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void el.requestFullscreen?.();
          }
          return;
        }
        case '?':
          stop();
          ui.openDialog({ kind: 'shortcuts' });
          return;
        case 'Escape':
          useProject.getState().select([]);
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts.zoomFit]);
}
