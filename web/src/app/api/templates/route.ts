import { NextRequest } from 'next/server';
import { handler, ok } from '@/lib/api';
import { templates, favorites } from '@/lib/repo';
import { getCurrentUser } from '@/lib/auth';
import { ensureSeeded } from '@/lib/seed';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest) => {
  ensureSeeded();
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const result = templates.list({
    category: url.searchParams.get('category') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    featured: url.searchParams.get('featured') === 'true',
    trending: url.searchParams.get('trending') === 'true',
    sort: url.searchParams.get('sort') ?? undefined,
    limit: Number(url.searchParams.get('limit') ?? 60),
    offset: Number(url.searchParams.get('offset') ?? 0),
  });
  const favs = user ? new Set(favorites.list(user.id, 'TEMPLATE')) : new Set<string>();
  return ok({
    items: result.items.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      category: t.category,
      subcategory: t.subcategory,
      tags: t.tags,
      width: t.width,
      height: t.height,
      kind: t.kind,
      authorName: t.authorName,
      license: t.license,
      featured: t.featured,
      trending: t.trending,
      usageCount: t.usageCount,
      favorite: favs.has(t.id),
      data: url.searchParams.get('full') === 'true' ? t.data : undefined,
    })),
    total: result.total,
    categories: templates.categories(),
  });
});
