import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, unauthorized, parseBody } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { folders } from '@/lib/repo';

export const runtime = 'nodejs';

export const GET = handler(async () => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return ok({ folders: folders.list(user.id) });
});

const schema = z.object({ name: z.string().min(1).max(80), parentId: z.string().nullable().optional(), color: z.string().max(20).nullable().optional() });

export const POST = handler(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body = await parseBody(req, schema);
  const folder = folders.create(user.id, body.name, body.parentId ?? null, body.color ?? null);
  return ok({ folder, folders: folders.list(user.id) });
});
