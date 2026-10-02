import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { requireTenantAdmin } from '@/lib/auth/requireTenantAdmin';
import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(['clinical', 'clinical_support', 'administrative']);

function errorResponse(error: unknown): NextResponse {
  const status = typeof error === 'object' && error !== null && 'code' in error && error.code === 'FORBIDDEN' ? 403 : 500;
  return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Request could not be completed.' }, { status });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const items = await withTenantContext(session.tenantId, async (client) => {
      const denial = await requireTenantAdmin(client, session);
      if (denial) throw denial;
      const result = await client.query(
        `SELECT d.id, d.parent_id, d.name, d.department_type, d.head_user_id,
                d.deputy_head_user_id, d.location, d.is_active,
                d.created_at, d.updated_at,
                h.display_name AS head_name, dh.display_name AS deputy_head_name
           FROM departments d
           LEFT JOIN users h ON h.tenant_id = d.tenant_id AND h.id = d.head_user_id
           LEFT JOIN users dh ON dh.tenant_id = d.tenant_id AND dh.id = d.deputy_head_user_id
          WHERE d.tenant_id = $1
          ORDER BY d.name`,
        [session.tenantId],
      );
      return result.rows;
    });
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  const input = body as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const departmentType = input.departmentType;
  const parentId = input.parentId ?? null;
  const headUserId = input.headUserId ?? null;
  const deputyHeadUserId = input.deputyHeadUserId ?? null;
  const location = typeof input.location === 'string' ? input.location.trim() || null : null;
  if (!name || name.length > 120 || typeof departmentType !== 'string' || !TYPES.has(departmentType) ||
      (parentId !== null && (typeof parentId !== 'string' || !UUID.test(parentId))) ||
      (headUserId !== null && (typeof headUserId !== 'string' || !UUID.test(headUserId))) ||
      (deputyHeadUserId !== null && (typeof deputyHeadUserId !== 'string' || !UUID.test(deputyHeadUserId))) ||
      (location !== null && location.length > 160)) {
    return NextResponse.json({ error: 'Department fields are invalid.' }, { status: 400 });
  }
  try {
    const row = await withTenantContext(session.tenantId, async (client) => {
      const denial = await requireTenantAdmin(client, session);
      if (denial) throw denial;
      const result = await client.query(
        `INSERT INTO departments
           (tenant_id, name, department_type, parent_id, head_user_id, deputy_head_user_id, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, parent_id, name, department_type, head_user_id,
                   deputy_head_user_id, location, is_active, created_at`,
        [session.tenantId, name, departmentType, parentId, headUserId, deputyHeadUserId, location],
      );
      const department = result.rows[0];
      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'department.created',
        entityType: 'department',
        entityId: department.id,
        oldState: null,
        newState: { name, departmentType, parentId, headUserId, deputyHeadUserId },
      });
      return department;
    });
    return NextResponse.json({ item: row }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
