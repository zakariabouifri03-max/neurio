'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Mail } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button, Field, TextInput } from '@/components/ui';
import { useToast } from '@/components/ui/toast';

export default function ForgotPasswordPage() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.post<{ sent: boolean; devLink: string | null }>('/api/auth/forgot-password', { email });
      setDevLink(result.devLink);
      toast.success('Check your inbox', 'If that email exists, a reset link is on its way.');
    } catch (error) {
      toast.error('Request failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-[20px] font-semibold">Reset your password</h1>
      <p className="mb-5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Enter the email on your account and we’ll send a reset link.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Email">
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <TextInput
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="pl-9"
              placeholder="you@company.com"
            />
          </div>
        </Field>
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Send reset link
        </Button>
      </form>

      {devLink ? (
        <div className="mt-4 rounded-xl p-3 text-[12.5px]" style={{ background: 'var(--bg-panel-2)', color: 'var(--text-muted)' }}>
          No email transport configured — use this link to continue:{' '}
          <a href={devLink} style={{ color: 'var(--brand)' }}>
            reset password
          </a>
        </div>
      ) : null}

      <p className="mb-0 mt-5 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
        <Link href="/sign-in" className="no-underline" style={{ color: 'var(--brand)' }}>
          Back to sign in
        </Link>
      </p>
    </>
  );
}
