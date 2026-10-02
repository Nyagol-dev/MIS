import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { requireTenantAdmin } from '@/lib/auth/requireTenantAdmin';
import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(['clinical', 'clinical_support', 'administrative']);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid department ID.' }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  const input = body as Record<string, unknown>;
  const name = input.name === undefined ? undefined : typeof input.name === 'string' ? input.name.trim() : null;
  const type = input.departmentType;
  const parentId = input.parentId;
  const headId = input.headUserId;
  const deputyId = input.deputyHeadUserId;
  const location = input.location;
  const active = input.isActive;
  if ((name !== undefined && (name === null || !name || name.length > 120)) ||
      (type !== undefined && (typeof type !== 'string' || !TYPES.has(type))) ||
      (parentId !== undefined && parentId !== null && (typeof parentId !== 'string' || !UUID.test(parentId))) ||
      (headId !== undefined && headId !== null && (typeof headId !== 'string' || !UUID.test(headId))) ||
      (deputyId !== undefined && deputyId !== null && (typeof deputyId !== 'string' || !UUID.test(deputyId))) ||
      (location !== undefined && location !== null && (typeof location !== 'string' || location.trim().length > 160)) ||
      (active !== undefined && typeof active !== 'boolean')) {
    return NextResponse.json({ error: 'Department fields are invalid.' }, { status: 400 });
  }
  try {
    const item = await withTenantContext(session.tenantId, async (client) => {
      const denial = await requireTenantAdmin(client, session);
      if (denial) throw denial;
      const before = await client.query('SELECT id, name, department_type, parent_id, head_user_id, deputy_head_user_id, location, is_active FROM departments WHERE tenant_id = $1 AND id = $2', [session.tenantId, id]);
      if (!before.rows[0]) return null;
      const result = await client.query(
        `UPDATE departments
            SET name = CASE WHEN $3::boolean THEN $4::text ELSE name END,
                department_type = CASE WHEN $5::boolean THEN $6::text ELSE department_type END,
                parent_id = CASE WHEN $7::boolean THEN $8::uuid ELSE parent_id END,
                head_user_id = CASE WHEN $9::boolean THEN $10::uuid ELSE head_user_id END,
                deputy_head_user_id = CASE WHEN $11::boolean THEN $12::uuid ELSE deputy_head_user_id END,
                location = CASE WHEN $13::boolean THEN $14::text ELSE location END,
                is_active = CASE WHEN $15::boolean THEN $16::boolean ELSE is_active END,
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING id, parent_id, name, department_type, head_user_id, deputy_head_user_id,
                    location, is_active, created_at, updated_at`,
        [session.tenantId, id,
          name !== undefined, name ?? null,
          type !== undefined, type ?? null,
          parentId !== undefined, parentId ?? null,
          headId !== undefined, headId ?? null,
          deputyId !== undefined, deputyId ?? null,
          location !== undefined, typeof location === 'string' ? location.trim() || null : location ?? null,
          active !== undefined, active ?? null],
      );
      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: result.rows[0].is_active ? 'department.updated' : 'department.deactivated',
        entityType: 'department',
        entityId: id,
        oldState: before.rows[0],
        newState: result.rows[0],
      });
      return result.rows[0];
    });
    if (!item) return NextResponse.json({ error: 'Department not found.' }, { status: 404 });
    return NextResponse.json({ item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'code' in error && error.code === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Request could not be completed.' }, { status });
  }
}
