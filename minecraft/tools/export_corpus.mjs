#!/usr/bin/env node
/**
 * export_corpus.mjs — dumps the dialogue corpus to JSON so the Python tools can use it
 *
 *   node tools/export_corpus.mjs            -> build/corpus.json
 *
 * build/corpus.json = { lines:[{i,ar,dz,en,fr}], words:[...], hesitations:[...] }
 * `words` is the vocabulary used for word-by-word speech (concatenative TTS).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES, HESITATIONS } from '../addon/behavior_pack/scripts/corpus.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'build');
mkdirSync(outDir, { recursive: true });

const lines = LINES.map((l, i) => ({
  id: l.id || `L${i}`,
  i: l.i,
  ar: l.ar,
  dz: l.dz,
  en: l.en || null,
  fr: l.fr || null,
}));

// vocabulary: every Arabizi word + every Arabic word, longest first (better for splicing)
const words = new Set();
for (const l of lines) {
  for (const txt of [l.dz, l.ar]) {
    if (!txt) continue;
    for (const w of String(txt).toLowerCase().split(/[\s,.!?;:'"()\[\]{}؟،؛]+/)) {
      const t = w.trim();
      if (t.length >= 2 && t.length <= 14) words.add(t);
    }
  }
}

const payload = {
  generated: new Date().toISOString(),
  lines,
  words: [...words].sort((a, b) => b.length - a.length || a.localeCompare(b)),
  hesitations: HESITATIONS,
};

const file = join(outDir, 'corpus.json');
writeFileSync(file, JSON.stringify(payload, null, 1));
console.log(`wrote ${file}: ${lines.length} lines, ${payload.words.length} unique words`);
