import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, SsoOnlyUserError } from "@/lib/auth/password";
import { createPlatformAdminSession, setSessionCookie } from "@/lib/auth/session";
import { _adminPoolInternal } from "@/lib/db/pool";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const { rows } = await _adminPoolInternal.query(
      `SELECT id, password_hash, is_active FROM platform_admins WHERE email = $1`,
      [email]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const admin = rows[0];

    if (!admin.is_active) {
      return NextResponse.json({ error: "Account is inactive." }, { status: 403 });
    }

    try {
      const isValid = await verifyPassword(admin.password_hash, password);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
      }
    } catch (err: any) {
      if (err instanceof SsoOnlyUserError) {
        return NextResponse.json({ error: "This account uses SSO. Please sign in with your identity provider." }, { status: 403 });
      }
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const sessionToken = await createPlatformAdminSession(admin.id);
    const response = NextResponse.json({ success: true }, { status: 200 });
    setSessionCookie(response, sessionToken);

    return response;
  } catch (err) {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
