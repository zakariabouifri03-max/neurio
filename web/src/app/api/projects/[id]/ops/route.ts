import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, forbidden, notFound, parseBody, unauthorized, fail } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { ops, access } from '@/lib/repo';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

/**
 * Collaboration transport.
 *
 * `GET` long-polls (or streams) new ops since a sequence number; `POST` appends
 * one. Sequence numbers are monotonic per project, so a reconnecting client
 * resumes exactly where it left off and never misses an edit. Presence and
 * cursor updates ride the same channel.
 */
export const GET = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!access.canView(id, user?.id ?? null)) return notFound();
  const url = new URL(req.url);
  const since = Number(url.searchParams.get('since') ?? 0);
  const stream = url.searchParams.get('stream') === 'true';

  if (!stream) {
    return ok({ ops: ops.since(id, since), latest: ops.latest(id), now: Date.now() });
  }

  const encoder = new TextEncoder();
  let cursor = since;
  let closed = false;

  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      send('ready', { latest: ops.latest(id), now: Date.now() });

      const started = Date.now();
      while (!closed && Date.now() - started < 55_000) {
        const batch = ops.since(id, cursor);
        if (batch.length) {
          cursor = batch[batch.length - 1]!.seq;
          send('ops', batch);
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      if (!closed) send('bye', { reason: 'timeout' });
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(readable, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
});

const schema = z.object({
  type: z.string().min(1).max(60),
  payload: z.any(),
});

export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const role = access.roleFor(id, user.id);
  if (!role) return notFound();
  if (role === 'VIEWER' && !['presence', 'cursor'].includes('x')) {
    // viewers may broadcast presence only
  }
  const body = await parseBody(req, schema);
  if (role === 'VIEWER' && !['presence', 'cursor'].includes(body.type)) {
    return forbidden('Viewers cannot edit this design');
  }
  const seq = ops.append(id, user.id, body.type, body.payload);
  return ok({ seq });
});
