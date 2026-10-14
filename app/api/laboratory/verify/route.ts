/**
 * POST /api/laboratory/verify
 *
 * Verify and release a lab result (technologist → verification step).
 * Requires lab_result:verify permission.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { verifyLabResult } from '@/lib/lab/service';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { sampleId } = body as { sampleId?: string };
  if (!sampleId) return NextResponse.json({ error: 'sampleId is required.' }, { status: 400 });

  try {
    await withTenantContext(session.tenantId, async (client) => {
      const authz = await loadUserAuthz(client, session);
      authorize(authz, 'lab_result:verify');

      await verifyLabResult(session.tenantId, sampleId, session.userId, client);
    });

    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: 'Could not verify result.' }, { status: 500 });
  }
}
