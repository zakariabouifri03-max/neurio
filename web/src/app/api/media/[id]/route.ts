import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, notFound, parseBody, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { assets, users } from '@/lib/repo';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().min(1).max(120).optional(),
  favorite: z.boolean().optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  folderId: z.string().nullable().optional(),
});

export const PATCH = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const asset = assets.get(id);
  if (!asset || asset.ownerId !== user.id) return notFound();
  const body = await parseBody(req, schema);
  assets.update(id, user.id, body);
  return ok({ ...assets.get(id)!, tags: assets.get(id)!.tags });
});

export const DELETE = handler(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const asset = assets.get(id);
  if (!asset || asset.ownerId !== user.id) return notFound();
  if (asset.storageKey) await storage().delete(asset.storageKey).catch(() => {});
  assets.remove(id, user.id);
  users.update(user.id, { storageUsed: assets.storageUsed(user.id) });
  return ok({ deleted: true });
});
