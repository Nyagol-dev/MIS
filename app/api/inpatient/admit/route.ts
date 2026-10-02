import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';
import { admitPatient } from '@/lib/inpatient/service';

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
      !input.encounterId || typeof input.encounterId !== 'string') {
    return NextResponse.json({ error: 'Required fields missing or invalid.' }, { status: 400 });
  }

  try {
    const admissionId = await withTenantContext(session.tenantId, async (client) => {
      const id = await admitPatient({
        tenantId: session.tenantId,
        patientId: input.patientId as string,
        encounterId: input.encounterId as string,
        admittedBy: session.userId,
      }, client);

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'admission.created',
        entityType: 'admission',
        entityId: id,
        oldState: null,
        newState: { 
          patientId: input.patientId, 
          encounterId: input.encounterId 
        },
      });

      return id;
    });

    return NextResponse.json({ id: admissionId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
