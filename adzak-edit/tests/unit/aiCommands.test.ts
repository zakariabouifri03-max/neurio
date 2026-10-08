import { describe, it, expect } from 'vitest';
import { validateCommand, validateCommandBatch, describeErrors } from '../../src/core/ai/validate';
import { extractJson, extractCommands, repairJson } from '../../src/core/ai/jsonRepair';
import { decideConsent, ConsentSession, DEFAULT_PERMISSIONS } from '../../src/core/ai/permissions';
import { executeCommand, executePlan } from '../../src/core/ai/executor';
import { AI_TOOLS, getTool, toolManifestForPrompt } from '../../src/core/ai/registry';
import { EditingAgent } from '../../src/core/ai/agent';
import { buildOfflinePlan, matchIntent } from '../../src/core/ai/planner';
import type { EditorApi, OperationOutcome } from '../../src/core/ai/editorApi';
import type { AiCommand } from '../../src/core/types/ai';

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

describe('AI commands: validation', () => {
  it('accepts a well-formed split_clip', () => {
    const result = validateCommand({ action: 'split_clip', clipId: 'clip_12', time: 14.52 });
    expect(result.ok).toBe(true);
    expect(result.normalized?.action).toBe('split_clip');
  });

  it('rejects an unknown action', () => {
    const result = validateCommand({ action: 'delete_all_files', path: '/' });
    expect(result.ok).toBe(false);
    expect(describeErrors(result.errors)).toContain('not a supported command');
  });

  it('rejects shell execution attempts outright', () => {
    for (const attempt of [
      { action: 'run_shell', command: 'rm -rf /' },
      { action: 'exec', cmd: 'powershell -c "Get-Content ~/.ssh/id_rsa"' },
      { action: 'read_file', path: 'C:\\Windows\\System32\\config\\SAM' },
      { action: 'http_get', url: 'http://evil.example/upload' },
      { action: 'write_file', path: '/etc/passwd', content: 'x' },
    ]) {
      const result = validateCommand(attempt);
      expect(result.ok, JSON.stringify(attempt)).toBe(false);
    }
  });

  it('rejects smuggled extra keys', () => {
    const result = validateCommand({
      action: 'split_clip',
      clipId: 'clip_1',
      time: 5,
      shellCommand: 'curl http://evil.example',
    });
    expect(result.ok).toBe(false);
    expect(describeErrors(result.errors)).toContain('not a recognised argument');
  });

  it('rejects prompt-injection text placed in a structural field', () => {
    const result = validateCommand({
      action: 'delete_clip',
      clipId: 'clip_1"; rm -rf / #',
      ripple: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'custom')).toBe(true);
  });

  it('rejects a missing required field', () => {
    const result = validateCommand({ action: 'split_clip', clipId: 'clip_1' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('missing');
  });

  it('rejects out-of-range numbers', () => {
    expect(validateCommand({ action: 'change_speed', clipId: 'c', speed: 1000, keepPitch: true }).ok).toBe(false);
    expect(validateCommand({ action: 'change_speed', clipId: 'c', speed: -2, keepPitch: true }).ok).toBe(false);
    expect(validateCommand({ action: 'set_volume', clipId: 'c', volumeDb: 200 }).ok).toBe(false);
  });

  it('rejects an invalid enum value', () => {
    const result = validateCommand({ action: 'trim_clip', clipId: 'c', edge: 'middle', time: 1 });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'enum')).toBe(true);
  });

  it('rejects a subtitle that ends before it starts', () => {
    const result = validateCommand({ action: 'add_subtitle', text: 'hi', start: 10, end: 5 });
    expect(result.ok).toBe(false);
    expect(describeErrors(result.errors)).toContain('must end after it starts');
  });

  it('rejects a crop that leaves no visible area', () => {
    const result = validateCommand({
      action: 'crop_video',
      clipId: 'c',
      top: 0.1,
      right: 0.48,
      bottom: 0.1,
      left: 0.48,
    });
    expect(result.ok).toBe(false);
    expect(describeErrors(result.errors)).toContain('no horizontal area');
  });

  it('rejects an odd resolution', () => {
    const result = validateCommand({ action: 'resize_video', width: 1081, height: 1920 });
    expect(result.ok).toBe(false);
    expect(describeErrors(result.errors)).toContain('even');
  });

  it('rejects an unregistered effect id', () => {
    const result = validateCommand({ action: 'add_effect', clipId: 'c', effectId: 'not_a_real_effect' });
    expect(result.ok).toBe(false);
    expect(describeErrors(result.errors)).toContain('Unknown effect');
  });

  it('accepts a registered effect id', () => {
    const result = validateCommand({ action: 'add_effect', clipId: 'c', effectId: 'color.basic' });
    expect(result.ok).toBe(true);
  });

  it('coerces the loose types models actually emit', () => {
    const result = validateCommand({ action: 'split_clip', clipId: 'clip_1', time: '14.52' });
    expect(result.ok).toBe(true);
    expect((result.normalized as unknown as { time: number }).time).toBe(14.52);

    const bool = validateCommand({ action: 'delete_clip', clipId: 'c', ripple: 'true' });
    expect(bool.ok).toBe(true);
    expect((bool.normalized as unknown as { ripple: boolean }).ripple).toBe(true);
  });

  it('rejects non-object payloads', () => {
    expect(validateCommand('split_clip').ok).toBe(false);
    expect(validateCommand(null).ok).toBe(false);
    expect(validateCommand([1, 2, 3]).ok).toBe(false);
    expect(validateCommand(undefined).ok).toBe(false);
  });

  it('accepts an optional reason on any command', () => {
    const result = validateCommand({
      action: 'split_clip',
      clipId: 'c',
      time: 1,
      reason: 'The user asked for a cut here.',
    });
    expect(result.ok).toBe(true);
  });

  it('validates a batch and reports the failing index', () => {
    const batch = validateCommandBatch([
      { action: 'split_clip', clipId: 'c', time: 1 },
      { action: 'split_clip', clipId: 'c' },
      { action: 'split_clip', clipId: 'c', time: 3 },
    ]);
    expect(batch.ok).toBe(false);
    if (batch.ok) return;
    expect(batch.index).toBe(1);
  });
});

