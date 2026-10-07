import { NextRequest } from 'next/server';
import { handler, ok, notFound } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { activity, access } from '@/lib/repo';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!access.canView(id, user?.id ?? null)) return notFound();
  return ok({ activity: activity.forProject(id) });
});
