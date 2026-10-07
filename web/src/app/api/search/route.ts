import { NextRequest } from 'next/server';
import { handler, ok, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { search } from '@/lib/repo';
import { ensureSeeded } from '@/lib/seed';

export const runtime = 'nodejs';

/** Global search across designs, media, templates and elements. */
export const GET = handler(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const url = new URL(req.url);
  const term = (url.searchParams.get('q') ?? '').trim();
  if (!term) return ok({ projects: [], media: [], templates: [], elements: [] });
  ensureSeeded();
  return ok(search.everything(user.id, term, 8));
});
