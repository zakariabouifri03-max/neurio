import { NextRequest } from 'next/server';
import { handler, fail } from '@/lib/api';
import { googleConfigured } from '@/lib/auth';
import crypto from 'node:crypto';

export const runtime = 'nodejs';

/**
 * Step 1 of the OAuth 2.0 authorization-code flow.
 * Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET; without them the endpoint
 * tells the client to hide the button rather than failing silently.
 */
export const GET = handler(async (req: NextRequest) => {
  if (!googleConfigured()) {
    return fail('Google sign-in is not configured on this server', 501, 'NOT_CONFIGURED');
  }
  const state = crypto.randomBytes(16).toString('base64url');
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  const res = new Response(null, { status: 302, headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` } });
  res.headers.append('set-cookie', `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  return res;
});
