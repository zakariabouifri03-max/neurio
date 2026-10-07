import { handler, ok } from '@/lib/api';
import { destroySession } from '@/lib/auth';

export const runtime = 'nodejs';

export const POST = handler(async () => {
  await destroySession();
  return ok({ signedOut: true });
});
