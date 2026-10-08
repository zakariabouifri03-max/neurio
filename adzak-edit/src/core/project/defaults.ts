/**
 * Re-exported defaults.
 *
 * Kept in one module so `serialize.ts` (which must not import from the timeline
 * package, to avoid a cycle with the factory) and the UI share exactly the same
 * default values.
 */
export {
  defaultAudioSettings,
  defaultTransform,
  defaultTextStyle,
  defaultProjectSettings,
} from '../types/timeline';
export { defaultWorkspace } from '../types/project';
export { defaultSubtitleStyle } from '../types/subtitles';
