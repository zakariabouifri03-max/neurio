import type { AiTextRequest } from '../../../shared/types/ai'
import { seededRandom } from '../../../shared/utils/color'

/**
 * Offline copy engine.
 *
 * The editor must be useful with no API key at all, so every AI text task has a
 * deterministic local implementation: template banks + light NLP over the user
 * prompt. Results are labelled `offline: true` in the UI.
 */

const STOPWORDS = new Set([
  'a','an','the','and','or','but','for','with','about','into','over','of','to','in','on','at','by','from','my','your','our','their','this','that','these','those','is','are','was','were','be','been','being','it','its','as','i','you','we','they','he','she','them','his','her','make','making','create','creating','design','please','some','any','new','using','use','need'
])

const ADJECTIVES = ['Bold', 'Fresh', 'Modern', 'Timeless', 'Effortless', 'Handcrafted', 'Fearless', 'Sharp', 'Playful', 'Refined']
const VERBS = ['Stand Out', 'Level Up', 'Ship It', 'Own The Look', 'Make It Yours', 'Turn Heads', 'Get Started']
const BENEFITS = [
  'built for people who care about the details',
  'ready in minutes, not days',
  'designed to be seen from across the room',
  'made to be shared, saved and re-shared',
  'crafted for screens, prints and everything between'
]
const CTAS = ['Shop the drop', 'Learn more', 'Save your spot', 'Get started free', 'Grab yours', 'See the collection']

const titleCase = (value: string): string => value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1))

export function extractKeywords(prompt: string, limit = 6): string[] {
  return Array.from(
    new Set(
      prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    )
  ).slice(0, limit)
}

const subjectOf = (keywords: string[]): string => (keywords.length ? titleCase(keywords.slice(0, 2).join(' ')) : 'Your Next Idea')

const pick = <T,>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length) % list.length]

export function offlineText(request: AiTextRequest): string[] {
  const keywords = extractKeywords(`${request.prompt} ${request.sourceText ?? ''}`)
  const subject = subjectOf(keywords)
  const rand = seededRandom(Math.abs(hash(`${request.task}${request.prompt}${request.sourceText ?? ''}`)) + 7)
  const count = Math.max(1, Math.min(6, request.count ?? 3))
  const source = (request.sourceText ?? '').trim()

  const unique = (values: string[]): string[] => Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)))

  switch (request.task) {
    case 'headline': {
      const bank = [
        `${subject}, Done Right`,
        `The ${pick(ADJECTIVES, rand)} Way To ${pick(VERBS, rand)}`,
        `${subject}: ${pick(BENEFITS, rand)}`,
        `Meet ${subject}`,
        `${new Date().getFullYear()} ${subject} Edit`,
        `${subject} That ${pick(VERBS, rand)}`
      ]
      return shuffle(bank, rand).slice(0, count)
    }
    case 'slogans': {
      const bank = [
        `${subject}. ${pick(VERBS, rand)}.`,
        `Made For ${subject}`,
        `${subject}, Simplified`,
        `Think ${subject}`,
        `${subject} Without Compromise`,
        `Small Details. Big ${titleCase(keywords[0] ?? 'Impact')}.`
      ]
      return shuffle(bank, rand).slice(0, count)
    }
    case 'captions': {
      const tags = keywords.slice(0, 3).map((k) => `#${k.replace(/[^a-z0-9]/gi, '')}`)
      const bank = [
        `${subject} season is here — ${pick(BENEFITS, rand)}. ${tags.join(' ')}`,
        `POV: you just found ${subject.toLowerCase()}. ${tags.join(' ')}`,
        `New in: ${subject.toLowerCase()}. ${pick(CTAS, rand)}. ${tags.join(' ')}`,
        `${pick(BENEFITS, rand)} ✨ ${subject}. ${tags.join(' ')}`
      ]
      return shuffle(bank, rand).slice(0, count)
    }
    case 'marketing': {
      const bank = [
        `${subject} — ${pick(BENEFITS, rand)}. ${pick(CTAS, rand)}.`,
        `Meet ${subject.toLowerCase()}: ${pick(BENEFITS, rand)}. ${pick(CTAS, rand)}.`,
        `Upgrade to ${subject.toLowerCase()} today and ${pick(BENEFITS, rand)}.`
      ]
      return shuffle(bank, rand).slice(0, count)
    }
    case 'product': {
      const bank = [
        `${subject} — ${pick(BENEFITS, rand)}. Every detail is considered, from the first sketch to the final export.`,
        `${subject}: ${pick(BENEFITS, rand)}. Built to last, designed to be noticed.`,
        `Introducing ${subject.toLowerCase()}. ${pick(BENEFITS, rand)}, with a finish that holds up close.`
      ]
      return shuffle(bank, rand).slice(0, count)
    }
    case 'shorten': {
      if (!source) return unique([subject])
      const max = request.maxLength ?? 60
      if (source.length <= max) return unique([source])
      const words = source.split(/\s+/)
      let out = ''
      for (const word of words) {
        if ((out + ' ' + word).trim().length > max) break
        out = `${out} ${word}`.trim()
      }
      return unique([out.replace(/[,.;:\s]+$/, '') + (out.length < source.length ? '…' : '')])
    }
    case 'expand': {
      const base = source || `${subject} — ${pick(BENEFITS, rand)}.`
      return Array.from({ length: count }, (_, i) =>
        `${base} ${pick(BENEFITS, rand)}${i === 0 ? '' : ', ' + pick(BENEFITS, rand)}. ${pick(CTAS, rand)}.`
      )
    }
    case 'professional':
      return unique([toneShift(source || subject, 'formal')])
    case 'funny':
      return unique([toneShift(source || subject, 'playful')])
    case 'rewrite':
    default:
      return unique([tidy(source || `${subject} — ${pick(BENEFITS, rand)}.`), `${subject}: ${pick(BENEFITS, rand)}.`]).slice(0, count)
  }
}

const FILLER = /\b(very|really|just|actually|basically|totally|kind of|sort of|in order to|a lot of)\b/gi
const FORMAL: Array<[RegExp, string]> = [
  [/\bget\b/gi, 'receive'],
  [/\bhelp\b/gi, 'support'],
  [/\bshow\b/gi, 'demonstrate'],
  [/\bbig\b/gi, 'significant'],
  [/\bthings\b/gi, 'features'],
  [/!/g, '.']
]
const PLAYFUL: Array<[RegExp, string]> = [
  [/\bgood\b/gi, 'ridiculously good'],
  [/\bfast\b/gi, 'stupidly fast'],
  [/\bnew\b/gi, 'shiny new']
]

function tidy(value: string): string {
  return value
    .replace(FILLER, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

function toneShift(value: string, tone: 'formal' | 'playful'): string {
  let out = tidy(value)
  const map = tone === 'formal' ? FORMAL : PLAYFUL
  for (const [pattern, replacement] of map) out = out.replace(pattern, replacement)
  if (tone === 'playful' && !/[!?]$/.test(out)) out += ' ✨'
  return out
}

function shuffle<T>(values: readonly T[], rand: () => number): T[] {
  const copy = [...values]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function hash(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i += 1) h = (h << 5) - h + value.charCodeAt(i)
  return h | 0
}
