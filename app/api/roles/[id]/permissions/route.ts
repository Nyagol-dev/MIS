import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { requireTenantAdmin } from '@/lib/auth/requireTenantAdmin';
import {
  assignGlobalPermission,
  assignPermissionOverride,
  revokeGlobalPermission,
  revokePermissionOverride,
} from '@/lib/roles/permissions-assignment';

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: roleId } = await params;
    const body = await request.json();
    const { type, id: targetId } = body;

    if (!type || !targetId || (type !== 'global' && type !== 'override')) {
      return NextResponse.json({ error: 'Invalid body, expected type ("global" | "override") and id' }, { status: 400 });
    }

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      let result;
      if (type === 'global') {
        result = await assignGlobalPermission(client, session.tenantId, roleId, targetId, session.userId);
      } else {
        result = await assignPermissionOverride(client, session.tenantId, roleId, targetId, session.userId);
      }

      if (result && 'code' in result) {
        return handleError(result);
      }
      
      return NextResponse.json({ success: true }, { status: 201 });
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

    const { id: roleId } = await params;
    const body = await request.json();
    const { type, id: targetId } = body;

    if (!type || !targetId || (type !== 'global' && type !== 'override')) {
      return NextResponse.json({ error: 'Invalid body, expected type ("global" | "override") and id' }, { status: 400 });
    }

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      if (type === 'global') {
        await revokeGlobalPermission(client, session.tenantId, roleId, targetId, session.userId);
      } else {
        await revokePermissionOverride(client, session.tenantId, roleId, targetId, session.userId);
      }

      return new NextResponse(null, { status: 204 });
    });
  } catch (error) {
    return handleError(error);
  }
}
