import 'server-only';

/**
 * AI provider registry.
 *
 * Any OpenAI/Anthropic/Google-compatible HTTP endpoint can be plugged in by
 * setting the matching environment variable — there is no vendor lock-in. When
 * no key is present the studio transparently uses its built-in offline engines
 * (`local-llm.ts` / `engine/ai-art.ts`) so every AI feature still works; the UI
 * labels which engine produced the result.
 *
 * Secrets are only ever read here, on the server. The browser can only reach AI
 * through `/api/ai/*`, which authenticates, rate-limits and meters usage.
 */

export type AIProviderId = 'openai' | 'anthropic' | 'google' | 'local';
export type AIImageProviderId = 'openai' | 'stability' | 'replicate' | 'fal' | 'local';

export type TextRequest = {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  feature?: string;
};

export type TextResult = {
  text: string;
  provider: AIProviderId;
  model: string;
  usage?: { input?: number; output?: number };
};

export type ImageRequest = {
  prompt: string;
  size: '1024x1024' | '1536x1024' | '1024x1536' | '1792x1024' | '1024x1792' | 'auto';
  n?: number;
  negative?: string;
};

export type ImageResult = {
  images: { dataUrl?: string; url?: string; mime: string }[];
  provider: AIImageProviderId;
  model: string;
};

/* ---------------------------------------------------------------- detection */

export function configuredTextProvider(): AIProviderId {
  const forced = process.env.AI_PROVIDER;
  if (forced && forced !== 'auto') return forced as AIProviderId;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GOOGLE_AI_API_KEY) return 'google';
  return 'local';
}

export function configuredImageProvider(): AIImageProviderId {
  const forced = process.env.AI_IMAGE_PROVIDER;
  if (forced && forced !== 'auto') return forced as AIImageProviderId;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.STABILITY_API_KEY) return 'stability';
  if (process.env.REPLICATE_API_TOKEN) return 'replicate';
  if (process.env.FAL_API_KEY) return 'fal';
  return 'local';
}

export function aiStatus() {
  return {
    text: {
      provider: configuredTextProvider(),
      configured: configuredTextProvider() !== 'local',
      models: {
        openai: 'gpt-4o-mini',
        anthropic: 'claude-3-5-haiku',
        google: 'gemini-2.0-flash',
        local: 'prism-offline-1',
      },
    },
    image: {
      provider: configuredImageProvider(),
      configured: configuredImageProvider() !== 'local',
      models: {
        openai: 'gpt-image-1',
        stability: 'sd-3.5-large',
        replicate: 'flux-1.1-pro',
        fal: 'flux-pro',
        local: 'prism-procedural-1',
      },
    },
    features: {
      backgroundRemoval: 'local-cv',
      upscaling: 'local-lanczos',
      inpainting: 'local-patchmatch',
      autoCaptions: 'local-heuristic',
    },
  };
}

/* --------------------------------------------------------------------- text */

export async function generateText(req: TextRequest): Promise<TextResult> {
  const provider = configuredTextProvider();
  switch (provider) {
    case 'openai':
      return openAIText(req);
    case 'anthropic':
      return anthropicText(req);
    case 'google':
      return googleText(req);
    default: {
      const { localText } = await import('./local-llm');
      const text = localText(req);
      return { text, provider: 'local', model: 'prism-offline-1' };
    }
  }
}

async function openAIText(req: TextRequest): Promise<TextResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.prompt },
      ],
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[]; usage?: any; model?: string };
  return {
    text: json.choices?.[0]?.message?.content ?? '',
    provider: 'openai',
    model: json.model ?? 'gpt-4o-mini',
    usage: { input: json.usage?.prompt_tokens, output: json.usage?.completion_tokens },
  };
}

