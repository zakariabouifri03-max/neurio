import { notFound, redirect } from 'next/navigation';
import { EditorShell } from '@/components/editor/EditorShell';
import { getCurrentUser } from '@/lib/auth';
import { projects, access, brandKits } from '@/lib/repo';
import { defaultDocSettings, type DesignDoc, type DocKind, type Page } from '@/engine/types';

export const dynamic = 'force-dynamic';

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const project = projects.get(id);
  if (!project) notFound();

  const role = access.roleFor(id, user?.id ?? null);
  if (!role) notFound();

  const pageRecords = projects.pages(id);
  const settings = { ...defaultDocSettings(), ...(project.data ?? {}) };

  const pages: Page[] = pageRecords.length
    ? pageRecords.map((record) => ({
        id: record.id,
        name: record.name,
        width: record.width,
        height: record.height,
        background: record.background ?? { color: '#ffffff' },
        nodes: record.nodes ?? [],
        notes: (record.meta as { notes?: string } | null)?.notes ?? '',
      }))
    : [
        {
          id: 'page-1',
          name: project.kind === 'presentation' ? 'Slide 1' : 'Page 1',
          width: project.width,
          height: project.height,
          background: { color: '#ffffff' },
          nodes: [],
        },
      ];

  const doc: DesignDoc = {
    id: project.id,
    title: project.title,
    kind: (project.kind as DocKind) ?? 'design',
    width: project.width,
    height: project.height,
    pages,
    settings,
    timeline: (project.data as { timeline?: DesignDoc['timeline'] } | null)?.timeline,
    version: project.version,
  };

  const kits = user ? brandKits.list(user.id) : [];
  const kit = kits.find((item) => item.isDefault) ?? kits[0] ?? null;

  return (
    <EditorShell
      projectId={project.id}
      initialDoc={doc}
      version={project.version}
      role={role}
      visibility={project.visibility}
      shareSlug={project.shareSlug}
      brandKit={
        kit
          ? {
              id: kit.id,
              name: kit.name,
              colors: (kit.colors ?? []) as { name?: string; value: string }[],
              fonts: (kit.fonts ?? null) as { heading: string; body: string } | null,
              logoUrl: kit.logoUrl ?? null,
            }
          : null
      }
    />
  );
}
