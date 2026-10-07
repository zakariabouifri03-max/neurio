'use client';

import { useEffect, useState } from 'react';
import { Link2, Copy, Globe, Lock, Mail, Check, Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useEditor } from '@/store/editor';
import { Button, Field, Modal, Select, TextInput, Toggle } from '@/components/ui';
import { useToast } from '@/components/ui/toast';

type Share = { id: string; userId: string | null; email: string | null; role: string; createdAt: number };

export function ShareDialog({
  open,
  onClose,
  visibility,
  role,
}: {
  open: boolean;
  onClose: () => void;
  visibility: string;
  role: string;
}) {
  const doc = useEditor((s) => s.doc);
  const toast = useToast();
  const [shares, setShares] = useState<Share[]>([]);
  const [mode, setMode] = useState(visibility === 'private' ? 'private' : 'link');
  const [linkRole, setLinkRole] = useState('VIEWER');
  const [email, setEmail] = useState('');
  const [emailRole, setEmailRole] = useState('EDITOR');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const canManage = role === 'OWNER' || role === 'ADMIN';

  const load = async () => {
    try {
      const data = await api.get<{ shares: Share[] }>(`/api/projects/${doc.id}/shares`);
      setShares(data.shares);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (open) {
      load();
      setMode(visibility === 'private' ? 'private' : 'link');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc.id, visibility]);

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/p/${doc.id}` : `/p/${doc.id}`;

  async function applyVisibility(next: string) {
    setBusy(true);
    try {
      await api.patch(`/api/projects/${doc.id}`, { visibility: next });
      toast.success(next === 'private' ? 'Link sharing disabled' : 'Link sharing enabled');
    } catch (error) {
      toast.error('Update failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.info('Copy failed', shareUrl);
    }
  }

  async function invite() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const data = await api.post<{ shares: Share[] }>(`/api/projects/${doc.id}/shares`, {
        email: email.trim(),
        role: emailRole,
      });
      setShares(data.shares);
      setEmail('');
      toast.success('Invite added', 'They get access the moment they sign in with that email.');
    } catch (error) {
      toast.error('Invite failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Share this design" width={560}>
      <div className="flex flex-col gap-4 p-5">
        <div>
          <h4 className="mb-2 mt-0 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
            Link access
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'private', label: 'Only invited people', icon: Lock },
              { id: 'link', label: 'Anyone with the link', icon: Globe },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={!canManage}
                onClick={() => {
                  setMode(item.id);
                  applyVisibility(item.id);
                }}
                className="flex items-center gap-2 rounded-xl p-3 text-start disabled:opacity-60"
                style={{
                  border: `1px solid ${mode === item.id ? 'var(--brand)' : 'var(--border)'}`,
                  background: mode === item.id ? 'var(--brand-soft)' : 'var(--bg-panel)',
                  color: 'var(--text)',
                }}
              >
                <item.icon size={16} style={{ color: mode === item.id ? 'var(--brand)' : 'var(--text-muted)' }} />
                <span className="text-[12.5px]">{item.label}</span>
              </button>
            ))}
          </div>

          {mode === 'link' ? (
            <>
              <div className="mt-3 flex gap-2">
                <TextInput value={shareUrl} readOnly className="flex-1" />
                <Button variant="primary" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {canManage ? (
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                    People with the link can
                  </span>
                  <div className="w-[150px]">
                    <Select
                      value={linkRole}
                      onChange={setLinkRole}
                      options={[
                        { value: 'VIEWER', label: 'View' },
                        { value: 'EDITOR', label: 'Edit' },
                      ]}
                    />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {canManage ? (
          <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <h4 className="mb-2 mt-0 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              <Users size={12} /> Invite people
            </h4>
            <div className="flex gap-2">
              <div className="flex-1">
                <TextInput value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" type="email" />
              </div>
              <div className="w-[130px]">
                <Select
                  value={emailRole}
                  onChange={setEmailRole}
                  options={[
                    { value: 'VIEWER', label: 'Viewer' },
                    { value: 'EDITOR', label: 'Editor' },
                    { value: 'ADMIN', label: 'Admin' },
                  ]}
                />
              </div>
              <Button variant="primary" loading={busy} icon={<Mail size={14} />} onClick={invite}>
                Invite
              </Button>
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              {shares.length === 0 ? (
                <p className="m-0 text-[12px]" style={{ color: 'var(--text-faint)' }}>
                  No individual invites yet.
                </p>
              ) : (
                shares.map((share) => (
                  <div key={share.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: 'var(--bg-panel)' }}>
                    <span className="truncate text-[12.5px]" style={{ color: 'var(--text)' }}>
                      {share.email ?? 'Shared user'}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                        {share.role}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          await api.del(`/api/projects/${doc.id}/shares?shareId=${share.id}`).catch(() => undefined);
                          load();
                        }}
                        style={{ color: 'var(--danger)' }}
                        aria-label="Remove access"
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        <div className="flex items-start gap-2 rounded-xl p-3 text-[11.5px] leading-relaxed" style={{ background: 'var(--bg-panel-2)', color: 'var(--text-muted)' }}>
          <Link2 size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Viewers can open, comment and export. Editors can change the design. Everything is logged in the project activity
            feed with the account that made the change.
          </span>
        </div>
      </div>
    </Modal>
  );
}
