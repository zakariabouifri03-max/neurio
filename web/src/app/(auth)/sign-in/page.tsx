'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useSession } from '@/components/providers';
import { Button, Field, TextInput } from '@/components/ui';
import { useToast } from '@/components/ui/toast';

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSession();
  const toast = useToast();
  const [form, setForm] = useState({ email: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const next = params.get('next') ?? '/home';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.post<{ adopted?: number }>('/api/auth/login', form);
      await refresh();
      toast.success(
        'Welcome back',
        result.adopted ? `${result.adopted} guest design${result.adopted === 1 ? '' : 's'} moved to your account` : undefined,
      );
      router.push(next);
      router.refresh();
    } catch (error) {
      toast.error('Sign-in failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-[20px] font-semibold">Sign in to Prism Studio</h1>
      <p className="mb-5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Continue to your projects, brand kits and media library.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Email">
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <TextInput
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
              className="pl-9"
              placeholder="you@company.com"
            />
          </div>
        </Field>

        <Field label="Password">
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <TextInput
              type={show ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={form.password}
              onChange={(event) => setForm((f) => ({ ...f, password: event.target.value }))}
              className="pl-9 pr-9"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-faint)' }}
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </Field>

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-[12.5px] no-underline" style={{ color: 'var(--brand)' }}>
            Forgot password?
          </Link>
        </div>

        <Button type="submit" variant="primary" loading={busy} className="mt-1 w-full">
          Sign in
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
        Skip — continue without an account
      </Link>

      <p className="mb-0 mt-5 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
        New here?{' '}
        <Link href="/sign-up" className="no-underline" style={{ color: 'var(--brand)' }}>
          Create a free account
        </Link>
      </p>
    </>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div style={{ height: 320 }} />}>
      <SignInForm />
    </Suspense>
  );
}
