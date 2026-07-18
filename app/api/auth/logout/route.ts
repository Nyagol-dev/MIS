/**
 * app/api/auth/logout/route.ts
 *
 * Tenant (and platform admin) logout endpoint.
 *
 * CONTRACT
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/auth/logout
 *   - No request body required.
 *   - Clears the mis_session cookie by overwriting it with an empty value
 *     and maxAge=0 (instructs the browser to delete it immediately).
 *   - Returns 200 { ok: true } on success.
 *   - Does NOT require a valid session — clearing an already-invalid or
 *     missing cookie is a no-op and should not return an error.
 *
 * SECURITY NOTE
 * ─────────────────────────────────────────────────────────────────────────────
 * Because sessions are stateless JWTs (no sessions table), "logout" is
 * purely client-side: we instruct the browser to delete the cookie. There
 * is no server-side token revocation. If revocation is needed in future,
 * a deny-list (Redis or DB) should be added here.
 *
 * This route is listed under `/api/auth` which is a PUBLIC_ROUTE_PREFIX in
 * middleware.ts — it is reachable without a valid session (necessary because
 * the cookie may already be expired/invalid when the user clicks "Log out").
 */

import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth/session";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true }, { status: 200 });

  // Clear the session cookie by setting it to empty with maxAge=0.
  // The attributes must match those used in setSessionCookie() so that
  // the browser recognises it as the same cookie and removes it.
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}

/**
 * Reject non-POST methods explicitly.
 * Next.js returns 405 by default for unhandled methods, but being explicit
 * lets us include a proper Allow header.
 */
export function GET(): NextResponse {
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "POST" },
  });
}
