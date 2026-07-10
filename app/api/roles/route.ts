import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { requireTenantAdmin } from '@/lib/auth/requireTenantAdmin';
import { listRoles, createRole } from '@/lib/roles/roles';

function handleError(error: any) {
  const code = error.code || error.name || error.status;
  const status =
    code === 'NOT_FOUND' || code === 404
      ? 404
      : code === 'FORBIDDEN' || code === 'FORBIDDEN_SYSTEM_ROLE' || code === 'TENANT_MISMATCH' || code === 'ForbiddenError' || code === 403
      ? 403
      : code === 'ROLE_IN_USE' || code === 409
      ? 409
      : code === 'VALIDATION_ERROR' || code === 'INVALID_ACTION' || code === 400
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
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

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

      const roles = await listRoles(client, session.tenantId, { limit, offset });
      if ('code' in roles) return handleError(roles);

      return NextResponse.json(roles, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const role = await createRole(client, session.tenantId, body);
      return NextResponse.json(role, { status: 201 });
    });
  } catch (error) {
    return handleError(error);
  }
}
