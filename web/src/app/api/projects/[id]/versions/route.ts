import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, fail, notFound, forbidden, parseBody, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { projects, access, versions, activity } from '@/lib/repo';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!access.canView(id, user?.id ?? null)) return notFound();
  return ok({
    versions: versions.list(id).map((v) => ({
      id: v.id,
      number: v.number,
      label: v.label,
      auto: v.auto,
      creatorId: v.creatorId,
      creatorName: v.creatorName,
      createdAt: v.createdAt,
    })),
  });
});

const postSchema = z.object({ label: z.string().min(1).max(120).optional() });

/** Snapshots the current document as a named version. */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!access.canEdit(id, user.id)) return forbidden();
  const body = await parseBody(req, postSchema).catch(() => ({}));
  const pages = projects.pages(id);
  const project = projects.get(id);
  const record = versions.create(
    id,
    { projectId: id, pages, settings: project?.data ?? null },
    { creatorId: user.id, label: (body as { label?: string }).label ?? 'Manual save', auto: false },
  );
  activity.log(id, user.id, 'version.create', { number: record.number });
  return ok({ id: record.id, number: record.number });
});
