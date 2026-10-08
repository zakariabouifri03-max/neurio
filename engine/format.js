import path from 'node:path';

export function formatBytes(value, decimals = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const bytes = Math.max(0, Number(value));
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let amount = bytes;
  let unit = -1;
  while (amount >= 1000 && unit < units.length - 1) {
    amount /= 1000;
    unit += 1;
  }
  return `${amount.toFixed(decimals)} ${units[unit]}`;
}

export function formatRate(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '—';
  return `${formatBytes(value)}/s`;
}

export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) return '—';
  let value = Math.floor(Number(seconds));
  const days = Math.floor(value / 86400);
  value %= 86400;
  const hours = Math.floor(value / 3600);
  value %= 3600;
  const minutes = Math.floor(value / 60);
  const secs = value % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function sanitizeFileName(input, fallback = 'download') {
  let name = String(input || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
  name = name.replace(/\s+/g, ' ');
  if (!name || name === '.' || name === '..') name = fallback;
  const base = name.split('.')[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) name = `_${name}`;
  // Leave room for Windows path limits and the .part / metadata suffixes.
  if (name.length > 180) {
    const ext = path.extname(name);
    name = `${name.slice(0, Math.max(1, 179 - ext.length))}${ext}`;
  }
  return name;
}

export function fileNameFromUrl(input) {
  try {
    const url = new URL(input);
    const raw = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'download');
    return sanitizeFileName(raw || 'download');
  } catch {
    return 'download';
  }
}

export function getFileCategory(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const groups = {
    Videos: new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.mpeg', '.mpg', '.wmv']),
    Music: new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus', '.wma']),
    Images: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg', '.avif']),
    Documents: new Set(['.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md', '.xls', '.xlsx', '.ppt', '.pptx', '.csv']),
    Archives: new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.zst', '.tgz']),
    Software: new Set(['.exe', '.msi', '.msix', '.dmg', '.pkg', '.deb', '.rpm', '.apk', '.appimage', '.iso']),
  };
  for (const [category, extensions] of Object.entries(groups)) if (extensions.has(ext)) return category;
  return 'Other';
}

export function redactUrl(input) {
  try {
    const url = new URL(input);
    url.username = '';
    url.password = '';
    if (url.search) url.search = '?[redacted]';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid URL]';
  }
}

export function getSafeOrigin(input) {
  try {
    const url = new URL(input);
    return `${url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return 'Unknown source';
  }
}
