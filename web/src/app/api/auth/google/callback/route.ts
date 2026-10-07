import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { handler, fail } from '@/lib/api';
import { createSession, googleConfigured } from '@/lib/auth';
import { users } from '@/lib/repo';
import { seedUserDefaults } from '@/lib/seed';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest) => {
  if (!googleConfigured()) return fail('Google sign-in is not configured', 501, 'NOT_CONFIGURED');

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const jar = await cookies();
  const expected = jar.get('oauth_state')?.value;

  if (!code || !state || state !== expected) return fail('Invalid OAuth state', 400, 'BAD_STATE');

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? url.origin}/api/auth/google/callback`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return fail('Could not exchange the authorization code', 400, 'OAUTH_FAILED');
  const tokens = (await tokenRes.json()) as { access_token: string };

  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) return fail('Could not read your Google profile', 400, 'PROFILE_FAILED');
  const profile = (await infoRes.json()) as { sub: string; email: string; name: string; picture?: string };

  let user = users.byOAuth('google', profile.sub) ?? users.byEmail(profile.email);
  if (!user) {
    user = users.create({
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture ?? null,
      oauth: { provider: 'google', subject: profile.sub },
    });
    seedUserDefaults(user.id);
  } else if (!user.oauthProvider) {
    users.update(user.id, { avatarUrl: user.avatarUrl ?? profile.picture ?? null });
  }

  await createSession(user.id, { userAgent: req.headers.get('user-agent') });
  jar.delete('oauth_state');
  return new Response(null, { status: 302, headers: { location: '/dashboard' } });
});
