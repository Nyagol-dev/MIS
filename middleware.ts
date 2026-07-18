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
 * using `jose` which is explicitly Edge-compatible. `verifyAnySession` is
 * a thin jose wrapper — no DB access, no pool, no Node-only APIs.
 *
 * All DB-touching operations (permission checks, user data lookups, tenant
 * resolution) happen in Route Handlers, Server Actions, and Server Components
 * (Node runtime), using the session payload that this middleware has already
 * verified.
 *
 * MIDDLEWARE RESPONSIBILITIES
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Read the `mis_session` httpOnly cookie from the incoming request.
 * 2. Verify the JWT signature and expiry using verifyAnySession (jose under the
 *    hood). verifyAnySession never throws — it returns null on any failure.
 * 3. Cross-kind routing:
 *    a. Tenant session on a /platform/ route → redirect to /dashboard.
 *    b. Platform-admin session on a non-/platform/ route → redirect to
 *       /platform/dashboard.
 * 4. If invalid / missing: redirect to /login or /platform/login (for
 *    /platform/ paths), preserving ?next= for post-login return.
 * 5. If valid and no cross-kind mismatch: pass through unchanged.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  verifyAnySession,
  COOKIE_NAME,
  type AnySessionPayload,
} from "@/lib/auth/session";

// ─── Route configuration ──────────────────────────────────────────────────────

/**
 * Routes that are accessible without authentication.
 * Prefix-match: '/login' matches '/login', '/login?next=...', etc.
 * Add new public routes here rather than scattering auth checks.
 */
const PUBLIC_ROUTE_PREFIXES: readonly string[] = [
  "/login",
  "/signup",
  "/api/auth",      // login/logout API routes
  "/platform/login",
  "/api/platform/login",
  "/api/webhooks/", // webhook callbacks for payment providers
  "/_next",         // Next.js internals (also excluded by matcher below)
];

/**
 * Exact public paths (not prefix-matched) — listed separately so that
 * a prefix like "/" cannot accidentally bypass auth on all routes.
 */
const PUBLIC_EXACT_PATHS: readonly string[] = [
  "/", // Marketing homepage — publicly accessible without a session
];

/**
 * Returns true if the requested pathname should bypass auth gating.
 */
function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.includes(pathname)) return true;
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Returns true if the pathname belongs to the platform-admin area.
 * Covers both page routes (/platform/...) and API routes (/api/platform/...).
 * Public platform routes (e.g. /platform/login, /api/platform/login) are
 * already handled by isPublicRoute before this is ever called.
 */
function isPlatformRoute(pathname: string): boolean {
  return pathname.startsWith("/platform/") || pathname.startsWith("/api/platform/");
}

/**
 * Returns true if the pathname is an API route (starts with /api/).
 * API routes get JSON error responses instead of redirects.
 */
function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

// ─── Middleware handler ───────────────────────────────────────────────────────

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Skip auth check for public routes.
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Extract the raw JWT value from the httpOnly cookie.
  const token: string | undefined = request.cookies.get(COOKIE_NAME)?.value;

  // Attempt to verify the JWT. verifyAnySession returns null — never throws —
  // on missing, expired, or tampered tokens.
  const session: AnySessionPayload | null = token
    ? await verifyAnySession(token)
    : null;

  if (!session) {
    // Unauthenticated: API routes return JSON; page routes redirect to login.
    if (isApiRoute(pathname)) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED" } },
        { status: 401 },
      );
    }
    const loginPath: string = isPlatformRoute(pathname)
      ? "/platform/login"
      : "/login";
    const loginUrl = new URL(loginPath, request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Cross-kind routing ────────────────────────────────────────────────────
  //
  // A valid session of the wrong kind for the requested area should be bounced
  // to the correct home route rather than being denied with a login redirect.
  // API routes return 403 JSON; page routes redirect to the caller's home area.
  // This prevents a tenant user from accidentally landing on a 403 when they
  // navigate to /platform/* (they just get sent to their own dashboard), and
  // prevents a platform-admin cookie from granting access to tenant UI pages.

  if (session.sessionKind === "tenant" && isPlatformRoute(pathname)) {
    // Tenant session hitting a platform-scoped route.
    if (isApiRoute(pathname)) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN" } },
        { status: 403 },
      );
    }
    // Page route: redirect to tenant dashboard; do NOT forward ?next=.
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (session.sessionKind === "platform_admin" && !isPlatformRoute(pathname)) {
    // Platform-admin session hitting a tenant-scoped route.
    if (isApiRoute(pathname)) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN" } },
        { status: 403 },
      );
    }
    // Page route: redirect to platform dashboard.
    return NextResponse.redirect(new URL("/platform/dashboard", request.url));
  }

  // Session is valid and the kind matches the requested area — pass through.
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
