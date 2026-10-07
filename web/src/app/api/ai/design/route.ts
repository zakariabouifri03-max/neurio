import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, fail, parseBody, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { generateText, configuredTextProvider } from '@/lib/ai/providers';
import { parseDesignCommand } from '@/engine/assistant';
import { usage, users } from '@/lib/repo';

export const runtime = 'nodejs';

const schema = z.object({
  prompt: z.string().min(1).max(2000),
  context: z
    .object({
      width: z.number().optional(),
      height: z.number().optional(),
      selection: z.number().optional(),
      pageCount: z.number().optional(),
      kind: z.string().optional(),
    })
    .optional(),
});

const SYSTEM = `You convert natural-language design requests into a single JSON command for a design editor.
Reply with JSON only, no markdown. Shape:
{"intent":"<one of: create|recolor|resize|variations|removeBackground|typography|cleanup|brand|multiFormat|generateImage|writeText|suggest|explain|unknown>",
 "params":{ ...intent specific... }, "reply":"<one friendly sentence>"}
Intent params:
 create: {templateHint, width, height, kind}
 recolor: {colors:[string], target:"background"|"all"|"text"|"selection"}
 resize: {targets:["instagram"|"story"|"tiktok"|"youtube"|"youtubeBanner"|"facebook"|"linkedin"|"x"|"pinterest"|"presentation"|"a4"], width?, height?}
 variations: {count:number}
 removeBackground: {}
 typography: {preset:"classic"|"modern"|"editorial"|"playful"|"luxury"|"bold"}
 cleanup: {}
 brand: {}
 multiFormat: {targets:[string]}
 generateImage: {prompt:string, count:number}
 writeText: {feature:string, prompt:string}
 suggest, explain: {}
Never include commentary outside the JSON.`;

/**
 * Natural-language → structured design command.
 *
 * With an LLM configured the model returns the JSON command; otherwise the
 * deterministic parser in src/engine/assistant.ts handles it, so the assistant
 * always responds and always acts on the canvas.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body = await parseBody(req, schema);

  const local = parseDesignCommand(body.prompt, body.context ?? {});
  const provider = configuredTextProvider();

  if (provider === 'local') {
    return ok({ ...local, provider: 'local', offline: true });
  }

  try {
    const result = await generateText({
      system: SYSTEM,
      prompt: `Request: ${body.prompt}\nCanvas: ${JSON.stringify(body.context ?? {})}`,
      maxTokens: 400,
      temperature: 0.2,
      json: true,
    });
    const parsed = JSON.parse(result.text) as { intent?: string; params?: Record<string, unknown>; reply?: string };
    if (!parsed.intent) throw new Error('no intent');
    usage.record(user.id, 'AI_TEXT', 1, { feature: 'design', provider });
    return ok({
      intent: parsed.intent,
      params: parsed.params ?? {},
      reply: parsed.reply ?? 'Done.',
      provider,
      offline: false,
    });
  } catch (err) {
    console.error('[ai/design] falling back to local parser:', err);
    return ok({ ...local, provider: 'local', offline: true });
  }
});
