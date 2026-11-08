/** Anywear AI logo mark — pure CSS/SVG, no external assets. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-label="Anywear AI"
      role="img"
    >
      <rect width="64" height="64" rx="16" fill="#111114" />
      <path
        d="M32 17 L21 46"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M32 17 L43 46"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M24.5 36.5 L39.5 36.5"
        stroke="#e8e6e1"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="49" r="3.4" fill="#fff" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Logo size={26} />
      <div className="leading-tight">
        <div className="text-[15px] font-bold tracking-tight text-ink">Anywear AI</div>
        <div className="text-[9px] font-medium uppercase tracking-[0.14em] text-ink-muted">
          Virtual Try-On
        </div>
      </div>
    </div>
  );
}
