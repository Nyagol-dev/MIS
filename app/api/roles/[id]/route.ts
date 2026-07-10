import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { requireTenantAdmin } from '@/lib/auth/requireTenantAdmin';
import { getRole, updateRole, deleteRole } from '@/lib/roles/roles';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const result = await getRole(client, session.tenantId, id);
      if (result && 'code' in result) {
        return handleError(result);
      }
      return NextResponse.json(result, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const result = await updateRole(client, session.tenantId, id, body);
      if (result && 'code' in result) {
        return handleError(result);
      }
      return NextResponse.json(result, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const result = await deleteRole(client, session.tenantId, id);
      if (result && 'code' in result) {
        return handleError(result);
      }
      return new NextResponse(null, { status: 204 });
    });
  } catch (error) {
    return handleError(error);
  }
}
