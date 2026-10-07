import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, unauthorized, parseBody } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { brandKits } from '@/lib/repo';
import { seedUserDefaults } from '@/lib/seed';

export const runtime = 'nodejs';

export const GET = handler(async () => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  seedUserDefaults(user.id);
  return ok({ kits: brandKits.list(user.id) });
});

const schema = z.object({
  name: z.string().min(1).max(80).default('My brand'),
  colors: z.array(z.object({ name: z.string().max(40).optional(), value: z.string().max(30) })).max(40).optional(),
  fonts: z.object({ heading: z.string().max(60), body: z.string().max(60), accent: z.string().max(60).optional() }).optional(),
  logoUrl: z.string().max(600).nullable().optional(),
  guidelines: z.string().max(4000).nullable().optional(),
  isDefault: z.boolean().optional(),
});

export const POST = handler(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body = await parseBody(req, schema);
  const kit = brandKits.create(user.id, body);
  return ok({ kit, kits: brandKits.list(user.id) });
});
