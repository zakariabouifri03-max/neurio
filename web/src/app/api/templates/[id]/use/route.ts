import { NextRequest } from 'next/server';
import { handler, ok, notFound, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { templates, projects, activity } from '@/lib/repo';
import { ensureSeeded } from '@/lib/seed';
import { defaultDocSettings } from '@/engine/types';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

/** Instantiates a template as a new editable project. */
const KINDS = ['design', 'presentation', 'document', 'video', 'whiteboard'] as const;
function normalizeKind(kind?: string | null): (typeof KINDS)[number] {
  return (KINDS as readonly string[]).includes(kind ?? '') ? (kind as (typeof KINDS)[number]) : 'design';
}

export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  ensureSeeded();
  const template = templates.byId(id) ?? templates.bySlug(id);
  if (!template) return notFound('Template not found');

  const data = template.data as { pages?: any[] } | null;
  if (!data?.pages?.length) return notFound('Template has no pages');

  const project = projects.create({
    ownerId: user.id,
    title: template.name,
    kind: normalizeKind(template.kind),
    width: template.width,
    height: template.height,
    category: template.category,
    data: defaultDocSettings(),
  });
  projects.savePages(
    project.id,
    data.pages.map((p: any) => ({
      name: p.name,
      width: p.width,
      height: p.height,
      background: p.background,
      nodes: p.nodes,
      meta: { notes: p.notes ?? '' },
    })),
  );
  templates.use(template.id);
  activity.log(project.id, user.id, 'project.from_template', { template: template.id });
  return ok({ id: project.id, title: project.title });
});
