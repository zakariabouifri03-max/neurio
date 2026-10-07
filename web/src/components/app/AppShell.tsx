'use client';

/**
 * Application chrome for the signed-in area (dashboard, templates, media,
 * brand, settings). The editor uses its own full-bleed shell.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LayoutGrid,
  FolderOpen,
  LayoutTemplate,
  Image as ImageIcon,
  Palette,
  Settings,
  Shield,
  Plus,
  Search,
  ChevronDown,
  LogOut,
  Loader2,
  Menu,
  X,
  Sparkles,
  Globe,
} from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { useSession, useTheme } from '@/components/providers';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api-client';
import { Button, Modal, Field, TextInput, Select } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { SIZE_PRESETS } from '@/data/sizes';

const NAV = [
  { href: '/home', label: 'Home', icon: LayoutGrid },
  { href: '/projects', label: 'Projects', icon: FolderOpen },
  { href: '/templates', label: 'Templates', icon: LayoutTemplate },
  { href: '/media', label: 'Media', icon: ImageIcon },
  { href: '/brand', label: 'Brand kits', icon: Palette },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser } = useSession();
  const { lang, setLang } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[] | null>(null);

  useEffect(() => setMobileOpen(false), [pathname]);

  // Global search across projects, templates, media and brand kits.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const data = await api.get<{ projects: any[]; templates: any[]; media: any[] }>(`/api/search?q=${encodeURIComponent(term)}`);
        setResults([
          ...data.projects.map((p) => ({ kind: 'project', id: p.id, label: p.title, href: `/design/${p.id}`, meta: 'Design' })),
          ...data.templates.map((t) => ({ kind: 'template', id: t.id, label: t.name, href: `/templates?use=${t.id}`, meta: 'Template' })),
          ...data.media.map((m) => ({ kind: 'media', id: m.id, label: m.name, href: '/media', meta: 'Media' })),
        ].slice(0, 8));
      } catch {
        setResults([]);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  const isAdmin = user?.role === 'ADMIN';

  async function signOut() {
    await api.post('/api/auth/logout').catch(() => undefined);
    setUser(null);
    router.push('/');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      {/* ------------------------------------------------------------ sidebar */}
      <aside
        className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-e p-3 md:flex"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
      >
        <div className="px-2 py-2">
          <Logo />
        </div>

        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="btn btn-primary mt-4 w-full"
          style={{ justifyContent: 'center' }}
        >
          <Plus size={15} /> New design
        </button>

        <nav className="mt-4 flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium no-underline transition-colors"
                style={{
                  background: active ? 'var(--bg-active)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                }}
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            );
          })}
          {isAdmin ? (
            <Link
              href="/admin"
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium no-underline"
              style={{
                background: pathname.startsWith('/admin') ? 'var(--bg-active)' : 'transparent',
                color: pathname.startsWith('/admin') ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              <Shield size={16} />
              Administration
            </Link>
          ) : null}
        </nav>

        <div className="mt-auto">
          <div className="rounded-xl p-3" style={{ background: 'var(--bg-panel)' }}>
            <div className="mb-1 flex items-center justify-between text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <span>Storage</span>
              <span>{formatBytes(user?.storageUsed ?? 0)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-hover)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, ((user?.storageUsed ?? 0) / Math.max(1, user?.storageQuota ?? 1)) * 100)}%`,
                  background: 'var(--brand)',
                }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
              <span>{formatBytes(user?.storageQuota ?? 0)} total</span>
              <span style={{ color: 'var(--brand)' }}>{user?.aiCredits ?? 0} AI credits</span>
            </div>
          </div>

          <button
            type="button"
            onClick={signOut}
            className="mt-2 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-muted)' }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      {/* -------------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-4"
          style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg) 88%, transparent)', backdropFilter: 'blur(12px)' }}
        >
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-lg md:hidden"
            style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Menu"
          >
            {mobileOpen ? <X size={16} /> : <Menu size={16} />}
          </button>

          <div className="relative max-w-[520px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects, templates, media…"
              className="h-9 w-full rounded-lg pl-9 pr-3 text-[13px] outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
              aria-label="Search"
            />
            {results && results.length ? (
              <div
                className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl py-1"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)' }}
              >
                {results.map((result) => (
                  <Link
                    key={`${result.kind}-${result.id}`}
                    href={result.href}
                    onClick={() => {
                      setResults(null);
                      setQuery('');
                    }}
                    className="flex items-center justify-between px-3 py-2 text-[13px] no-underline hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text)' }}
                  >
                    <span className="truncate">{result.label}</span>
                    <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                      {result.meta}
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          <div className="ms-auto flex items-center gap-2">
            <Link href="/home?new=design" className="no-underline">
              <Button variant="primary" size="sm" icon={<Sparkles size={14} />}>
                Create
              </Button>
            </Link>

            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              className="grid h-9 w-9 place-items-center rounded-lg"
              style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              aria-label="Switch language"
            >
              <Globe size={15} />
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                style={{ border: '1px solid var(--border)' }}
              >
                <span
                  className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold"
                  style={{ background: 'var(--brand)', color: '#fff' }}
                >
                  {(user?.name ?? 'U').slice(0, 1).toUpperCase()}
                </span>
                <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />
              </button>
              {menuOpen ? (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div
                    className="absolute end-0 top-11 z-50 w-56 overflow-hidden rounded-xl py-1"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)' }}
                  >
                    <div className="border-b px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
                      <div className="truncate text-[13px] font-medium" style={{ color: 'var(--text)' }}>
                        {user?.name}
                      </div>
                      <div className="truncate text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                        {user?.email}
                      </div>
                    </div>
                    {[
                      { label: 'Settings', href: '/settings' },
                      { label: 'Brand kits', href: '/brand' },
                      { label: 'Media library', href: '/media' },
                      ...(isAdmin ? [{ label: 'Administration', href: '/admin' }] : []),
                    ].map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMenuOpen(false)}
                        className="block px-3 py-2 text-[13px] no-underline hover:bg-[var(--bg-hover)]"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {item.label}
                      </Link>
                    ))}
                    <button
                      type="button"
                      onClick={signOut}
                      className="block w-full px-3 py-2 text-start text-[13px] hover:bg-[var(--bg-hover)]"
                      style={{ color: 'var(--danger)' }}
                    >
                      Sign out
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>

        {mobileOpen ? (
          <div className="border-b p-3 md:hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
            <nav className="flex flex-col gap-0.5">
              {[...NAV, ...(isAdmin ? [{ href: '/admin', label: 'Administration', icon: Shield }] : [])].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium no-underline"
                  style={{ color: pathname.startsWith(item.href) ? 'var(--text)' : 'var(--text-muted)' }}
                >
                  <item.icon size={16} />
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        ) : null}

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <NewDesignModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------- new design */

export function NewDesignModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState('Untitled design');
  const [preset, setPreset] = useState('instagram-post');
  const [custom, setCustom] = useState({ width: 1080, height: 1080 });
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'preset' | 'blank' | 'doc'>('preset');

  const presets = SIZE_PRESETS.slice(0, 60);

  async function create(overrides?: { kind?: string; width?: number; height?: number }) {
    setBusy(true);
    try {
      const selected = presets.find((p) => p.id === preset);
      const project = await api.post<{ id: string }>('/api/projects', {
        title,
        kind: overrides?.kind ?? selected?.kind ?? 'design',
        width: overrides?.width ?? (tab === 'preset' && selected ? selected.width : custom.width),
        height: overrides?.height ?? (tab === 'preset' && selected ? selected.height : custom.height),
      });
      onClose();
      router.push(`/design/${project.id}`);
    } catch (error) {
      toast.error('Could not create the design', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New design"
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => create()}>
            Create design
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <Field label="Name">
          <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>

        <div className="flex gap-2">
          {([
            ['preset', 'Preset size'],
            ['blank', 'Custom size'],
            ['doc', 'Document type'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className="rounded-lg px-3 py-1.5 text-[12.5px]"
              style={{
                background: tab === id ? 'var(--brand-soft)' : 'var(--bg-panel)',
                color: tab === id ? 'var(--brand)' : 'var(--text-muted)',
                border: `1px solid ${tab === id ? 'var(--brand)' : 'var(--border)'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'preset' ? (
          <Field label="Size">
            <Select
              value={preset}
              onChange={setPreset}
              options={presets.map((p) => ({ value: p.id, label: `${p.name} — ${p.width}×${p.height}` }))}
            />
          </Field>
        ) : null}

        {tab === 'blank' ? (
          <div className="flex items-end gap-2">
            <Field label="Width (px)">
              <TextInput type="number" value={custom.width} onChange={(event) => setCustom((c) => ({ ...c, width: Number(event.target.value) }))} />
            </Field>
            <Field label="Height (px)">
              <TextInput type="number" value={custom.height} onChange={(event) => setCustom((c) => ({ ...c, height: Number(event.target.value) }))} />
            </Field>
          </div>
        ) : null}

        {tab === 'doc' ? (
          <div className="grid grid-cols-2 gap-2">
            {[
              { kind: 'design', label: 'Design', w: 1080, h: 1080, icon: LayoutGrid },
              { kind: 'presentation', label: 'Presentation', w: 1920, h: 1080, icon: LayoutTemplate },
              { kind: 'document', label: 'Document', w: 794, h: 1123, icon: FolderOpen },
              { kind: 'video', label: 'Video', w: 1920, h: 1080, icon: Sparkles },
            ].map((item) => (
              <button
                key={item.kind}
                type="button"
                onClick={() => create({ kind: item.kind, width: item.w, height: item.h })}
                className="card flex items-center gap-3 p-3 text-start"
              >
                <item.icon size={18} style={{ color: 'var(--brand)' }} />
                <span>
                  <span className="block text-[13.5px] font-medium" style={{ color: 'var(--text)' }}>
                    {item.label}
                  </span>
                  <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                    {item.w}×{item.h}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function SpinnerInline({ label }: { label?: string }) {
  return (
    <span className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
      <Loader2 size={15} className="animate-spin" /> {label ?? 'Loading…'}
    </span>
  );
}
