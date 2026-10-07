import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, parseBody, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { projects, folders } from '@/lib/repo';
import { allTemplates } from '@/data/templates';
import { defaultDocSettings } from '@/engine/types';
import { slugify, newId } from '@/lib/ids';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const url = new URL(req.url);
  const items = projects.list(user.id, {
    folderId: url.searchParams.get('folderId') ?? undefined,
    trashed: url.searchParams.get('trashed') === 'true',
    favorite: url.searchParams.get('favorite') === 'true',
    kind: url.searchParams.get('kind') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    sort: (url.searchParams.get('sort') as 'updated' | 'created' | 'title') ?? 'updated',
    limit: Number(url.searchParams.get('limit') ?? 60),
    offset: Number(url.searchParams.get('offset') ?? 0),
    sharedWith: url.searchParams.get('shared') === 'true' ? user.id : undefined,
  });
  return ok({
    items: items.map((p) => ({
      id: p.id,
      title: p.title,
      kind: p.kind,
      width: p.width,
      height: p.height,
      thumbnail: p.thumbnail,
      favorite: p.favorite,
      trashed: p.trashed,
      visibility: p.visibility,
      folderId: p.folderId,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
      pageCount: p.pageCount ?? 0,
      role: p.role ?? 'OWNER',
      ownerName: p.ownerName,
    })),
    folders: folders.list(user.id),
  });
});

const createSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  kind: z.enum(['design', 'presentation', 'document', 'video', 'whiteboard']).optional(),
  width: z.number().int().min(16).max(8000).optional(),
  height: z.number().int().min(16).max(8000).optional(),
  folderId: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  templateId: z.string().optional(),
  templateSlug: z.string().optional(),
  pages: z.any().optional(),
});

/** Document kinds the database accepts; anything else falls back to a design. */
const KINDS = ['design', 'presentation', 'document', 'video', 'whiteboard'] as const;
function normalizeKind(kind?: string | null): (typeof KINDS)[number] {
  return (KINDS as readonly string[]).includes(kind ?? '') ? (kind as (typeof KINDS)[number]) : 'design';
}

export const POST = handler(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body = await parseBody(req, createSchema);

  // Start from a template when one is requested.
  let template = body.templateSlug ? allTemplates().find((t) => t.slug === body.templateSlug) : undefined;
  if (!template && body.templateId) template = allTemplates().find((t) => t.id === body.templateId);

  const width = body.width ?? template?.width ?? 1080;
  const height = body.height ?? template?.height ?? 1080;
  const kind = normalizeKind(body.kind ?? template?.kind);

  const project = projects.create({
    ownerId: user.id,
    title: body.title ?? template?.name ?? 'Untitled design',
    kind,
    width,
    height,
    folderId: body.folderId ?? null,
    category: template?.category ?? body.category ?? null,
    data: defaultDocSettings(),
  });

  const pages = template
    ? template.pages.map((p) => ({
        name: p.name,
        width: p.width,
        height: p.height,
        background: p.background,
        nodes: p.nodes,
        meta: { notes: p.notes ?? '' },
      }))
    : body.pages ?? [
        {
          name: kind === 'document' ? 'Page 1' : kind === 'presentation' ? 'Slide 1' : 'Page 1',
          width,
          height,
          background: { color: '#ffffff' },
          nodes: [],
          meta: {},
        },
      ];

  projects.savePages(project.id, pages);
  return ok({ id: project.id, title: project.title, width, height, kind });
});
