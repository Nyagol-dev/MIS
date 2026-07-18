import { NextRequest, NextResponse } from "next/server";
import { verifyAnySession, COOKIE_NAME } from "@/lib/auth/session";
import { requirePlatformAdminSession } from "@/lib/auth/platformAdmin";
import { deactivateTenant } from "@/lib/platform/tenants";

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

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
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

    const result = await deactivateTenant(session, (await props.params).id);
    
    if (result && 'code' in result && result.code === 'TENANT_NOT_FOUND') {
      return NextResponse.json({ error: result.message }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return handleError(error);
  }
}
