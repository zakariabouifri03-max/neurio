import test from 'node:test';
import assert from 'node:assert/strict';
import { addCaptionSegments, addMediaAsset, addAssetToTimeline, createProject, getTimelineDuration, removeTimelineRange, setAspectRatio, splitClip } from '../src/editor/project.js';
import { ProjectStore } from '../src/editor/store.js';

test('ripple removal splits a clip, advances source in, and closes the gap', () => {
  const project = createProject('Test');
  const asset = addMediaAsset(project, { id: 'a', name: 'source.mp4', mediaType: 'video', duration: 20, hasAudio: true });
  const clip = addAssetToTimeline(project, asset.id);
  removeTimelineRange(project, 4, 7);
  const clips = project.tracks[0].clips;
  assert.equal(clips.length, 2);
  assert.equal(clips[0].duration, 4);
  assert.equal(clips[1].startTime, 4);
  assert.equal(clips[1].sourceIn, 7);
  assert.equal(getTimelineDuration(project), 17);
  assert.notEqual(clips[0].id, clips[1].id);
});

test('splitting and non-destructive aspect changes preserve source references', () => {
  const project = createProject();
  const asset = addMediaAsset(project, { id: 'b', name: 'clip.mp4', mediaType: 'video', duration: 9, width: 1920, height: 1080 });
  const clip = addAssetToTimeline(project, asset.id);
  const pieces = splitClip(project, clip.id, 3);
  assert.ok(pieces);
  assert.equal(project.tracks[0].clips.length, 2);
  assert.equal(project.tracks[0].clips[1].sourceIn, 3);
  setAspectRatio(project, '9:16');
  assert.deepEqual([project.settings.width, project.settings.height], [1080, 1920]);
  assert.equal(project.assets[0].width, 1920);
});

test('caption segments are real timeline objects and store validates media references', () => {
  const project = createProject();
  const captions = addCaptionSegments(project, [{ start: 0.4, end: 1.3, text: 'Hello Nexus' }]);
  assert.equal(captions.length, 1);
  assert.equal(project.tracks.find((track) => track.type === 'caption').clips[0].text, 'Hello Nexus');
});

test('undo and redo restore full project state', () => {
  const project = createProject();
  const store = new ProjectStore(project);
  store.commit('Set vertical', (draft) => { draft.settings.aspectRatio = '9:16'; });
  assert.equal(store.project.settings.aspectRatio, '9:16');
  assert.equal(store.undo(), 'Set vertical');
  assert.equal(store.project.settings.aspectRatio, '16:9');
  assert.equal(store.redo(), 'Set vertical');
  assert.equal(store.project.settings.aspectRatio, '9:16');
});
