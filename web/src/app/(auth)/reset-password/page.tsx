'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button, Field, TextInput } from '@/components/ui';
import { useToast } from '@/components/ui/toast';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', { token: params.get('token'), password });
      toast.success('Password updated', 'You can sign in now.');
      router.push('/sign-in');
    } catch (error) {
      toast.error('Reset failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-[20px] font-semibold">Choose a new password</h1>
      <p className="mb-5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Use at least 8 characters with a mix of letters and numbers.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="New password">
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <TextInput
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="pl-9"
              placeholder="••••••••"
            />
          </div>
        </Field>
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Update password
        </Button>
      </form>
      <p className="mb-0 mt-5 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
        <Link href="/sign-in" className="no-underline" style={{ color: 'var(--brand)' }}>
          Back to sign in
        </Link>
      </p>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ height: 260 }} />}>
      <ResetForm />
    </Suspense>
  );
}
