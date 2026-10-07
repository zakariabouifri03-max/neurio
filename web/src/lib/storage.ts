import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { uploadsPath } from './data-path.mjs';

/**
 * Object storage abstraction.
 *
 * The app never touches the filesystem directly — everything goes through
 * `storage.put/get/delete`, so the same code runs against the local disk in
 * development and S3/R2/GCS in production by changing STORAGE_DRIVER.
 */

export type PutOptions = {
  contentType?: string;
  /** Whether the object may be served publicly (uploads are private by default). */
  public?: boolean;
  filename?: string;
  folder?: string;
  metadata?: Record<string, string>;
};

export type StoredObject = {
  key: string;
  url: string;
  size: number;
  contentType: string;
  provider: string;
};

export interface StorageDriver {
  name: string;
  put(data: Buffer, options: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Short-lived signed URL for private objects, or a direct URL when public. */
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
  exists(key: string): Promise<boolean>;
}

/* --------------------------------------------------------------- local driver */

class LocalDriver implements StorageDriver {
  name = 'local';
  private root: string;

  constructor(root: string) {
    this.root = path.resolve(process.cwd(), root);
  }

  private resolve(key: string): string {
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
    const full = path.join(this.root, safe);
    if (!full.startsWith(this.root)) throw new Error('Invalid storage key');
    return full;
  }

  async put(data: Buffer, options: PutOptions): Promise<StoredObject> {
    const ext = path.extname(options.filename ?? '') || extFromMime(options.contentType ?? '');
    const folder = options.folder ?? 'uploads';
    const key = `${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`;
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return {
      key,
      url: `/api/storage/${key}`,
      size: data.byteLength,
      contentType: options.contentType ?? 'application/octet-stream',
      provider: 'local',
    };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true }).catch(() => {});
  }

  async signedUrl(key: string): Promise<string> {
    return `/api/storage/${key.replace(/^\/+/, '')}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------ s3 driver */

/** Minimal AWS Signature V4 so S3/R2 work without pulling in the whole SDK. */
function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

class S3Driver implements StorageDriver {
  name = 's3';
  private bucket: string;
  private region: string;
  private accessKey: string;
  private secretKey: string;
  private endpoint: string;
  private publicBase?: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET!;
    this.region = process.env.S3_REGION ?? 'auto';
    this.accessKey = process.env.S3_ACCESS_KEY_ID!;
    this.secretKey = process.env.S3_SECRET_ACCESS_KEY!;
    this.endpoint = process.env.S3_ENDPOINT ?? `https://s3.${this.region}.amazonaws.com`;
    this.publicBase = process.env.S3_PUBLIC_URL;
  }

  private sign(method: string, key: string, query: string, payload: Buffer | null, headers: Record<string, string>) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const host = new URL(this.endpoint).host;
    const allHeaders = { host, 'x-amz-date': amzDate, ...headers };
    const signedHeaderKeys = Object.keys(allHeaders)
      .map((k) => k.toLowerCase())
      .sort();
    const headerMap = allHeaders as Record<string, string>;
    const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headerMap[k] ?? ''}\n`).join('');
    const signedHeaders = signedHeaderKeys.join(';');
    const payloadHash = crypto.createHash('sha256').update(payload ?? Buffer.alloc(0)).digest('hex');
    const canonicalRequest = [
      method,
      `/${this.bucket}/${key}`,
      query,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const kDate = hmac(`AWS4${this.secretKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(toSign, 'utf8').digest('hex');
    return {
      ...allHeaders,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  async put(data: Buffer, options: PutOptions): Promise<StoredObject> {
    const ext = path.extname(options.filename ?? '') || extFromMime(options.contentType ?? '');
    const key = `${options.folder ?? 'uploads'}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`;
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const headers = this.sign('PUT', key, '', data, {
      'content-type': options.contentType ?? 'application/octet-stream',
      'content-length': String(data.byteLength),
    });
    const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(data) });
    if (!res.ok) throw new Error(`S3 upload failed: ${res.status} ${await res.text()}`);
    return {
      key,
      url: this.publicBase ? `${this.publicBase}/${key}` : `/api/storage/${key}`,
      size: data.byteLength,
      contentType: options.contentType ?? 'application/octet-stream',
      provider: 's3',
    };
  }

  async get(key: string): Promise<Buffer | null> {
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const headers = this.sign('GET', key, '', null, {});
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const headers = this.sign('DELETE', key, '', null, {});
    await fetch(url, { method: 'DELETE', headers }).catch(() => {});
  }

  async signedUrl(key: string, ttlSeconds = 3600): Promise<string> {
    if (this.publicBase) return `${this.publicBase}/${key}`;
    const query = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(
      `${this.accessKey}/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/${this.region}/s3/aws4_request`,
    )}&X-Amz-Date=${new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')}&X-Amz-Expires=${ttlSeconds}&X-Amz-SignedHeaders=host`;
    const headers = this.sign('GET', key, query, null, {});
    return `${this.endpoint}/${this.bucket}/${key}?${query}&X-Amz-Signature=${headers.authorization.split('Signature=')[1]}`;
  }

  async exists(key: string): Promise<boolean> {
    const headers = this.sign('HEAD', key, '', null, {});
    const res = await fetch(`${this.endpoint}/${this.bucket}/${key}`, { method: 'HEAD', headers });
    return res.ok;
  }
}

