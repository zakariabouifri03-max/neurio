// NEXUS EDITOR — inline SVG icon set
const P: Record<string, string> = {
  play: 'M6 4l14 8-14 8z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  stop: 'M5 5h14v14H5z',
  restart: 'M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  step: 'M5 4l8 8-8 8zM15 4h3v16h-3z',
  cursor: 'M4 2l7 18 2.5-7.5L21 10z',
  move: 'M12 2l3 3h-2v5h5V8l3 4-3 4v-2h-5v5h2l-3 3-3-3h2v-5H6v2l-3-4 3-4v2h5V5H9z',
  rotate: 'M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  scale: 'M4 20h7v-2H7.8L11 14.8 9.6 13.4 6.4 16.6V13H4zm9.2-9.2L16.4 7.6V11H19V4h-7v2.6h3.4l-3.2 3.2z',
  cube: 'M12 2 3 7v10l9 5 9-5V7zM12 4.3l6.5 3.6L12 11.5 5.5 7.9zM5 9.7l6 3.4v6.6l-6-3.3zm14 0v6.7l-6 3.3v-6.6z',
  sphere: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 0 1 4.5 1.4A8 8 0 0 1 12 20a8 8 0 0 1-4.5-14.6A8 8 0 0 1 12 4z',
  light: 'M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2zM9 19h6v1.5a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 20.5z',
  camera: 'M9 4h6l1.5 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5zM12 9a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z',
  person: 'M12 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-7 20c0-3.9 3.1-7 7-7s7 3.1 7 7z',
  bot: 'M12 2v3M8 5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2 5v2m4-2v2M9 21h6M12 17v4',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5zM5.5 9.4v5.2l5.5 3v-5.3zm13 0-5.5 2.9v5.3l5.5-3z',
  weight: 'M12 2a3 3 0 0 1 3 3c0 .8-.3 1.5-.8 2H16l4 15H4L8 7h1.8A3 3 0 0 1 9 5a3 3 0 0 1 3-3z',
  heart: 'M12 21S4 14.5 4 9a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 5.5-8 12-8 12z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
  gift: 'M20 8h-3.2A3 3 0 0 0 12 3a3 3 0 0 0-4.8 5H4v4h16zm-9 4v9h10v-9zM4 12v9h5v-9z',
  grid: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  spawn: 'M12 2a8 8 0 0 1 8 8h-3a5 5 0 1 0-5 5v-3l5 4.5L12 21v-3a8 8 0 0 1 0-16z',
  target: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  door: 'M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17h2v1H3v-1zm4-9a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 9 12z',
  flag: 'M5 3v18h2v-7h11l-3-4 3-4H7V3z',
  sword: 'M6.9 17.1 3 21l1.4 1.4 3.9-3.9zM20 3l1 1-9.5 9.5-2-2L19 3zM8.5 13.5l2 2-1.6 1.6-2-2z',
  arrow: 'M2 12h16m-5-6 6 6-6 6',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0-6h1v3h-2V2zm0 17h1v3h-2zm11-8v1h-3v-2h3zM4 12v1H1v-2h3zM18.4 5.6l-.7.7-2.1-2.1.7-.7zM8.4 17.6l-.7.7-2.1-2.1.7-.7zm10-2.1.7.7-2.1 2.1-.7-.7zM5.6 6.3l.7.7L4.2 9.1l-.7-.7z',
  mountain: 'M3 20 10 7l4 7 2-3 5 9z',
  water: 'M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z',
  tree: 'M12 2 6 10h3l-4 6h5v6h4v-6h5l-4-6h3z',
  audio: 'M4 9h3l5-5v16l-5-5H4zm12.5-2.5a6 6 0 0 1 0 11l-1.2-1.6a4 4 0 0 0 0-7.8z',
  code: 'M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6z',
  flow: 'M4 3h6v4H4zm10 0h6v4h-6zM7 17h6v4H7zM7 5v3a2 2 0 0 0 2 2h5m0-2v2m0-2h-2m2 0v5a2 2 0 0 1-2 2H7',
  save: 'M5 3h11l5 5v13H5zm3 2v5h8V5zm4 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  sliders: 'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 3v6M8 9v6M16 15v6',
  eye: 'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M2 3l19 19-1.4 1.4L17 19.7A10.6 10.6 0 0 1 12 19c-5 0-9-4.5-10-7a15 15 0 0 1 3.3-4L3.4 4.4zm8.6 5.2a3 3 0 0 0 4.2 4.2zM12 5c5 0 9 4.5 10 7a15.6 15.6 0 0 1-2.4 3.3L15 11a3 3 0 0 0-3.7-3.7L8.8 4.8A11 11 0 0 1 12 5z',
  folder: 'M3 5h6l2 2h10v12H3z',
  file: 'M6 2h8l4 4v16H6zm8 0v4h4z',
  terminal: 'M4 4h16v16H4zm3 4 3 3-3 3m5 1h5',
  wrench: 'M21 6.5a5 5 0 0 1-6.6 6.6L7 20.5a2.1 2.1 0 0 1-3-3l7.4-7.4A5 5 0 0 1 17.5 3l-3 3 .9 2.6L18 9.4z',
  brain: 'M9 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A3 3 0 0 0 6 17a3 3 0 0 0 3 3h1V3zm6 0a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2A3 3 0 0 1 18 17a3 3 0 0 1-3 3h-1V3z',
  hand: 'M7 11V6a1.5 1.5 0 0 1 3 0v5m0-6a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V13a7 7 0 0 1-7 7 6 6 0 0 1-5-2.7L3.5 13A1.6 1.6 0 0 1 6 11l1 1.5',
  search: 'M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm10 16-5.5-5.5',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z',
  copy: 'M8 3h9a2 2 0 0 1 2 2v11h-2V5H8zm-3 4h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  close: 'M5 5l14 14M19 5 5 19',
  check: 'M4 12l5 5L20 6',
  settings: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm8.4 4a8.4 8.4 0 0 0-.1-1.3l2-1.5-2-3.4-2.4 1a8.6 8.6 0 0 0-2.2-1.3L15.3 3h-4l-.4 2.5a8.6 8.6 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.5a8.4 8.4 0 0 0 0 2.6l-2 1.5 2 3.4 2.4-1a8.6 8.6 0 0 0 2.2 1.3l.4 2.5h4l.4-2.5a8.6 8.6 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
  hammer: 'M14 3l6 6-2 2-1-1-8 8-3 3-2-2 3-3 8-8-1-1z',
  package: 'M12 2 3 6.5v11L12 22l9-4.5v-11zm0 2.2 6.5 3.2L12 10.7 5.5 7.4zM5 9.2l6 3v8l-6-3zm14 0v8l-6 3v-8z',
  history: 'M13 3a9 9 0 1 0 8.9 10.4l-2-.4A7 7 0 1 1 13 5v4l5-4.5L13 0zm-1 5v5l4 2 1-1.7-3-1.5V8z',
  layers: 'M12 3 2 8.5 12 14l10-5.5zM2 13l10 5.5 10-5.5-2.1-1.2L12 16.5 4.1 11.8z',
  sunMoon: 'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9zm-1 3.5L9.6 9 7 10l2.6 1L11 13.5l1.4-2.5L15 10l-2.6-1z',
  gauge: 'M12 4a9 9 0 0 0-9 9c0 2 .7 3.9 1.9 5.4L4 20h16l-.9-1.6A8.9 8.9 0 0 0 21 13a9 9 0 0 0-9-9zm0 2a7 7 0 0 1 7 7h-3l-2.5 3L10 12H5a7 7 0 0 1 7-6z',
  bug: 'M9 4h6v2h1a4 4 0 0 1 4 4v1h2v2h-2v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-3H2v-2h2v-1a4 4 0 0 1 4-4h1zm0 6a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 9 10zm6 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z',
  sparkle: 'M12 2l2.2 6.2L20 10l-5.8 1.8L12 18l-2.2-6.2L4 10l5.8-1.8zM19 15l1 2.6 2.6 1-2.6 1L19 22l-1-1.4-2.6-1 2.6-1z',
  zoom: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm5.5 12.5L21 21M8 11h6m-3-3v6',
  wand: 'M6 18 18 6M5 11l2 2m3-9 1 1m7 3 1 1m-3-3 1 1M4 20l1.5-1.5',
  bugfix: 'M12 2l3 3h4v4l3 3-3 3v4h-4l-3 3-3-3H5v-4l-3-3 3-3V5h4zm-2 6 4 4m0-4-4 4',
};

export function icon(name: string, size = 16): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.style.fill = 'none';
  svg.style.stroke = 'currentColor';
  svg.style.strokeWidth = '1.7';
  svg.style.strokeLinecap = 'round';
  svg.style.strokeLinejoin = 'round';
  const d = P[name] ?? P.cube;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

export const logoSvg = `<svg viewBox="0 0 32 32" fill="none"><path d="M16 2 29 9v14L16 30 3 23V9z" stroke="#22d3ee" stroke-width="2"/><path d="M11 22V10l10 12V10" stroke="#22d3ee" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
