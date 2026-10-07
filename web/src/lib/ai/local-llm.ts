/**
 * Prism offline writing engine.
 *
 * Used whenever no LLM provider is configured (and as a fallback if a provider
 * errors). It is deterministic, runs in microseconds, costs nothing, and still
 * produces genuinely useful copy: the topic is analysed for keywords and
 * intent, then a feature-specific template bank is filled in.
 *
 * Results are labelled "Prism offline engine" in the UI so users always know
 * which engine produced them.
 */

export type WriteFeature =
  | 'generate'
  | 'rewrite'
  | 'summarize'
  | 'expand'
  | 'shorten'
  | 'tone'
  | 'grammar'
  | 'marketing'
  | 'caption'
  | 'product'
  | 'headline'
  | 'blog'
  | 'name'
  | 'hashtags'
  | 'translate';

export type LocalWriteRequest = {
  prompt: string;
  system?: string;
  feature?: string;
  tone?: string;
  maxTokens?: number;
};

/* ------------------------------------------------------------------ analysis */

const STOP_WORDS = new Set(
  `a an the and or but if then than that this these those is are was were be been being do does did doing have has had having i you he she it we they me him her them my your his its our their of in on at to from for with without into over under again further once here there all any both each few more most other some such no nor not only own same so too very can will just should now about make made making create design new using use`.split(
    ' ',
  ),
);

export function keywords(text: string, limit = 6): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

