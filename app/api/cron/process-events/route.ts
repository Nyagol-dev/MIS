/**
 * app/api/cron/process-events/route.ts
 *
 * Vercel Cron Job endpoint — fires every minute (see vercel.json).
 *
 * SECURITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Vercel automatically appends `Authorization: Bearer <CRON_SECRET>` to cron
 * invocations.  We validate that header before calling the processor.
 * Return 401 for missing or wrong secrets so external scanners cannot trigger
 * expensive DB work.
 *
 * WHY getSystemAdminPool IS NOT IMPORTED HERE
 * ─────────────────────────────────────────────────────────────────────────────
 * The admin pool is used inside processPendingEvents (lib/events/processor.ts),
 * which is the only symbol this route needs.  Importing getSystemAdminPool
 * directly here would couple this HTTP handler to a privileged pool reference
 * with no additional value — all security is enforced by CRON_SECRET above.
 *
 * IDEMPOTENCY
 * ─────────────────────────────────────────────────────────────────────────────
 * processPendingEvents uses FOR UPDATE SKIP LOCKED, so concurrent or repeated
 * invocations within the same minute are safe — they will each claim a disjoint
 * set of rows (or find nothing to do).
 */

import { NextRequest, NextResponse } from 'next/server';
import { processPendingEvents, ProcessorSummary } from '@/lib/events/processor';

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── 1. Authenticate via shared CRON_SECRET ────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Misconfiguration — fail loudly in server logs, return 500 to caller.
    console.error(
      '[cron/process-events] CRON_SECRET environment variable is not set. ' +
      'Set it in your deployment environment and in .env.example.',
    );
    return NextResponse.json(
      { ok: false, error: 'Server misconfiguration: CRON_SECRET not set.' },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get('Authorization');
  const expectedHeader = `Bearer ${cronSecret}`;

  if (authHeader !== expectedHeader) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized.' },
      { status: 401 },
    );
  }

  // ── 2. Run the processor ──────────────────────────────────────────────────
  try {
    const summary: ProcessorSummary = await processPendingEvents();

    return NextResponse.json({
      ok: true,
      ...summary,
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('[cron/process-events] Unhandled error in processPendingEvents:', err);

    return NextResponse.json(
      { ok: false, error: errorMessage },
      { status: 500 },
    );
  }
}
