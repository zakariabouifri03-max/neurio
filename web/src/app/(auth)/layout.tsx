import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { LanguageToggle } from '@/components/marketing/LanguageToggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-screen place-items-center px-5 py-10">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 0%, rgba(108,92,231,.20), transparent 55%)' }}
      />
      <div className="relative w-full max-w-[420px]">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <LanguageToggle />
        </div>
        <div className="card p-6" style={{ boxShadow: 'var(--shadow-panel)' }}>
          {children}
        </div>
        <p className="mt-4 text-center text-[12px]" style={{ color: 'var(--text-faint)' }}>
          <Link href="/" className="no-underline" style={{ color: 'var(--text-muted)' }}>
            ← Back to Prism Studio
          </Link>
        </p>
      </div>
    </main>
  );
}
