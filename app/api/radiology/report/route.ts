/**
 * POST /api/radiology/report
 *
 * Submit an imaging report for an imaging order.
 * Requires imaging_report:create permission.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { createImagingReport } from '@/lib/radiology/service';

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { orderId, reportText, dicomStudyUid } = body;

    if (!orderId || !reportText) {
      return NextResponse.json(
        { error: 'Missing orderId or reportText' },
        { status: 400 }
      );
    }

    const reportId = await withTenantContext(session.tenantId, async (client) => {
      const authz = await loadUserAuthz(client, session);
      authorize(authz, 'imaging_report:create');

      return createImagingReport(
        session.tenantId,
        orderId,
        reportText,
        session.userId,
        dicomStudyUid,
        client
      );
    });

    return NextResponse.json({ success: true, reportId });
  } catch (error: any) {
    if (error?.status === 403 || error?.message?.includes('Forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Error creating imaging report:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
