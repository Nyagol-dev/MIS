/**
 * POST /api/laboratory/results
 *
 * Enter lab results for a collected sample.
 * Requires lab_result:create permission.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { enterLabResult } from '@/lib/lab/service';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { sampleId, results } = body as { sampleId?: string; results?: unknown[] };
  if (!sampleId || !Array.isArray(results) || results.length === 0) {
    return NextResponse.json({ error: 'sampleId and results[] are required.' }, { status: 400 });
  }

  try {
    await withTenantContext(session.tenantId, async (client) => {
      const authz = await loadUserAuthz(client, session);
      authorize(authz, 'lab_result:create');

      await enterLabResult(
        session.tenantId,
        sampleId,
        results as Parameters<typeof enterLabResult>[2],
        session.userId,
        client
      );
    });

    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: 'Could not save results.' }, { status: 500 });
  }
}
