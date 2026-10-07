import { NextRequest } from 'next/server';
import { handler, ok, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { assets } from '@/lib/repo';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const url = new URL(req.url);
  const items = assets.list(user.id, {
    kind: url.searchParams.get('kind') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    favorite: url.searchParams.get('favorite') === 'true',
    folderId: url.searchParams.get('folderId') ?? undefined,
    sort: url.searchParams.get('sort') ?? undefined,
    limit: Number(url.searchParams.get('limit') ?? 100),
  });
  return ok({
    items: items.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      url: a.url,
      mime: a.mime,
      size: a.size,
      width: a.width,
      height: a.height,
      duration: a.duration,
      favorite: a.favorite,
      tags: a.tags,
      folderId: a.folderId,
      usageCount: a.usageCount,
      createdAt: a.createdAt,
      meta: a.meta,
    })),
  });
});
