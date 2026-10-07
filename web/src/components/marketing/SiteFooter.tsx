import Link from 'next/link';
import { Github, Twitter, Linkedin, Youtube } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Design editor', href: '/home?new=design' },
      { label: 'Presentations', href: '/home?new=presentation' },
      { label: 'Video editor', href: '/home?new=video' },
      { label: 'Documents', href: '/home?new=document' },
      { label: 'Print studio', href: '/home?new=print' },
    ],
  },
  {
    title: 'Create',
    links: [
      { label: 'Templates', href: '/templates' },
      { label: 'Elements library', href: '/design/new' },
      { label: 'Brand kits', href: '/brand' },
      { label: 'Media library', href: '/media' },
      { label: 'AI assistant', href: '/home' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Dashboard', href: '/home' },
      { label: 'Projects', href: '/projects' },
      { label: 'Settings', href: '/settings' },
      { label: 'Plans', href: '/#pricing' },
      { label: 'Administration', href: '/admin' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t px-5 py-14" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
      <div className="mx-auto grid max-w-[1200px] gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            A professional visual design platform: real editing, real export, real collaboration — in the browser.
          </p>
          <div className="mt-4 flex gap-2">
            {[Github, Twitter, Linkedin, Youtube].map((Icon, index) => (
              <span
                key={index}
                className="grid h-8 w-8 place-items-center rounded-lg"
                style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >
                <Icon size={14} />
              </span>
            ))}
          </div>
        </div>

        {COLUMNS.map((column) => (
          <div key={column.title}>
            <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
              {column.title}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-[13px] no-underline" style={{ color: 'var(--text-muted)' }}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div
        className="mx-auto mt-10 flex max-w-[1200px] flex-wrap items-center justify-between gap-3 border-t pt-6 text-[12px]"
        style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
      >
        <span>© {new Date().getFullYear()} Prism Studio. Built as an original product — no borrowed assets.</span>
        <span>English · العربية</span>
      </div>
    </footer>
  );
}
