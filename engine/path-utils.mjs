import path from 'node:path';
import fs from 'node:fs/promises';

const CATEGORIES = {
  Videos: new Set(['.mp4', '.m4v', '.mkv', '.mov', '.avi', '.webm', '.mpeg', '.mpg', '.wmv', '.flv']),
  Music: new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.wma']),
  Images: new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg', '.heic']),
  Documents: new Set(['.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md', '.xls', '.xlsx', '.ppt', '.pptx', '.csv']),
  Archives: new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.tgz']),
  Software: new Set(['.exe', '.msi', '.msix', '.appx', '.dmg', '.pkg', '.deb', '.rpm', '.iso', '.apk']),
};

export function categoryForFilename(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  for (const [category, extensions] of Object.entries(CATEGORIES)) if (extensions.has(extension)) return category;
  return 'Other';
}

export async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

export async function availableName(directory, requestedName) {
  const parsed = path.parse(requestedName);
  let candidate = requestedName;
  let count = 1;
  while (await exists(path.join(directory, candidate))) {
    candidate = `${parsed.name} (${count})${parsed.ext}`;
    count += 1;
  }
  return candidate;
}
