import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, forbidden, parseBody, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { projects, access, versions, activity } from '@/lib/repo';
import { newId } from '@/lib/ids';

export const runtime = 'nodejs';

/**
 * Autosave endpoint.
 *
 * Writes the page set atomically, bumps the document version, and periodically
 * stores a version snapshot so history can be restored later. Runs on a debounce
 * from the editor and never blocks the UI.
 */
const schema = z.object({
  pages: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        width: z.number().int().min(16).max(8000),
        height: z.number().int().min(16).max(8000),
        background: z.any().optional(),
        nodes: z.any(),
        meta: z.any().optional(),
      }),
    )
    .min(1),
  settings: z.any().optional(),
  thumbnail: z.string().nullable().optional(),
  createVersion: z.boolean().optional(),
  versionLabel: z.string().max(120).optional(),
});

type Params = { params: Promise<{ id: string }> };

export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!access.canEdit(id, user.id)) return forbidden('You have view-only access to this design');

  const body = await parseBody(req, schema);
  const savedPages = projects.savePages(
    id,
    body.pages.map((page) => ({ ...page, nodes: page.nodes ?? [] })),
  );

  const patch: Record<string, unknown> = {};
  if (body.settings) patch.data = body.settings;
  if (body.thumbnail !== undefined) patch.thumbnail = body.thumbnail;
  if (savedPages[0]) {
    patch.width = savedPages[0].width;
    patch.height = savedPages[0].height;
  }
  if (Object.keys(patch).length) projects.update(id, patch);

  const version = projects.incrementVersion(id);

  // Snapshot every 10 saves or on explicit request, so restoring is always possible.
  let snapshotId: string | null = null;
  const shouldSnapshot = body.createVersion || version % 10 === 0;
  if (shouldSnapshot) {
    const record = versions.create(
      id,
      { projectId: id, pages: savedPages.map((p) => ({ ...p })), settings: body.settings ?? null },
      { creatorId: user.id, label: body.versionLabel ?? (body.createVersion ? 'Manual save' : 'Autosave'), auto: !body.createVersion },
    );
    snapshotId = record.id;
  }

  activity.log(id, user.id, 'project.save', { pages: savedPages.length });

  return ok({
    savedAt: Date.now(),
    version,
    pages: savedPages.map((p) => ({ id: p.id, index: p.index })),
    snapshotId,
  });
});
