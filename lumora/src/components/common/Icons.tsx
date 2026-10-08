import React from 'react';

const wrap = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

export const Icons = {
  templates: wrap(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="12" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="19" width="7" height="2" rx="1" />
    </>
  ),
  elements: wrap(
    <>
      <circle cx="7.5" cy="7.5" r="4.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
      <path d="M13 3h8l-4 7z" />
    </>
  ),
  text: wrap(
    <>
      <path d="M4 6V4h16v2" />
      <path d="M12 4v16" />
      <path d="M9 20h6" />
    </>
  ),
  uploads: wrap(
    <>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </>
  ),
  ai: wrap(
    <>
      <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" />
      <path d="M18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9z" />
    </>
  ),
  backgrounds: wrap(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 15l5-4 4 3 3-2 6 5" />
      <circle cx="9" cy="9" r="1.4" />
    </>
  ),
  shapes: wrap(
    <>
      <rect x="3" y="12" width="9" height="9" rx="1.5" />
      <circle cx="16.5" cy="7.5" r="4.5" />
    </>
  ),
  icons: wrap(
    <>
      <path d="M12 3l2.6 6H21l-5 4 2 7-6-4-6 4 2-7-5-4h6.4z" />
    </>
  ),
  projects: wrap(
    <>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    </>
  ),
  brand: wrap(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M7.5 9.5h9" />
    </>
  ),
  undo: wrap(
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h9a7 7 0 010 14H8" />
    </>
  ),
  redo: wrap(
    <>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9h-9a7 7 0 000 14h5" />
    </>
  ),
  save: wrap(
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v6h8V3M8 21v-7h8v7" />
    </>
  ),
  download: wrap(
    <>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </>
  ),
  copy: wrap(
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h10" />
    </>
  ),
  trash: wrap(
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
    </>
  ),
  eye: wrap(
    <>
      <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: wrap(
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A9.8 9.8 0 0112 6c6.2 0 10 7 10 7a17 17 0 01-3.6 4.2M6.3 7.8A17 17 0 002 13s3.8 7 10 7a9.7 9.7 0 004-.85" />
    </>
  ),
  lock: wrap(
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 118 0v3" />
    </>
  ),
  unlock: wrap(
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 017-2.6" />
    </>
  ),
  play: wrap(<path d="M6 4l14 8-14 8z" />),
  share: wrap(
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.6l6.8-4M8.6 13.4l6.8 4" />
    </>
  ),
  settings: wrap(
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
    </>
  ),
  home: wrap(
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  plus: wrap(
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  grid: wrap(
    <>
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  layers: wrap(
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  )
} as const;

export type IconName = keyof typeof Icons;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <span style={{ display: 'inline-flex', width: size, height: size }}>{Icons[name]}</span>;
}
