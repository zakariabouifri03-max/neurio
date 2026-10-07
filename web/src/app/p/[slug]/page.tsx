import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { projects, access } from '@/lib/repo';
import { getCurrentUser } from '@/lib/auth';
import { Logo } from '@/components/brand/Logo';
import { SharedViewer } from '@/components/share/SharedViewer';

export const dynamic = 'force-dynamic';

/**
 * Public share view — read-only, no editor chrome. Used by anyone with the link
 * (or invited users) and by the “share to mobile” flow.
 */
export default async function SharedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const project = projects.get(slug) ?? projects.byShareSlug(slug);
  if (!project) notFound();

  const role = access.roleFor(project.id, user?.id ?? null);
  const visible = project.visibility === 'link' || project.visibility === 'public' || !!role;
  if (!visible) notFound();

  const pages = projects.pages(project.id);

  return (
    <main className="flex min-h-screen flex-col" style={{ background: 'var(--bg)' }}>
      <header
        className="flex h-14 items-center gap-3 border-b px-5"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
      >
        <Link href="/" className="no-underline">
          <Logo />
        </Link>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>
            {project.title}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Shared by {project.ownerName} · read-only view
          </div>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {user ? (
            <Link href={`/design/${project.id}`} className="no-underline">
              <span className="btn btn-primary btn-sm">
                <ArrowLeft size={13} /> Open in editor
              </span>
            </Link>
          ) : (
            <Link href={`/sign-in?next=${encodeURIComponent(`/design/${project.id}`)}`} className="no-underline">
              <span className="btn btn-primary btn-sm">Sign in to edit</span>
            </Link>
          )}
        </div>
      </header>

      <SharedViewer
        pages={pages.map((record) => ({
          id: record.id,
          name: record.name,
          width: record.width,
          height: record.height,
          background: record.background ?? { color: '#ffffff' },
          nodes: record.nodes ?? [],
        }))}
        title={project.title}
      />
    </main>
  );
}
