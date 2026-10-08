import { settings } from '../settings';
import { AIError, httpJSON, keyFor } from './providers';

export type TextTask =
  | 'headline'
  | 'rewrite'
  | 'shorter'
  | 'longer'
  | 'professional'
  | 'funny'
  | 'marketing'
  | 'product'
  | 'slogans'
  | 'caption'
  | 'freeform';

const INSTRUCTIONS: Record<TextTask, string> = {
  headline: 'Write one punchy headline (max 8 words). Return only the headline.',
  rewrite: 'Rewrite the text, keeping the meaning but improving clarity and flow. Return only the rewrite.',
  shorter: 'Rewrite the text to be significantly shorter while keeping the core message. Return only the result.',
  longer: 'Expand the text with concrete, useful detail. Return only the result.',
  professional: 'Rewrite the text in a polished, professional business tone. Return only the result.',
  funny: 'Rewrite the text with light, tasteful humour. Return only the result.',
  marketing: 'Write persuasive marketing copy (max 60 words) based on the input. Return only the copy.',
  product: 'Write a compelling product description (max 80 words). Return only the description.',
  slogans: 'Write 5 original slogans, one per line, no numbering.',
  caption: 'Write 3 social media captions with 2-3 relevant hashtags each, one per line.',
  freeform: 'Follow the user instruction exactly and return plain text only.'
};

export class TextGenerator {
  async run(task: TextTask, input: string, extra?: string): Promise<string> {
    const text = (input ?? '').trim();
    if (!text && task !== 'freeform') throw new AIError('Enter some text first.', 'empty_input');

    const s = settings.get().ai;
    const system = `You are a concise copywriter inside a graphic design app. ${INSTRUCTIONS[task]} Never use markdown formatting.`;
    const user = extra ? `${text}\n\nAdditional context: ${extra}` : text;

    if (s.textProvider === 'google') {
      const key = keyFor('google');
      const url = `${s.googleBaseUrl.replace(/\/$/, '')}/models/${s.googleTextModel}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await httpJSON<any>(url, {
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }]
        }
      });
      const out = res?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
      if (!out) throw new AIError('The model returned an empty response.', 'empty_response');
      return out.trim();
    }

    // OpenAI and OpenAI-compatible custom endpoints
    const provider = s.textProvider === 'custom' ? 'custom' : 'openai';
    const base = (provider === 'custom' ? s.customBaseUrl : s.openaiBaseUrl).replace(/\/$/, '');
    const model = provider === 'custom' ? s.customTextModel : s.openaiTextModel;
    if (!base) throw new AIError('No base URL configured for the custom provider.', 'missing_base_url');
    const key = keyFor(provider);
    const res = await httpJSON<any>(`${base}/chat/completions`, {
      headers: { authorization: `Bearer ${key}` },
      body: {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.8
      }
    });
    const out = res?.choices?.[0]?.message?.content ?? '';
    if (!out) throw new AIError('The model returned an empty response.', 'empty_response');
    return String(out).trim();
  }
}
