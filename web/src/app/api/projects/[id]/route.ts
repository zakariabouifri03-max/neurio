import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, fail, notFound, forbidden, parseBody, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { projects, access, activity, versions } from '@/lib/repo';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** Loads a full document (project row + pages). */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  const role = access.roleFor(id, user?.id ?? null);
  if (!role) return notFound('Design not found');
  const project = projects.get(id);
  if (!project) return notFound();
  const pages = projects.pages(id);
  projects.touch(id);
  return ok({
    project: {
      id: project.id,
      title: project.title,
      kind: project.kind,
      width: project.width,
      height: project.height,
      data: project.data,
      thumbnail: project.thumbnail,
      visibility: project.visibility,
      shareSlug: project.shareSlug,
      favorite: project.favorite,
      version: project.version,
      updatedAt: project.updatedAt,
    },
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      width: p.width,
      height: p.height,
      background: p.background,
      nodes: p.nodes,
      meta: p.meta,
    })),
    role,
  });
});

const patchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  folderId: z.string().nullable().optional(),
  favorite: z.boolean().optional(),
  trashed: z.boolean().optional(),
  visibility: z.enum(['private', 'link', 'public']).optional(),
  shareSlug: z.string().nullable().optional(),
  thumbnail: z.string().nullable().optional(),
  width: z.number().int().min(16).max(8000).optional(),
  height: z.number().int().min(16).max(8000).optional(),
  data: z.any().optional(),
});

export const PATCH = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!access.canEdit(id, user.id)) return forbidden();
  const body = await parseBody(req, patchSchema);

  if (body.visibility === 'link' || body.visibility === 'public') {
    const project = projects.get(id);
    if (!project?.shareSlug) body.shareSlug = `${slugifySafe(project?.title ?? 'design')}-${Math.random().toString(36).slice(2, 8)}`;
  }

  projects.update(id, body);
  activity.log(id, user.id, 'project.update', Object.keys(body));
  return ok({ updated: true });
});

export const DELETE = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const url = new URL(req.url);
  const permanent = url.searchParams.get('permanent') === 'true';
  const role = access.roleFor(id, user.id);
  if (role !== 'OWNER') return forbidden('Only the owner can delete this design');
  if (permanent) {
    projects.hardDelete(id);
  } else {
    projects.update(id, { trashed: true });
    activity.log(id, user.id, 'project.trash', {});
  }
  return ok({ deleted: true, permanent });
});

function slugifySafe(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'design';
}
