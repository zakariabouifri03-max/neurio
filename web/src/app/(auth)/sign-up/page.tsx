'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { Mail, Lock, User } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useSession } from '@/components/providers';
import { Button, Field, TextInput } from '@/components/ui';
import { useToast } from '@/components/ui/toast';

function strengthOf(password: string) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(4, score);
}

const LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
const COLORS = ['#ff5c5c', '#ff9f43', '#ffb800', '#00b894', '#00b894'];

function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSession();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => strengthOf(form.password), [form.password]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.post<{ adopted?: number }>('/api/auth/signup', form);
      await refresh();
      toast.success(
        'Account created',
        result.adopted
          ? `Your workspace is ready — ${result.adopted} guest design${result.adopted === 1 ? '' : 's'} moved over`
          : 'Your workspace is ready.',
      );
      router.push(params.get('next') ?? '/home');
      router.refresh();
    } catch (error) {
      toast.error('Could not create the account', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-[20px] font-semibold">Create your account</h1>
      <p className="mb-5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Free forever plan · no credit card required
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Name">
          <div className="relative">
            <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <TextInput
              required
              value={form.name}
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
              className="pl-9"
              placeholder="Your name"
              autoComplete="name"
            />
          </div>
        </Field>

        <Field label="Email">
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <TextInput
              type="email"
              required
              value={form.email}
              onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
              className="pl-9"
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>
        </Field>

        <Field label="Password">
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <TextInput
              type="password"
              required
              value={form.password}
              onChange={(event) => setForm((f) => ({ ...f, password: event.target.value }))}
              className="pl-9"
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </div>
          {form.password ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 gap-1">
                {[0, 1, 2, 3].map((index) => (
                  <span
                    key={index}
                    className="h-1 flex-1 rounded-full transition-colors"
                    style={{ background: index < strength ? COLORS[strength] : 'var(--border)' }}
                  />
                ))}
              </div>
              <span className="text-[11.5px]" style={{ color: COLORS[strength] }}>
                {LABELS[strength]}
              </span>
            </div>
          ) : null}
        </Field>

        <Button type="submit" variant="primary" loading={busy} className="mt-1 w-full">
          Create account
        </Button>

        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => {
            window.location.href = '/api/auth/google';
          }}
        >
          Continue with Google
        </Button>
      </form>

      <Link href="/home" className="mt-3 block text-center text-[13px] no-underline" style={{ color: 'var(--brand)' }}>
        Skip — start designing as a guest
      </Link>

      <p className="mb-0 mt-5 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Already have an account?{' '}
        <Link href="/sign-in" className="no-underline" style={{ color: 'var(--brand)' }}>
          Sign in
        </Link>
      </p>
    </>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<div style={{ height: 380 }} />}>
      <SignUpForm />
    </Suspense>
  );
}
