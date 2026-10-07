import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, notFound, unauthorized, parseBody } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { brandKits } from '@/lib/repo';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().min(1).max(80).optional(),
  colors: z.array(z.object({ name: z.string().max(40).optional(), value: z.string().max(30) })).max(40).optional(),
  fonts: z
    .object({ heading: z.string().max(60), body: z.string().max(60), accent: z.string().max(60).optional() })
    .optional(),
  logoUrl: z.string().max(600).nullable().optional(),
  guidelines: z.string().max(4000).nullable().optional(),
  templates: z.array(z.string().max(60)).max(100).optional(),
  images: z.array(z.string().max(60)).max(200).optional(),
  isDefault: z.boolean().optional(),
});

export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const kit = brandKits.byId(id);
  if (!kit || kit.ownerId !== user.id) return notFound();
  return ok({ kit });
});

export const PATCH = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const existing = brandKits.byId(id);
  if (!existing || existing.ownerId !== user.id) return notFound();
  const body = await parseBody(req, schema);
  brandKits.update(id, user.id, body);
  return ok({ kit: brandKits.byId(id), kits: brandKits.list(user.id) });
});

export const DELETE = handler(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  brandKits.remove(id, user.id);
  return ok({ kits: brandKits.list(user.id) });
});