describe('AI commands: registry', () => {
  it('every tool declares a risk level and a schema', () => {
    for (const tool of AI_TOOLS) {
      expect(['safe', 'moderate', 'destructive']).toContain(tool.risk);
      expect(tool.schema.type).toBe('object');
      expect(typeof tool.humanTitle({})).toBe('string');
    }
  });

  it('destructive tools never default to auto-apply', () => {
    for (const tool of AI_TOOLS.filter((t) => t.risk === 'destructive')) {
      expect(tool.defaultPolicy).toBe('confirm-always');
    }
  });

  it('read-only tools are marked batchable', () => {
    for (const tool of AI_TOOLS.filter((t) => t.readOnly)) {
      expect(tool.batchable).toBe(true);
    }
  });

  it('the prompt manifest mentions every tool', () => {
    const manifest = toolManifestForPrompt();
    for (const tool of AI_TOOLS) expect(manifest).toContain(tool.name);
  });

  it('exposes the documented tool set', () => {
    for (const name of [
      'get_project',
      'get_selected_clip',
      'get_timeline',
      'search_media',
      'split_clip',
      'trim_clip',
      'move_clip',
      'delete_clip',
      'add_text',
      'add_subtitle',
      'change_speed',
      'crop_video',
      'resize_video',
      'add_transition',
      'add_effect',
      'set_volume',
      'create_sequence',
      'export_video',
    ]) {
      expect(getTool(name), name).toBeDefined();
    }
  });
});

/* ------------------------------------------------------------------ *
 * JSON extraction
 * ------------------------------------------------------------------ */

