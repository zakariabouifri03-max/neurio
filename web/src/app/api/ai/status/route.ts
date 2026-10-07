import { handler, ok } from '@/lib/api';
import { aiStatus } from '@/lib/ai/providers';
import { getCurrentUser } from '@/lib/auth';
import { usage } from '@/lib/repo';

export const runtime = 'nodejs';

/** Tells the client which engines are live so the UI can label results. */
export const GET = handler(async () => {
  const user = await getCurrentUser();
  return ok({
    ...aiStatus(),
    credits: user?.aiCredits ?? null,
    usage: user ? usage.summary(user.id, 30) : [],
  });
});
