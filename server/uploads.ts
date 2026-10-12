/** Local, filesystem-backed attachment storage. No cloud, no signed URLs. */
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from './db';
import { HttpError, newId } from './ids';
import { sha256Hex } from './crypto';
import { isAllowedUpload, isImageType, sanitizeFilename, sniffImageSize } from './media';
import { getUpload, insertUpload, orphanUploads, deleteUpload, type UploadRow } from './store/messages';
import { logger } from './logger';

const log = logger('uploads');

export interface SaveResult {
  upload: UploadRow;
  bytes: number;
}

export class UploadService {
  readonly dir: string;
  readonly maxBytes: number;

  constructor(dir: string, maxBytes: number) {
    this.dir = dir;
    this.maxBytes = maxBytes;
    mkdirSync(this.dir, { recursive: true });
  }

  /** Sharded path so a single directory never holds tens of thousands of files. */
  pathFor(uploadId: string): string {
    const shard = uploadId.slice(-2).padStart(2, '0');
    return join(this.dir, shard, uploadId);
  }

  save(
    db: Database,
    input: { data: Buffer; filename: string; contentType: string; userId: string; now?: number },
  ): SaveResult {
    const filename = sanitizeFilename(input.filename);
    const contentType = (input.contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (!isAllowedUpload(contentType)) {
      throw new HttpError(415, `Files of type ${contentType} are not allowed`, 'unsupported_media_type');
    }
    if (input.data.length === 0) throw new HttpError(400, 'File is empty', 'empty_file');
    if (input.data.length > this.maxBytes) {
      throw new HttpError(413, `Files must be smaller than ${Math.round(this.maxBytes / 1024 / 1024)} MB`, 'file_too_large');
    }

    const now = input.now ?? Date.now();
    const id = newId(now);
    const target = this.pathFor(id);
    mkdirSync(join(this.dir, id.slice(-2).padStart(2, '0')), { recursive: true });

    const temp = `${target}.part`;
    writeFileSync(temp, input.data);
    renameSync(temp, target);

    insertUpload(db, {
      id,
      user_id: input.userId,
      filename,
      content_type: contentType,
      size: input.data.length,
      storage_key: target,
      sha256: sha256Hex(input.data),
      created_at: now,
    });

    const upload = getUpload(db, id)!;
    log.debug(`stored ${filename} (${input.data.length} bytes) as ${id}`);
    return { upload, bytes: input.data.length };
  }

  size(uploadId: string, upload?: UploadRow): number {
    if (upload) return upload.size;
    try {
      return statSync(this.pathFor(uploadId)).size;
    } catch {
      return 0;
    }
  }

  exists(uploadId: string): boolean {
    return existsSync(this.pathFor(uploadId));
  }

  dimensions(data: Buffer): { width: number; height: number } | null {
    return sniffImageSize(data);
  }

  open(uploadId: string, range?: { start: number; end: number }) {
    const path = this.pathFor(uploadId);
    if (!existsSync(path)) throw new HttpError(404, 'File no longer exists on disk', 'file_missing');
    return createReadStream(path, range);
  }

  remove(db: Database, uploadId: string): void {
    try {
      rmSync(this.pathFor(uploadId), { force: true });
    } catch (error) {
      log.warn(`could not delete ${uploadId}: ${(error as Error).message}`);
    }
    deleteUpload(db, uploadId);
  }

  /** Periodic housekeeping: drop uploads that were never attached to a message. */
  sweepOrphans(db: Database, maxAgeMs = 24 * 60 * 60 * 1000): number {
    const stale = orphanUploads(db, maxAgeMs);
    for (const upload of stale) this.remove(db, upload.id);
    if (stale.length > 0) log.info(`removed ${stale.length} orphaned upload(s)`);
    return stale.length;
  }
}

export function isImageUpload(contentType: string): boolean {
  return isImageType(contentType);
}