describe('AI commands: JSON extraction', () => {
  it('reads plain JSON', () => {
    const result = extractJson('{"action":"get_project"}');
    expect(result.ok).toBe(true);
  });

  it('reads JSON from a markdown fence', () => {
    const result = extractJson('Sure! Here you go:\n```json\n[{"action":"get_project"}]\n```\nHope that helps.');
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.value)).toBe(true);
  });

  it('finds JSON buried in prose with no fence', () => {
    const result = extractJson('I will do this: {"action":"split_clip","clipId":"c","time":2} — let me know.');
    expect(result.ok).toBe(true);
  });

  it('repairs trailing commas and unquoted keys', () => {
    const result = extractJson('{action: "get_project",}');
    expect(result.ok).toBe(true);
  });

  it('repairs smart quotes', () => {
    expect(repairJson('{“action”:“get_project”}')).toContain('"action"');
  });

  it('unwraps the commands array from a wrapper object', () => {
    const result = extractCommands('{"commands":[{"action":"get_project"}]}');
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.value)).toBe(true);
  });

  it('fails cleanly on prose with no JSON', () => {
    const result = extractJson("I'm sorry, I can't do that.");
    expect(result.ok).toBe(false);
  });

  it('fails cleanly on an empty response', () => {
    expect(extractJson('').ok).toBe(false);
    expect(extractJson('   ').ok).toBe(false);
  });

  it('is not confused by braces inside strings', () => {
    const result = extractJson('{"action":"add_text","text":"use {curly} braces","start":0,"duration":2}');
    expect(result.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Consent
 * ------------------------------------------------------------------ */

describe('AI commands: consent', () => {
  it('auto-approves read-only tools', () => {
    const command: AiCommand = { action: 'get_project' };
    const decision = decideConsent(command, DEFAULT_PERMISSIONS, new ConsentSession());
    expect(decision.autoApprove).toBe(true);
    expect(decision.blocked).toBe(false);
  });

  it('asks before a destructive command even when the tool default is looser', () => {
    const command: AiCommand = { action: 'delete_clip', clipId: 'c', ripple: false };
    const decision = decideConsent(command, DEFAULT_PERMISSIONS, new ConsentSession());
    expect(decision.autoApprove).toBe(false);
    expect(decision.blocked).toBe(false);
  });

  it('blocks every mutation when AI editing is off', () => {
    const settings = { ...DEFAULT_PERMISSIONS, aiEditingEnabled: false };
    const mutating: AiCommand = { action: 'split_clip', clipId: 'c', time: 1 };
    const decision = decideConsent(mutating, settings, new ConsentSession());
    expect(decision.blocked).toBe(true);
    // Reads still work so the assistant can at least answer questions.
    expect(decideConsent({ action: 'get_project' }, settings, new ConsentSession()).blocked).toBe(false);
  });

  it('honours an explicit block list', () => {
    const settings = { ...DEFAULT_PERMISSIONS, blocked: ['export_video'] };
    const decision = decideConsent({ action: 'export_video', preset: 'custom' }, settings, new ConsentSession());
    expect(decision.blocked).toBe(true);
  });

  it('remembers a confirm-once grant for the session', () => {
    const session = new ConsentSession();
    const command: AiCommand = { action: 'split_clip', clipId: 'c', time: 1 };
    expect(decideConsent(command, DEFAULT_PERMISSIONS, session).autoApprove).toBe(false);
    session.grant('split_clip');
    expect(decideConsent(command, DEFAULT_PERMISSIONS, session).autoApprove).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Executor
 * ------------------------------------------------------------------ */

function fakeApi(options: { withClip?: boolean } = {}): EditorApi & { calls: string[] } {
  const withClip = options.withClip ?? false;
  const calls: string[] = [];
  const ok: OperationOutcome = { ok: true, ids: [] };
  const record = (name: string) => (..._args: unknown[]) => {
    calls.push(name);
    return ok;
  };
  return {
    calls,
    getProjectSummary: () => ({
      id: 'p',
      name: 'P',
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 10,
      aspectRatio: '16:9',
      assets: withClip ? [{ id: 'a1', name: 'a.mp4', kind: 'video', durationSec: 60, isMissing: false }] : [],
      tracks: withClip ? [{ id: 'v1', name: 'V1', kind: 'video' as const, muted: false, locked: false, hidden: false, clipIds: ['clip_1'] }] : [],
      clipCount: withClip ? 1 : 0,
      selectedClipIds: [],
      availableEffects: [],
      aiAvailable: false,
      isOffline: true,
    }),
    getTimelineSnapshot: () => ({ durationSec: 10, fps: 30, tracks: [], markers: [] }),
    getSelectedClipIds: () => ['clip_1'],
    getClip: (id) => ({
      id,
      name: 'A',
      trackId: 't',
      trackName: 'V1',
      kind: 'media',
      start: 0,
      duration: 5,
      end: 5,
      speed: 1,
      reverse: false,
      volumeDb: 0,
      effects: [],
      isOffline: false,
    }),
    searchMedia: () => [],
    splitClip: record('splitClip') as unknown as EditorApi['splitClip'],
    trimClip: record('trimClip') as unknown as EditorApi['trimClip'],
    moveClip: record('moveClip') as unknown as EditorApi['moveClip'],
    deleteClip: record('deleteClip') as unknown as EditorApi['deleteClip'],
    addText: record('addText') as unknown as EditorApi['addText'],
    addSubtitle: record('addSubtitle') as unknown as EditorApi['addSubtitle'],
    changeSpeed: record('changeSpeed') as unknown as EditorApi['changeSpeed'],
    reverseClip: record('reverseClip') as unknown as EditorApi['reverseClip'],
    cropClip: record('cropClip') as unknown as EditorApi['cropClip'],
    resizeSequence: record('resizeSequence') as unknown as EditorApi['resizeSequence'],
    addTransition: record('addTransition') as unknown as EditorApi['addTransition'],
    addEffect: record('addEffect') as unknown as EditorApi['addEffect'],
    setVolume: record('setVolume') as unknown as EditorApi['setVolume'],
    setKeyframe: record('setKeyframe') as unknown as EditorApi['setKeyframe'],
    createSequence: record('createSequence') as unknown as EditorApi['createSequence'],
    removeSilence: async () => ({ ok: true, segments: [] }),
    transcribeClip: async () => ({ ok: false, needsModel: true }),
    queueExport: record('queueExport') as unknown as EditorApi['queueExport'],
  };
}

describe('AI commands: executor', () => {
  it('runs a valid command through the editor API', async () => {
    const api = fakeApi();
    const result = await executeCommand(
      { action: 'split_clip', clipId: 'clip_1', time: 2 },
      { api, permissions: DEFAULT_PERMISSIONS, session: new ConsentSession(), requestConsent: async () => true },
    );
    expect(result.ok).toBe(true);
    expect(api.calls).toEqual(['splitClip']);
  });

  it('never calls the API for an invalid command', async () => {
    const api = fakeApi();
    const result = await executeCommand(
      { action: 'split_clip', clipId: 'clip_1' },
      { api, permissions: DEFAULT_PERMISSIONS, session: new ConsentSession(), requestConsent: async () => true },
    );
    expect(result.ok).toBe(false);
    expect(api.calls).toEqual([]);
  });

  it('never calls the API for an unknown command', async () => {
    const api = fakeApi();
    const result = await executeCommand(
      { action: 'format_disk' },
      { api, permissions: DEFAULT_PERMISSIONS, session: new ConsentSession(), requestConsent: async () => true },
    );
    expect(result.ok).toBe(false);
    expect(api.calls).toEqual([]);
  });

  it('records a decline when the user cancels', async () => {
    const api = fakeApi();
    const result = await executeCommand(
      { action: 'delete_clip', clipId: 'clip_1', ripple: false },
      { api, permissions: DEFAULT_PERMISSIONS, session: new ConsentSession(), requestConsent: async () => false },
    );
    expect(result.ok).toBe(false);
    expect(result.declined).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('converts dB to linear gain for set_volume', async () => {
    const api = fakeApi();
    const result = await executeCommand(
      { action: 'set_volume', clipId: 'clip_1', volumeDb: -6 },
      { api, permissions: DEFAULT_PERMISSIONS, session: new ConsentSession(), requestConsent: async () => true },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { linearGain: number };
    expect(data.linearGain).toBeCloseTo(0.5012, 3);
  });

  it('stops a plan at the first declined step', async () => {
    const api = fakeApi();
    const commands: AiCommand[] = [
      { action: 'split_clip', clipId: 'c', time: 1 },
      { action: 'delete_clip', clipId: 'c', ripple: false },
      { action: 'split_clip', clipId: 'c', time: 2 },
    ];
    const { results, completed } = await executePlan(commands, {
      api,
      permissions: DEFAULT_PERMISSIONS,
      session: new ConsentSession(),
      // Approve the harmless cut, refuse the deletion.
      requestConsent: async (command) => command.action !== 'delete_clip',
    });
    // Step 1 ran, step 2 was declined, step 3 never started.
    expect(completed).toBe(1);
    expect(results.length).toBe(2);
    expect(results[1]!.declined).toBe(true);
    expect(api.calls).toEqual(['splitClip']);
  });

  it('explains a transcription that needs a model instead of failing silently', async () => {
    const api = fakeApi();
    const result = await executeCommand(
      { action: 'transcribe_clip', clipId: 'clip_1' },
      { api, permissions: DEFAULT_PERMISSIONS, session: new ConsentSession(), requestConsent: async () => true },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Whisper');
  });
});

/* ------------------------------------------------------------------ *
 * Offline planner
 * ------------------------------------------------------------------ */

describe('AI: offline planner', () => {
  it('matches intents from natural language', () => {
    expect(matchIntent('remove silence from my video').id).toBe('remove_silence');
    expect(matchIntent('please add captions').id).toBe('add_captions');
    expect(matchIntent('make this into a 30 second Short').id).toBe('make_short');
    expect(matchIntent('make this into a 30 second Short').targetDurationSec).toBe(30);
    expect(matchIntent('resize to 9:16').id).toBe('resize_vertical');
    expect(matchIntent('clean up the audio noise').id).toBe('improve_audio');
  });

  it('reports unknown requests instead of inventing a plan', () => {
    const api = fakeApi();
    const built = buildOfflinePlan('please order a pizza', api);
    expect(built.unsupported).toBe(true);
    expect(built.plan.steps.length).toBe(0);
    expect(built.plan.warnings.length).toBeGreaterThan(0);
  });

  it('silence removal always starts as a dry run', () => {
    const api = fakeApi({ withClip: true });
    const built = buildOfflinePlan('remove silence', api);
    const step = built.plan.steps.find((s) => s.command.action === 'remove_silence');
    expect(step).toBeDefined();
    expect((step!.command as { dryRun?: boolean }).dryRun).toBe(true);
  });

  it('drops steps that need a clip when the timeline is empty', () => {
    const api = fakeApi();
    const built = buildOfflinePlan('remove silence', api);
    expect(built.plan.steps.every((s) => s.command.action !== 'remove_silence')).toBe(true);
  });
});

describe('AI: agent', () => {
  it('falls back to the offline planner when no provider is configured', async () => {
    const agent = new EditingAgent({
      api: fakeApi(),
      permissions: DEFAULT_PERMISSIONS,
      session: new ConsentSession(),
      provider: null,
      requestConsent: async () => true,
    });
    const { plan, source } = await agent.createPlan('remove silence');
    expect(source).toBe('offline-rules');
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('falls back when the provider throws', async () => {
    const agent = new EditingAgent({
      api: fakeApi(),
      permissions: DEFAULT_PERMISSIONS,
      session: new ConsentSession(),
      provider: {
        id: 'broken',
        label: 'Broken',
        requiresInternet: false,
        isAvailable: async () => true,
        listModels: async () => [],
        completeJson: async <T,>(): Promise<T> => {
          throw new Error('connection refused');
        },
      },
      requestConsent: async () => true,
    });
    const { source } = await agent.createPlan('remove silence');
    expect(source).toBe('offline-rules');
  });

  it('falls back when the model returns garbage', async () => {
    const agent = new EditingAgent({
      api: fakeApi(),
      permissions: DEFAULT_PERMISSIONS,
      session: new ConsentSession(),
      provider: {
        id: 'nonsense',
        label: 'Nonsense',
        requiresInternet: false,
        isAvailable: async () => true,
        listModels: async () => [],
        completeJson: async <T,>(): Promise<T> => 'I am a helpful assistant!' as unknown as T,
      },
      requestConsent: async () => true,
    });
    const { source } = await agent.createPlan('remove silence');
    expect(source).toBe('offline-rules');
  });

  it('uses a valid model plan when one is returned', async () => {
    const agent = new EditingAgent({
      api: fakeApi({ withClip: true }),
      permissions: DEFAULT_PERMISSIONS,
      session: new ConsentSession(),
      provider: {
        id: 'good',
        label: 'Good',
        requiresInternet: false,
        isAvailable: async () => true,
        listModels: async () => [],
        completeJson: async <T,>(): Promise<T> =>
          [{ action: 'split_clip', clipId: 'clip_1', time: 3, reason: 'cut here' }] as unknown as T,
      },
      requestConsent: async () => true,
    });
    const { plan, source } = await agent.createPlan('cut at 3 seconds');
    expect(source).toBe('local-model');
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0]!.command.action).toBe('split_clip');
  });

  it('rejects a model plan containing an invalid command', async () => {
    const agent = new EditingAgent({
      api: fakeApi(),
      permissions: DEFAULT_PERMISSIONS,
      session: new ConsentSession(),
      provider: {
        id: 'malicious',
        label: 'Malicious',
        requiresInternet: false,
        isAvailable: async () => true,
        listModels: async () => [],
        completeJson: async <T,>(): Promise<T> =>
          [
            { action: 'split_clip', clipId: 'clip_1', time: 3 },
            { action: 'rm_rf', path: '/' },
          ] as unknown as T,
      },
      requestConsent: async () => true,
    });
    const { source } = await agent.createPlan('do something');
    // The whole batch is rejected, not just the bad command.
    expect(source).toBe('offline-rules');
  });
});
