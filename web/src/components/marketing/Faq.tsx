'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const ITEMS = [
  {
    q: 'Is this a template viewer or a real editor?',
    a: 'A real editor. Templates are live documents: every node is editable, the layer tree is real, snapping and alignment work, and export renders the same scene at 1×–4× resolution.',
  },
  {
    q: 'Where is my work stored?',
    a: 'In your account on the server — projects, pages, versions, assets, brand kits and comments are persisted in the database and autosaved from the editor every few seconds.',
  },
  {
    q: 'Does the AI need an API key?',
    a: 'No. The studio ships with a local model that handles design commands, writing and procedural image generation offline. You can add a provider key (OpenAI, Anthropic, Google, Groq, Mistral, Replicate, Stability) in the deployment environment to upgrade quality — the key stays server-side.',
  },
  {
    q: 'Can I export print-ready files?',
    a: 'Yes. PDF export at up to 300 dpi, CMYK-safe palette guidance, bleed and crop marks, plus SVG for vector workflows and transparent PNG for web.',
  },
  {
    q: 'Is video export real?',
    a: 'The timeline drives a real frame-by-frame render: trim, split, speed, reverse, transitions, keyframes and captions are honoured, and the composition is encoded at up to 4K with audio mixed through WebAudio.',
  },
  {
    q: 'How is collaboration handled?',
    a: 'Share links with view or edit roles, threaded comments with resolve/reply, an operation log with live streaming for co-editing, and per-project activity history.',
  },
  {
    q: 'Can I use my own fonts and logos?',
    a: 'Yes — upload TTF/OTF/WOFF fonts (registered through the FontFace API) and logos into your media library; brand kits apply them across new designs automatically.',
  },
  {
    q: 'Does it work in Arabic?',
    a: 'Fully. The interface, the editor chrome and the canvas mirror for right-to-left, Arabic font families are bundled into the picker, and templates adapt their layout direction.',
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="flex flex-col gap-2">
      {ITEMS.map((item, index) => {
        const isOpen = open === index;
        return (
          <div key={item.q} className="card overflow-hidden p-0">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : index)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
              aria-expanded={isOpen}
            >
              <span className="flex-1 text-[14px] font-medium" style={{ color: 'var(--text)' }}>
                {item.q}
              </span>
              <ChevronDown
                size={16}
                style={{
                  color: 'var(--text-muted)',
                  transform: isOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform .18s ease',
                }}
              />
            </button>
            {isOpen ? (
              <p className="m-0 border-t px-4 py-3.5 text-[13.5px] leading-relaxed" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                {item.a}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
