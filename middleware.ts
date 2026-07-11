/**
 * middleware.ts
 *
 * Edge-compatible route gating for the multi-tenant MIS.
 *
 * RUNTIME SPLIT
 * ─────────────────────────────────────────────────────────────────────────────
 * This file runs on the Edge Runtime. It MUST NOT import:
 * - `pg` or any pool from lib/db/ (Node.js-only)
 * - `argon2` (native Node addon)
 * - Any other Node.js-only module
 *
 * The ONLY auth operation performed here is JWT signature verification,
 * using `jose` which is explicitly Edge-compatible.
 *
 * All DB-touching operations (permission checks, user data lookups, tenant
 * resolution) happen in Route Handlers, Server Actions, and Server Components
 * (Node runtime), using the session payload that this middleware has already
 * verified.
 *
 * MIDDLEWARE RESPONSIBILITIES
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Read the `mis_session` httpOnly cookie from the incoming request.
 * 2. Verify the JWT signature and expiry using jose.
 * 3. If invalid / missing: redirect to /login (preserving ?next= for return).
 * 4. If valid: pass through unchanged — do NOT forward session data in headers
 *    (the cookie is already readable by Server Components via `cookies()`).
 */

import { type NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";

// ─── Route configuration ──────────────────────────────────────────────────────

/**
 * Routes that are accessible without authentication.
 * Prefix-match: '/login' matches '/login', '/login?next=...', etc.
 * Add new public routes here rather than scattering auth checks.
 */
const PUBLIC_ROUTE_PREFIXES: readonly string[] = [
  "/login",
  "/signup",
  "/api/auth",     // login/logout API routes
  "/platform/login",
  "/api/platform/login",
  "/api/webhooks/",// webhook callbacks for payment providers
  "/_next",        // Next.js internals (also excluded by matcher below)
];

/**
 * Returns true if the requested pathname should bypass auth gating.
 */
function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// ─── Middleware handler ───────────────────────────────────────────────────────

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Skip auth check for public routes.
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Attempt to verify the session JWT from the httpOnly cookie.
  const session = await getSessionFromRequest(request);

  if (!session) {
    // Unauthenticated: redirect to /login with ?next= so the login handler
    // can redirect back to the originally-requested route after sign-in.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Session is valid — pass the request through unchanged.
  // The session cookie is readable by Server Components and Route Handlers
  // via Next.js's `cookies()` helper; no need to forward it in headers.
  return NextResponse.next();
}

// ─── Route matcher ────────────────────────────────────────────────────────────

/**
 * Restricts which routes this middleware runs on.
 * Excludes Next.js static assets and image optimisation routes to avoid
 * unnecessary JWT verifications on every asset request.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static  (static files)
     * - _next/image   (image optimisation)
     * - favicon.ico   (browser favicon)
     * - Files with extensions (fonts, images, etc.)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|eot|css|js|map)$).*)",
  ],
};
