/**
 * POST /api/billing/payment
 *
 * Record a hospital patient payment (Cash, M-Pesa STK, Bank card).
 * Requires payment:create permission.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { recordPayment } from '@/lib/billing/service';
import { writeAuditLog } from '@/lib/db/audit';

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { invoiceId, patientId, amountMinorUnits, provider, referenceNumber } = body;

    if (!invoiceId || !patientId || !amountMinorUnits) {
      return NextResponse.json(
        { error: 'Missing invoiceId, patientId, or amountMinorUnits' },
        { status: 400 }
      );
    }

    const paymentId = await withTenantContext(session.tenantId, async (client) => {
      const authz = await loadUserAuthz(client, session);
      authorize(authz, 'payment:create');

      const pId = await recordPayment(
        session.tenantId,
        invoiceId,
        patientId,
        amountMinorUnits,
        provider || 'cash',
        referenceNumber || `RCP-${Date.now()}`,
        client
      );

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'payment.received',
        entityType: 'payment',
        entityId: pId,
        oldState: null,
        newState: { invoiceId, patientId, amountMinorUnits, provider },
      });

      return pId;
    });

    return NextResponse.json({ success: true, paymentId });
  } catch (err: any) {
    if (err?.status === 403 || err?.message?.includes('Forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Error recording payment:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
