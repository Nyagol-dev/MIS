import { NextRequest, NextResponse } from "next/server";
import { appPool } from "@/lib/db/pool";
import { createPlatformAdminSession, createSession, setSessionCookie } from "@/lib/auth/session";
import { hashCredentialSetupToken, isValidCredentialSetupToken } from "@/lib/auth/credentialSetup";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8_192) {
    return noStore(NextResponse.json({ error: "Request is too large." }, { status: 413 }));
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return noStore(NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore(NextResponse.json({ error: "Invalid request body." }, { status: 400 }));
  }

  const input = body as { token?: unknown; password?: unknown };
  if (
    !isValidCredentialSetupToken(input?.token) ||
    typeof input.password !== "string" ||
    input.password.length < PASSWORD_MIN_LENGTH ||
    input.password.length > PASSWORD_MAX_LENGTH
  ) {
    return noStore(NextResponse.json(
      { error: `Use a valid setup link and a password between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.` },
      { status: 400 }
    ));
  }

  try {
    const tokenHash = hashCredentialSetupToken(input.token);
    const { rows: validRows } = await appPool.query<{ valid: boolean }>(
      "SELECT is_valid_user_password_setup_token($1) AS valid",
      [tokenHash]
    );
    const { rows: validAdminRows } = await appPool.query<{ valid: boolean }>(
      "SELECT is_valid_platform_admin_password_setup_token($1) AS valid",
      [tokenHash]
    );
    if (!validRows[0]?.valid && !validAdminRows[0]?.valid) {
      return noStore(NextResponse.json({ error: "This setup link is invalid, expired, or already used." }, { status: 400 }));
    }

    const passwordHash = await hashPassword(input.password);
    if (validRows[0]?.valid) {
      const { rows } = await appPool.query<{ tenant_id: string; user_id: string }>(
        "SELECT tenant_id, user_id FROM complete_user_password_setup($1, $2)",
        [tokenHash, passwordHash]
      );
      if (rows.length !== 1) {
        return noStore(NextResponse.json({ error: "This setup link is invalid, expired, or already used." }, { status: 400 }));
      }
      const token = await createSession({
        userId: rows[0].user_id,
        tenantId: rows[0].tenant_id,
        issuedAt: Math.floor(Date.now() / 1000),
      });
      const response = NextResponse.json({ success: true, redirectTo: "/dashboard" });
      setSessionCookie(response, token);
      return noStore(response);
    }

    const { rows } = await appPool.query<{ platform_admin_id: string }>(
      "SELECT platform_admin_id FROM complete_platform_admin_password_setup($1, $2)",
      [tokenHash, passwordHash]
    );
    if (rows.length !== 1) {
      return noStore(NextResponse.json({ error: "This setup link is invalid, expired, or already used." }, { status: 400 }));
    }
    const token = await createPlatformAdminSession(rows[0].platform_admin_id);
    const response = NextResponse.json({ success: true, redirectTo: "/platform/dashboard" });
    setSessionCookie(response, token);
    return noStore(response);
  } catch {
    return noStore(NextResponse.json({ error: "Password setup is temporarily unavailable." }, { status: 503 }));
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
