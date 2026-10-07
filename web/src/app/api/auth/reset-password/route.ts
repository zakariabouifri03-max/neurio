import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handler, ok, fail, parseBody } from '@/lib/api';
import { consumeVerificationToken, hashPassword, passwordStrength } from '@/lib/auth';
import { users } from '@/lib/repo';

export const runtime = 'nodejs';

const schema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8).max(200),
});

export const POST = handler(async (req: NextRequest) => {
  const body = await parseBody(req, schema);
  const record = await consumeVerificationToken(body.token, 'PASSWORD_RESET');
  if (!record?.user_id) return fail('This reset link is invalid or has expired', 400, 'BAD_TOKEN');

  const strength = passwordStrength(body.password);
  if (strength.score < 2) return fail('Password is too weak', 422, 'WEAK_PASSWORD', strength.hints);

  users.setPassword(record.user_id, hashPassword(body.password));
  return ok({ reset: true });
});
