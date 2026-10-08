import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { DownloadError } from './errors.js';

export function parseChecksums(headers = {}) {
  const result = {};
  const digest = String(headers.digest || headers['content-digest'] || '');
  for (const match of digest.matchAll(/(?:^|[,;\s])(?:sha-256|sha256)\s*=\s*:?(?:"?)([A-Za-z0-9+/=_-]+)(?:"?:?)/gi)) {
    result.sha256 = match[1].replace(/:$/, '');
  }
  if (headers['content-md5']) result.md5 = String(headers['content-md5']).trim();
  if (headers['x-checksum-sha256']) result.sha256 = String(headers['x-checksum-sha256']).trim();
  if (headers['x-checksum-sha1']) result.sha1 = String(headers['x-checksum-sha1']).trim();
  return result;
}

function equalChecksum(actualHex, expected) {
  const clean = String(expected).replace(/^\s*:\s*|:\s*$/g, '').replace(/^"|"$/g, '').trim();
  if (!clean) return true;
  if (/^[a-f\d]+$/i.test(clean) && clean.length === actualHex.length) return clean.toLowerCase() === actualHex.toLowerCase();
  try {
    const expectedBytes = Buffer.from(clean, 'base64');
    const actualBytes = Buffer.from(actualHex, 'hex');
    return expectedBytes.length === actualBytes.length && expectedBytes.equals(actualBytes);
  } catch { return false; }
}

export class IntegrityChecker {
  async verify(filePath, { expectedSize = null, checksums = {} } = {}) {
    const stat = await fs.stat(filePath);
    if (Number.isSafeInteger(expectedSize) && stat.size !== expectedSize) {
      throw new DownloadError(`Expected ${expectedSize} bytes, found ${stat.size} bytes.`, { code: 'ERR_INCOMPLETE_FILE' });
    }
    const algorithms = Object.keys(checksums).filter((algorithm) => ['sha256', 'sha1', 'md5'].includes(algorithm));
    const calculated = {};
    if (algorithms.length) {
      const hashers = Object.fromEntries(algorithms.map((name) => [name, createHash(name)]));
      const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
      stream.on('data', (chunk) => {
        for (const hasher of Object.values(hashers)) hasher.update(chunk);
      });
      await once(stream, 'end');
      for (const [algorithm, hasher] of Object.entries(hashers)) calculated[algorithm] = hasher.digest('hex');
      for (const [algorithm, expected] of Object.entries(checksums)) {
        if (!expected || !calculated[algorithm]) continue;
        if (!equalChecksum(calculated[algorithm], expected)) {
          throw new DownloadError(`The source ${algorithm.toUpperCase()} checksum did not match.`, { code: 'ERR_CHECKSUM_MISMATCH' });
        }
      }
    }
    return { size: stat.size, calculated, sizeVerified: Number.isSafeInteger(expectedSize), checksumVerified: algorithms.length > 0 };
  }
}
