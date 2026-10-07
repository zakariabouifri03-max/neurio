import { NextRequest } from 'next/server';
import { handler, ok, forbidden, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { admin, users, templates, elements } from '@/lib/repo';
import { isAdmin } from '@/lib/rbac';

export const runtime = 'nodejs';

/** Admin overview — role gated. */
export const GET = handler(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isAdmin(user)) return forbidden('Admin access required');
  const url = new URL(req.url);
  const section = url.searchParams.get('section') ?? 'stats';

  if (section === 'users') {
    const result = users.list({
      search: url.searchParams.get('search') ?? undefined,
      limit: Number(url.searchParams.get('limit') ?? 50),
      offset: Number(url.searchParams.get('offset') ?? 0),
    });
    return ok({ users: result.items, total: result.total });
  }
  if (section === 'templates') {
    return ok({ templates: templates.list({ limit: 50 }).items, total: templates.count() });
  }
  if (section === 'elements') {
    return ok({ elements: elements.list({ limit: 50 }), total: elements.count() });
  }
  if (section === 'reports') {
    return ok({ reports: admin.reports(url.searchParams.get('status') ?? 'OPEN') });
  }
  return ok({ stats: admin.stats() });
});