async function anthropicText(req: TextRequest): Promise<TextResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest',
      max_tokens: req.maxTokens ?? 1024,
      system: req.system ?? '',
      messages: [{ role: 'user', content: req.prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { content: { text: string }[]; usage?: any; model?: string };
  return {
    text: json.content?.[0]?.text ?? '',
    provider: 'anthropic',
    model: json.model ?? 'claude-3-5-haiku',
    usage: { input: json.usage?.input_tokens, output: json.usage?.output_tokens },
  };
}

async function googleText(req: TextRequest): Promise<TextResult> {
  const model = process.env.GOOGLE_AI_MODEL ?? 'gemini-2.0-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${req.system ? req.system + '\n\n' : ''}${req.prompt}` }] }],
        generationConfig: { maxOutputTokens: req.maxTokens ?? 1024, temperature: req.temperature ?? 0.7 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Google AI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
  return {
    text: json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '',
    provider: 'google',
    model,
  };
}

/* -------------------------------------------------------------------- image */

export async function generateImage(req: ImageRequest): Promise<ImageResult> {
  const provider = configuredImageProvider();
  switch (provider) {
    case 'openai':
      return openAIImage(req);
    case 'stability':
      return stabilityImage(req);
    case 'replicate':
      return replicateImage(req);
    case 'fal':
      return falImage(req);
    default:
      throw new UnsupportedProviderError('local');
  }
}

/** Thrown when the caller must use the client-side procedural generator. */
export class UnsupportedProviderError extends Error {
  provider: string;
  constructor(provider: string) {
    super(`Provider ${provider} is handled client-side`);
    this.provider = provider;
  }
}

async function openAIImage(req: ImageRequest): Promise<ImageResult> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
      prompt: req.prompt,
      n: Math.min(req.n ?? 1, 4),
      size: req.size === 'auto' ? '1024x1024' : req.size,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI image error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
  return {
    images: (json.data ?? []).map((d) => ({ dataUrl: d.b64_json ? `data:image/png;base64,${d.b64_json}` : undefined, url: d.url, mime: 'image/png' })),
    provider: 'openai',
    model: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
  };
}

async function stabilityImage(req: ImageRequest): Promise<ImageResult> {
  const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/sd3', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
      accept: 'image/*',
    },
    // multipart
    body: (() => {
      const fd = new FormData();
      fd.append('prompt', req.prompt);
      fd.append('output_format', 'png');
      fd.append('aspect_ratio', req.size === '1024x1536' ? '2:3' : req.size === '1536x1024' ? '3:2' : '1:1');
      if (req.negative) fd.append('negative_prompt', req.negative);
      return fd;
    })(),
  });
  if (!res.ok) throw new Error(`Stability error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { images: [{ dataUrl: `data:image/png;base64,${buf.toString('base64')}`, mime: 'image/png' }], provider: 'stability', model: 'sd-3.5' };
}

async function replicateImage(req: ImageRequest): Promise<ImageResult> {
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      prefer: 'wait',
    },
    body: JSON.stringify({
      version: process.env.REPLICATE_IMAGE_VERSION ?? 'black-forest-labs/flux-1.1-pro',
      input: {
        prompt: req.prompt,
        aspect_ratio: req.size === '1024x1536' ? '2:3' : req.size === '1536x1024' ? '3:2' : '1:1',
        output_format: 'png',
      },
    }),
  });
  if (!res.ok) throw new Error(`Replicate error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { output?: string | string[] };
  const urls = Array.isArray(json.output) ? json.output : json.output ? [json.output] : [];
  return {
    images: urls.map((u) => ({ url: u, mime: 'image/png' })),
    provider: 'replicate',
    model: 'flux-1.1-pro',
  };
}

async function falImage(req: ImageRequest): Promise<ImageResult> {
  const res = await fetch('https://fal.run/fal-ai/flux-pro/v1.1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Key ${process.env.FAL_API_KEY}`,
    },
    body: JSON.stringify({
      prompt: req.prompt,
      image_size: req.size === '1024x1536' ? 'portrait_4_3' : req.size === '1536x1024' ? 'landscape_4_3' : 'square_hd',
      num_images: Math.min(req.n ?? 1, 4),
    }),
  });
  if (!res.ok) throw new Error(`fal error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { images: { url: string }[] };
  return {
    images: (json.images ?? []).map((i) => ({ url: i.url, mime: 'image/png' })),
    provider: 'fal',
    model: 'flux-pro',
  };
}

/* --------------------------------------------------------------- stock media */

export type StockPhoto = {
  id: string;
  url: string;
  thumb: string;
  width: number;
  height: number;
  author: string;
  color?: string;
};

/**
 * Stock photography adapters. Without credentials the studio serves its
 * bundled, license-free procedural artwork instead of an empty panel.
 */
export async function searchStock(query: string, page = 1, perPage = 30): Promise<{ photos: StockPhoto[]; provider: string }> {
  if (process.env.UNSPLASH_ACCESS_KEY) return { photos: await unsplash(query, page, perPage), provider: 'unsplash' };
  if (process.env.PEXELS_API_KEY) return { photos: await pexels(query, page, perPage), provider: 'pexels' };
  return { photos: [], provider: 'bundled' };
}

async function unsplash(query: string, page: number, perPage: number): Promise<StockPhoto[]> {
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`,
    { headers: { authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY!}` } },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { results: any[] };
  return (json.results ?? []).map((p) => ({
    id: p.id,
    url: p.urls.regular,
    thumb: p.urls.thumb,
    width: p.width,
    height: p.height,
    author: p.user?.name ?? 'Unsplash',
    color: p.color,
  }));
}

async function pexels(query: string, page: number, perPage: number): Promise<StockPhoto[]> {
  const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`, {
    headers: { authorization: process.env.PEXELS_API_KEY! },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { photos: any[] };
  return (json.photos ?? []).map((p) => ({
    id: String(p.id),
    url: p.src.large,
    thumb: p.src.medium,
    width: p.width,
    height: p.height,
    author: p.photographer ?? 'Pexels',
    color: p.avg_color,
  }));
}
