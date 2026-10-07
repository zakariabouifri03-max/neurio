/**
 * Dev-only console handle: `window.__neurio` exposes the live stores/engine so workflows can be
 * scripted and inspected (also used by the headless smoke tests). Not loaded in production builds.
 */
import * as store from '@/core/store';
import * as uiStore from '@/core/uiStore';
import * as commands from '@/core/commands';
import * as media from '@/engine/MediaManager';
import * as playback from '@/engine/PlaybackEngine';
import * as exporter from '@/engine/Exporter';
import * as clipActions from '@/services/clipActions';
import * as projects from '@/services/projects';
import * as synth from '@/library/synth';
import * as templates from '@/library/templates';
import * as music from '@/library/music';

(window as any).__neurio = { store, uiStore, commands, media, playback, exporter, clipActions, projects, synth, templates, music };
