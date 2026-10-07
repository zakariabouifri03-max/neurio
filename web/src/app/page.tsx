import Link from 'next/link';
import type { Metadata } from 'next';
import {
  Sparkles,
  Layers,
  Film,
  FileText,
  Printer,
  Palette,
  Wand2,
  Users,
  Download,
  History,
  LayoutTemplate,
  ScanFace,
  Gauge,
  Globe,
  ShieldCheck,
  Accessibility,
  Smartphone,
  Check,
  ChevronDown,
  ArrowRight,
  Type,
  Grid3x3,
  Crop,
  BarChart3,
} from 'lucide-react';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { CreateBar } from '@/components/marketing/CreateBar';
import { TemplateShowcase, type ShowcaseTemplate } from '@/components/marketing/TemplateShowcase';
import { Faq } from '@/components/marketing/Faq';
import { allTemplates } from '@/data/templates';

export const metadata: Metadata = {
  title: 'Prism Studio — the whole design studio, in one product',
  description:
    'Design social posts, presentations, videos, documents, logos and print in a real editor with layers, smart guides, brand kits, AI assistance and high-resolution export.',
};

const FEATURES: { icon: any; title: string; body: string }[] = [
  { icon: Layers, title: 'Real layer system', body: 'Nested groups, frames with clipping, lock, hide, blend modes, masks and a proper z-order you can drag.' },
  { icon: Grid3x3, title: 'Smart guides & snapping', body: 'Edge, centre, spacing and margin snapping with pixel-exact alignment tools and live measurements.' },
  { icon: Type, title: 'Serious typography', body: '250+ families, gradient text, outlines, glows, curved text on paths, full spacing control and text presets.' },
  { icon: Palette, title: 'Colour system', body: 'Gradients, harmonies, contrast checking, palette extraction from images and document-wide recolour.' },
  { icon: ScanFace, title: 'Image editing built in', body: 'Crop, background removal, upscaling, auto-enhance, 22 filters, duotone and non-destructive adjustments.' },
  { icon: Film, title: 'Timeline video editor', body: 'Tracks, trim, split, speed, reverse, transitions, keyframes, captions and 1080p/4K rendering.' },
  { icon: LayoutTemplate, title: 'Hundreds of templates', body: 'A generated, fully editable catalogue across 21 categories — every element is real and reusable.' },
  { icon: Wand2, title: 'AI that edits', body: 'Natural-language commands that actually change the design, plus AI image generation and writing help.' },
  { icon: Download, title: 'Export that respects quality', body: 'PNG (transparent), JPG, SVG, PDF, GIF and video at up to 4× resolution with print marks and bleed.' },
  { icon: History, title: 'Version history', body: 'Named snapshots with restore and preview — undo/redo goes far beyond the last keystroke.' },
  { icon: Users, title: 'Collaboration', body: 'Share links with view or edit roles, threaded comments with resolution, and live presence.' },
  { icon: Gauge, title: 'Fast by design', body: 'Virtualised galleries, worker-based image processing, autosave and lazy-loaded media.' },
];

const FORMATS = [
  { icon: Sparkles, label: 'Social', body: 'Posts, stories, reels covers, carousels and ad sets in every platform size.' },
  { icon: Layers, label: 'Presentations', body: 'Slide decks with animations, transitions, charts, tables and speaker notes.' },
  { icon: Film, label: 'Video', body: 'Trim, split, speed, captions, transitions and audio mixing on a real timeline.' },
  { icon: FileText, label: 'Documents', body: 'Resumes, reports, proposals with headings, tables, columns, headers and footers.' },
  { icon: Printer, label: 'Print', body: 'CMYK-safe palettes, bleed, crop marks and 300 dpi PDF export for real presses.' },
  { icon: Palette, label: 'Brand', body: 'Logos, brand kits, colour systems and typography rules applied in one click.' },
];

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    note: 'forever',
    features: ['Unlimited designs', 'Hundreds of templates & elements', 'PNG / JPG / PDF export', '5 GB storage', '100 AI credits / month'],
    cta: 'Start free',
    href: '/sign-up',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$12',
    note: 'per month',
    features: ['Everything in Free', 'Brand kits & team libraries', 'Background removal & 4× upscale', '4K video + SVG export', '5,000 AI credits / month', 'Version history (90 days)'],
    cta: 'Choose Pro',
    href: '/sign-up?plan=pro',
    highlight: true,
  },
  {
    name: 'Team',
    price: '$29',
    note: 'per month',
    features: ['Everything in Pro', 'Shared workspaces & roles', 'Approval workflow + comments', 'Centralised brand enforcement', '25,000 AI credits / month', 'Priority support'],
    cta: 'Choose Team',
    href: '/sign-up?plan=team',
    highlight: false,
  },
];

