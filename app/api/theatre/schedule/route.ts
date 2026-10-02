import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';
import { scheduleTheatreCase } from '@/lib/theatre/service';

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
      !input.encounterId || typeof input.encounterId !== 'string' ||
      !input.procedureCode || typeof input.procedureCode !== 'string' ||
      !input.procedureName || typeof input.procedureName !== 'string' ||
      !input.scheduledAt || typeof input.scheduledAt !== 'string') {
    return NextResponse.json({ error: 'Required fields missing or invalid.' }, { status: 400 });
  }

  try {
    const caseId = await withTenantContext(session.tenantId, async (client) => {
      const id = await scheduleTheatreCase({
        tenantId: session.tenantId,
        patientId: input.patientId as string,
        encounterId: input.encounterId as string,
        procedureCode: input.procedureCode as string,
        procedureName: input.procedureName as string,
        scheduledAt: new Date(input.scheduledAt as string),
        surgeonId: session.userId, // Defaulting to the requester for now
      }, client);

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'theatre_case.created',
        entityType: 'theatre_case',
        entityId: id,
        oldState: null,
        newState: { 
          patientId: input.patientId, 
          procedureCode: input.procedureCode 
        },
      });

      return id;
    });

    return NextResponse.json({ id: caseId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