export function seededRandom(seedText: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function topicOf(prompt: string): string {
  const cleaned = prompt
    .replace(/^(write|create|generate|make|draft|give me|i need)\b[:\s]*/i, '')
    .replace(/\b(a|an|the)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const firstSentence = cleaned.split(/[.\n!?]/)[0]?.trim() ?? cleaned;
  return firstSentence.length > 90 ? firstSentence.slice(0, 90).replace(/\s+\S*$/, '') : firstSentence || 'your project';
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/* --------------------------------------------------------------- generators */

const HEADLINE_FORMULAS = [
  (t: string, k: string[]) => `${titleCase(t)}`,
  (t: string, k: string[]) => `The Future of ${titleCase(k[0] ?? t)} Starts Here`,
  (t: string, k: string[]) => `${titleCase(k[0] ?? t)} That Actually Works`,
  (t: string, k: string[]) => `Everything You Need to Know About ${titleCase(t)}`,
  (t: string, k: string[]) => `${titleCase(t)} — Reimagined`,
  (t: string, k: string[]) => `How to Master ${titleCase(t)} in Record Time`,
  (t: string, k: string[]) => `${titleCase(k.slice(0, 2).join(' & '))}: The Complete Guide`,
  (t: string, k: string[]) => `Stop Guessing. Start ${titleCase(t)}.`,
];

const TONE_LEXICON: Record<string, { replace: [RegExp, string][]; opener?: string[]; closer?: string[] }> = {
  professional: {
    replace: [
      [/\breally\b/gi, 'significantly'],
      [/\ba lot of\b/gi, 'a great deal of'],
      [/\bget\b/gi, 'obtain'],
      [/\bhelps?\b/gi, 'enables'],
      [/\bgood\b/gi, 'effective'],
      [/\bbig\b/gi, 'substantial'],
      [/\bbut\b/gi, 'however'],
      [/\bso\b/gi, 'therefore'],
      [/\bawesome\b/gi, 'excellent'],
    ],
  },
  friendly: {
    replace: [
      [/\bobtain\b/gi, 'grab'],
      [/\bsignificantly\b/gi, 'a lot'],
      [/\bhowever\b/gi, 'but'],
      [/\butilize\b/gi, 'use'],
      [/\bassistance\b/gi, 'a hand'],
      [/\bpurchase\b/gi, 'pick up'],
    ],
  },
  persuasive: {
    replace: [
      [/\bgood\b/gi, 'game-changing'],
      [/\bhelps?\b/gi, 'supercharges'],
      [/\bimproves?\b/gi, 'transforms'],
      [/\bfast\b/gi, 'lightning-fast'],
      [/\beasy\b/gi, 'effortless'],
      [/\bnew\b/gi, 'brand-new'],
    ],
  },
  playful: {
    replace: [
      [/\bgood\b/gi, 'seriously good'],
      [/\bgreat\b/gi, 'ridiculously great'],
      [/\bfast\b/gi, 'zippy'],
      [/\bnew\b/gi, 'fresh-out-of-the-box'],
      [/\bproblem\b/gi, 'plot twist'],
    ],
  },
  luxury: {
    replace: [
      [/\bgood\b/gi, 'exceptional'],
      [/\bnice\b/gi, 'refined'],
      [/\bnew\b/gi, 'newly unveiled'],
      [/\bbuy\b/gi, 'acquire'],
      [/\bcheap\b/gi, 'accessible'],
    ],
  },
  minimal: {
    replace: [
      [/\breally very\b/gi, 'very'],
      [/\bjust\b/gi, ''],
      [/\bactually\b/gi, ''],
      [/\bbasically\b/gi, ''],
      [/\bin order to\b/gi, 'to'],
    ],
  },
};

function applyTone(text: string, tone: string): string {
  const rules = TONE_LEXICON[tone.toLowerCase()];
  if (!rules) return text;
  let out = text;
  for (const [pattern, replacement] of rules.replace) out = out.replace(pattern, replacement);
  return out.replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1');
}

function grammarFix(text: string): string {
  const fixes: [RegExp, string | ((...args: string[]) => string)][] = [
    [/\bi\b/g, 'I'],
    [/\s+,/g, ','],
    [/\s+\./g, '.'],
    [/\bteh\b/gi, 'the'],
    [/\brecieve/gi, 'receive'],
    [/\bseperate/gi, 'separate'],
    [/\boccured/gi, 'occurred'],
    [/\bdefinately/gi, 'definitely'],
    [/\balot\b/gi, 'a lot'],
    [/\bcould of|should of|would of/gi, (m) => m.replace(' of', ' have')],
    [/\bits\s+(?=[a-z])/g, "it's "],
    [/([a-z])([A-Z])/g, '$1 $2'],
    [/\b(\w+)\s+\1\b/gi, '$1'],
    [/([.!?])\s*([a-z])/g, (_, p, c) => `${p} ${c.toUpperCase()}`],
    [/\s{2,}/g, ' '],
  ];
  let out = ` ${text.trim()} `;
  for (const [pattern, replacement] of fixes) {
    out =
      typeof replacement === 'function'
        ? out.replace(pattern, replacement as (substring: string, ...args: string[]) => string)
        : out.replace(pattern, replacement);
  }
  out = out.trim();
  if (out && !/[.!?]$/.test(out)) out += '.';
  return out;
}

const HOOKS = [
  'Here is the thing:',
  'Let’s be honest —',
  'Nobody talks about this enough:',
  'Quick story:',
  'Save this before you scroll.',
  'This changed how we work:',
  'Three words:',
];

const CTAS = [
  'Tap the link in bio to get started.',
  'Save this post for later.',
  'Comment your biggest takeaway below.',
  'Share this with someone who needs it.',
  'DM us “START” and we will send the details.',
  'Follow for more behind-the-scenes.',
  'Try it today — your future self will thank you.',
];

export function localText(req: LocalWriteRequest): string {
  const feature = (req.feature ?? 'generate') as WriteFeature;
  const input = (req.prompt ?? '').trim();
  const topic = topicOf(input);
  const keys = keywords(input || topic);
  const rand = seededRandom(input + feature);

  switch (feature) {
    case 'headline': {
      const formulas = [...HEADLINE_FORMULAS].sort(() => rand() - 0.5).slice(0, 5);
      return formulas.map((f, i) => `${i + 1}. ${f(topic, keys)}`).join('\n');
    }

    case 'caption': {
      const hook = pick(HOOKS, rand);
      const hashtags = hashtagsFor(keys, topic, 8, rand);
      return `${hook} ${titleCase(topic)} is not a trend — it is the standard now.\n\nHere is what makes it work:\n• ${titleCase(keys[0] ?? 'quality')} you can feel immediately\n• Built for real people with real deadlines\n• Zero learning curve, maximum output\n\n${pick(CTAS, rand)}\n\n${hashtags}`;
    }

    case 'product': {
      return `${titleCase(topic)}\n\n${titleCase(topic)} is designed for people who refuse to compromise. Every detail — from the materials to the packaging — was engineered to deliver ${keys[0] ?? 'quality'} without the premium price tag.\n\n• Key benefit: built to last, season after season\n• Why it is different: thoughtful design that solves the problem nobody else addresses\n• Who it is for: anyone who values ${keys[1] ?? 'craft'} and wants results on day one\n\nAvailable now — ${pick(['limited stock', 'free shipping worldwide', '30-day money-back guarantee'], rand)}.`;
    }

    case 'marketing': {
      return `${titleCase(topic)}\n\nThe problem: most options make you choose between ${keys[0] ?? 'quality'} and ${keys[1] ?? 'speed'}. You should not have to.\n\nThe solution: ${titleCase(topic)} delivers both. In side-by-side testing it outperformed the category on every metric that matters.\n\n• 3× faster to get started\n• Trusted by teams in 40+ countries\n• Backed by a no-questions-asked guarantee\n\n${pick(CTAS, rand)}`;
    }

    case 'blog': {
      const sections = [
        `Why ${topic} matters right now`,
        `The core principles behind ${topic}`,
        `A step-by-step framework you can apply today`,
        `Common mistakes (and how to avoid them)`,
        `Measuring what actually works`,
        `What the next 12 months look like`,
      ];
      return `# ${titleCase(topic)}\n\n${topic} has quietly become one of the most important levers for teams that want to move faster without burning out. This guide breaks down exactly how to do it.\n\n${sections
        .map(
          (s, i) =>
            `## ${i + 1}. ${s}\n\n${pick(
              [
                `Start with the outcome and work backwards. Teams that define success first ship roughly twice as fast.`,
                `The pattern is consistent across every high-performing team we studied: they keep the loop tight and the feedback honest.`,
                `Most people skip this step, and it is the one that compounds. Small, repeatable wins beat occasional heroics.`,
              ],
              rand,
            )} Focus on ${keys[i % Math.max(keys.length, 1)] ?? 'the fundamentals'} and the rest follows.\n`,
        )
        .join('\n')}\n## Key takeaways\n\n• ${titleCase(keys[0] ?? 'clarity')} beats complexity every time\n• Consistency compounds — small daily progress wins\n• Measure outcomes, not activity\n\n${pick(CTAS, rand)}`;
    }

    case 'summarize': {
      const s = sentences(input);
      if (!s.length) return input;
      const important = s
        .map((sentence, index) => ({ sentence, index, score: keywords(sentence).length + (index === 0 ? 2 : 0) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, Math.min(3, Math.ceil(s.length / 3))))
        .sort((a, b) => a.index - b.index)
        .map((x) => x.sentence);
      return `**Summary**\n${important.map((x) => `• ${x}`).join('\n')}`;
    }

    case 'expand': {
      const s = sentences(input);
      const expanded = s
        .map((sentence) => {
          const k = keywords(sentence, 2);
          return `${sentence} ${pick(
            [
              `In practice, that means ${k[0] ?? 'the details'} get handled first and everything else follows.`,
              `The reason this matters is simple: ${k[0] ?? 'quality'} compounds over time.`,
              `Teams that adopt this early consistently report fewer surprises later on.`,
              `It also removes the guesswork, because the outcome is measured rather than assumed.`,
            ],
            rand,
          )}`;
        })
        .join(' ');
      return `${expanded}\n\nTo put this into action:\n1. Define what success looks like in one sentence.\n2. Pick the smallest version you can ship this week.\n3. Review, adjust, repeat.`;
    }

    case 'shorten': {
      const s = sentences(input);
      const target = Math.max(1, Math.ceil(words(input).length * 0.45));
      let out = '';
      for (const sentence of s) {
        if (words(out).length >= target) break;
        out += (out ? ' ' : '') + sentence;
      }
      return out || input.slice(0, 280);
    }

    case 'rewrite': {
      const s = sentences(input);
      const openers = [
        'Put simply, ',
        'Here is the short version: ',
        'The bottom line: ',
        'In other words, ',
      ];
      return `${pick(openers, rand)}${s.map((x) => x.replace(/^[A-Z]/, (c) => c.toLowerCase())).join(' ')}`;
    }

    case 'tone': {
      return applyTone(input, req.tone ?? 'professional');
    }

    case 'grammar': {
      return grammarFix(input);
    }

    case 'hashtags': {
      return hashtagsFor(keys, topic, 15, rand);
    }

    case 'name': {
      const prefixes = ['North', 'Lumen', 'Vertex', 'Kite', 'Atlas', 'Nova', 'Ember', 'Prism', 'Halcyon', 'Cobalt'];
      const suffixes = ['Studio', 'Works', 'Collective', 'Lab', '& Co.', 'Group', 'House', 'Society'];
      return Array.from({ length: 6 }, () => `${pick(prefixes, rand)}${rand() > 0.5 ? pick(suffixes, rand) : ''}`).join('\n');
    }

    case 'translate': {
      return `[Offline engine] Translation requires a configured language model. Add OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_AI_API_KEY to enable it. Detected ${words(input).length} words in the source text.`;
    }

    case 'generate':
    default: {
      const s = sentences(input);
      if (s.length && input.length > 120) {
        return localText({ ...req, feature: 'expand' });
      }
      return `${titleCase(topic)}\n\n${pick(
        [
          `Built around ${keys[0] ?? 'quality'} and designed to scale, ${topic.toLowerCase()} gives you a professional result in minutes instead of hours.`,
          `${titleCase(topic)} brings structure to the messy middle: plan it, build it, ship it — without switching tools.`,
          `Everything you need for ${topic.toLowerCase()}, in one place. No setup, no learning curve, no compromises.`,
        ],
        rand,
      )}\n\n• Start from a proven template or a blank canvas\n• Customise every detail — colours, type, layout\n• Export print-ready files in a single click\n\n${pick(CTAS, rand)}`;
    }
  }
}

function hashtagsFor(keys: string[], topic: string, count: number, rand: () => number): string {
  const base = [...new Set([...keys, ...topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3)])];
  const generic = ['design', 'creative', 'inspiration', 'studio', 'branding', 'madewithprism', 'visualdesign', 'contentcreator', 'smallbusiness', 'marketing'];
  const pool = [...new Set([...base, ...generic])];
  const chosen = [...pool].sort(() => rand() - 0.5).slice(0, count);
  return chosen.map((k) => `#${k.replace(/[^a-z0-9]/gi, '')}`).join(' ');
}

/** Compact helper used by the AI assistant for structured design commands. */
export const WRITE_FEATURES: { id: WriteFeature; label: string; hint: string }[] = [
  { id: 'generate', label: 'Generate', hint: 'Write copy from a short brief' },
  { id: 'rewrite', label: 'Rewrite', hint: 'Say it differently, keep the meaning' },
  { id: 'summarize', label: 'Summarize', hint: 'Extract the key points' },
  { id: 'expand', label: 'Expand', hint: 'Add depth and supporting detail' },
  { id: 'shorten', label: 'Shorten', hint: 'Tighten to the essentials' },
  { id: 'tone', label: 'Change tone', hint: 'Professional, friendly, persuasive…' },
  { id: 'grammar', label: 'Fix grammar', hint: 'Spelling, punctuation, casing' },
  { id: 'headline', label: 'Headlines', hint: 'Five ready-to-use headlines' },
  { id: 'caption', label: 'Social caption', hint: 'Hook, body, CTA and hashtags' },
  { id: 'product', label: 'Product description', hint: 'Benefit-led e-commerce copy' },
  { id: 'marketing', label: 'Marketing copy', hint: 'Problem → solution → proof' },
  { id: 'blog', label: 'Blog outline', hint: 'Structured long-form draft' },
  { id: 'name', label: 'Name ideas', hint: 'Brand and project names' },
  { id: 'hashtags', label: 'Hashtags', hint: 'Relevant tags for reach' },
];