export default function LandingPage() {
  const showcase: ShowcaseTemplate[] = allTemplates()
    .filter((template) => template.featured || template.trending)
    .slice(0, 24)
    .map((template) => ({
      id: template.id,
      name: template.name,
      category: template.category,
      width: template.width,
      height: template.height,
      page: template.pages[0]!,
    }));

  return (
    <>
      <SiteHeader />

      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden px-5 pb-16 pt-14 sm:pt-20">
        <div
          className="pointer-events-none absolute inset-x-0 top-[-220px] mx-auto h-[520px] max-w-[1000px] rounded-full blur-[120px]"
          style={{ background: 'radial-gradient(circle, rgba(108,92,231,.35), transparent 65%)' }}
        />
        <div className="relative mx-auto max-w-[1000px] text-center">
          <span
            className="chip"
            style={{ background: 'var(--brand-soft)', color: 'var(--text)', border: '1px solid var(--border-strong)' }}
          >
            <Sparkles size={13} style={{ color: 'var(--brand)' }} />
            Design · Present · Video · Print — one editor
          </span>

          <h1 className="mt-5 text-balance text-[38px] font-bold leading-[1.06] tracking-tight sm:text-[60px]">
            The whole design studio,
            <br />
            <span style={{ color: 'var(--brand)' }}>in a single product.</span>
          </h1>

          <p className="mx-auto mt-5 max-w-[620px] text-[16px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            A professional editor with real layers, smart guides, brand kits, an AI assistant that edits your canvas, a
            timeline video editor and high-resolution export — running entirely in your browser and saved to your account.
          </p>

          <div className="mt-8">
            <CreateBar />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
            <span className="flex items-center gap-1.5">
              <Check size={13} style={{ color: 'var(--accent)' }} /> No credit card
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={13} style={{ color: 'var(--accent)' }} /> Cloud saved
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={13} style={{ color: 'var(--accent)' }} /> English & العربية with full RTL
            </span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ formats */}
      <section id="formats" className="px-5 py-14">
        <div className="mx-auto max-w-[1200px]">
          <SectionTitle eyebrow="Every format" title="One editor for every deliverable" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FORMATS.map((format) => (
              <div key={format.label} className="card p-5">
                <span
                  className="mb-3 grid h-9 w-9 place-items-center rounded-xl"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                >
                  <format.icon size={17} />
                </span>
                <h3 className="mb-1 text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
                  {format.label}
                </h3>
                <p className="m-0 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {format.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- showcase */}
      <section className="px-5 py-14">
        <div className="mx-auto max-w-[1200px]">
          <SectionTitle
            eyebrow="Templates"
            title="Start from a real design, then edit everything"
            body="Each template is a live document: every shape, gradient and word is editable — rendered here with the same engine as the editor."
          />
          <div className="mt-8">
            <TemplateShowcase templates={showcase} />
          </div>
          <div className="mt-8 text-center">
            <Link href="/templates" className="no-underline">
              <span className="btn btn-primary">
                Browse all templates <ArrowRight size={14} />
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- features */}
      <section id="features" className="px-5 py-14">
        <div className="mx-auto max-w-[1200px]">
          <SectionTitle eyebrow="Capabilities" title="Built for people who ship design work" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="card p-5">
                <span
                  className="mb-3 grid h-9 w-9 place-items-center rounded-xl"
                  style={{ background: 'var(--bg-panel-2)', color: 'var(--text)' }}
                >
                  <feature.icon size={17} />
                </span>
                <h3 className="mb-1 text-[14.5px] font-semibold" style={{ color: 'var(--text)' }}>
                  {feature.title}
                </h3>
                <p className="m-0 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- ai */}
      <section className="px-5 py-14">
        <div className="mx-auto grid max-w-[1200px] items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="chip" style={{ background: 'var(--brand-soft)', color: 'var(--text)' }}>
              <Wand2 size={13} style={{ color: 'var(--brand)' }} /> AI assistant
            </span>
            <h2 className="mb-3 mt-4 text-[30px] font-bold leading-tight tracking-tight sm:text-[38px]">
              Say what you want.
              <br />
              The canvas changes.
            </h2>
            <p className="text-[14.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              “Make a dark Instagram promo for a coffee shop using the brand palette, add a headline and a CTA button, then
              generate three variations.” The assistant reads your document, applies the changes through the same commands
              you would use by hand, and every step is undoable.
            </p>
            <ul className="mt-5 flex flex-col gap-2.5 p-0 text-[13.5px]" style={{ color: 'var(--text-muted)', listStyle: 'none' }}>
              {[
                'Layout, colour, typography and resize commands',
                'AI image generation with styles and variations',
                'Writing help: rewrite, shorten, translate, tone',
                'One-click design variations and cleanup',
                'Works offline with the built-in local model, or bring your own provider key',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check size={15} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#ff5c5c' }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#ffb800' }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#00b894' }} />
              <span className="ms-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
                Assistant
              </span>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <div className="ms-auto max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13px]" style={{ background: 'var(--brand)', color: '#fff' }}>
                Make a dark promo post for “Solstice Coffee”, use my brand colours, add a big headline and a button.
              </div>
              <div className="max-w-[90%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13px]" style={{ background: 'var(--bg-panel-2)', color: 'var(--text)' }}>
                Applied 7 changes: dark background, brand palette from <strong>Solstice</strong>, headline “Slow mornings,
                better coffee”, CTA button, accent divider, soft shadow and a balanced 3-block layout. 3 variations are ready in
                the panel.
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className="grid h-20 place-items-center rounded-xl text-[11px]"
                    style={{
                      background: `linear-gradient(${140 + index * 30}deg, #1b1b28, ${['#6C5CE7', '#00B894', '#FDCB6E'][index]}55)`,
                      color: '#fff',
                    }}
                  >
                    Variation {index + 1}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- extra */}
      <section className="px-5 py-14">
        <div className="mx-auto grid max-w-[1200px] gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: ShieldCheck, title: 'Your keys stay server-side', body: 'AI and storage credentials live in the API layer — never in the browser bundle.' },
            { icon: Globe, title: 'English + Arabic RTL', body: 'Full right-to-left interface, Arabic typography and mirrored layouts.' },
            { icon: Accessibility, title: 'Accessible by default', body: 'Keyboard-first editor, focus rings, contrast checking and ARIA labels on canvas nodes.' },
            { icon: Smartphone, title: 'Share to any device', body: 'Every project has a shareable link with view/edit roles and a mobile-friendly viewer.' },
          ].map((item) => (
            <div key={item.title} className="card p-5">
              <item.icon size={17} style={{ color: 'var(--brand)' }} />
              <h3 className="mb-1 mt-3 text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
                {item.title}
              </h3>
              <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ pricing */}
      <section id="pricing" className="px-5 py-14">
        <div className="mx-auto max-w-[1100px]">
          <SectionTitle
            eyebrow="Plans"
            title="Simple pricing, honest limits"
            body="Plans are enforced server-side through the subscription layer. Payment providers are configured by the deployment — no provider is hardcoded."
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className="card flex flex-col p-6"
                style={plan.highlight ? { borderColor: 'var(--brand)', boxShadow: '0 0 0 1px var(--brand)' } : undefined}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
                    {plan.name}
                  </h3>
                  {plan.highlight ? (
                    <span className="chip" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                      Most popular
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[34px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                    {plan.price}
                  </span>
                  <span className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
                    {plan.note}
                  </span>
                </div>
                <ul className="my-5 flex flex-1 flex-col gap-2.5 p-0 text-[13px]" style={{ listStyle: 'none', color: 'var(--text-muted)' }}>
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link href={plan.href} className="no-underline">
                  <span className={`btn ${plan.highlight ? 'btn-primary' : 'btn-secondary'} w-full`} style={{ justifyContent: 'center' }}>
                    {plan.cta}
                  </span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- faq */}
      <section className="px-5 py-14">
        <div className="mx-auto max-w-[760px]">
          <SectionTitle eyebrow="Questions" title="Frequently asked" />
          <div className="mt-6">
            <Faq />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- cta */}
      <section className="px-5 py-14">
        <div
          className="mx-auto max-w-[1100px] overflow-hidden rounded-3xl px-8 py-14 text-center"
          style={{ background: 'linear-gradient(135deg, rgba(108,92,231,.22), rgba(0,184,148,.16))', border: '1px solid var(--border-strong)' }}
        >
          <h2 className="text-[30px] font-bold tracking-tight sm:text-[40px]">Open the editor. Make something real.</h2>
          <p className="mx-auto mt-3 max-w-[520px] text-[14.5px]" style={{ color: 'var(--text-muted)' }}>
            No download, no demo mode — your first design is saved to your account the moment you touch it.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/sign-up" className="no-underline">
              <span className="btn btn-primary btn-lg">Create your account</span>
            </Link>
            <Link href="/templates" className="no-underline">
              <span className="btn btn-secondary btn-lg">Browse templates</span>
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

function SectionTitle({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="text-center">
      <span className="chip" style={{ background: 'var(--bg-panel-2)', color: 'var(--text-muted)' }}>
        {eyebrow}
      </span>
      <h2 className="mb-2 mt-4 text-[28px] font-bold tracking-tight sm:text-[36px]">{title}</h2>
      {body ? (
        <p className="mx-auto max-w-[640px] text-[14.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {body}
        </p>
      ) : null}
    </div>
  );
}
