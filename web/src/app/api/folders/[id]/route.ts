import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, unauthorized, parseBody } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { folders } from '@/lib/repo';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

const schema = z.object({ name: z.string().min(1).max(80).optional(), color: z.string().max(20).nullable().optional() });

export const PATCH = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body = await parseBody(req, schema);
  if (body.name) folders.rename(id, user.id, body.name);
  return ok({ folders: folders.list(user.id) });
});

export const DELETE = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const url = new URL(req.url);
  if (url.searchParams.get('permanent') === 'true') folders.remove(id, user.id);
  else folders.trash(id, user.id);
  return ok({ folders: folders.list(user.id) });
});
