import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';
import { createTriageRecord, updateEncounterStatus } from '@/lib/encounters/service';

function errorResponse(error: unknown): NextResponse {
  const status = typeof error === 'object' && error !== null && 'code' in error && error.code === 'FORBIDDEN' ? 403 : 500;
  return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Request could not be completed.' }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { id: encounterId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  const input = body as Record<string, unknown>;

  try {
    const triageId = await withTenantContext(session.tenantId, async (client) => {
      const id = await createTriageRecord({
        tenantId: session.tenantId,
        encounterId,
        temperature: typeof input.temperature === 'number' ? input.temperature : undefined,
        bloodPressure: typeof input.bloodPressure === 'string' ? input.bloodPressure : undefined,
        heartRate: typeof input.heartRate === 'number' ? input.heartRate : undefined,
        respiratoryRate: typeof input.respiratoryRate === 'number' ? input.respiratoryRate : undefined,
        oxygenSaturation: typeof input.oxygenSaturation === 'number' ? input.oxygenSaturation : undefined,
        notes: typeof input.notes === 'string' ? input.notes : undefined,
        createdBy: session.userId,
      }, client);

      // Update encounter status to triaged
      await updateEncounterStatus(session.tenantId, encounterId, 'triaged', client);

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'triage.created',
        entityType: 'triage_record',
        entityId: id,
        oldState: null,
        newState: input,
      });

      return id;
    });

    return NextResponse.json({ id: triageId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
