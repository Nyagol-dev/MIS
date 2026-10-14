/**
 * POST /api/him/amendments
 *
 * Approve or reject a chart amendment request.
 * Requires amendment:approve or him:manage permission.
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
    const { amendmentId, status, reviewNotes } = body;

    if (!amendmentId || !status || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json(
        { error: 'Missing amendmentId or invalid status' },
        { status: 400 }
      );
    }

    await withTenantContext(session.tenantId, async (client) => {
      const authz = await loadUserAuthz(client, session);
      authorize(authz, 'amendment:approve');

      await client.query(
        `UPDATE chart_amendment_requests
         SET status = $1, reviewed_by = $2, reviewed_at = now()
         WHERE tenant_id = $3 AND id = $4`,
        [status, session.userId, session.tenantId, amendmentId]
      );

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: `amendment.${status}`,
        entityType: 'chart_amendment_request',
        entityId: amendmentId,
        oldState: null,
        newState: { status, reviewNotes, reviewedBy: session.userId },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.status === 403 || err?.message?.includes('Forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Error processing amendment:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
