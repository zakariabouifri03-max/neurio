import type { SVGProps } from 'react';

/**
 * Inline SVG icon set.
 *
 * Original 24×24 line drawings on a 1.6 stroke — no icon library, no borrowed
 * asset packs, so the whole app stays self-contained and licence-clean.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icons = {
  Logo: ({ size = 24, ...rest }: IconProps) => (
    <Icon size={size} {...rest}>
      <path d="M12 3 4 20h4l1.6-3.6h4.8L16 20h4L12 3Z" />
      <path d="M10.6 13.4h2.8L12 10.2l-1.4 3.2Z" fill="currentColor" stroke="none" />
    </Icon>
  ),
  Play: (p: IconProps) => (
    <Icon {...p}>
      <path d="M7 4.5 19 12 7 19.5V4.5Z" fill="currentColor" />
    </Icon>
  ),
  Pause: (p: IconProps) => (
    <Icon {...p}>
      <rect x="6.5" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
      <rect x="13.5" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
    </Icon>
  ),
  Stop: (p: IconProps) => (
    <Icon {...p}>
      <rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor" />
    </Icon>
  ),
  SkipBack: (p: IconProps) => (
    <Icon {...p}>
      <path d="M18 5v14L8 12l10-7Z" fill="currentColor" />
      <path d="M5.5 5v14" />
    </Icon>
  ),
  SkipForward: (p: IconProps) => (
    <Icon {...p}>
      <path d="M6 5v14l10-7L6 5Z" fill="currentColor" />
      <path d="M18.5 5v14" />
    </Icon>
  ),
  FrameBack: (p: IconProps) => (
    <Icon {...p}>
      <path d="M14 6 8 12l6 6" />
      <path d="M18.5 6v12" />
    </Icon>
  ),
  FrameForward: (p: IconProps) => (
    <Icon {...p}>
      <path d="M10 6l6 6-6 6" />
      <path d="M5.5 6v12" />
    </Icon>
  ),
  Scissors: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="6" cy="6.5" r="2.5" />
      <circle cx="6" cy="17.5" r="2.5" />
      <path d="M8.2 8.2 20 18M8.2 15.8 20 6" />
    </Icon>
  ),
  Trash: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4.5 7h15M9 7V4.5h6V7M6.5 7l1 13h9l1-13" />
      <path d="M10.5 10.5v6.5M13.5 10.5v6.5" />
    </Icon>
  ),
  Undo: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 9h10a5 5 0 0 1 0 10H9" />
      <path d="M7.5 5.5 4 9l3.5 3.5" />
    </Icon>
  ),
  Redo: (p: IconProps) => (
    <Icon {...p}>
      <path d="M20 9H10a5 5 0 0 0 0 10h5" />
      <path d="M16.5 5.5 20 9l-3.5 3.5" />
    </Icon>
  ),
  Folder: (p: IconProps) => (
    <Icon {...p}>
      <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18v-11.5Z" />
    </Icon>
  ),
  Plus: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  ),
  Magnet: (p: IconProps) => (
    <Icon {...p}>
      <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4H6Z" />
      <path d="M6 8h4M14 8h4" />
    </Icon>
  ),
  Type: (p: IconProps) => (
    <Icon {...p}>
      <path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />
    </Icon>
  ),
  Captions: (p: IconProps) => (
    <Icon {...p}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M9.5 11a2.5 2.5 0 1 0 0 3M16 11a2.5 2.5 0 1 0 0 3" />
    </Icon>
  ),
  Sparkle: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5Z" />
      <path d="M18.5 16.5 19.3 19l2.5.8-2.5.8-.8 2.4" transform="scale(0.7) translate(6 -4)" />
    </Icon>
  ),
  Wave: (p: IconProps) => (
    <Icon {...p}>
      <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11h2" />
    </Icon>
  ),
  Export: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </Icon>
  ),
  Settings: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
    </Icon>
  ),
  Film: (p: IconProps) => (
    <Icon {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 5v14M16 5v14M3 12h18M3 8.5h5M3 15.5h5M16 8.5h5M16 15.5h5" />
    </Icon>
  ),
  Music: (p: IconProps) => (
    <Icon {...p}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </Icon>
  ),
  Image: (p: IconProps) => (
    <Icon {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m4 17 5-4 4 3 3-2 4 3" />
    </Icon>
  ),
  Layers: (p: IconProps) => (
    <Icon {...p}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5M3 17l9 5 9-5" />
    </Icon>
  ),
  Eye: (p: IconProps) => (
    <Icon {...p}>
      <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </Icon>
  ),
  EyeOff: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 4l16 16" />
      <path d="M9.5 6.4A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.3 3.9M6.2 8.2A16.6 16.6 0 0 0 2.5 12S6 18 12 18a9.7 9.7 0 0 0 3.4-.6" />
    </Icon>
  ),
  Volume: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 9.5h3L11 6v12l-4-3.5H4v-5Z" />
      <path d="M14.5 9.5a3.5 3.5 0 0 1 0 5M17 7a7 7 0 0 1 0 10" />
    </Icon>
  ),
  VolumeOff: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 9.5h3L11 6v12l-4-3.5H4v-5Z" />
      <path d="M15 10l4 4M19 10l-4 4" />
    </Icon>
  ),
  Lock: (p: IconProps) => (
    <Icon {...p}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Icon>
  ),
  Unlock: (p: IconProps) => (
    <Icon {...p}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 7.5-2" />
    </Icon>
  ),
  Save: (p: IconProps) => (
    <Icon {...p}>
      <path d="M5 4.5h11L19.5 8v11a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
      <path d="M8 4.5v5h7v-5M8 20v-5h8v5" />
    </Icon>
  ),
  Close: (p: IconProps) => (
    <Icon {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  ),
  Check: (p: IconProps) => (
    <Icon {...p}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Icon>
  ),
  Warning: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 4 2.8 20h18.4L12 4Z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </Icon>
  ),
  Info: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.3" />
    </Icon>
  ),
  Refresh: (p: IconProps) => (
    <Icon {...p}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.5h-4.5" />
    </Icon>
  ),
  Bolt: (p: IconProps) => (
    <Icon {...p}>
      <path d="M13 3 5 13.5h6L11 21l8-10.5h-6L13 3Z" />
    </Icon>
  ),
  Zoom: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5M8.5 11h5M11 8.5v5" />
    </Icon>
  ),
  Fit: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
    </Icon>
  ),
  Expand: (p: IconProps) => (
    <Icon {...p}>
      <path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15" />
    </Icon>
  ),
  Keyframe: (p: IconProps) => (
    <Icon {...p}>
      <path d="m12 6 4 6-4 6-4-6 4-6Z" />
    </Icon>
  ),
  Send: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 12 20 5l-6 15-2.5-6L4 12Z" />
    </Icon>
  ),
  Offline: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 4l16 16" />
      <path d="M5 12.5a5 5 0 0 1 2-4M19 12.5a5 5 0 0 0-1.6-3.7M8.5 16a4 4 0 0 1 3-1.9M2 16.5h3M19 16.5h3M12 20v.3" />
    </Icon>
  ),
  Keyboard: (p: IconProps) => (
    <Icon {...p}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
    </Icon>
  ),
  Upload: (p: IconProps) => (
    <Icon {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5M12 3v12" />
    </Icon>
  ),
  Download: (p: IconProps) => (
    <Icon {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </Icon>
  ),
  Crop: (p: IconProps) => (
    <Icon {...p}>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M2 6h14a2 2 0 0 1 2 2v14" />
    </Icon>
  ),
  Rotate: (p: IconProps) => (
    <Icon {...p}>
      <path d="M21 12a9 9 0 1 1-3.2-6.9" />
      <path d="M21 3v5h-5" />
    </Icon>
  ),
  Reverse: (p: IconProps) => (
    <Icon {...p}>
      <path d="M3 12a9 9 0 1 0 3.2-6.9" />
      <path d="M3 3v5h5" />
    </Icon>
  ),
  Mic: (p: IconProps) => (
    <Icon {...p}>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4M9 22h6" />
    </Icon>
  ),
  Timer: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M9 2h6" />
    </Icon>
  ),
  Grid: (p: IconProps) => (
    <Icon {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Icon>
  ),
  Marker: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 3v10" />
      <path d="M8 13l4 8 4-8z" />
    </Icon>
  ),
};

export type IconName = keyof typeof Icons;
