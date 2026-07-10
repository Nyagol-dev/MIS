import { NextRequest, NextResponse } from "next/server";
import { verifyAnySession, COOKIE_NAME } from "@/lib/auth/session";
import { requirePlatformAdminSession } from "@/lib/auth/platformAdmin";
import { listPlatformAdmins, createPlatformAdmin } from "@/lib/platform/platformAdmins";

function handleError(error: any) {
  const status =
    error.code === 'NOT_FOUND' || error.status === 404
      ? 404
      : error.code === 'FORBIDDEN' || error.status === 403
      ? 403
      : error.code === 'VALIDATION_ERROR' || error.status === 400
      ? 400
      : 500;

  const body: Record<string, any> = { error: error.message || 'An unexpected error occurred.' };
  if (error.code === 'VALIDATION_ERROR' && 'invalidKeys' in error) {
    body.details = error.invalidKeys;
  }

  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const cookie = request.cookies.get(COOKIE_NAME);
    if (!cookie?.value) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const session = await verifyAnySession(cookie.value);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    requirePlatformAdminSession(session);

    const admins = await listPlatformAdmins(session);
    return NextResponse.json(admins, { status: 200 });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const cookie = request.cookies.get(COOKIE_NAME);
    if (!cookie?.value) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const session = await verifyAnySession(cookie.value);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    requirePlatformAdminSession(session);

    const body = await request.json();
    const result = await createPlatformAdmin(session, body);
    
    if ('code' in result && result.code === 'EMAIL_COLLISION') {
      return NextResponse.json({ error: result.message }, { status: 409 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
