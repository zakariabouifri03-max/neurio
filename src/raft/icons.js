const line = {
  waves: '<path d="M2 8c3-4 4 4 8 0s5 4 12 0M2 14c3-4 4 4 8 0s5 4 12 0M2 20c3-4 4 4 8 0s5 4 12 0"/>',
  sail: '<path d="M12 3v15M10 4 3 15h7M15 6l6 9h-6M3 19h18l-3 3H6z"/>',
  heart: '<path d="m12 20-8-8C-1 6 6 1 12 7c6-6 13-1 8 5z"/>',
  drop: '<path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  food: '<path d="M7 2v7m-3-7v7a3 3 0 0 0 6 0V2M7 12v10M18 2c-4 4-4 11 0 11h1M19 2v20"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l1.5 1.5m13 13L20 20M4 20l1.5-1.5m13-13L20 4"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  sound: '<path d="M11 4 6 8H2v8h4l5 4zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="M11 4 6 8H2v8h4l5 4zM17 9l5 6m0-6-5 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 2-1.5 2M12 17h.01"/>',
  wind: '<path d="M3 7h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M5 17h5a3 3 0 1 1-3 3"/>',
  arrow: '<path d="M5 19 19 5M5 5h14v14"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  backpack: '<path d="M7 7V5a5 5 0 0 1 10 0v2M5 7h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><rect x="7" y="13" width="10" height="6" rx="1"/><path d="M10 13v2"/>',
  craft: '<path d="m14 3 7 7-4 4-3-3L5 21l-3-3L12 8 9 5z"/>',
  flag: '<path d="M5 22V3m0 0c5-5 9 5 15 0v11c-6 5-10-5-15 0"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5z"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v14H3z"/><circle cx="12" cy="13" r="4"/>',
  mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v7M6 10h12"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8"/>',
  save: '<path d="M4 3h14l3 3v15H3V3zM7 3v6h10V3M7 21v-7h10v7"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1 8M3 3v7h7"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  anchor: '<circle cx="12" cy="4" r="2"/><path d="M12 6v16M8 10h8M3 14v3c0 7 18 7 18 0v-3M1 16l2-2 3 2m12 0 3-2 2 2"/>',
  warning: '<path d="m12 3 10 18H2zM12 9v5m0 3h.01"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M3 16v5h18v-5"/>',
};

