/**
 * app/api/cron/poll-mpesa-pending/route.ts
 *
 * Cron job: polls Safaricom's STK Query API for M-Pesa payment_requests that
 * are still in 'pending' status and have not received a callback.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Safaricom's Daraja platform delivers STK Push outcomes via a webhook callback
 * (handled by Task 8.8).  However, callbacks can be delayed or never arrive in
 * edge cases (network partition between Safaricom and MIS, Daraja outages, etc.).
 * This cron job is the fallback reconciliation path:
 *
 *   1. Queries payment_requests for M-Pesa rows still 'pending' and created
 *      within the last 30 minutes (older means Safaricom has already given up).
 *   2. For each, calls MpesaPaymentProvider.queryPaymentStatus() against the
 *      Daraja STK Query API to get the current outcome.
 *   3. If resolved (succeeded/failed), processes the update inside a tenant
 *      context using processPaymentStatusUpdate() — the same logic used by
 *      the webhook-driven path (Task 8.8 dependency, see note below).
 *   4. Marks requests older than 30 minutes that are still pending as 'expired'.
 *
 * ─── AUTH PATTERN ────────────────────────────────────────────────────────────
 * Mirrors app/api/cron/process-events/route.ts exactly:
 *   - GET handler (Vercel cron jobs call GET).
 *   - x-cron-secret header checked against process.env.CRON_SECRET.
 *   - Returns HTTP 401 if absent or mismatched.
 *
 * ─── TWO-POOL PATTERN ────────────────────────────────────────────────────────
 * Uses getSystemAdminPool() (mis_admin role, bypasses RLS) to query
 * payment_requests across all tenants without needing to know tenant IDs
 * ahead of time, mirroring the pattern in lib/events/processor.ts.
 *
 * After resolving a payment's status, withTenantContext() (mis_app role, RLS
 * enforced) is used for the processPaymentStatusUpdate() call so the business
 * logic executes under proper tenant isolation.
 *
 * ─── TASK 8.8 DEPENDENCY ─────────────────────────────────────────────────────
 * processPaymentStatusUpdate() is imported from lib/billing/payments.ts, which
 * is defined in Task 8.8.  This import will cause a compile error until Task
 * 8.8 is merged.  The call site here is intentionally written as it will be
 * in the final system — do NOT stub the import with a local placeholder.
 */

import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getSystemAdminPool } from "@/lib/db/pool";
import { withTenantContext } from "@/lib/db/withTenant";
import { getPaymentProvider } from "@/lib/billing/providers/registry";
import { getProviderCredentials } from "@/lib/billing/providerConfig";
// ⚠️  TASK 8.8 DEPENDENCY: lib/billing/payments.ts is created in Task 8.8.
// This import will not resolve until that task is complete.  The call site
// below is the correct final form — do not remove or stub this import.
import { processPaymentStatusUpdate } from "@/lib/billing/payments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingMpesaRow {
  id: string;          // payment_requests.id (UUID)
  tenant_id: string;   // payment_requests.tenant_id (UUID)
  provider_payment_id: string; // payment_requests.provider_payment_id = CheckoutRequestID
  created_at: Date;    // payment_requests.created_at
}

interface PollSummary {
  scanned: number;
  resolved: number;
  expired: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Auth: mirror the exact pattern from app/api/cron/process-events/route.ts
  const secretHeader = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secretHeader !== expectedSecret) {
    return NextResponse.json(
      { error: "Invalid or missing CRON secret." },
      { status: 401 }
    );
  }

  const summary = await pollMpesaPending();
  return NextResponse.json({ ok: true, ...summary });
}

// ---------------------------------------------------------------------------
// Core polling logic
// ---------------------------------------------------------------------------

/**
 * Polls all pending M-Pesa payment_requests and resolves or expires them.
 *
 * Separated from the route handler for testability.
 */
