import Link from 'next/link';

/** The Prism mark: three refracted beams forming a prism — original, no assets. */
export function PrismMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="prism-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8B74FF" />
          <stop offset="55%" stopColor="#6C5CE7" />
          <stop offset="100%" stopColor="#00B894" />
        </linearGradient>
      </defs>
      <path d="M16 2 L29 26 H3 Z" fill="url(#prism-a)" opacity="0.18" />
      <path d="M16 2 L29 26 H3 Z" fill="none" stroke="url(#prism-a)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M2 11 H13" stroke="#8B74FF" strokeWidth="2" strokeLinecap="round" />
      <path d="M12.5 15.5 L22 15.5" stroke="#00B894" strokeWidth="2" strokeLinecap="round" />
      <path d="M11.6 19.6 L20.5 19.6" stroke="#FDCB6E" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({
  size = 28,
  href = '/',
  withWordmark = true,
}: {
  size?: number;
  href?: string | null;
  withWordmark?: boolean;
}) {
  const content = (
    <span className="inline-flex items-center gap-2">
      <PrismMark size={size} />
      {withWordmark ? (
        <span className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
          Prism<span style={{ color: 'var(--brand)' }}> Studio</span>
        </span>
      ) : null}
    </span>
  );
  if (!href) return content;
  return (
    <Link href={href} className="inline-flex items-center gap-2 no-underline" aria-label="Prism Studio home">
      {content}
    </Link>
  );
}
