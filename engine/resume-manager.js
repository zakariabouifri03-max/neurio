import fs from 'node:fs/promises';
import path from 'node:path';

export class ResumeManager {
  async load(metadataPath) {
    try {
      const value = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      return value && typeof value === 'object' ? value : null;
    } catch (error) {
      if (error.code === 'ENOENT' || error.name === 'SyntaxError') return null;
      throw error;
    }
  }

  async save(metadataPath, metadata) {
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    const tempPath = `${metadataPath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, metadataPath);
  }

  async remove(metadataPath) {
    await fs.unlink(metadataPath).catch(() => {});
    await fs.unlink(`${metadataPath}.tmp`).catch(() => {});
  }

  isSameResource(previous, current) {
    if (!previous || !current) return false;
    if (previous.totalBytes != null && current.totalBytes != null && Number(previous.totalBytes) !== Number(current.totalBytes)) return false;
    if (previous.etag) return previous.etag === current.etag;
    if (previous.lastModified) return previous.lastModified === current.lastModified;
    return false;
  }
}
