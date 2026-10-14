/**
 * POST /api/pharmacy/dispense
 *
 * Record a prescription dispense event.
 * Requires prescription:dispense permission.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { dispensePrescription } from '@/lib/pharmacy/service';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { orderId, patientId, notes } = body as { orderId?: string; patientId?: string; notes?: string };
  if (!orderId || !patientId) {
    return NextResponse.json({ error: 'orderId and patientId are required.' }, { status: 400 });
  }

  try {
    const dispenseId = await withTenantContext(session.tenantId, async (client) => {
      const authz = await loadUserAuthz(client, session);
      authorize(authz, 'prescription:dispense');
      return dispensePrescription(session.tenantId, orderId, patientId, session.userId, notes, client);
    });

    return NextResponse.json({ id: dispenseId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: 'Could not record dispense.' }, { status: 500 });
  }
}