const art = {
  wood: '<g transform="rotate(-27 32 32)"><path d="M10 20h41l4 6-4 8H10l-4-7Z" fill="#bb7544"/><path d="M10 20h41l4 6H6Z" fill="#e4b274"/><path d="M13 27h16m6 0h12M10 38h41l5 6-5 8H10l-4-8Z" fill="#9f613b"/><path d="M10 38h41l5 6H6Z" fill="#d19b60"/><path d="M16 45h20m6 0h9M17 23h26" stroke="#805131" stroke-width="1.5"/><path d="M11 20v13m39-13v13M11 38v13m39-13v13" stroke="#f1ca8a" stroke-width="2"/></g>',
  hook: '<path d="M21 9c-7 0-10 10-3 14 9 5 15-4 10-10-5-7-11 0-8 5" fill="none" stroke="#ceaa70" stroke-width="4"/><path d="m24 19 16 18" stroke="#c9a16b" stroke-width="5"/><path d="m40 36 8-10-1 23c-4 13-24 10-21-4l3-7 4 10c2 6 10 4 10-1Z" fill="#c7d9d5" stroke="#849f9c" stroke-width="1.5"/><path d="m36 34 7 6" stroke="#e1ba7f" stroke-width="6"/>',
  hammer: '<path d="m20 52 23-31-8-6L12 47q-1 5 8 5" fill="#bb834f"/><path d="m17 45 21-26" stroke="#e1b679" stroke-width="3"/><path d="m24 12 11-7 21 16-1 8-6 5-20-16-6 1-5-4Z" fill="#9bb2b0"/><path d="m25 12 10-6 21 16-8 5Z" fill="#d2ded5"/><path d="m29 24 8 6" stroke="#e6c895" stroke-width="4"/>',
  paddle: '<path d="m48 5 5 4-25 32-5-4Z" fill="#bb834f"/><path d="m23 30 12 10-14 18-9 1-6-6 2-9Z" fill="#d7a76a"/><path d="m27 39-13 16M26 35 49 7" stroke="#f0c78c" stroke-width="2.5"/>',
  spear: '<path d="m11 56 4 3 32-41-5-4Z" fill="#b58453"/><path d="m38 21 7-17 7 1-1 18-7-3Z" fill="#c9d9d6"/><path d="m40 22 7 5m-9-2 7 5m-9-2 7 5" stroke="#e4cca0" stroke-width="3"/><path d="m15 51 19-25" stroke="#d4ab73" stroke-width="2"/>',
  plastic: '<g transform="rotate(20 32 32)"><path d="M23 15V8h17v7l7 7v31q-15 7-29 0V22Z" fill="#d9e3d7"/><path d="M23 9h17v7H23z" fill="#eaa66a"/><path d="M21 30h24v16H21z" fill="#78b9b5"/><path d="M35 21h6v7h-6z" fill="#208b9b"/><path d="M22 23v25" stroke="#f5f0d8" stroke-width="2"/></g>',
  leaf: '<path d="M11 54C1 25 32 4 54 7c5 25-17 45-37 43" fill="#77ac69"/><path d="M12 52 50 12" stroke="#c6d59a" stroke-width="3"/><path d="m22 43-3-17m14 6-3-15m11 6-2-10m-15 29 16-1m-7-9 15-1" stroke="#4b8b5e" stroke-width="2"/><path d="m9 58 9-10" stroke="#c5b17b" stroke-width="3"/>',
  rope: '<g fill="none" stroke="#d1b684" stroke-width="6"><ellipse cx="31" cy="29" rx="18" ry="14" transform="rotate(-30 31 29)"/><ellipse cx="32" cy="35" rx="18" ry="14" transform="rotate(-30 32 35)"/><ellipse cx="32" cy="40" rx="18" ry="14" transform="rotate(-30 32 40)"/><path d="M47 32c14 7 10 17 3 22"/></g><path d="M16 32c-4-10 11-21 22-18M19 43c-3-6 1-12 6-15" fill="none" stroke="#f0d4a1" stroke-width="2"/>',
  scrap: '<path d="m12 21 21-12 20 8-1 19-23 14-18-9Z" fill="#a9b5b0"/><path d="m12 21 17 9 24-13-1 9-23 13-17-9Z" fill="#d0d7cb"/><path d="m29 39 23-13v10L29 50Z" fill="#728e8c"/><path d="m15 31 10 5m-9 1 8 4" stroke="#b57954" stroke-width="3"/><circle cx="34" cy="20" r="3" fill="#678887"/>',
  cup: '<path d="M43 24h6c12 0 12 23-2 23h-6" fill="none" stroke="#abbdb7" stroke-width="5"/><path d="M12 20h33l-3 34q-15 8-27 0Z" fill="#b4c7bf"/><ellipse cx="28.5" cy="20" rx="16.5" ry="5" fill="#6f9d9f"/><ellipse cx="28.5" cy="22" rx="13" ry="3" fill="#71cece"/><path d="m19 29 2 20" stroke="#e1e4d1" stroke-width="3"/><path d="M30 4s-5 6-5 9a5 5 0 0 0 10 0c0-3-5-9-5-9Z" fill="#87d7d4"/>',
  coconut: '<path d="M10 30c-8 31 43 40 46 4l-8-13-27-2Z" fill="#94613c"/><ellipse cx="33" cy="27" rx="23" ry="17" transform="rotate(14 33 27)" fill="#c99e6c"/><ellipse cx="33" cy="26" rx="19" ry="13" transform="rotate(14 33 26)" fill="#eee3c6"/><ellipse cx="33" cy="27" rx="13" ry="8" transform="rotate(14 33 27)" fill="#b4c8ba"/><path d="m14 38 4 9m4-6 4 10m8-6 1 9m10-12-2 8" stroke="#bd8a52" stroke-width="2"/><path d="m39 27 7-20 9-2" fill="none" stroke="#b4cb93" stroke-width="3"/>',
  foundation: '<path d="m5 28 27-16 27 16v9L32 54 5 38Z" fill="#90653f"/><path d="m5 27 27-16 27 16-27 17Z" fill="#d4a66a"/><path d="m13 23 27 16m-18-21 27 16M5 31l27 17 27-17" fill="none" stroke="#805b3b" stroke-width="2"/><path d="M32 44v10" stroke="#edc58d" stroke-width="2"/>',
  purifier: '<path d="m10 49 13-33h18l12 33M16 33h32" fill="none" stroke="#b89562" stroke-width="4"/><path d="M16 35h33l-8 15H23Z" fill="#728f88"/><path d="m24 14 20 1-8 21Z" fill="#a9d0c1" fill-opacity=".85"/><path d="M26 43h10v12H26z" fill="#c5d8c9"/><path d="M29 33v5" stroke="#7dcad0" stroke-width="3"/><path d="m10 50 44 1" stroke="#c69761" stroke-width="5"/>',
  grill: '<path d="m17 41-7 16m36-16 8 16M9 33h46l-9 16H19Z" fill="#587b77" stroke="#87a39a" stroke-width="3"/><ellipse cx="32" cy="33" rx="23" ry="9" fill="#384c4b"/><path d="M15 30h34m-36 6h36M22 25v15m10-16v18m10-17v15" stroke="#b3b7a3" stroke-width="2"/><path d="M30 27c-13-5 1-17 0-24 20 18 10 28 0 24" fill="#eca364"/><path d="M32 25c-5-3 0-7 1-11 5 6 5 11-1 11" fill="#f2dc91"/>',
  garden: '<path d="m8 37 24-13 25 13v15L32 64 8 52Z" fill="#b88b57"/><path d="m8 37 24-13 25 13-25 14Z" fill="#665b3f"/><path d="M31 40V11" stroke="#c5b383" stroke-width="4"/><path d="M32 18C5-7 9 35 32 18M32 13c26-22 26 14 0 0M31 30C4 6 11 48 31 30" fill="#83b77b"/><path d="m8 45 24 14 25-13M32 52v11" stroke="#865b3f" stroke-width="2"/>',
  sail: '<path d="M31 5v52" stroke="#c2a16c" stroke-width="4"/><path d="m27 10-20 32h20ZM35 13l23 29H35Z" fill="#f2e4bc"/><path d="m7 42 20-10v10Zm28-11 23 11H35Z" fill="#85b1a1"/><path d="M8 55h49l-7 6H15Z" fill="#b48251"/><path d="m31 5 14 1-14 7Z" fill="#df9763"/>',
  barrel: '<path d="M17 9q16-7 31 0 12 22 0 44-15 8-31 0-10-22 0-44" fill="#ba8d57"/><path d="M15 16q17 8 36 0M15 46q17 8 36 0" fill="none" stroke="#798a7c" stroke-width="6"/><path d="M25 12q-5 18 0 42m12-42q5 18 0 42" fill="none" stroke="#d6ae72" stroke-width="2"/>',
};

export function icon(name, size = 20, className = '') {
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${line[name] || line.waves}</svg>`;
}

export function itemIcon(name, size = 48) {
  return `<svg class="item-art" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${art[name] || art.wood}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 20); });
}
