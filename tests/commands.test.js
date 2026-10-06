import test from 'node:test';
import assert from 'node:assert/strict';
import { addAssetToTimeline, addCaptionSegments, addMediaAsset, createProject, getTimelineDuration } from '../src/editor/project.js';
import { ProjectStore } from '../src/editor/store.js';
import { applyPlan, prepareCommand } from '../src/editor/commands.js';
import { validateLocalPlan } from '../src/editor/local-ai-engine.js';

function fixture() {
  const project = createProject('Command test');
  const asset = addMediaAsset(project, { id: 'src', name: 'sample.mp4', mediaType: 'video', duration: 60, width: 1920, height: 1080, hasAudio: true });
  addAssetToTimeline(project, asset.id);
  return project;
}

test('simple natural language trim plans and applies an actual ripple cut', async () => {
  const project = fixture();
  const plan = await prepareCommand('Remove the first 4 seconds.', project);
  assert.equal(plan.requiresReview, false);
  const store = new ProjectStore(project);
  applyPlan(store, plan);
  assert.equal(getTimelineDuration(store.project), 56);
  assert.equal(store.project.tracks[0].clips[0].sourceIn, 4);
  assert.equal(store.undo(), 'Remove the first 4 seconds.');
  assert.equal(getTimelineDuration(store.project), 60);
});

test('a short plan shows unavailable local speech model and never invents captions', async () => {
  const project = fixture();
  const plan = await prepareCommand('Make this a 30 second vertical YouTube Short.', project);
  assert.equal(plan.requiresReview, true);
  assert.ok(plan.actions.some((action) => action.type === 'set_aspect_ratio'));
  assert.ok(plan.actions.some((action) => action.type === 'trim_to_duration'));
  assert.ok(!plan.actions.some((action) => action.type === 'add_captions'));
  assert.ok(plan.unavailable.some((reason) => /Local AI model required/i.test(reason)));
});

test('semantic highlight requests never invent cut ranges even when a local LLM is ready', async () => {
  const project = fixture();
  const plan = await prepareCommand('Remove the boring parts.', project, null, { modelStatus: { llm: { installed: true, runtimeAvailable: true } } });
  assert.equal(plan.actions.length, 0);
  assert.ok(plan.unavailable.some((reason) => /cannot inspect footage/i.test(reason)));
});

test('local language model plans cannot fabricate captions or invoke unregistered tools', () => {
  const project = fixture();
  assert.throws(() => validateLocalPlan({ actions: [{ tool: 'add_captions', arguments: { segments: [{ startTime: 1, endTime: 2, text: 'invented transcript' }] } }] }, project), /Blocked unsupported AI tool/);
  assert.throws(() => validateLocalPlan({ actions: [{ tool: 'run_shell', arguments: { command: 'anything' } }] }, project), /Blocked unsupported AI tool/);
  const plan = validateLocalPlan({ summary: 'Remove the opening', actions: [{ tool: 'remove_range', arguments: { start: 0, end: 3 } }] }, project);
  assert.deepEqual(plan.actions, [{ type: 'remove_range', start: 0, end: 3, ripple: true }]);
});

test('transcript and zoom timecodes stay aligned when ripple cuts are in the same reviewed plan', () => {
  const project = fixture();
  const store = new ProjectStore(project);
  const plan = {
    command: 'Remove intro and add captions',
    cache: [], warnings: [], unavailable: [],
    actions: [
      { type: 'remove_range', start: 0, end: 5 },
      { type: 'add_captions', segments: [{ startTime: 8, endTime: 9, text: 'Real transcript segment' }] },
      { type: 'add_speech_zooms', segments: [{ startTime: 8, endTime: 9 }], zoom: 1.12 },
    ],
  };
  applyPlan(store, plan);
  const caption = store.project.tracks.find((track) => track.type === 'caption').clips[0];
  assert.equal(caption.startTime, 3);
  const video = store.project.tracks.find((track) => track.type === 'video').clips[0];
  assert.deepEqual(video.keyframes.map((keyframe) => Number(keyframe.time.toFixed(2))), [3, 3.88, 4]);
});

test('caption clips are transformed by a later ripple edit rather than left out of sync', () => {
  const project = fixture();
  addCaptionSegments(project, [{ start: 10, end: 11, text: 'A timestamped caption' }]);
  const store = new ProjectStore(project);
  applyPlan(store, { command: 'Remove the opening', cache: [], actions: [{ type: 'remove_range', start: 0, end: 4 }] });
  const caption = store.project.tracks.find((track) => track.type === 'caption').clips[0];
  assert.equal(caption.startTime, 6);
});