/* -------------------------------------------------------------------- export */

let cached: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (cached) return cached;
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver === 's3' && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID) {
    cached = new S3Driver();
  } else {
    cached = new LocalDriver(uploadsPath());
  }
  return cached;
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'application/pdf': '.pdf',
    'font/ttf': '.ttf',
    'font/otf': '.otf',
    'font/woff2': '.woff2',
  };
  return map[mime] ?? '';
}

/** Allowed upload types — enforced server-side so clients cannot smuggle scripts. */
export const UPLOAD_RULES: Record<string, { maxBytes: number; mime: RegExp }> = {
  IMAGE: { maxBytes: 40 * 1024 * 1024, mime: /^image\/(png|jpeg|jpg|webp|gif|svg\+xml|avif)$/ },
  VIDEO: { maxBytes: 512 * 1024 * 1024, mime: /^video\/(mp4|webm|quicktime|ogg)$/ },
  AUDIO: { maxBytes: 64 * 1024 * 1024, mime: /^audio\/(mpeg|mp3|wav|ogg|aac|flac|webm)$/ },
  FONT: { maxBytes: 16 * 1024 * 1024, mime: /^font\/(ttf|otf|woff2|woff|sfnt)$|^application\/(font-sfnt|octet-stream|x-font-ttf)$/ },
  DOCUMENT: { maxBytes: 64 * 1024 * 1024, mime: /^application\/(pdf|msword|vnd\.openxmlformats-officedocument\..*|json|zip)$|^text\/plain$/ },
  OTHER: { maxBytes: 64 * 1024 * 1024, mime: /.*/ },
};

export function validateUpload(kind: string, mime: string, size: number): { ok: boolean; error?: string } {
  const rule = UPLOAD_RULES[kind] ?? UPLOAD_RULES.OTHER!;
  if (!rule.mime.test(mime)) return { ok: false, error: `Unsupported file type: ${mime}` };
  if (size > rule.maxBytes) return { ok: false, error: `File exceeds ${Math.round(rule.maxBytes / 1024 / 1024)} MB limit` };
  return { ok: true };
}

/** Blocks SVG/HTML payloads that carry scripts or external fetches. */
export function sanitizeSvg(svg: string): string {
  let out = svg;
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  out = out.replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');
  out = out.replace(/(href|xlink:href)\s*=\s*"(?!#)(https?:|\/\/)/gi, 'data-removed=');
  out = out.replace(/javascript:/gi, '');
  return out;
}

export async function readLocalFile(key: string): Promise<Buffer | null> {
  return storage().get(key);
}
