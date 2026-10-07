import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, fail, parseBody, clientKey, rateLimit, tooMany } from '@/lib/api';
import { createSession, verifyPassword, adoptGuestWork, GUEST_COOKIE, GUEST_HEADER } from '@/lib/auth';
import { users } from '@/lib/repo';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const POST = handler(async (req: NextRequest) => {
  const key = clientKey(req, 'login');
  const limit = rateLimit(key, 12, 60_000);
  if (!limit.allowed) return tooMany('Too many sign-in attempts. Wait a minute and try again.');

  const body = await parseBody(req, schema);
  const user = users.byEmail(body.email);
  if (!user || !user.passwordHash || !verifyPassword(body.password, user.passwordHash)) {
    return fail('Incorrect email or password', 401, 'INVALID_CREDENTIALS');
  }
  if (user.disabled) return fail('This account has been disabled', 403, 'DISABLED');

  await createSession(user.id, {
    userAgent: req.headers.get('user-agent'),
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
  });

  // Anything created before signing in moves to the real account.
  const adopted = adoptGuestWork(req.headers.get(GUEST_HEADER) ?? req.cookies.get(GUEST_COOKIE)?.value ?? null, user.id);

  return ok({
    adopted,
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    plan: user.plan,
    locale: user.locale,
    aiCredits: user.aiCredits,
    storageUsed: user.storageUsed,
    storageQuota: user.storageQuota,
    onboarded: user.onboarded,
  });
});
