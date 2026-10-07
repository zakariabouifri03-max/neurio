import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, fail, parseBody, unauthorized, tooMany } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { generateText } from '@/lib/ai/providers';
import { localText, WRITE_FEATURES } from '@/lib/ai/local-llm';
import { usage, users } from '@/lib/repo';

export const runtime = 'nodejs';

const schema = z.object({
  feature: z.string().max(40).default('generate'),
  prompt: z.string().min(1).max(8000),
  tone: z.string().max(40).optional(),
  maxTokens: z.number().int().min(32).max(4000).optional(),
});

const SYSTEM = `You are Prism Studio's writing assistant, embedded in a visual design tool.
Be concise, concrete and on-brand. Never add preamble or meta commentary — return only the copy
the user asked for. Keep headlines under 8 words, body copy tight, and preserve the requested language.`;

export const POST = handler(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const record = users.byId(user.id);
  if (record && record.aiCredits <= 0) {
    return fail('AI credits exhausted for this period', 402, 'NO_CREDITS');
  }

  const body = await parseBody(req, schema);
  const feature = WRITE_FEATURES.find((f) => f.id === body.feature);

  const prompt = feature
    ? `${feature.label.toUpperCase()} task.\n${body.tone ? `Tone: ${body.tone}.\n` : ''}Content:\n"""\n${body.prompt}\n"""`
    : body.prompt;

  let result: { text: string; provider: string; model: string };
  try {
    const generated = await generateText({
      system: SYSTEM,
      prompt,
      maxTokens: body.maxTokens ?? 700,
      temperature: 0.75,
      feature: body.feature,
    });
    result = { text: generated.text, provider: generated.provider, model: generated.model };
  } catch (err) {
    // Provider failure must never break the editor — fall back to the offline engine.
    console.error('[ai/text] provider failed, using offline engine:', err);
    result = {
      text: localText({ prompt: body.prompt, feature: body.feature, tone: body.tone }),
      provider: 'local',
      model: 'prism-offline-1 (fallback)',
    };
  }

  usage.record(user.id, 'AI_TEXT', 1, { feature: body.feature, provider: result.provider });
  return ok({ ...result, offline: result.provider === 'local' });
});