async function pollMpesaPending(): Promise<PollSummary> {
  const adminPool = getSystemAdminPool();
  const adminClient: PoolClient = await adminPool.connect();

  let pendingRows: PendingMpesaRow[] = [];

  try {
    // ── Fetch pending M-Pesa rows from the last 30 minutes ─────────────────
    //
    // The 30-minute window matches Safaricom's STK Push session validity.
    // Requests older than 30 minutes will never receive a callback from
    // Daraja, so we do not query the API for them (they are handled below
    // by the 'expired' path).
    //
    // mis_admin bypasses RLS, so this sees all tenants without needing
    // per-tenant context — identical pattern to lib/events/processor.ts.
    const result = await adminClient.query<PendingMpesaRow>(
      `SELECT id, tenant_id, provider_payment_id, created_at
         FROM payment_requests
        WHERE provider_slug = 'mpesa'
          AND status        = 'pending'
          AND created_at    > now() - interval '30 minutes'
        ORDER BY created_at ASC`
    );

    pendingRows = result.rows;
  } finally {
    // Release immediately after the read — the subsequent per-row work uses
    // its own connections, mirroring the CLAIM → release pattern in processor.ts.
    adminClient.release();
  }

  if (pendingRows.length === 0) {
    return { scanned: 0, resolved: 0, expired: 0, errors: 0 };
  }

  let resolved = 0;
  let expired = 0;
  let errors = 0;

  for (const row of pendingRows) {
    try {
      await processPendingRow(row, adminPool);
      resolved++;
    } catch (err) {
      errors++;
      console.error(
        `[poll-mpesa-pending] Error processing payment_request ${row.id}:`,
        err
      );
      // Continue with remaining rows — one failure does not abort the batch.
    }
  }

  // ── Expire requests older than 30 minutes still 'pending' ────────────────
  //
  // These are rows that were created more than 30 minutes ago but did not
  // receive a callback and were NOT in the above poll window (because we
  // filtered to created_at > now() - 30min for the query above).
  // We separately expire them here by querying the wider range.
  //
  // Note: a request could have been inserted between the first query and this
  // one and appear in both; the WHERE status = 'pending' guard makes this safe.
  const expireClient: PoolClient = await adminPool.connect();
  try {
    const expireResult = await expireClient.query<{ id: string }>(
      `UPDATE payment_requests
          SET status     = 'expired',
              updated_at = now()
        WHERE provider_slug = 'mpesa'
          AND status        = 'pending'
          AND created_at    <= now() - interval '30 minutes'
        RETURNING id`
    );
    expired = expireResult.rowCount ?? 0;
  } finally {
    expireClient.release();
  }

  return {
    scanned: pendingRows.length,
    resolved,
    expired,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Per-row processor
// ---------------------------------------------------------------------------

/**
 * Processes a single pending M-Pesa payment_request:
 *
 *   1. Fetches the tenant's M-Pesa credentials via admin pool.
 *   2. Calls queryPaymentStatus() against the Daraja STK Query API.
 *   3. If the status is still pending (Daraja hasn't settled yet), skips
 *      without writing — the next cron invocation will retry.
 *   4. If resolved (succeeded or failed), opens a tenant RLS context and
 *      delegates to processPaymentStatusUpdate() (Task 8.8 dependency).
 *
 * Throws on any error so the caller can count and log failures without losing
 * the remaining rows in the batch.
 */
async function processPendingRow(
  row: PendingMpesaRow,
  adminPool: import("pg").Pool
): Promise<void> {
  // ── Step 1: Load tenant credentials via admin pool ────────────────────────
  //
  // We use a fresh admin client here so credential reads are isolated from
  // the subsequent withTenantContext transaction.
  const adminClient: PoolClient = await adminPool.connect();
  let providerConfig: Awaited<ReturnType<typeof getProviderCredentials>>;

  try {
    providerConfig = await getProviderCredentials(adminClient, row.tenant_id, "mpesa");
  } finally {
    adminClient.release();
  }

  if (!providerConfig) {
    throw new Error(
      `[poll-mpesa-pending] No M-Pesa provider config found for tenant ${row.tenant_id}. ` +
        `payment_request ${row.id} cannot be queried.`
    );
  }

  // ── Step 2: Query Daraja STK Query API ───────────────────────────────────
  const provider = getPaymentProvider("mpesa");
  const update = await provider.queryPaymentStatus(
    row.provider_payment_id,
    providerConfig
  );

  // ── Step 3: Skip if still unresolved ─────────────────────────────────────
  //
  // Daraja returns 'pending' when the user hasn't responded yet or the
  // system is still processing.  We do nothing and let the next cron cycle
  // retry.  The 'expired' path above will clean up requests that age past
  // 30 minutes.
  if (update.status === "pending") {
    return;
  }

  // ── Step 4: Process resolved update under tenant RLS ────────────────────
  //
  // withTenantContext opens an app-pool connection (mis_app role, RLS on) and
  // sets app.current_tenant_id so all writes are tenant-scoped.
  //
  // processPaymentStatusUpdate is a Task 8.8 dependency — see file-level
  // comment.  Its signature matches what the webhook handler (Task 8.8) also
  // calls, ensuring both paths apply identical business logic.
  await withTenantContext(row.tenant_id, async (client) => {
    // ⚠️  TASK 8.8 DEPENDENCY: processPaymentStatusUpdate is defined in
    // lib/billing/payments.ts (created in Task 8.8).  This call will not
    // compile until that task is merged.
    await processPaymentStatusUpdate(client, row.tenant_id, update, row.id);
  });
}
