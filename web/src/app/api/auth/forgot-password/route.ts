import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, parseBody, clientKey, rateLimit, tooMany } from '@/lib/api';
import { createVerificationToken } from '@/lib/auth';
import { users } from '@/lib/repo';

export const runtime = 'nodejs';

const schema = z.object({ email: z.string().email().max(200) });

/**
 * Always reports success (no account enumeration). In development the reset
 * link is returned so it can be tested end-to-end; in production it is emailed
 * through the configured transport (see README — Email delivery).
 */
export const POST = handler(async (req: NextRequest) => {
  const limit = rateLimit(clientKey(req, 'forgot'), 6, 60_000);
  if (!limit.allowed) return tooMany('Too many reset requests. Try again later.');

  const body = await parseBody(req, schema);
  const user = users.byEmail(body.email);
  let devLink: string | null = null;

  if (user) {
    const token = await createVerificationToken({ type: 'PASSWORD_RESET', userId: user.id, ttlMinutes: 60 });
    const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
    devLink = `${base}/reset-password?token=${token}`;
    if (process.env.SMTP_URL) {
      // A real transport is configured: hand off to it.
      await fetch(process.env.SMTP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: user.email, subject: 'Reset your Prism Studio password', link: devLink }),
      }).catch(() => {});
    } else {
      console.log(`[auth] password reset link for ${user.email}: ${devLink}`);
    }
  }

  return ok({ sent: true, devLink: process.env.NODE_ENV === 'production' ? null : devLink });
});
