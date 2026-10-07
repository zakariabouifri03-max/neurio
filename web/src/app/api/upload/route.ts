import { NextRequest } from 'next/server';
import { handler, ok, fail, unauthorized, tooMany, clientKey, rateLimit } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { assets, users } from '@/lib/repo';
import { storage, validateUpload, sanitizeSvg } from '@/lib/storage';
import { limitsFor } from '@/lib/rbac';
import { newId } from '@/lib/ids';

export const runtime = 'nodejs';

const MAX_BODY = 600 * 1024 * 1024;

/**
 * Secure upload: authenticated, rate limited, type-checked against an allow
 * list, size-capped by plan quota, and stored through the storage driver
 * (private URL by default). SVGs are sanitized before they are persisted.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const limit = rateLimit(clientKey(req, 'upload'), 60, 60_000);
  if (!limit.allowed) return tooMany('Too many uploads. Slow down.');

  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY) return fail('File is too large', 413, 'TOO_LARGE');

  const form = await req.formData();
  const file = form.get('file');
  const kind = String(form.get('kind') ?? 'IMAGE').toUpperCase();
  const folderId = (form.get('folderId') as string | null) ?? null;

  if (!(file instanceof File)) return fail('No file provided', 400, 'NO_FILE');

  const mime = file.type || 'application/octet-stream';
  const check = validateUpload(kind, mime, file.size);
  if (!check.ok) return fail(check.error!, 415, 'BAD_TYPE');

  const record = users.byId(user.id);
  const quota = limitsFor(record?.plan ?? user.plan).storageBytes;
  if (Number(record?.storageUsed ?? 0) + file.size > quota) {
    return fail('Storage quota reached. Delete files or upgrade your plan.', 413, 'QUOTA');
  }

  let buffer = Buffer.from(await file.arrayBuffer());
  if (mime.includes('svg')) {
    const clean = sanitizeSvg(buffer.toString('utf8'));
    buffer = Buffer.from(clean, 'utf8');
  }

  const stored = await storage().put(buffer, {
    contentType: mime,
    filename: file.name,
    folder: `${user.id}/${kind.toLowerCase()}`,
  });

  const asset = assets.create({
    ownerId: user.id,
    kind,
    name: (form.get('name') as string) || file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Upload',
    url: stored.url,
    storageKey: stored.key,
    provider: stored.provider,
    mime,
    size: stored.size,
    folderId,
    tags: String(form.get('tags') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  });

  users.update(user.id, { storageUsed: assets.storageUsed(user.id) });
  return ok({
    id: asset.id,
    url: asset.url,
    name: asset.name,
    kind: asset.kind,
    mime: asset.mime,
    size: asset.size,
    storageKey: asset.storageKey,
  });
});
