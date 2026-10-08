import { useEffect, useRef, useState } from 'react';
import { useAi, AI_SUGGESTIONS } from '../store/aiStore';
import { useSettings } from '../store/settingsStore';
import { useEditor } from '../store/editorStore';
import { Icons } from '../components/Icons';
import { explainCommand } from '../../core/ai/agent';
import { brand } from '../../brand';
import { clsx } from 'clsx';

/**
 * AI panel.
 *
 * The assistant proposes a plan and shows it *before* anything changes. Nothing
 * in here can bypass the consent layer — the "Run" button feeds the plan through
 * the same validator and permission checks as any other AI command.
 */

export function AiPanel() {
  const { entries, pendingPlan, consentQueue, thinking, providerStatus } = useAi();
  const { sendMessage, runSuggestion, runPendingPlan, discardPendingPlan, respondConsent, respondConsentAll } = useAi.getState();
  const providerId = useSettings((s) => s.settings.ai.providerId);
  const capabilities = useEditor((s) => s.capabilities);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, pendingPlan, consentQueue, thinking]);

  const submit = () => {
    const text = draft.trim();
    if (!text || thinking) return;
    setDraft('');
    void sendMessage(text);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="panel-header">
        <Icons.Sparkle size={14} className="text-brand-400" />
        <span>AI Editor</span>
        <span
          className={clsx(
            'ml-auto chip',
            providerStatus === 'ready' ? 'border-brand-500/50 text-brand-300 bg-brand-600/15' : 'border-ink-700 text-ink-400',
          )}
          title={
            providerId === 'offline'
              ? 'Using the built-in offline assistant. Connect a local model in Settings → AI for free-form requests.'
              : providerStatus === 'ready'
                ? 'Local model connected.'
                : 'Local model not reachable — falling back to the offline assistant.'
          }
        >
          {providerId === 'offline' ? 'Offline assistant' : providerStatus === 'ready' ? 'Local model' : 'Fallback'}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 scroll-area p-3 space-y-3">
        {entries.map((entry) => (
          <div key={entry.id} className={clsx('text-[12px] leading-relaxed', entry.role === 'user' && 'text-right')}>
            {entry.role === 'user' ? (
              <span className="inline-block bg-ink-750 border border-ink-700 rounded-lg rounded-br-sm px-2.5 py-1.5 text-ink-100 max-w-[90%] text-left">
                {entry.text}
              </span>
            ) : entry.role === 'system' ? (
              <div className="flex items-start gap-1.5 text-ink-400">
                <Icons.Info size={12} className="mt-0.5 shrink-0 text-accent" />
                <span className="whitespace-pre-wrap">{entry.text}</span>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-md bg-brand-600/20 border border-brand-500/40 flex items-center justify-center text-brand-300 shrink-0">
                  <Icons.Sparkle size={12} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="whitespace-pre-wrap text-ink-200">{entry.text}</p>
                  {entry.plan && entry.plan.steps.length > 0 && <PlanCard plan={entry.plan} source={entry.planSource ?? null} />}
                  {entry.plan && entry.plan.warnings.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {entry.plan.warnings.map((warning, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[11px] text-accent-warm/90">
                          <Icons.Warning size={11} className="mt-0.5 shrink-0" />
                          <span>{warning}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {thinking && (
          <div className="flex items-center gap-2 text-[11px] text-ink-400">
            <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse-soft" />
            Working on your timeline…
          </div>
        )}

        {consentQueue.length > 0 && (
          <div className="panel p-2.5 border-accent-warm/50">
            <div className="flex items-center gap-1.5 text-[11px] text-accent-warm mb-1.5">
              <Icons.Warning size={13} />
              <span className="font-medium">Needs your approval</span>
            </div>
            {consentQueue.map((request) => (
              <div key={request.id} className="mb-2 last:mb-0">
                <p className="text-[11px] text-ink-200 whitespace-pre-wrap mb-1.5">{request.summary}</p>
                <div className="flex gap-1.5">
                  <button className="btn-primary h-7 text-[11px]" onClick={() => respondConsent(request.id, true)}>
                    <Icons.Check size={12} />
                    Allow
                  </button>
                  <button className="btn h-7 text-[11px]" onClick={() => respondConsent(request.id, false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ))}
            {consentQueue.length > 1 && (
              <div className="flex gap-1.5 pt-1 border-t border-ink-800 mt-2">
                <button className="btn h-6 text-[10px] flex-1" onClick={() => respondConsentAll(true)}>
                  Allow all ({consentQueue.length})
                </button>
                <button className="btn h-6 text-[10px] flex-1" onClick={() => respondConsentAll(false)}>
                  Refuse all
                </button>
              </div>
            )}
          </div>
        )}

        {entries.length <= 1 && (
          <div className="pt-1">
            <p className="text-[10px] uppercase tracking-wider text-ink-500 mb-2">Suggestions</p>
            <div className="flex flex-wrap gap-1.5">
              {AI_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.label}
                  className="chip border-ink-700 text-ink-300 hover:border-brand-500/60 hover:text-brand-300 px-2 py-1"
                  onClick={() => void runSuggestion(suggestion.prompt)}
                  disabled={thinking}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {pendingPlan && pendingPlan.steps.length > 0 && (
        <div className="shrink-0 border-t border-ink-800 p-2 flex gap-1.5 bg-ink-850">
          <button className="btn-primary h-8 flex-1" onClick={() => void runPendingPlan()} disabled={thinking}>
            <Icons.Bolt size={13} />
            Apply {pendingPlan.steps.length} step{pendingPlan.steps.length === 1 ? '' : 's'}
          </button>
          <button className="btn h-8" onClick={discardPendingPlan} disabled={thinking}>
            Discard
          </button>
        </div>
      )}

      <div className="shrink-0 border-t border-ink-800 p-2">
        <div className="flex gap-1.5 items-end">
          <textarea
            className="field h-16 py-1.5 resize-none text-[12px]"
            placeholder='What do you want to do? e.g. "Make this into a 30 second Short"'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button className="btn-primary h-8 w-9 shrink-0" onClick={submit} disabled={thinking || !draft.trim()} title="Send">
            <Icons.Send size={14} />
          </button>
        </div>
        <p className="text-[9px] text-ink-600 mt-1.5 leading-relaxed">
          Runs on your machine. {brand.name} never uploads your media. Destructive steps always ask first, and every
          change is undoable.
          {capabilities && !capabilities.ffmpeg && ' This browser build cannot export MP4 — use the desktop app for that.'}
        </p>
      </div>
    </div>
  );
}

function PlanCard({ plan, source }: { plan: NonNullable<ReturnType<typeof useAi.getState>['pendingPlan']>; source: 'local-model' | 'offline-rules' | null }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-2 rounded-md border border-ink-700 bg-ink-850 overflow-hidden">
      <button
        className="w-full flex items-center gap-1.5 px-2 h-7 text-[10px] uppercase tracking-wider text-ink-400 hover:text-ink-200"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={clsx('transition-transform', open && 'rotate-90')}>›</span>
        Plan · {plan.steps.length} step{plan.steps.length === 1 ? '' : 's'}
        <span className="ml-auto normal-case tracking-normal text-[9px] text-ink-600">
          {source === 'local-model' ? 'local model' : 'built-in rules'}
        </span>
      </button>
      {open && (
        <ol className="px-2 pb-2 space-y-1">
          {plan.steps.map((step, index) => (
            <li key={step.id} className="flex items-start gap-1.5 text-[11px]">
              <span className="mono text-[9px] text-ink-600 mt-0.5 w-4 shrink-0">{index + 1}.</span>
              <span className="flex-1 text-ink-300">{explainCommand(step.command)}</span>
              <RiskBadge risk={step.risk} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RiskBadge({ risk }: { risk: 'safe' | 'moderate' | 'destructive' }) {
  if (risk === 'safe') return null;
  return (
    <span
      className={clsx(
        'chip shrink-0',
        risk === 'destructive'
          ? 'border-accent-danger/50 text-accent-danger bg-accent-danger/10'
          : 'border-accent-warm/50 text-accent-warm bg-accent-warm/10',
      )}
    >
      {risk === 'destructive' ? 'asks' : 'undoable'}
    </span>
  );
}
