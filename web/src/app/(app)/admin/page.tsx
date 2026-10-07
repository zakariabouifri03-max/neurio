'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shield, Users, LayoutTemplate, BarChart3, Search, Loader2, Cpu } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button, EmptyState, SearchInput, Select } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { formatBytes } from '@/components/app/AppShell';

type Stats = {
  users?: number;
  projects?: number;
  assets?: number;
  templates?: number;
  elements?: number;
  storageBytes?: number;
  [key: string]: unknown;
};

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  plan: string;
  storageUsed: number;
  createdAt: number;
  disabled?: boolean;
};

export default function AdminPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'stats' | 'users' | 'templates' | 'elements'>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [elements, setElements] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [aiStatus, setAiStatus] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ section: tab, ...(search && tab === 'users' ? { search } : {}) });
      const data = await api.get<any>(`/api/admin?${params.toString()}`);
      if (tab === 'stats') setStats(data.stats);
      if (tab === 'users') setUsers(data.users ?? []);
      if (tab === 'templates') setTemplates(data.templates ?? []);
      if (tab === 'elements') setElements(data.elements ?? []);
    } catch (error) {
      toast.error('Admin data unavailable', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tab, search, toast]);

  useEffect(() => {
    const timer = window.setTimeout(load, 150);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    api
      .get<any>('/api/ai/status')
      .then(setAiStatus)
      .catch(() => undefined);
  }, []);

  const TABS = [
    { id: 'stats' as const, label: 'Overview', icon: BarChart3 },
    { id: 'users' as const, label: 'Users', icon: Users },
    { id: 'templates' as const, label: 'Templates', icon: LayoutTemplate },
    { id: 'elements' as const, label: 'Elements', icon: Shield },
  ];

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-[22px] font-bold tracking-tight">Administration</h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Platform-wide metrics, accounts and catalogue health.
          </p>
        </div>
        <div className="flex gap-2">
          {TABS.map((item) => (
            <Button key={item.id} size="sm" variant={tab === item.id ? 'primary' : 'secondary'} icon={<item.icon size={13} />} onClick={() => setTab(item.id)}>
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      {tab === 'users' ? (
        <div className="mt-5 w-[280px]">
          <SearchInput value={search} onChange={setSearch} placeholder="Search users…" />
        </div>
      ) : null}

      {loading ? (
        <div className="grid place-items-center py-20">
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--brand)' }} />
        </div>
      ) : (
        <>
          {tab === 'stats' && stats ? (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {Object.entries(stats)
                  .filter(([, value]) => typeof value === 'number')
                  .map(([key, value]) => (
                    <div key={key} className="card p-4">
                      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                        {key.replace(/([A-Z])/g, ' $1')}
                      </div>
                      <div className="text-[20px] font-bold" style={{ color: 'var(--text)' }}>
                        {key.toLowerCase().includes('byte') || key.toLowerCase().includes('storage')
                          ? formatBytes(Number(value))
                          : Number(value).toLocaleString()}
                      </div>
                    </div>
                  ))}
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <section className="card p-5">
                  <h2 className="mb-3 mt-0 flex items-center gap-2 text-[14px] font-semibold">
                    <Cpu size={15} style={{ color: 'var(--brand)' }} /> AI providers
                  </h2>
                  {aiStatus ? (
                    <div className="flex flex-col gap-2 text-[12.5px]">
                      <Row label="Text provider" value={String(aiStatus.textProvider ?? aiStatus.provider ?? 'local')} />
                      <Row label="Image provider" value={String(aiStatus.imageProvider ?? 'local')} />
                      <Row
                        label="Configured"
                        value={aiStatus.configured ? 'Yes — server-side keys' : 'No — running the local offline model'}
                      />
                      {aiStatus.availableProviders?.length ? (
                        <Row label="Supported" value={aiStatus.availableProviders.join(', ')} />
                      ) : null}
                    </div>
                  ) : (
                    <p className="m-0 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                      Loading provider status…
                    </p>
                  )}
                  <p className="mb-0 mt-3 text-[11.5px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                    Keys are read from the server environment only — they are never exposed to the browser. Without keys the
                    studio uses its built-in local model and procedural art generator.
                  </p>
                </section>

                <section className="card p-5">
                  <h2 className="mb-3 mt-0 flex items-center gap-2 text-[14px] font-semibold">
                    <BarChart3 size={15} style={{ color: 'var(--brand)' }} /> Runtime
                  </h2>
                  <div className="flex flex-col gap-2 text-[12.5px]">
                    <Row label="Database" value="SQLite (node:sqlite) — Postgres-ready schema" />
                    <Row label="Storage driver" value={String(process.env.NEXT_PUBLIC_STORAGE_DRIVER ?? 'local disk / S3 by config')} />
                    <Row label="Video encoding" value="In-browser (no server ffmpeg required)" />
                  </div>
                </section>
              </div>
            </>
          ) : null}

          {tab === 'users' ? (
            <div className="card mt-5 overflow-hidden p-0">
              {users.length === 0 ? (
                <EmptyState icon={<Users size={22} />} title="No users found" />
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ color: 'var(--text-faint)' }}>
                      <th className="px-4 py-2.5 text-start font-medium">User</th>
                      <th className="px-4 py-2.5 text-start font-medium">Role</th>
                      <th className="px-4 py-2.5 text-start font-medium">Plan</th>
                      <th className="px-4 py-2.5 text-start font-medium">Storage</th>
                      <th className="px-4 py-2.5 text-start font-medium">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((item) => (
                      <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-4 py-2.5">
                          <div style={{ color: 'var(--text)' }}>{item.name}</div>
                          <div className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                            {item.email}
                          </div>
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                          {item.role}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                          {item.plan}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                          {formatBytes(item.storageUsed ?? 0)}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                          {new Date(item.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}

          {tab === 'templates' ? (
            <div className="card mt-5 overflow-hidden p-0">
              {templates.length === 0 ? (
                <EmptyState icon={<LayoutTemplate size={22} />} title="No templates in the database yet" description="The catalogue seeds itself on first use." />
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ color: 'var(--text-faint)' }}>
                      <th className="px-4 py-2.5 text-start font-medium">Name</th>
                      <th className="px-4 py-2.5 text-start font-medium">Category</th>
                      <th className="px-4 py-2.5 text-start font-medium">Size</th>
                      <th className="px-4 py-2.5 text-start font-medium">Uses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((template) => (
                      <tr key={template.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text)' }}>
                          {template.name}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                          {template.category}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                          {template.width}×{template.height}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                          {template.usageCount ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}

          {tab === 'elements' ? (
            <div className="card mt-5 overflow-hidden p-0">
              {elements.length === 0 ? (
                <EmptyState icon={<Shield size={22} />} title="No database elements" description="The bundled element library ships with the app." />
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ color: 'var(--text-faint)' }}>
                      <th className="px-4 py-2.5 text-start font-medium">Name</th>
                      <th className="px-4 py-2.5 text-start font-medium">Category</th>
                      <th className="px-4 py-2.5 text-start font-medium">Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {elements.map((element) => (
                      <tr key={element.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text)' }}>
                          {element.name}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                          {element.category}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                          {(element.tags ?? []).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  );
}
