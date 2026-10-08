import { create } from 'zustand';
import { EditingAgent } from '../../core/ai/agent';
import { ConsentSession } from '../../core/ai/permissions';
import type { AiCommand, AiExecutionResult, AiPlan, AiProvider } from '../../core/types/ai';
import { buildEditorApi } from './editorApi';
import { useSettings } from './settingsStore';
import { useEditor } from './editorStore';
import { OllamaProvider } from '../../core/ai/providers/ollama';
import { LlamaCppProvider } from '../../core/ai/providers/llamacpp';
import { AI_SUGGESTIONS } from '../../core/ai/planner';

/**
 * AI panel state: the conversation, the pending plan and the consent queue.
 *
 * The consent queue is the human-in-the-loop mechanism. The agent never applies
 * anything by itself — it appends a `ConsentRequest` and waits for the user.
 */

export interface ChatEntry {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  at: number;
  /** Attached plan, when the agent proposed one. */
  plan?: AiPlan;
  planSource?: 'local-model' | 'offline-rules';
  /** Results of an executed plan. */
  results?: AiExecutionResult[];
}

export interface PendingConsent {
  id: string;
  command: AiCommand;
  summary: string;
  resolve: (allowed: boolean) => void;
}

interface AiState {
  entries: ChatEntry[];
  pendingPlan: AiPlan | null;
  planSource: 'local-model' | 'offline-rules' | null;
  consentQueue: PendingConsent[];
  thinking: boolean;
  providerStatus: 'unknown' | 'ready' | 'unavailable';
  modelList: { id: string; sizeBytes?: number }[];
  /** Commands the agent has already run this session, for the activity log. */
  activity: { command: AiCommand; ok: boolean; error?: string; at: number }[];

  sendMessage: (text: string) => Promise<void>;
  runSuggestion: (prompt: string) => Promise<void>;
  runPendingPlan: () => Promise<void>;
  discardPendingPlan: () => void;
  respondConsent: (id: string, allowed: boolean) => void;
  respondConsentAll: (allowed: boolean) => void;
  refreshProvider: () => Promise<void>;
  clearChat: () => void;
}

let agent: EditingAgent | null = null;
const session = new ConsentSession();

