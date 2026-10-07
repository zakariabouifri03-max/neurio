'use client';

import { useEffect, useState } from 'react';
import { User, Lock, Globe, Palette, CreditCard, Shield, Trash2, Loader2, Check } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useSession, useTheme } from '@/components/providers';
import { useI18n } from '@/i18n/provider';
import { Button, Field, Modal, Select, TextInput, Toggle } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { formatBytes } from '@/components/app/AppShell';

type Session = { id: string; userAgent: string | null; ip: string | null; createdAt: number; expiresAt: number };

const PLANS = [
  { id: 'FREE', name: 'Free', price: '$0', features: ['Unlimited designs', 'Core export formats', '5 GB storage', '100 AI credits / month'] },
  { id: 'PRO', name: 'Pro', price: '$12', features: ['Brand kits', 'Background removal', '4K + SVG export', '5,000 AI credits / month'] },
  { id: 'TEAM', name: 'Team', price: '$29', features: ['Shared workspaces', 'Approval workflow', '25,000 AI credits / month', 'Priority support'] },
];

export default function SettingsPage() {
  const { user, refresh, setUser } = useSession();
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useI18n();
  const toast = useToast();

  const [profile, setProfile] = useState({ name: '', email: '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (user) setProfile({ name: user.name, email: user.email });
  }, [user]);

  useEffect(() => {
    api
      .get<{ sessions: Session[] }>('/api/auth/me')
      .then((data) => setSessions(data.sessions ?? []))
      .catch(() => undefined);
  }, []);

  async function saveProfile() {
    setBusy(true);
    try {
      await api.patch('/api/auth/me', { name: profile.name });
      await refresh();
      toast.success('Profile saved');
    } catch (error) {
      toast.error('Save failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    setBusy(true);
    try {
      await api.patch('/api/auth/me', passwords);
      setPasswords({ currentPassword: '', newPassword: '' });
      toast.success('Password updated');
    } catch (error) {
      toast.error('Could not change the password', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function switchLocale(next: 'en' | 'ar') {
    setLang(next);
    await api.patch('/api/auth/me', { locale: next }).catch(() => undefined);
    await refresh();
  }

  async function deleteAccount() {
    await api.del('/api/auth/me').catch((error) => toast.error('Delete failed', error.message));
    setUser(null);
    window.location.href = '/';
  }

  return (
    <div className="mx-auto max-w-[860px] px-5 py-7">
      <h1 className="m-0 text-[22px] font-bold tracking-tight">Settings</h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Account, language, appearance, plan and security.
      </p>

      {/* ------------------------------------------------------------ profile */}
      <section className="card mt-6 p-5">
        <h2 className="mb-4 mt-0 flex items-center gap-2 text-[14px] font-semibold">
          <User size={15} style={{ color: 'var(--brand)' }} /> Profile
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <TextInput value={profile.name} onChange={(event) => setProfile((p) => ({ ...p, name: event.target.value }))} />
          </Field>
          <Field label="Email">
            <TextInput value={profile.email} disabled onChange={() => undefined} />
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="primary" loading={busy} onClick={saveProfile}>
            Save profile
          </Button>
        </div>
      </section>

      {/* ------------------------------------------------------- preferences */}
      <section className="card mt-4 p-5">
        <h2 className="mb-4 mt-0 flex items-center gap-2 text-[14px] font-semibold">
          <Globe size={15} style={{ color: 'var(--brand)' }} /> Language & appearance
        </h2>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13.5px]" style={{ color: 'var(--text)' }}>
                Interface language
              </div>
              <div className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                Arabic switches the whole product to right-to-left.
              </div>
            </div>
            <div className="w-[160px]">
              <Select
                value={lang}
                onChange={(value) => switchLocale(value as 'en' | 'ar')}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ar', label: 'العربية' },
                ]}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13.5px]" style={{ color: 'var(--text)' }}>
                Theme
              </div>
              <div className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                Dark is optimised for long editing sessions.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                {theme === 'dark' ? 'Dark' : 'Light'}
              </span>
              <Toggle checked={theme === 'dark'} onChange={toggle} label="Dark theme" />
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- plan */}
      <section className="card mt-4 p-5">
        <h2 className="mb-4 mt-0 flex items-center gap-2 text-[14px] font-semibold">
          <CreditCard size={15} style={{ color: 'var(--brand)' }} /> Plan & usage
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {PLANS.map((plan) => {
            const active = (user?.plan ?? 'FREE') === plan.id;
            return (
              <div
                key={plan.id}
                className="rounded-xl p-4"
                style={{ border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`, background: active ? 'var(--brand-soft)' : 'var(--bg-panel-2)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
                    {plan.name}
                  </span>
                  {active ? <Check size={14} style={{ color: 'var(--brand)' }} /> : null}
                </div>
                <div className="mt-1 text-[20px] font-bold" style={{ color: 'var(--text)' }}>
                  {plan.price}
                </div>
                <ul className="my-3 flex flex-col gap-1.5 p-0 text-[11.5px]" style={{ listStyle: 'none', color: 'var(--text-muted)' }}>
                  {plan.features.map((feature) => (
                    <li key={feature}>· {feature}</li>
                  ))}
                </ul>
                <Button size="sm" variant={active ? 'secondary' : 'primary'} className="w-full" disabled={active}>
                  {active ? 'Current plan' : `Upgrade to ${plan.name}`}
                </Button>
              </div>
            );
          })}
        </div>
        <p className="mb-0 mt-3 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          Billing is wired through the subscription layer; payment providers are configured by the deployment (no provider is
          hardcoded). An administrator can also assign a plan directly.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Usage label="Storage" value={formatBytes(user?.storageUsed ?? 0)} hint={`of ${formatBytes(user?.storageQuota ?? 0)}`} />
          <Usage label="AI credits" value={String(user?.aiCredits ?? 0)} hint="remaining this period" />
          <Usage label="Role" value={user?.role ?? 'USER'} hint="administrators see the admin panel" />
        </div>
      </section>

      {/* --------------------------------------------------------- security */}
      <section className="card mt-4 p-5">
        <h2 className="mb-4 mt-0 flex items-center gap-2 text-[14px] font-semibold">
          <Lock size={15} style={{ color: 'var(--brand)' }} /> Password
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Current password">
            <TextInput
              type="password"
              value={passwords.currentPassword}
              onChange={(event) => setPasswords((p) => ({ ...p, currentPassword: event.target.value }))}
            />
          </Field>
          <Field label="New password">
            <TextInput
              type="password"
              value={passwords.newPassword}
              onChange={(event) => setPasswords((p) => ({ ...p, newPassword: event.target.value }))}
            />
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" loading={busy} onClick={changePassword}>
            Change password
          </Button>
        </div>

        <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-2 text-[12.5px] font-medium" style={{ color: 'var(--text)' }}>
            Active sessions
          </div>
          <div className="flex flex-col gap-1.5">
            {sessions.length === 0 ? (
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                No session information available.
              </span>
            ) : (
              sessions.slice(0, 6).map((session) => (
                <div key={session.id} className="flex items-center justify-between gap-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  <span className="truncate">{session.userAgent ?? 'Unknown device'}</span>
                  <span style={{ color: 'var(--text-faint)' }}>{new Date(session.createdAt).toLocaleString()}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- danger */}
      <section className="card mt-4 p-5" style={{ borderColor: 'var(--danger)' }}>
        <h2 className="mb-2 mt-0 flex items-center gap-2 text-[14px] font-semibold" style={{ color: 'var(--danger)' }}>
          <Shield size={15} /> Danger zone
        </h2>
        <p className="mb-3 mt-0 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Deactivating your account signs you out everywhere and hides your designs. Shared links keep working for
          collaborators.
        </p>
        <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => setDeleteOpen(true)}>
          Deactivate account
        </Button>
      </section>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Deactivate account?"
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deleteAccount}>
              Deactivate
            </Button>
          </>
        }
      >
        <p className="m-0 p-5 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Your account will be deactivated and you will be signed out. Contact an administrator to restore access.
        </p>
      </Modal>
    </div>
  );
}

function Usage({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--bg-panel-2)' }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        {label}
      </div>
      <div className="text-[16px] font-semibold" style={{ color: 'var(--text)' }}>
        {value}
      </div>
      <div className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
        {hint}
      </div>
    </div>
  );
}
