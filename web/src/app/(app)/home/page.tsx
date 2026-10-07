'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  ArrowRight,
  Sparkles,
  Palette,
  Image as ImageIcon,
  Upload,
  FileText,
  Presentation,
  Film,
  Printer,
  Loader2,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { useSession } from '@/components/providers';
import { ProjectCard, type ProjectItem } from '@/components/app/ProjectCard';
import { NewDesignModal, formatBytes } from '@/components/app/AppShell';
import { CreateBar } from '@/components/marketing/CreateBar';
import { TemplatePreview } from '@/components/template/TemplatePreview';
import { Button, EmptyState } from '@/components/ui';
import type { Page } from '@/engine/types';

type Showcase = { id: string; name: string; category: string; page: Page };

export default function DashboardHomePage() {
  const { user } = useSession();
  const [projects, setProjects] = useState<ProjectItem[] | null>(null);
  const [showcase, setShowcase] = useState<Showcase[]>([]);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    api
      .get<{ items: ProjectItem[] }>('/api/projects?limit=12')
      .then((data) => setProjects(data.items))
      .catch(() => setProjects([]));
  }, []);

  // The catalogue is code-generated and large; load it after first paint.
  useEffect(() => {
    let cancelled = false;
    import('@/data/templates').then((module) => {
      if (cancelled) return;
      const items = module
        .allTemplates()
        .filter((template) => template.featured)
        .slice(0, 8)
        .map((template) => ({
          id: template.id,
          name: template.name,
          category: template.category,
          page: template.pages[0]!,
        }));
      setShowcase(items);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-[24px] font-bold tracking-tight">
            {greeting}, {user?.name?.split(' ')[0] ?? 'there'}
          </h1>
          <p className="mt-1 text-[13.5px]" style={{ color: 'var(--text-muted)' }}>
            Everything you make is saved automatically. Pick up where you left off or start something new.
          </p>
        </div>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setNewOpen(true)}>
          New design
        </Button>
      </div>

      {/* ------------------------------------------------------- quick start */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickCard icon={Presentation} label="Presentation" body="16:9 deck" kind="presentation" w={1920} h={1080} />
        <QuickCard icon={FileText} label="Document" body="A4 page" kind="document" w={794} h={1123} />
        <QuickCard icon={Film} label="Video" body="1080p timeline" kind="video" w={1920} h={1080} />
        <QuickCard icon={Printer} label="Print" body="A3 poster" kind="print" w={1123} h={1587} />
      </div>

      <div className="mt-5">
        <CreateBar compact />
      </div>

      {/* ------------------------------------------------------------ stats */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <StatCard label="Designs" value={String(projects?.length ?? '—')} hint="in your workspace" />
        <StatCard
          label="Storage used"
          value={formatBytes(user?.storageUsed ?? 0)}
          hint={`of ${formatBytes(user?.storageQuota ?? 0)}`}
        />
        <StatCard label="AI credits" value={String(user?.aiCredits ?? 0)} hint="remaining this month" />
      </div>

      {/* -------------------------------------------------------- recents */}
      <section className="mt-9">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[15px] font-semibold">Recent designs</h2>
          <Link href="/projects" className="flex items-center gap-1 text-[12.5px] no-underline" style={{ color: 'var(--brand)' }}>
            All projects <ArrowRight size={13} />
          </Link>
        </div>

        {projects === null ? (
          <div className="grid place-items-center py-16">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--brand)' }} />
          </div>
        ) : projects.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Sparkles size={22} />}
              title="No designs yet"
              description="Create your first design — start from a blank canvas or a ready-made template."
              action={
                <Button variant="primary" onClick={() => setNewOpen(true)}>
                  New design
                </Button>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ templates */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[15px] font-semibold">Start from a template</h2>
          <Link href="/templates" className="flex items-center gap-1 text-[12.5px] no-underline" style={{ color: 'var(--brand)' }}>
            Browse all <ArrowRight size={13} />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {showcase.length === 0
            ? Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="skeleton"
                  style={{ aspectRatio: '4/3', borderRadius: 12 }}
                />
              ))
            : showcase.map((template) => (
                <Link
                  key={template.id}
                  href={`/templates?use=${template.id}`}
                  className="group rounded-xl p-2 no-underline transition-transform hover:-translate-y-0.5"
                  style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
                >
                  <div className="grid place-items-center overflow-hidden rounded-lg" style={{ background: 'var(--bg-input)' }}>
                    <TemplatePreview page={template.page} width={200} />
                  </div>
                  <div className="px-1 pb-0.5 pt-2 text-[12.5px] font-medium" style={{ color: 'var(--text)' }}>
                    {template.name}
                  </div>
                  <div className="px-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    {template.category}
                  </div>
                </Link>
              ))}
        </div>
      </section>

      {/* --------------------------------------------------------- library */}
      <section className="mt-10 grid gap-3 sm:grid-cols-3">
        <LibraryCard icon={Palette} href="/brand" title="Brand kits" body="Colours, fonts, logos and voice applied in one click." />
        <LibraryCard icon={ImageIcon} href="/media" title="Media library" body="Uploads, AI images and stock — searchable and re-usable." />
        <LibraryCard icon={Upload} href="/media?upload=1" title="Import assets" body="Drag in images, video, audio, fonts and SVG art." />
      </section>

      <NewDesignModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function QuickCard({
  icon: Icon,
  label,
  body,
  kind,
  w,
  h,
}: {
  icon: any;
  label: string;
  body: string;
  kind: string;
  w: number;
  h: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const project = await api.post<{ id: string }>('/api/projects', { title: label, kind, width: w, height: h });
      router.push(`/design/${project.id}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={create}
      disabled={busy}
      className="card flex items-center gap-3 p-4 text-start transition-transform hover:-translate-y-0.5"
    >
      <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Icon size={17} />}
      </span>
      <span>
        <span className="block text-[13.5px] font-medium" style={{ color: 'var(--text)' }}>
          {label}
        </span>
        <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
          {body}
        </span>
      </span>
    </button>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11.5px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        {label}
      </div>
      <div className="mt-1 text-[22px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
        {value}
      </div>
      <div className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
        {hint}
      </div>
    </div>
  );
}

function LibraryCard({ icon: Icon, href, title, body }: { icon: any; href: string; title: string; body: string }) {
  return (
    <Link href={href} className="card flex items-start gap-3 p-4 no-underline transition-transform hover:-translate-y-0.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: 'var(--bg-panel-2)', color: 'var(--text)' }}>
        <Icon size={17} />
      </span>
      <span>
        <span className="block text-[13.5px] font-medium" style={{ color: 'var(--text)' }}>
          {title}
        </span>
        <span className="block text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {body}
        </span>
      </span>
    </Link>
  );
}
