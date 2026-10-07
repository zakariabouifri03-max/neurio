import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, forbidden, notFound, parseBody, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { comments, access, activity } from '@/lib/repo';
import { newId } from '@/lib/ids';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!access.canView(id, user?.id ?? null)) return notFound();
  return ok({ comments: comments.forProject(id), currentUserId: user?.id ?? null });
});

const schema = z.object({
  body: z.string().min(1).max(4000),
  parentId: z.string().nullable().optional(),
  pageId: z.string().nullable().optional(),
  nodeId: z.string().nullable().optional(),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
});

export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!access.canView(id, user.id)) return notFound();
  const body = await parseBody(req, schema);
  const mentions = [...body.body.matchAll(/@([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+)/g)].map((m) => m[1]!);
  const commentId = comments.add({
    projectId: id,
    authorId: user.id,
    body: body.body,
    parentId: body.parentId ?? null,
    pageId: body.pageId ?? null,
    nodeId: body.nodeId ?? null,
    x: body.x ?? null,
    y: body.y ?? null,
    mentions,
  });
  activity.log(id, user.id, 'comment.add', { nodeId: body.nodeId ?? null });
  return ok({ id: commentId, comments: comments.forProject(id) });
});

const patchSchema = z.object({
  commentId: z.string().min(1),
  body: z.string().min(1).max(4000).optional(),
  resolved: z.boolean().optional(),
});

export const PATCH = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body = await parseBody(req, patchSchema);
  const list = comments.forProject(id);
  const comment = list.find((c) => c.id === body.commentId);
  if (!comment) return notFound('Comment not found');
  if (comment.authorId !== user.id && access.roleFor(id, user.id) !== 'OWNER') {
    return forbidden('You can only edit your own comments');
  }
  comments.update(body.commentId, { body: body.body, resolved: body.resolved });
  return ok({ comments: comments.forProject(id) });
});

const deleteSchema = z.object({ commentId: z.string().min(1) });
export const DELETE = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body = await parseBody(req, deleteSchema);
  const list = comments.forProject(id);
  const comment = list.find((c) => c.id === body.commentId);
  if (!comment) return notFound();
  if (comment.authorId !== user.id && access.roleFor(id, user.id) !== 'OWNER') return forbidden();
  comments.remove(body.commentId);
  return ok({ comments: comments.forProject(id) });
});
