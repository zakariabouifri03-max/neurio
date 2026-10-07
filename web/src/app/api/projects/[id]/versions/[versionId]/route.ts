import { NextRequest } from 'next/server';
import { handler, ok, notFound, forbidden, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { versions, projects, access, activity } from '@/lib/repo';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string; versionId: string }> };

/** Returns a stored snapshot (pages + settings) for preview or restore. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const { id, versionId } = await params;
  const user = await getCurrentUser();
  if (!access.canView(id, user?.id ?? null)) return notFound();
  const version = versions.get(versionId);
  if (!version || version.projectId !== id) return notFound('Version not found');
  return ok({
    id: version.id,
    number: version.number,
    label: version.label,
    createdAt: version.createdAt,
    creatorName: version.creatorName,
    snapshot: version.snapshot,
  });
});

export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const { id, versionId } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!access.canEdit(id, user.id)) return forbidden();

  const version = versions.get(versionId);
  if (!version || version.projectId !== id) return notFound('Version not found');
  const snapshot = version.snapshot as { pages?: any[]; settings?: unknown } | null;
  if (!snapshot?.pages?.length) return notFound('Snapshot is empty');

  // Keep the current state recoverable before overwriting it.
  const currentPages = projects.pages(id);
  const current = projects.get(id);
  versions.create(id, { projectId: id, pages: currentPages, settings: current?.data ?? null }, {
    creatorId: user.id,
    label: 'Before restore',
    auto: false,
  });

  projects.savePages(
    id,
    snapshot.pages.map((p: any) => ({
      name: p.name,
      width: p.width,
      height: p.height,
      background: p.background,
      nodes: p.nodes,
      meta: p.meta,
    })),
  );
  if (snapshot.settings) projects.update(id, { data: snapshot.settings });
  projects.incrementVersion(id);
  activity.log(id, user.id, 'version.restore', { number: version.number });
  return ok({ restored: true, pages: snapshot.pages.length });
});

export const DELETE = handler(async (_req: NextRequest, { params }: Params) => {
  const { id, versionId } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!access.canEdit(id, user.id)) return forbidden();
  versions.remove(versionId);
  return ok({ deleted: true });
});
