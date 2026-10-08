import fs from 'node:fs/promises';
import path from 'node:path';

function sumSegments(segments = []) {
  return segments.reduce((sum, segment) => sum + Math.max(0, Number(segment.downloaded) || 0), 0);
}

export class ResumeManager {
  async load(metadataPath) {
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      if (metadata?.version !== 1 || typeof metadata.url !== 'string' || !Array.isArray(metadata.segments)) return null;
      metadata.segments = metadata.segments.map((segment, index) => ({
        index: Number.isInteger(segment.index) ? segment.index : index,
        start: Math.max(0, Number(segment.start) || 0),
        end: Number.isFinite(Number(segment.end)) ? Number(segment.end) : -1,
        downloaded: Math.max(0, Number(segment.downloaded) || 0),
        complete: Boolean(segment.complete),
        failures: Math.max(0, Number(segment.failures) || 0),
      }));
      metadata.downloadedBytes = sumSegments(metadata.segments);
      return metadata;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async save(job) {
    if (!job.metadataPath || !job.url) return;
    const metadata = {
      version: 1,
      id: job.id,
      url: job.url,
      fileName: job.fileName,
      outputDirectory: job.outputDirectory,
      finalPath: job.finalPath,
      partPath: job.partPath,
      size: job.size,
      downloadedRanges: job.segments.map(({ start, end, downloaded }) => ({ start, end, downloaded })),
      etag: job.info?.etag || null,
      lastModified: job.info?.lastModified || null,
      validator: job.validator || null,
      contentType: job.info?.contentType || null,
      supportsRanges: Boolean(job.info?.supportsRanges),
      segments: job.segments.map(segment => ({
        index: segment.index,
        start: segment.start,
        end: segment.end,
        downloaded: segment.downloaded,
        complete: segment.complete,
        failures: segment.failures || 0,
      })),
      createdAt: job.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const temp = `${job.metadataPath}.tmp`;
    await fs.mkdir(path.dirname(job.metadataPath), { recursive: true });
    await fs.writeFile(temp, JSON.stringify(metadata, null, 2), 'utf8');
    await fs.rename(temp, job.metadataPath);
  }

  async remove(metadataPath) {
    if (!metadataPath) return;
    await fs.rm(metadataPath, { force: true }).catch(() => {});
    await fs.rm(`${metadataPath}.tmp`, { force: true }).catch(() => {});
  }
}
