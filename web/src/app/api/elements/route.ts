import { NextRequest } from 'next/server';
import { handler, ok } from '@/lib/api';
import { elements } from '@/lib/repo';

export const runtime = 'nodejs';

/**
 * Creator-contributed elements stored in the database. The editor unions these
 * with the bundled catalogue (millions of items scale through this table while
 * the bundled set keeps first paint instant).
 */
export const GET = handler(async (req: NextRequest) => {
  const url = new URL(req.url);
  const items = elements.list({
    category: url.searchParams.get('category') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    limit: Number(url.searchParams.get('limit') ?? 120),
    offset: Number(url.searchParams.get('offset') ?? 0),
  });
  return ok({ items, total: elements.count() });
});
