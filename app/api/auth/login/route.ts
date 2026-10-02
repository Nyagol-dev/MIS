import { NextRequest, NextResponse } from "next/server";
import { appPool, _adminPoolInternal } from "@/lib/db/pool";
import { clearLoginRateLimit, checkLoginRateLimit } from "@/lib/auth/loginRateLimit";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { withTenantContext } from "@/lib/db/withTenant";

export const runtime = "nodejs";

const INVALID_CREDENTIALS = { error: "Invalid organization, email, or password." };
const DUMMY_PASSWORD = "invalid-login-placeholder-not-a-user-password";

function jsonError(message: string, status: number, retryAfter?: number) {
  const response = NextResponse.json({ error: message }, { status });
  if (retryAfter) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonError("Content-Type must be application/json.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8_192) return jsonError("Request is too large.", 413);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400);
  }

  const input = body as { slug?: unknown; email?: unknown; password?: unknown };
  const configuredSlug = process.env.DEFAULT_TENANT_SLUG?.trim().toLowerCase();
  const requestedSlug = configuredSlug || input?.slug;
  if (
    typeof requestedSlug !== "string" ||
    typeof input.email !== "string" ||
    typeof input.password !== "string" ||
    requestedSlug.length > 80 ||
    input.email.length > 254 ||
    input.password.length === 0 ||
    input.password.length > 1_024
  ) {
    return jsonError("Organization, email, and password are required.", 400);
  }

  const slug = requestedSlug.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  let scopeHash: string | null = null;
  try {
    const rateLimit = await checkLoginRateLimit(
      appPool,
      request.headers.get("x-forwarded-for"),
      request.headers.get("x-real-ip"),
      `${slug}:${email}`
    );
    scopeHash = rateLimit.scopeHash;
    if (!rateLimit.allowed) {
      return jsonError("Too many sign-in attempts. Try again later.", 429, rateLimit.retryAfterSeconds);
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError(INVALID_CREDENTIALS.error, 401);
    }

    // The organization slug is a public routing identifier. Resolve only its
    // active ID here; fetch user credentials below under tenant RLS context.
    const { rows: organizations } = await _adminPoolInternal.query<{ id: string }>(
      `SELECT id FROM organizations WHERE slug = $1 AND is_active = TRUE LIMIT 1`,
      [slug]
    );

    if (organizations.length !== 1) {
      await hashPassword(DUMMY_PASSWORD);
      return jsonError(INVALID_CREDENTIALS.error, 401);
    }

    const tenantId = organizations[0].id;
    const user = await withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query<{
        id: string;
        password_hash: string | null;
        is_active: boolean;
      }>(
        `SELECT id, password_hash, is_active
           FROM users
          WHERE tenant_id = $1 AND lower(email) = $2
          LIMIT 2`,
        [tenantId, email]
      );
      return rows.length === 1 ? rows[0] : null;
    });

    if (!user || !user.is_active || !user.password_hash) {
      await hashPassword(DUMMY_PASSWORD);
      return jsonError(INVALID_CREDENTIALS.error, 401);
    }

    let validPassword = false;
    try {
      validPassword = await verifyPassword(user.password_hash, password);
    } catch {
      // Keep malformed hashes and passwordless rows indistinguishable to callers.
    }
    if (!validPassword) return jsonError(INVALID_CREDENTIALS.error, 401);

    await clearLoginRateLimit(appPool, scopeHash);
    const token = await createSession({ userId: user.id, tenantId, issuedAt: Math.floor(Date.now() / 1000) });
    const response = NextResponse.json({ success: true }, { status: 200 });
    setSessionCookie(response, token);
    return response;
  } catch {
    return jsonError("Sign-in is temporarily unavailable.", 503);
  }
}
