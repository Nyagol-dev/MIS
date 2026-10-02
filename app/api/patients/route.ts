import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';
import { createPatient, findPotentialDuplicates } from '@/lib/patients/service';

function errorResponse(error: unknown): NextResponse {
  const status = typeof error === 'object' && error !== null && 'code' in error && error.code === 'FORBIDDEN' ? 403 : 500;
  return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Request could not be completed.' }, { status });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const firstName = url.searchParams.get('firstName');
  const lastName = url.searchParams.get('lastName');
  const dob = url.searchParams.get('dob');
  const phone = url.searchParams.get('phone');

  if (!firstName || !lastName || !dob) {
    return NextResponse.json({ error: 'Missing search parameters (firstName, lastName, dob required for dedupe check).' }, { status: 400 });
  }

  try {
    const items = await findPotentialDuplicates(session.tenantId, firstName, lastName, dob, phone || undefined);
    
    // Audit the read operation
    await withTenantContext(session.tenantId, async (client) => {
      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'patient.search',
        entityType: 'patient',
        entityId: null,
        oldState: null,
        newState: { query: { firstName, lastName, dob, phone } },
      });
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

  // Basic validation
  if (!input.firstName || typeof input.firstName !== 'string' ||
      !input.lastName || typeof input.lastName !== 'string' ||
      !input.dob || typeof input.dob !== 'string' ||
      !input.gender || typeof input.gender !== 'string') {
    return NextResponse.json({ error: 'Required fields missing or invalid.' }, { status: 400 });
  }

  try {
    const patientId = await withTenantContext(session.tenantId, async (client) => {
      // Create patient inside tenant transaction
      const id = await createPatient({
        tenantId: session.tenantId,
        firstName: input.firstName as string,
        lastName: input.lastName as string,
        dob: input.dob as string,
        gender: input.gender as string,
        createdBy: session.userId,
        phone: typeof input.phone === 'string' ? input.phone : undefined,
        address: typeof input.address === 'string' ? input.address : undefined,
        nextOfKinName: typeof input.nextOfKinName === 'string' ? input.nextOfKinName : undefined,
        nextOfKinPhone: typeof input.nextOfKinPhone === 'string' ? input.nextOfKinPhone : undefined,
        identifiers: Array.isArray(input.identifiers) ? input.identifiers : [],
      }, client);

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'patient.created',
        entityType: 'patient',
        entityId: id,
        oldState: null,
        newState: { 
          firstName: input.firstName, 
          lastName: input.lastName, 
          dob: input.dob, 
          gender: input.gender,
          phone: input.phone,
          identifiers: input.identifiers 
        },
      });

      return id;
    });

    return NextResponse.json({ id: patientId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
