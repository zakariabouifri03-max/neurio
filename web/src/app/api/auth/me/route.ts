import { NextRequest } from 'next/server';
import { handler, ok, fail, parseBody, unauthorized } from '@/lib/api';
import { getCurrentUser, hashPassword, verifyPassword, destroySession, passwordStrength } from '@/lib/auth';
import { users, assets, all } from '@/lib/repo';
import { z } from 'zod';
import { seedUserDefaults } from '@/lib/seed';

export const runtime = 'nodejs';

export const GET = handler(async () => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const storageUsed = assets.storageUsed(user.id);
  const sessions = all<{ id: string; user_agent: string | null; ip: string | null; created_at: number; expires_at: number }>(
    'SELECT id, user_agent, ip, created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
    [user.id],
  ).map((s) => ({ id: s.id, userAgent: s.user_agent, ip: s.ip, createdAt: Number(s.created_at), expiresAt: Number(s.expires_at) }));
  return ok({ ...user, storageUsed, sessions });
});

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  locale: z.enum(['en', 'ar']).optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  onboarded: z.boolean().optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8).max(200).optional(),
});

export const PATCH = handler(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body = await parseBody(req, patchSchema);

  if (body.newPassword) {
    const record = users.byId(user.id);
    if (!record?.passwordHash || !verifyPassword(body.currentPassword ?? '', record.passwordHash)) {
      return fail('Current password is incorrect', 403, 'BAD_PASSWORD');
    }
    const strength = passwordStrength(body.newPassword);
    if (strength.score < 2) return fail('New password is too weak', 422, 'WEAK_PASSWORD', strength.hints);
    users.setPassword(user.id, hashPassword(body.newPassword));
  }

  users.update(user.id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.locale !== undefined ? { locale: body.locale } : {}),
    ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
    ...(body.onboarded !== undefined ? { onboarded: body.onboarded } : {}),
  });

  seedUserDefaults(user.id);
  const updated = users.byId(user.id)!;
  return ok({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    locale: updated.locale,
    avatarUrl: updated.avatarUrl,
    onboarded: updated.onboarded,
  });
});

export const DELETE = handler(async () => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  await destroySession();
  // Account removal is a soft delete so shared content stays resolvable.
  users.update(user.id, { disabled: true });
  return ok({ deleted: true });
});
