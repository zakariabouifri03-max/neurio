import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-[480px] text-center">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div
          className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
        >
          <Compass size={20} style={{ color: 'var(--brand)' }} />
        </div>
        <h1 className="m-0 text-[20px] font-bold tracking-tight">This page does not exist</h1>
        <p className="mt-2 text-[13.5px]" style={{ color: 'var(--text-muted)' }}>
          The design may have been deleted, or the link is wrong.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/home" className="no-underline">
            <span className="btn btn-primary">Open the studio</span>
          </Link>
          <Link href="/templates" className="no-underline">
            <span className="btn btn-secondary">Browse templates</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
