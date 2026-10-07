import { NextResponse, type NextRequest } from 'next/server';

/**
 * Guest identity.
 *
 * Prism Studio is usable with no account at all: the first time a browser
 * touches the app this middleware mints an opaque guest id, stores it in a
 * cookie and forwards it to the request as a header. Server code resolves that
 * id to a real (anonymous) user row on first use, so projects, uploads and
 * autosave work exactly as they do for a registered account.
 *
 * Signing in later adopts everything the guest created — see
 * `adoptGuestWork()` in `src/lib/auth.ts`.
 */

export const GUEST_COOKIE = 'prism_guest';
export const GUEST_HEADER = 'x-prism-guest';

const ONE_YEAR = 60 * 60 * 24 * 365;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function middleware(request: NextRequest) {
  const existing = request.cookies.get(GUEST_COOKIE)?.value;
  const guest = existing && UUID_RE.test(existing) ? existing : crypto.randomUUID();

  // Forward the id so the very first request in a new browser already has an
  // identity, before the Set-Cookie round-trip has happened.
  const headers = new Headers(request.headers);
  headers.set(GUEST_HEADER, guest);

  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(GUEST_COOKIE, guest, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ONE_YEAR,
  });
  return response;
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
