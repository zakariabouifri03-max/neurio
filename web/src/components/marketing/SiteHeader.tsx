'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X, Languages, Sun, Moon, LayoutDashboard, Sparkles } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { useSession, useTheme } from '@/components/providers';
import { useI18n } from '@/i18n/provider';
import { Button } from '@/components/ui';

const NAV = [
  { href: '/templates', label: 'Templates' },
  { href: '/#features', label: 'Features' },
  { href: '/#formats', label: 'Formats' },
  { href: '/#pricing', label: 'Pricing' },
];

export function SiteHeader() {
  const { user } = useSession();
  // Guests have a session but no account, so they still get the sign-in affordance.
  const signedIn = !!user && !user.guest;
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  const switchLang = async () => {
    const next = lang === 'en' ? 'ar' : 'en';
    setLang(next);
    if (signedIn) {
      await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: next }),
      }).catch(() => undefined);
    }
    router.refresh();
  };

  return (
    <header
      className="sticky top-0 z-50 w-full backdrop-blur-xl transition-shadow"
      style={{
        background: scrolled ? 'color-mix(in srgb, var(--bg) 82%, transparent)' : 'transparent',
        borderBottom: scrolled ? '1px solid var(--border)' : '1px solid transparent',
      }}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-5">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-[13.5px] font-medium no-underline transition-colors hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-muted)' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={switchLang}
            className="grid h-9 w-9 place-items-center rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            title={lang === 'en' ? 'العربية' : 'English'}
            aria-label="Switch language"
          >
            <Languages size={16} />
          </button>
          <button
            type="button"
            onClick={toggle}
            className="grid h-9 w-9 place-items-center rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {signedIn ? (
            <Link href="/home" className="no-underline">
              <Button variant="primary" icon={<LayoutDashboard size={15} />}>
                Dashboard
              </Button>
            </Link>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link href="/sign-in" className="no-underline">
                <Button variant="ghost">Sign in</Button>
              </Link>
              <Link href="/home" className="no-underline">
                <Button variant="primary" icon={<Sparkles size={15} />}>
                  Start designing
                </Button>
              </Link>
            </div>
          )}

          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-lg md:hidden"
            style={{ color: 'var(--text)', border: '1px solid var(--border)' }}
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t px-5 py-3 md:hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
          <div className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-lg px-3 py-2 text-sm no-underline" style={{ color: 'var(--text-muted)' }}>
                {item.label}
              </Link>
            ))}
            {!signedIn ? (
              <div className="mt-2 flex gap-2 sm:hidden">
                <Link href="/sign-in" className="flex-1 no-underline">
                  <Button variant="secondary" className="w-full">
                    Sign in
                  </Button>
                </Link>
                <Link href="/home" className="flex-1 no-underline">
                  <Button variant="primary" className="w-full">
                    Start designing
                  </Button>
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
