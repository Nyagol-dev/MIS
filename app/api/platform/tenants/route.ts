import { NextRequest, NextResponse } from "next/server";
import { verifyAnySession, COOKIE_NAME } from "@/lib/auth/session";
import { requirePlatformAdminSession } from "@/lib/auth/platformAdmin";
import { listTenants, createTenant } from "@/lib/platform/tenants";

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

    const limitParam = request.nextUrl.searchParams.get('limit');
    const offsetParam = request.nextUrl.searchParams.get('offset');
    let limit: number | undefined;
    let offset: number | undefined;

    if (limitParam !== null) {
      limit = parseInt(limitParam, 10);
      if (Number.isNaN(limit)) {
        return NextResponse.json({ error: 'limit must be a valid integer' }, { status: 400 });
      }
    }
    if (offsetParam !== null) {
      offset = parseInt(offsetParam, 10);
      if (Number.isNaN(offset)) {
        return NextResponse.json({ error: 'offset must be a valid integer' }, { status: 400 });
      }
    }

    const tenants = await listTenants(session, { limit, offset });
    if ('code' in tenants) return handleError(tenants);

    return NextResponse.json(tenants, { status: 200 });
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    const input = body as {
      slug?: unknown;
      name?: unknown;
      orgTypeId?: unknown;
      initialAdmin?: { email?: unknown; displayName?: unknown };
    };
    const slug = typeof input?.slug === 'string' ? input.slug.trim().toLowerCase() : '';
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const orgTypeId = typeof input?.orgTypeId === 'string' ? input.orgTypeId.trim().toLowerCase() : '';
    const adminEmail = typeof input?.initialAdmin?.email === 'string' ? input.initialAdmin.email.trim().toLowerCase() : '';
    const adminName = typeof input?.initialAdmin?.displayName === 'string' ? input.initialAdmin.displayName.trim() : '';
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 ||
      !name || name.length > 160 ||
      !/^[a-z0-9_]+$/.test(orgTypeId) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminEmail.length > 254 ||
      !adminName || adminName.length > 120
    ) {
      return NextResponse.json({ error: 'Enter a valid organisation, type, and initial administrator.' }, { status: 400 });
    }

    const result = await createTenant(session, {
      slug,
      name,
      orgTypeId,
      initialAdmin: { email: adminEmail, displayName: adminName },
    });
    
    if ('code' in result && result.code === 'SLUG_COLLISION') {
      return NextResponse.json({ error: result.message }, { status: 409 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