function buildAgent(): EditingAgent {
  const settings = useSettings.getState().settings.ai;
  let provider: AiProvider | null = null;
  if (settings.providerId === 'ollama') {
    provider = new OllamaProvider({ baseUrl: settings.ollamaUrl, model: settings.ollamaModel });
  } else if (settings.providerId === 'llamacpp') {
    provider = new LlamaCppProvider({ baseUrl: settings.llamacppUrl });
  }

  const enqueueConsent = (command: AiCommand, summary: string) =>
    new Promise<boolean>((resolve) => {
      const id = `consent_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      useAi.setState((state) => ({ consentQueue: [...state.consentQueue, { id, command, summary, resolve }] }));
    });

  return new EditingAgent({
    api: buildEditorApi(),
    permissions: settings.permissions,
    session,
    provider,
    requestConsent: enqueueConsent,
    onProgress: (message) =>
      useAi.setState((state) => ({
        entries: [...state.entries, { id: `sys_${Date.now()}`, role: 'system', text: message, at: Date.now() }],
      })),
    onExecuted: (result) =>
      useAi.setState((state) => ({
        activity: [
          ...state.activity.slice(-49),
          { command: result.command, ok: result.ok, ...(result.error ? { error: result.error } : {}), at: Date.now() },
        ],
      })),
  });
}

export const useAi = create<AiState>((set, get) => ({
  entries: [
    {
      id: 'welcome',
      role: 'agent',
      text:
        'I am the ADZAK editing assistant. Tell me what you want to do — "remove the silences", "add captions", "make this into a 30 second Short" — and I will show you a plan before I change anything.\n\n' +
        'Everything runs on your machine. No video is uploaded, and every change is undoable with Ctrl+Z.',
      at: Date.now(),
    },
  ],
  pendingPlan: null,
  planSource: null,
  consentQueue: [],
  thinking: false,
  providerStatus: 'unknown',
  modelList: [],
  activity: [],

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().thinking) return;
    set((state) => ({
      thinking: true,
      entries: [...state.entries, { id: `u_${Date.now()}`, role: 'user', text: trimmed, at: Date.now() }],
    }));

    agent ??= buildAgent();
    // Rebuild the agent so a settings change (provider, permissions) takes effect.
    const settings = useSettings.getState().settings.ai;
    agent = buildAgent();
    void settings;

    try {
      const { plan, source } = await agent.createPlan(trimmed);
      set((state) => ({
        thinking: false,
        entries: [
          ...state.entries,
          {
            id: `a_${Date.now()}`,
            role: 'agent',
            text: plan.summary,
            at: Date.now(),
            plan,
            planSource: source,
          },
        ],
        ...(plan.steps.length ? { pendingPlan: plan, planSource: source } : {}),
      }));
      if (plan.warnings.length) {
        useEditor.getState().toast({ kind: 'info', title: 'Notes from the assistant', message: plan.warnings[0] });
      }
    } catch (error) {
      set((state) => ({
        thinking: false,
        entries: [
          ...state.entries,
          { id: `e_${Date.now()}`, role: 'system', text: `Something went wrong: ${(error as Error).message}`, at: Date.now() },
        ],
      }));
    }
  },

  runSuggestion: (prompt) => get().sendMessage(prompt),

  runPendingPlan: async () => {
    const plan = get().pendingPlan;
    agent ??= buildAgent();
    if (!plan || !agent) return;
    set({ thinking: true });
    const { results, completed } = await agent.runPlan(plan);
    set((state) => ({
      thinking: false,
      pendingPlan: null,
      entries: [
        ...state.entries,
        {
          id: `r_${Date.now()}`,
          role: 'system',
          text:
            completed === plan.steps.length
              ? `Done — ${completed} change${completed === 1 ? '' : 's'} applied. Press Ctrl+Z to undo.`
              : `Applied ${completed} of ${plan.steps.length} steps. Stopped at: ${
                  results.find((r) => !r.ok)?.error ?? 'an unapproved step'
                }`,
          at: Date.now(),
          results,
        },
      ],
    }));
  },

  discardPendingPlan: () =>
    set((state) => ({
      pendingPlan: null,
      entries: [...state.entries, { id: `d_${Date.now()}`, role: 'system', text: 'Plan discarded. Nothing was changed.', at: Date.now() }],
    })),

  respondConsent: (id, allowed) => {
    const request = get().consentQueue.find((c) => c.id === id);
    if (!request) return;
    request.resolve(allowed);
    set((state) => ({ consentQueue: state.consentQueue.filter((c) => c.id !== id) }));
  },

  respondConsentAll: (allowed) => {
    for (const request of get().consentQueue) request.resolve(allowed);
    set({ consentQueue: [] });
  },

  refreshProvider: async () => {
    agent = buildAgent();
    const settings = useSettings.getState().settings.ai;
    if (settings.providerId === 'offline') {
      set({ providerStatus: 'ready', modelList: [] });
      return;
    }
    const provider: AiProvider =
      settings.providerId === 'ollama'
        ? new OllamaProvider({ baseUrl: settings.ollamaUrl, model: settings.ollamaModel })
        : new LlamaCppProvider({ baseUrl: settings.llamacppUrl });
    try {
      const available = await provider.isAvailable();
      const models = available ? await provider.listModels() : [];
      set({ providerStatus: available ? 'ready' : 'unavailable', modelList: models });
    } catch {
      set({ providerStatus: 'unavailable', modelList: [] });
    }
  },

  clearChat: () => set({ entries: [], activity: [], pendingPlan: null, consentQueue: [] }),
}));

export { AI_SUGGESTIONS };
