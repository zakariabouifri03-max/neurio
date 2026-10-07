'use client';

import { useRef, useState } from 'react';
import { Sparkles, Send, Loader2, Wand2, Image as ImageIcon, PenLine, Lightbulb, Undo2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button, TextArea, Segmented } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useEditor } from '@/store/editor';
import { parseDesignCommand } from '@/engine/assistant';
import { applyCommand } from '@/engine/apply-command';
import { generateArtwork, generateVariations } from '@/engine/ai-art';
import { createImage, createSticker, uid } from '@/engine/factory';
import { addAtViewCenter } from '../insert';
import type { EditorBrandKit } from './BrandPanel';

type Message = { id: string; role: 'user' | 'assistant'; text: string; changes?: string[]; images?: string[] };

const SUGGESTIONS = [
  'Make it dark and use my brand palette',
  'Add a strong headline and a CTA button',
  'Improve the typography',
  'Tidy up spacing and alignment',
  'Create 4 variations',
  'Resize for Instagram story',
  'Write a catchy caption',
  'Generate an abstract background',
];

export function AIPanel({ kit }: { kit: EditorBrandKit | null }) {
  const toast = useToast();
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const selection = useEditor((s) => s.selection);
  const setDoc = useEditor((s) => s.setDoc);
  const undo = useEditor((s) => s.undo);
  const page = doc.pages[activePage];

  const [mode, setMode] = useState<'design' | 'image' | 'write'>('design');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Tell me what to change and I will edit the design. Every change is a single undo step.',
    },
  ]);
  const listRef = useRef<HTMLDivElement>(null);

  function push(message: Message) {
    setMessages((current) => [...current, message]);
    window.setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }), 30);
  }

  async function run() {
    const prompt = input.trim();
    if (!prompt || busy) return;
    setInput('');
    push({ id: uid('msg'), role: 'user', text: prompt });
    setBusy(true);

    try {
      const command = parseDesignCommand(prompt, {
        width: doc.width,
        height: doc.height,
        selection: selection.length,
        pageCount: doc.pages.length,
        kind: doc.kind,
      });

      if (command.intent === 'generateImage' || mode === 'image') {
        const images = await generateImages(prompt);
        push({
          id: uid('msg'),
          role: 'assistant',
          text: `Generated ${images.length} image${images.length === 1 ? '' : 's'} for “${prompt}”.`,
          images,
        });
        return;
      }

      if (command.intent === 'writeText' || mode === 'write') {
        const text = await generateText(prompt);
        push({ id: uid('msg'), role: 'assistant', text });
        return;
      }

      if (command.intent === 'variations') {
        const count = Number(command.params.count ?? 4);
        const variations = generateVariations(prompt || doc.title, count);
        for (const svg of variations) {
          const node = createSticker(svg, { name: `Variation · ${prompt.slice(0, 24)}`, width: 320, height: 320 });
          node.id = uid('svg');
          addAtViewCenter(node, 'Add variation');
        }
        push({ id: uid('msg'), role: 'assistant', text: `Added ${count} variations on the canvas.`, changes: [`${count} variations`] });
        return;
      }

      if (command.intent === 'create') {
        const size = { width: Number(command.params.width ?? doc.width), height: Number(command.params.height ?? doc.height) };
        push({
          id: uid('msg'),
          role: 'assistant',
          text: `A new ${size.width}×${size.height} ${command.params.kind} can be started from the dashboard or by resizing this design.`,
          changes: [`${size.width}×${size.height}`],
        });
        return;
      }

      const result = applyCommand(doc, command, { brandKit: kit ? { colors: kit.colors, fonts: kit.fonts } : null });
      if (result.changes.length) {
        setDoc(result.doc, { resetHistory: false });
        push({ id: uid('msg'), role: 'assistant', text: command.reply, changes: result.changes });
      } else {
        // Ask the (optional) LLM provider for a richer answer, else explain.
        try {
          const data = await api.post<{ text: string }>('/api/ai/text', { prompt, context: { kind: doc.kind } });
          push({ id: uid('msg'), role: 'assistant', text: data.text });
        } catch {
          push({
            id: uid('msg'),
            role: 'assistant',
            text: 'I can recolor, restyle typography, clean up layout, resize, create variations, generate images and write copy. Try one of those.',
          });
        }
      }
    } catch (error) {
      toast.error('Assistant failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function generateImages(prompt: string): Promise<string[]> {
    try {
      const data = await api.post<{ images: { url: string }[] }>('/api/ai/image', { prompt, count: 2, size: '1024x1024' });
      const urls = data.images?.map((image) => image.url) ?? [];
      if (urls.length) {
        for (const url of urls) {
          const node = createImage(url, { name: `AI · ${prompt.slice(0, 30)}`, width: 480, height: 480 });
          addAtViewCenter(node, 'Add AI image');
        }
        return urls;
      }
    } catch {
      /* fall through to the offline generator */
    }
    const svg = generateArtwork(prompt, { width: 1024, height: 1024 });
    const node = createSticker(svg, { name: `AI · ${prompt.slice(0, 30)}`, width: 480, height: 480 });
    node.id = uid('svg');
    addAtViewCenter(node, 'Add AI artwork');
    return [];
  }

  async function generateText(prompt: string): Promise<string> {
    try {
      const data = await api.post<{ text: string }>('/api/ai/text', { prompt, feature: 'generate' });
      return data.text;
    } catch (error) {
      return `Offline writing helper: keep it short, lead with the benefit, and end with a clear call to action. (${(error as Error).message})`;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3" style={{ borderColor: 'var(--border)' }}>
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'design', label: <span className="flex items-center gap-1"><Wand2 size={12} /> Design</span> },
            { value: 'image', label: <span className="flex items-center gap-1"><ImageIcon size={12} /> Image</span> },
            { value: 'write', label: <span className="flex items-center gap-1"><PenLine size={12} /> Write</span> },
          ]}
        />
      </div>

      <div ref={listRef} className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.map((message) => (
          <div key={message.id} className={message.role === 'user' ? 'ms-6' : ''}>
            <div
              className="rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed"
              style={{
                background: message.role === 'user' ? 'var(--brand)' : 'var(--bg-panel-2)',
                color: message.role === 'user' ? '#fff' : 'var(--text)',
              }}
            >
              {message.text}
              {message.changes?.length ? (
                <ul className="mb-0 mt-2 flex flex-col gap-1 p-0 text-[11.5px]" style={{ listStyle: 'none', opacity: 0.85 }}>
                  {message.changes.map((change) => (
                    <li key={change}>✓ {change}</li>
                  ))}
                </ul>
              ) : null}
              {message.images?.length ? (
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {message.images.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={url} src={url} alt="" className="w-full rounded-lg" />
                  ))}
                </div>
              ) : null}
            </div>
            {message.changes?.length ? (
              <button
                type="button"
                onClick={undo}
                className="mt-1 flex items-center gap-1 text-[11px]"
                style={{ color: 'var(--text-faint)' }}
              >
                <Undo2 size={10} /> undo this change
              </button>
            ) : null}
          </div>
        ))}
        {busy ? (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={13} className="animate-spin" /> Working…
          </div>
        ) : null}
      </div>

      <div className="px-3">
        <div className="flex flex-wrap gap-1 pb-2">
          {SUGGESTIONS.slice(0, 4).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setInput(suggestion)}
              className="rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              <Lightbulb size={9} className="me-1 inline" />
              {suggestion}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2 pb-3">
          <TextArea
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                run();
              }
            }}
            placeholder={mode === 'image' ? 'Describe the image…' : mode === 'write' ? 'What should I write?' : 'e.g. make it dark, bold and premium'}
          />
          <Button variant="primary" size="sm" loading={busy} onClick={run} icon={<Send size={13} />}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
