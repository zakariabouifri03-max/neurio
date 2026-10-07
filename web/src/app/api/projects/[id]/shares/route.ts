import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, fail, forbidden, notFound, parseBody, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { projects, shares, access, activity, users } from '@/lib/repo';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!access.canView(id, user.id)) return notFound();
  const project = projects.get(id);
  return ok({
    shares: shares.forProject(id),
    visibility: project?.visibility,
    shareSlug: project?.shareSlug,
    role: access.roleFor(id, user.id),
  });
});

const schema = z.object({
  email: z.string().email().max(200).optional(),
  role: z.enum(['VIEWER', 'EDITOR', 'ADMIN']).default('VIEWER'),
});

export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (access.roleFor(id, user.id) !== 'OWNER') return forbidden('Only the owner can manage access');
  const body = await parseBody(req, schema);

  const target = body.email ? users.byEmail(body.email) : null;
  if (body.email && !target) {
    // Invite by email: the share is created and applied when the account exists.
    shares.add(id, { email: body.email, role: body.role ?? 'VIEWER', grantedBy: user.id });
  } else {
    shares.add(id, {
      userId: target?.id ?? null,
      email: body.email ?? target?.email ?? null,
      role: body.role ?? 'VIEWER',
      grantedBy: user.id,
    });
  }
  activity.log(id, user.id, 'share.add', { email: body.email, role: body.role });
  return ok({ shares: shares.forProject(id) });
});

const deleteSchema = z.object({ shareId: z.string().min(1) });
export const DELETE = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (access.roleFor(id, user.id) !== 'OWNER') return forbidden('Only the owner can manage access');
  const body = await parseBody(req, deleteSchema);
  shares.remove(id, body.shareId);
  return ok({ shares: shares.forProject(id) });
});
