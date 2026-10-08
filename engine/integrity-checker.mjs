import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DownloadError } from './errors.mjs';

function normalizeExpected(value, algorithm) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim().replace(/^:+|:+$/g, '');
  if (/^[a-f0-9]+$/i.test(raw)) return raw.toLowerCase();
  try { return Buffer.from(raw, 'base64').toString('hex').toLowerCase(); } catch { return null; }
}

function equalHex(left, right) {
  if (!left || !right || left.length !== right.length || left.length % 2) return false;
  try { return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex')); } catch { return false; }
}

export class IntegrityChecker {
  async verify(filePath, { expectedSize = null, checksums = {} } = {}) {
    const stat = await fs.stat(filePath);
    if (expectedSize != null && stat.size !== expectedSize) {
      throw new DownloadError(`Expected ${expectedSize} bytes but found ${stat.size} bytes.`, {
        code: 'INTEGRITY_ERROR', details: { expectedSize, actualSize: stat.size },
      });
    }
    const algorithms = Object.entries(checksums || {}).filter(([algorithm, value]) => {
      return ['sha256', 'sha1', 'md5'].includes(algorithm) && typeof value === 'string' && value.length > 0;
    });
    if (algorithms.length === 0) return { size: stat.size, checksum: null, verifiedBy: 'size' };
    const hashes = new Map(algorithms.map(([algorithm]) => [algorithm, createHash(algorithm)]));
    for await (const chunk of createReadStream(filePath)) {
      for (const hash of hashes.values()) hash.update(chunk);
    }
    const computed = Object.fromEntries([...hashes].map(([algorithm, hash]) => [algorithm, hash.digest('hex').toLowerCase()]));
    for (const [algorithm, expectedValue] of algorithms) {
      const expected = normalizeExpected(expectedValue, algorithm);
      if (!expected || !equalHex(computed[algorithm], expected)) {
        throw new DownloadError(`The server-provided ${algorithm.toUpperCase()} checksum did not match.`, {
          code: 'INTEGRITY_ERROR', details: { algorithm },
        });
      }
    }
    return { size: stat.size, checksum: computed, verifiedBy: 'size-and-checksum' };
  }
}
