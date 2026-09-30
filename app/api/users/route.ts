import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { requireTenantAdmin } from '@/lib/auth/requireTenantAdmin';
import { listUsers, inviteUser } from '@/lib/users/users';
import { createCredentialSetupToken } from '@/lib/auth/credentialSetup';

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

      const isActiveParam = request.nextUrl.searchParams.get('is_active');
      const filters = isActiveParam !== null ? { isActive: isActiveParam === 'true' } : undefined;

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

      const users = await listUsers(client, session.tenantId, filters, { limit, offset });
      if ('code' in users) return handleError(users);

      return NextResponse.json(users, { status: 200 });
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const input = body as { email?: unknown; fullName?: unknown; roleIds?: unknown };
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const fullName = typeof input?.fullName === 'string' ? input.fullName.trim() : '';
    const roleIds = input?.roleIds === undefined ? [] : input.roleIds;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      fullName.length < 1 || fullName.length > 120 ||
      !Array.isArray(roleIds) || roleIds.length > 50 ||
      roleIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
    ) {
      return NextResponse.json({ error: 'Enter a valid name and email, and choose valid roles.' }, { status: 400 });
    }

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const user = await inviteUser(client, session.tenantId, { email, fullName, roleIds }, session.userId);
      const { token, tokenHash } = createCredentialSetupToken();
      await client.query(
        `INSERT INTO user_password_setup_tokens
           (tenant_id, user_id, token_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '24 hours')`,
        [session.tenantId, user.id, tokenHash, session.userId]
      );
      const { password_hash: _passwordHash, ...safeUser } = user;
      return NextResponse.json({ user: safeUser, setupPath: `/accept-invite?token=${token}` }, { status: 201 });
    });
  } catch (error) {
    return handleError(error);
  }
}
