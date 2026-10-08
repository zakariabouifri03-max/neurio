import fs from 'node:fs/promises';
import path from 'node:path';
import { DownloadError } from './errors.mjs';

export class FileWriter {
  constructor(filePath, handle) {
    this.filePath = filePath;
    this.handle = handle;
    this.closed = false;
  }

  static async open(filePath, { totalSize = null, resume = false } = {}) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let handle;
    if (resume) {
      handle = await fs.open(filePath, 'r+');
      const stat = await handle.stat();
      if (totalSize != null && stat.size !== totalSize) {
        await handle.close();
        throw new DownloadError('The temporary file length changed during resume validation.', { code: 'PARTIAL_FILE_SIZE_MISMATCH' });
      }
    } else {
      handle = await fs.open(filePath, 'w+');
      if (totalSize != null) await handle.truncate(totalSize);
    }
    return new FileWriter(filePath, handle);
  }

  async writeAt(buffer, position) {
    if (this.closed) throw new Error('File writer is already closed.');
    let written = 0;
    while (written < buffer.length) {
      const result = await this.handle.write(buffer, written, buffer.length - written, position + written);
      if (result.bytesWritten <= 0) throw new Error('A disk write returned zero bytes.');
      written += result.bytesWritten;
    }
    return written;
  }

  async sync() {
    if (!this.closed) await this.handle.sync();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close();
  }
}
