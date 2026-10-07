/**
 * Filler-word removal ("um", "uh", "euh", "like"…): uses word-level timings from caption clips
 * (produced by auto captions) to cut the matching spans out of the media clips underneath and ripple
 * the timeline closed. Deterministic — no model needed beyond the captions already generated.
 */
import type { CaptionClip, Clip, Project } from '@/core/types';
import { useProject } from '@/core/store';
import * as cmd from '@/core/commands';
import { applySilenceRemoval, type SilencePlan } from './edits';

export const FILLER_SETS: Record<string, { label: string; words: string[] }> = {
  en: { label: 'English', words: ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm', 'like', 'you know', 'basically', 'literally', 'actually', 'so yeah'] },
  fr: { label: 'French', words: ['euh', 'euhh', 'heu', 'hum', 'ben', 'bah', 'genre', 'en fait', 'du coup', 'voilà', 'quoi'] },
  es: { label: 'Spanish', words: ['eh', 'ehh', 'em', 'este', 'o sea', 'pues', 'bueno', 'digamos', 'tipo'] },
  ar: { label: 'Arabic / Darija', words: ['يعني', 'اه', 'آه', 'أه', 'امم', 'إمم', 'زعما', 'يعنى', 'واخا', 'إيوا', 'ايوا'] },
  de: { label: 'German', words: ['äh', 'ähm', 'hm', 'halt', 'quasi', 'sozusagen', 'genau'] },
};
export const CORE_FILLERS = ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'mm', 'mhm', 'euh', 'euhh', 'heu', 'äh', 'ähm', 'eh', 'ehh', 'امم', 'إمم', 'اه', 'آه'];

const norm = (s: string) => s.toLowerCase().replace(/[.,!?;:…"'()\[\]«»]/g, '').trim();

export interface FillerHit {
  text: string;
  start: number; // timeline seconds
  end: number;
  captionId: string;
}

export function findFillers(p: Project, opts: { langs?: string[]; includeDiscourse?: boolean; onlySelected?: string[] } = {}): FillerHit[] {
  const sets = (opts.langs ?? Object.keys(FILLER_SETS)).map((k) => FILLER_SETS[k]).filter(Boolean);
  const vocab = new Set<string>(CORE_FILLERS);
  if (opts.includeDiscourse) sets.forEach((s) => s.words.forEach((w) => vocab.add(w)));
  const phrases = [...vocab].filter((w) => w.includes(' '));
  const hits: FillerHit[] = [];
  const caps = cmd.allClips(p).filter((c): c is CaptionClip => c.kind === 'caption' && (!opts.onlySelected || opts.onlySelected.includes(c.id)));
  for (const c of caps) {
    const ws = c.words || [];
    for (let i = 0; i < ws.length; i++) {
      const w = norm(ws[i].text);
      if (!w) continue;
      // two-word phrases
      const two = ws[i + 1] ? `${w} ${norm(ws[i + 1].text)}` : '';
      if (two && phrases.includes(two)) {
        hits.push({ text: `${ws[i].text} ${ws[i + 1].text}`, start: c.start + ws[i].start, end: c.start + ws[i + 1].end, captionId: c.id });
        i++;
        continue;
      }
      if (vocab.has(w)) hits.push({ text: ws[i].text, start: c.start + ws[i].start, end: c.start + ws[i].end, captionId: c.id });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** Build removal plans targeting the media clips under each filler and apply them (ripple). */
export function removeFillers(hits: FillerHit[], padding = 0.03): number {
  const st = useProject.getState();
  const p = st.project;
  if (!p || !hits.length) return 0;
  const plans: SilencePlan[] = [];
  for (const h of hits) {
    const s = Math.max(0, h.start - padding), e = h.end + padding;
    if (e - s < 0.08) continue;
    const under = cmd.clipsInRange(p, s, e).filter((c: Clip) => (c.kind === 'video' || c.kind === 'audio') && c.start <= s && c.start + c.duration >= e);
    const target = under.find((c) => c.kind === 'video') ?? under[0];
    if (!target) continue;
    let plan = plans.find((pl) => pl.clipId === target.id);
    if (!plan) plans.push((plan = { clipId: target.id, ranges: [], removed: 0 }));
    plan.ranges.push({ start: s, end: e });
    plan.removed += e - s;
  }
  // merge overlapping ranges per clip
  for (const pl of plans) {
    pl.ranges.sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const r of pl.ranges) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end + 0.01) last.end = Math.max(last.end, r.end);
      else merged.push({ ...r });
    }
    pl.ranges = merged;
  }
  return applySilenceRemoval(plans, 'Remove filler words');
}
