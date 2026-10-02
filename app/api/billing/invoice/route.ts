import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getEffectivePermissions, requirePermission } from '@/lib/auth/permissions';
import { createInvoice } from '@/lib/billing/service';
import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const input = await request.json();
    
    const perms = await getEffectivePermissions(session.tenantId, session.userId);
    requirePermission(perms, 'invoice:create');

    const invoiceId = await withTenantContext(session.tenantId, async (client) => {
      const id = await createInvoice({
        tenantId: session.tenantId,
        patientId: input.patientId,
        encounterId: input.encounterId,
        createdBy: session.userId,
      }, client);

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: id,
        oldState: null,
        newState: { patientId: input.patientId, encounterId: input.encounterId },
      });

      return id;
    });

    return NextResponse.json({ id: invoiceId });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
