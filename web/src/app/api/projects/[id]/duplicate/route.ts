import { NextRequest } from 'next/server';
import { handler, ok, notFound, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { projects, access, activity } from '@/lib/repo';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!access.canView(id, user.id)) return notFound();
  const url = new URL(req.url);
  const copy = projects.duplicate(id, user.id, url.searchParams.get('title') ?? undefined);
  activity.log(copy.id, user.id, 'project.duplicate', { from: id });
  return ok({ id: copy.id, title: copy.title });
});
