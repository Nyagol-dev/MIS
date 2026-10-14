/**
 * POST /api/him/roi
 *
 * Log a new Release of Information (ROI) event.
 * Requires him:manage permission.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { writeAuditLog } from '@/lib/db/audit';

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { patientId, requestedBy, purpose, details } = body;

    if (!patientId || !requestedBy || !purpose) {
      return NextResponse.json(
        { error: 'Missing patientId, requestedBy, or purpose' },
        { status: 400 }
      );
    }

    const logId = await withTenantContext(session.tenantId, async (client) => {
      const authz = await loadUserAuthz(client, session);
      authorize(authz, 'him:manage');

      const result = await client.query(
        `INSERT INTO release_of_information_log (tenant_id, patient_id, requested_by, purpose, released_by, details)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [session.tenantId, patientId, requestedBy, purpose, session.userId, details || null]
      );

      const id = result.rows[0].id;

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'roi.logged',
        entityType: 'release_of_information_log',
        entityId: id,
        oldState: null,
        newState: { patientId, requestedBy, purpose },
      });

      return id;
    });

    return NextResponse.json({ success: true, logId });
  } catch (err: any) {
    if (err?.status === 403 || err?.message?.includes('Forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Error logging release of information:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
