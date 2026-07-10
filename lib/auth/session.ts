/**
 * lib/auth/session.ts
 *
 * Stateless JWT session management using `jose` (Edge-runtime compatible).
 *
 * SESSION MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 * Sessions are stored as signed JWTs in an httpOnly, Secure cookie. There is
 * no sessions table in the schema — this is intentional. A user belongs to
 * exactly one tenant (tenant_id is part of the users composite PK), so the
 * JWT payload carries { userId, tenantId } without ambiguity.
 *
 * The middleware (middleware.ts) verifies the JWT on every request using
 * jose's Edge-compatible API. DB-touching operations (permission checks,
 * user data) happen in Route Handlers / Server Actions / Server Components
 * using the already-verified session payload — not in middleware.
 *
 * COOKIE SECURITY
 * ─────────────────────────────────────────────────────────────────────────────
 * - httpOnly: not accessible from JavaScript (XSS protection)
 * - Secure: only sent over HTTPS in production
 * - SameSite=Lax: CSRF protection with standard navigation compatibility
 * - Path=/: available across all routes
 */

import {
  SignJWT,
  jwtVerify,
  type JWTPayload,
} from "jose";
import type { NextRequest, NextResponse } from "next/server";

// ─── Constants ────────────────────────────────────────────────────────────────

const COOKIE_NAME = "mis_session" as const;
const JWT_ALGORITHM = "HS256" as const;

/** Default session lifetime: 7 days in seconds. */
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The canonical session payload stored inside the JWT.
 *
 * userId   — matches users.id (the non-tenant portion of the composite PK)
 * tenantId — matches users.tenant_id / organizations.id
 * issuedAt — Unix epoch seconds (also available as standard JWT `iat` claim)
 */
export interface SessionPayload {
  userId: string;
  tenantId: string;
  issuedAt: number;
  /** Optional discriminator added in Round 6. Absent on legacy tokens — treated as 'tenant'. */
  sessionKind?: "tenant";
}

// ─── Platform-admin session types (Round 6) ───────────────────────────────────

/**
 * JWT payload for platform-admin sessions.
 *
 * These tokens are issued to MIS super-admins and are entirely separate
 * from tenant user sessions. They carry no tenantId.
 */
export interface PlatformAdminSessionPayload {
  sessionKind: "platform_admin";
  platformAdminId: string;
  issuedAt: number;
}

/**
 * Discriminated union of every valid session kind understood by this system.
 *
 * Use this type — and `verifyAnySession` — at route-handler entry points
 * that must accept either tenant users or platform admins.
 */
export type AnySessionPayload =
  | (SessionPayload & { sessionKind: "tenant" })
  | PlatformAdminSessionPayload;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Derives the HMAC secret from SESSION_SECRET. jose requires a Uint8Array.
 * The secret is encoded once and cached in module scope.
 */
function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "[mis:session] SESSION_SECRET must be set to a random string of at least " +
        "32 characters. Generate one with: openssl rand -base64 32"
    );
  }
  return new TextEncoder().encode(secret);
}

function getTTLSeconds(): number {
  const raw = process.env.SESSION_TTL_SECONDS;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TTL_SECONDS;
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────

/**
 * Creates a signed HS256 JWT containing the given session payload.
 *
 * @param payload - The session data to embed in the token.
 * @returns A compact JWT string suitable for storing in a cookie.
 */
export async function createSession(payload: SessionPayload): Promise<string> {
  const secret = getSecret();
  const ttl = getTTLSeconds();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    userId: payload.userId,
    tenantId: payload.tenantId,
    issuedAt: payload.issuedAt ?? now,
  } satisfies Omit<SessionPayload, "issuedAt"> & { issuedAt: number } & JWTPayload)
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(secret);
}

/**
 * Verifies a JWT and extracts the session payload.
 *
 * @param token - The raw JWT string from the cookie.
 * @returns The decoded SessionPayload.
 * @throws {JWTExpired | JWSSignatureVerificationFailed | ...} on invalid tokens.
 *         These error types are exported by `jose` and can be caught by callers.
 */
export async function verifySession(token: string): Promise<SessionPayload> {
  const secret = getSecret();
  const { payload } = await jwtVerify(token, secret, {
    algorithms: [JWT_ALGORITHM],
  });

  // Validate required custom claims are present and correctly typed.
  if (
    typeof payload["userId"] !== "string" ||
    typeof payload["tenantId"] !== "string" ||
    typeof payload["issuedAt"] !== "number"
  ) {
    throw new Error(
      "[mis:session] JWT payload is missing required claims (userId, tenantId, issuedAt)."
    );
  }

  return {
    userId: payload["userId"] as string,
    tenantId: payload["tenantId"] as string,
    issuedAt: payload["issuedAt"] as number,
  };
}

