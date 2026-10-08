/**
 * JSON extraction and repair for LLM output.
 *
 * Models wrap JSON in prose, in ```json fences, add trailing commas, or use
 * single quotes. The agent must survive all of that without ever executing a
 * half-parsed command — if we cannot produce valid JSON, we return null and the
 * agent asks the model to try again.
 */

export interface JsonExtraction {
  ok: boolean;
  value?: unknown;
  error?: string;
}

const FENCE_RE = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;

export function extractJson(text: string): JsonExtraction {
  if (!text || !text.trim()) return { ok: false, error: 'The model returned an empty response.' };

  const candidates: string[] = [];
  let match: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(text)) !== null) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }
  candidates.push(text.trim());
  candidates.push(...balancedBlocks(text));

  for (const candidate of candidates) {
    const direct = tryParse(candidate);
    if (direct.ok) return direct;
    const repaired = tryParse(repairJson(candidate));
    if (repaired.ok) return repaired;
  }
  return { ok: false, error: 'The model did not return parseable JSON.' };
}

/** Pull out every top-level {...} or [...] block, brace-balanced. */
function balancedBlocks(text: string): string[] {
  const out: string[] = [];
  const stack: { char: string; index: number }[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') stack.push({ char: ch, index: i });
    else if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (!open) continue;
      const expected = open.char === '{' ? '}' : ']';
      if (ch === expected && stack.length === 0) {
        out.push(text.slice(open.index, i + 1));
      }
    }
  }
  return out;
}

function tryParse(text: string): JsonExtraction {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Conservative repair: trailing commas, comments, smart quotes, NaN/Infinity. */
export function repairJson(text: string): string {
  let out = text.trim();
  // Strip line comments that are not inside strings (best-effort, line based).
  out = out
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      if (idx === -1) return line;
      const before = line.slice(0, idx);
      // Only strip when the quote count before the comment is even.
      return (before.match(/"/g)?.length ?? 0) % 2 === 0 ? before : line;
    })
    .join('\n');

  out = out
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bNaN\b/g, 'null')
    .replace(/\b-?Infinity\b/g, 'null')
    .replace(/,\s*([}\]])/g, '$1') // trailing commas
    .replace(/\n\s*$/g, '');

  // Unquoted keys: { action: "x" } -> { "action": "x" }
  out = out.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
  return out;
}

/**
 * Extract a single command object or an array of them from a model response.
 * Normalises to an array so the caller has one code path.
 */
export function extractCommands(text: string): JsonExtraction {
  const result = extractJson(text);
  if (!result.ok) return result;
  const value = result.value;
  if (Array.isArray(value)) return { ok: true, value };
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    // Some models wrap the plan: { "commands": [...] } / { "steps": [...] }
    for (const key of ['commands', 'steps', 'actions', 'plan']) {
      if (Array.isArray(obj[key])) return { ok: true, value: obj[key] };
    }
    return { ok: true, value: [value] };
  }
  return { ok: false, error: 'The model returned JSON that is not a command or a list of commands.' };
}
