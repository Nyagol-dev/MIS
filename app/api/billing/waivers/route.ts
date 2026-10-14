/**
 * POST /api/billing/waivers
 *
 * Request or approve a bill waiver / discount.
 * Requires waiver:create or waiver:approve permission.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { applyWaiver } from '@/lib/billing/service';
import { writeAuditLog } from '@/lib/db/audit';

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { invoiceId, amountMinorUnits, reason } = body;

    if (!invoiceId || !amountMinorUnits || !reason) {
      return NextResponse.json(
        { error: 'Missing invoiceId, amountMinorUnits, or reason' },
        { status: 400 }
      );
    }

    await withTenantContext(session.tenantId, async (client) => {
      const authz = await loadUserAuthz(client, session);
      // Require approval authority for waivers
      authorize(authz, 'waiver:create');

      await applyWaiver(
        session.tenantId,
        invoiceId,
        amountMinorUnits,
        reason,
        session.userId,
        client
      );

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'waiver.applied',
        entityType: 'invoice',
        entityId: invoiceId,
        oldState: null,
        newState: { amountMinorUnits, reason, approvedBy: session.userId },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.status === 403 || err?.message?.includes('Forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Error applying waiver:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
