'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import { Button } from '@/components/ui';
import { Logo } from '@/components/brand/Logo';

/**
 * Root error boundary. A client exception anywhere in the app lands here with a
 * readable message and a way out, instead of a raw stack trace.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[prism] unhandled error', error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-[520px] text-center">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div
          className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
        >
          <AlertTriangle size={20} style={{ color: 'var(--danger)' }} />
        </div>
        <h1 className="m-0 text-[20px] font-bold tracking-tight">Something went wrong</h1>
        <p className="mx-auto mt-2 max-w-[420px] text-[13.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          The page hit an unexpected error. Your work is saved — reload to carry on.
        </p>
        <pre
          className="mx-auto mt-4 max-h-32 overflow-auto rounded-xl p-3 text-start text-[11.5px]"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-faint)' }}
        >
          {error.message || 'Unknown error'}
          {error.digest ? `\nref: ${error.digest}` : ''}
        </pre>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon={<RotateCcw size={14} />} onClick={() => reset()}>
            Try again
          </Button>
          <Link href="/" className="no-underline">
            <Button variant="secondary" icon={<Home size={14} />}>
              Back to home
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
