import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, fail, parseBody, clientKey, rateLimit, tooMany } from '@/lib/api';
import { createSession, hashPassword, passwordStrength, pruneAuthTables, adoptGuestWork, GUEST_COOKIE, GUEST_HEADER } from '@/lib/auth';
import { users, activity } from '@/lib/repo';
import { seedUserDefaults } from '@/lib/seed';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email('Enter a valid email address').max(200),
  name: z.string().min(1, 'Enter your name').max(80),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  locale: z.string().optional(),
});

export const POST = handler(async (req: NextRequest) => {
  const limit = rateLimit(clientKey(req, 'signup'), 8, 60_000);
  if (!limit.allowed) return tooMany('Too many sign-up attempts. Try again shortly.');

  const body = await parseBody(req, schema);
  const email = body.email.trim().toLowerCase();

  if (users.byEmail(email)) return fail('An account with this email already exists', 409, 'EMAIL_TAKEN');

  const strength = passwordStrength(body.password);
  if (strength.score < 2) return fail('Password is too weak', 422, 'WEAK_PASSWORD', strength.hints);

  const user = users.create({
    email,
    name: body.name.trim(),
    passwordHash: hashPassword(body.password),
    locale: body.locale ?? 'en',
    role: process.env.SEED_ADMIN_EMAIL === email ? 'ADMIN' : 'USER',
  });

  seedUserDefaults(user.id);
  activity.log('', user.id, 'user.signup', { email });
  pruneAuthTables();

  await createSession(user.id, {
    userAgent: req.headers.get('user-agent'),
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
  });

  // Designs made as a guest are transferred to the new account.
  const adopted = adoptGuestWork(req.headers.get(GUEST_HEADER) ?? req.cookies.get(GUEST_COOKIE)?.value ?? null, user.id);

  return ok({
    adopted,
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    plan: user.plan,
    locale: user.locale,
    aiCredits: user.aiCredits,
    storageUsed: user.storageUsed,
    storageQuota: user.storageQuota,
  });
});
