import fs from 'node:fs/promises';
import path from 'node:path';
import { DownloadError } from './errors.js';

export class FileWriter {
  constructor(handle, filePath, expectedSize = null) {
    this.handle = handle;
    this.filePath = filePath;
    this.expectedSize = expectedSize;
    this.closed = false;
  }

  static async open(filePath, { expectedSize = null, reset = false } = {}) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let handle;
    if (reset) {
      handle = await fs.open(filePath, 'w+');
      if (Number.isSafeInteger(expectedSize) && expectedSize >= 0) await handle.truncate(expectedSize);
    } else {
      try {
        handle = await fs.open(filePath, 'r+');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        handle = await fs.open(filePath, 'w+');
      }
      if (Number.isSafeInteger(expectedSize) && expectedSize >= 0) {
        const stat = await handle.stat();
        if (stat.size !== expectedSize) await handle.truncate(expectedSize);
      }
    }
    return new FileWriter(handle, filePath, expectedSize);
  }

  async write(buffer, position) {
    if (this.closed) throw new Error('The temporary file is closed.');
    let written = 0;
    while (written < buffer.length) {
      const result = await this.handle.write(buffer, written, buffer.length - written, position + written);
      if (!result.bytesWritten) throw new DownloadError('The file writer made no progress.', { code: 'EIO', retryable: true });
      written += result.bytesWritten;
    }
    return written;
  }

  async truncate(size) {
    await this.handle.truncate(size);
    this.expectedSize = size;
  }

  async sync() {
    if (!this.closed) await this.handle.datasync();
  }

  async stat() {
    return this.handle.stat();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close();
  }
}
