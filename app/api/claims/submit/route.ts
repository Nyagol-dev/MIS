import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getEffectivePermissions, requirePermission } from '@/lib/auth/permissions';
import { submitClaim } from '@/lib/claims/service';
import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const input = await request.json();
    
    const perms = await getEffectivePermissions(session.tenantId, session.userId);
    requirePermission(perms, 'claim:create');

    const claimId = await withTenantContext(session.tenantId, async (client) => {
      const id = await submitClaim(
        session.tenantId,
        input.patientId,
        input.encounterId,
        input.coverageId,
        input.totalMinorUnits,
        input.lines,
        client
      );

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'claim.submitted',
        entityType: 'claim',
        entityId: id,
        oldState: null,
        newState: { patientId: input.patientId, coverageId: input.coverageId, total: input.totalMinorUnits },
      });

      return id;
    });

    return NextResponse.json({ id: claimId });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