// ─── Platform-admin JWT helpers (Round 6) ────────────────────────────────────

/**
 * Creates a signed HS256 JWT for a platform-admin session.
 *
 * Uses the same SESSION_SECRET and JWT_ALGORITHM as `createSession` so that
 * a single secret covers all token kinds. The `sessionKind` claim is what
 * distinguishes the two at verification time.
 *
 * @param platformAdminId - The platform admin's unique identifier.
 * @returns A compact JWT string suitable for storing in a cookie.
 */
export async function createPlatformAdminSession(
  platformAdminId: string
): Promise<string> {
  const secret = getSecret();
  const ttl = getTTLSeconds();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    sessionKind: "platform_admin" as const,
    platformAdminId,
    issuedAt: now,
  } satisfies Omit<PlatformAdminSessionPayload, "issuedAt"> & { issuedAt: number } & JWTPayload)
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(secret);
}

/**
 * Verifies a JWT and returns the appropriate typed session payload.
 *
 * Discrimination rules (confirmed team decision, Round 6):
 * - `sessionKind === 'platform_admin'` → PlatformAdminSessionPayload
 * - `sessionKind === 'tenant'` OR absent (legacy tokens) → tenant branch of
 *   AnySessionPayload. Absent sessionKind is NOT treated as an error — no
 *   forced re-login for existing tenant sessions.
 * - Invalid / expired / unparseable tokens → returns null (never throws).
 *
 * @param token - The raw JWT string (from a cookie or Authorization header).
 * @returns The typed AnySessionPayload, or null on any failure.
 */
export async function verifyAnySession(
  token: string
): Promise<AnySessionPayload | null> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [JWT_ALGORITHM],
    });

    const kind = payload["sessionKind"];

    if (kind === "platform_admin") {
      // ── Platform-admin branch ──────────────────────────────────────────────
      if (
        typeof payload["platformAdminId"] !== "string" ||
        typeof payload["issuedAt"] !== "number"
      ) {
        return null;
      }
      return {
        sessionKind: "platform_admin",
        platformAdminId: payload["platformAdminId"] as string,
        issuedAt: payload["issuedAt"] as number,
      } satisfies PlatformAdminSessionPayload;
    }

    // ── Tenant branch (sessionKind === 'tenant' OR absent) ─────────────────
    if (
      typeof payload["userId"] !== "string" ||
      typeof payload["tenantId"] !== "string" ||
      typeof payload["issuedAt"] !== "number"
    ) {
      return null;
    }
    return {
      sessionKind: "tenant",
      userId: payload["userId"] as string,
      tenantId: payload["tenantId"] as string,
      issuedAt: payload["issuedAt"] as number,
    } satisfies SessionPayload & { sessionKind: "tenant" };
  } catch {
    // Token is expired, tampered, or otherwise invalid — return null.
    return null;
  }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

/**
 * Writes the session JWT into an httpOnly cookie on the given response.
 *
 * @param response - A NextResponse object (from a Route Handler or middleware).
 * @param token    - The JWT string returned by createSession().
 */
export function setSessionCookie(response: NextResponse, token: string): void {
  const ttl = getTTLSeconds();
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttl,
  });
}

/**
 * Clears the session cookie, effectively logging the user out.
 *
 * @param response - A NextResponse object to write the cleared cookie onto.
 */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0, // Instructs the browser to expire the cookie immediately.
  });
}

/**
 * Reads and verifies the session JWT from an incoming Next.js request.
 *
 * Returns null — rather than throwing — on any failure (missing cookie,
 * expired token, invalid signature). This is the safe default for middleware
 * and other code that needs to branch on auth state without crashing.
 *
 * @param request - The incoming NextRequest (route handler or middleware).
 * @returns The decoded SessionPayload, or null if unauthenticated / invalid.
 */
export async function getSessionFromRequest(
  request: NextRequest
): Promise<SessionPayload | null> {
  const cookie = request.cookies.get(COOKIE_NAME);
  if (!cookie?.value) return null;

  try {
    return await verifySession(cookie.value);
  } catch {
    // Token is expired, tampered, or otherwise invalid — treat as unauthenticated.
    return null;
  }
}

/**
 * The cookie name constant, exported for use in middleware and tests.
 * Use the `getSessionFromRequest` / `setSessionCookie` helpers rather than
 * reading this directly where possible.
 */
export { COOKIE_NAME };
