import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';
import { createEncounter } from '@/lib/encounters/service';

function errorResponse(error: unknown): NextResponse {
  const status = typeof error === 'object' && error !== null && 'code' in error && error.code === 'FORBIDDEN' ? 403 : 500;
  return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Request could not be completed.' }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  const input = body as Record<string, unknown>;

  if (!input.patientId || typeof input.patientId !== 'string' ||
      !input.departmentId || typeof input.departmentId !== 'string') {
    return NextResponse.json({ error: 'patientId and departmentId are required.' }, { status: 400 });
  }

  try {
    const encounterId = await withTenantContext(session.tenantId, async (client) => {
      const id = await createEncounter({
        tenantId: session.tenantId,
        patientId: input.patientId as string,
        departmentId: input.departmentId as string,
        encounterType: typeof input.encounterType === 'string' ? input.encounterType : undefined,
        status: typeof input.status === 'string' ? input.status : undefined,
        createdBy: session.userId,
      }, client);

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'encounter.created',
        entityType: 'encounter',
        entityId: id,
        oldState: null,
        newState: { 
          patientId: input.patientId, 
          departmentId: input.departmentId, 
          encounterType: input.encounterType,
          status: input.status
        },
      });

      return id;
    });

    return NextResponse.json({ id: encounterId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
