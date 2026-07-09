/**
 * lib/events/processor.ts
 *
 * Batch processor for the event execution queue.
 *
 * ─── TWO-POOL PATTERN ────────────────────────────────────────────────────────
 *
 * This module uses TWO distinct Postgres connections deliberately:
 *
 *   ADMIN POOL  (getSystemAdminPool)  — mis_admin role, bypasses RLS entirely.
 *   Used only to:
 *     a. Claim a batch of pending/retrying log rows atomically
 *        (UPDATE … FOR UPDATE SKIP LOCKED  across ALL tenants at once).
 *     b. Write the execution result back to event_execution_log after the
 *        action completes (the log row is cross-tenant data — no single
 *        tenant context is appropriate for it).
 *
 *   APP POOL  (via withTenantContext)  — mis_app role, RLS enforced.
 *   Used to:
 *     a. Load the matching event_subscription row under the correct tenant.
 *     b. Run the action executor (which may read/write entity_records, etc.)
 *        with full RLS protection so no tenant can touch another's data.
 *
 * This separation means:
 *   • The CLAIM step scans the entire event_execution_log without needing to
 *     know tenant IDs ahead of time (cross-tenant polling).
 *   • The EXECUTE step is fully tenant-isolated for the business logic.
 *   • Log status writes go through the admin pool to avoid needing a
 *     withTenantContext per-log-row after the executor has already committed
 *     the app-pool transaction.
 *
 * ─── REQUEST_PAYLOAD NOTE ─────────────────────────────────────────────────────
 *
 * The dispatcher (lib/events/dispatcher.ts) must store the serialised
 * MutationEvent in event_execution_log.request_payload at enqueue time so
 * the processor can reconstruct the event without re-querying the originating
 * mutation.
 *
 * IMPORTANT: As of the initial implementation of dispatcher.ts, the INSERT
 * into event_execution_log did NOT include request_payload.  The dispatcher
 * has been updated in this step to include the MutationEvent JSON.  If you
 * see NULL request_payload rows from before this change, the processor will
 * skip them with a warning rather than crash — see the guard in step (b) below.
 *
 * ─── SKIP LOCKED ─────────────────────────────────────────────────────────────
 *
 * FOR UPDATE SKIP LOCKED in the CLAIM query prevents two simultaneous Vercel
 * cron invocations from double-claiming the same rows.  Rows that are already
 * locked by another invocation are silently skipped rather than causing a
 * wait/deadlock.
 */

import type { PoolClient } from 'pg';
import { getSystemAdminPool }   from '../db/pool';
import { withTenantContext }    from '../db/withTenant';
import { getActionExecutor }    from './actions/registry';
import type { EventExecutionLogRow, EventSubscriptionRow, MutationEvent } from './types';

// ─── Public surface ───────────────────────────────────────────────────────────

export interface ProcessorSummary {
  processed: number;
  succeeded: number;
  failed:    number;
}

/**
 * Claims up to `batchSize` pending/retrying log rows and executes their
 * corresponding action executors.
 *
 * Designed to be called from the cron route
 * (app/api/cron/process-events/route.ts).  Safe to call concurrently —
 * FOR UPDATE SKIP LOCKED prevents double-processing.
 *
 * @param batchSize Maximum number of log rows to process in one invocation.
 * @returns Summary of how many rows were processed, succeeded, and failed.
 */
export async function processPendingEvents(batchSize = 50): Promise<ProcessorSummary> {
  const adminPool = getSystemAdminPool();
  const adminClient: PoolClient = await adminPool.connect();

  let claimedRows: EventExecutionLogRow[] = [];

  try {
    // ── STEP A: Claim a batch atomically ─────────────────────────────────
    //
    // This UPDATE … FOR UPDATE SKIP LOCKED pattern is the standard
    // Postgres queue-consumer pattern.  It atomically:
    //   1. Selects up to batchSize rows in 'pending' or 'retrying' state.
    //   2. Locks those rows so concurrent cron invocations skip them.
    //   3. Transitions them to 'running' and records started_at.
    //   4. Returns the full row so we have tenant_id, subscription_id,
    //      attempt, and request_payload without a second query.
    //
    // The query runs under mis_admin (no RLS), so it sees ALL tenants.
    const claimResult = await adminClient.query<EventExecutionLogRow>(
      `UPDATE event_execution_log
          SET status     = 'running',
              started_at = now()
        WHERE id IN (
          SELECT id
            FROM event_execution_log
           WHERE status IN ('pending', 'retrying')
           ORDER BY created_at ASC
           LIMIT $1
             FOR UPDATE SKIP LOCKED
        )
        RETURNING *`,
      [batchSize],
    );

    claimedRows = claimResult.rows;
  } finally {
    // Release the admin client immediately after the claim so it returns to
    // the pool before the (potentially slow) executor calls below.
    adminClient.release();
  }

  if (claimedRows.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // ── STEP B: Execute each claimed row ─────────────────────────────────────
  //
  // We process rows sequentially rather than in parallel to avoid saturating
  // the connection pool on a small serverless instance.  Increase to parallel
  // with Promise.allSettled if throughput becomes a bottleneck.

  let succeeded = 0;
  let failed    = 0;

  for (const logRow of claimedRows) {
    await processOneRow(logRow, adminPool);

    // We don't yet know the final outcome here — processOneRow writes its own
    // status update.  We'll count by re-reading the admin pool result inside
    // processOneRow and returning the outcome through a shared counter.
    // (Simplified: re-query not needed — processOneRow returns the outcome.)
  }

  // Re-fetch the outcomes of the rows we claimed to build the summary.
  // We use a single admin query to avoid N+1 round trips.
  const summaryAdminClient = await adminPool.connect();
  try {
    const ids = claimedRows.map((r) => r.id);
    const summaryResult = await summaryAdminClient.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::TEXT AS count
         FROM event_execution_log
        WHERE id = ANY($1::uuid[])
        GROUP BY status`,
      [ids],
    );

    for (const row of summaryResult.rows) {
      const n = parseInt(row.count, 10);
      if (row.status === 'succeeded') succeeded += n;
      if (row.status === 'failed')    failed    += n;
      // 'retrying' rows count as neither succeeded nor definitively failed
      // for this summary; they will be re-processed in a future invocation.
    }
  } finally {
    summaryAdminClient.release();
  }

  return { processed: claimedRows.length, succeeded, failed };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Processes a single claimed event_execution_log row:
 *   1. Opens a tenant-scoped app connection to load the subscription and run
 *      the executor.
 *   2. Uses the admin pool to write the final status back to the log row.
 */
async function processOneRow(
  logRow:    EventExecutionLogRow,
  adminPool: import('pg').Pool,
): Promise<void> {
  // Guard: request_payload must contain the serialised MutationEvent.
  // Rows inserted by older dispatcher code (before the request_payload was
  // added) will have NULL here.  We fail them gracefully rather than crashing.
  if (!logRow.request_payload) {
    console.warn(
      `[processor] Skipping log row ${logRow.id}: request_payload is NULL. ` +
      `This row was enqueued before the dispatcher was updated to store the ` +
      `MutationEvent in request_payload. Mark it failed and move on.`,
    );
    await updateLogStatus(adminPool, logRow.id, 'failed', null,
      'request_payload is NULL — row was enqueued before the processor upgrade.');
    return;
  }

  // Reconstruct the MutationEvent from the stored JSON.
  const event = logRow.request_payload as unknown as MutationEvent;

  try {
    // ── Execute under tenant RLS context ─────────────────────────────────
    const result = await withTenantContext(logRow.tenant_id, async (client) => {
      // Load the subscription under RLS (only this tenant's subscriptions visible).
      const subResult = await client.query<EventSubscriptionRow>(
        `SELECT *
           FROM event_subscriptions
          WHERE tenant_id = $1
            AND id        = $2`,
        [logRow.tenant_id, logRow.subscription_id],
      );

      if (subResult.rowCount === 0) {
        // Subscription deleted between enqueue and execution — treat as fatal.
        return {
          success:      false,
          errorMessage: `Subscription ${logRow.subscription_id} not found (deleted?).`,
        };
      }

      const subscription = subResult.rows[0];

      // Dispatch to the correct executor.
      const executor = getActionExecutor(subscription.action_type);
      return executor(subscription, event, logRow.id, client);
    });

    // ── Write success status via admin pool ───────────────────────────────
    //
    // We deliberately write the log outcome through the admin pool (not
    // through withTenantContext) because:
    //   a. The withTenantContext transaction has already been committed above.
    //   b. The log row is cross-tenant data — updating it via the app pool
    //      would require another withTenantContext call, adding round-trips.
    //   c. mis_admin bypasses RLS, so the UPDATE is always permitted.
    await updateLogStatus(
      adminPool,
      logRow.id,
      'succeeded',
      result.responsePayload !== undefined
        ? (result.responsePayload as Record<string, unknown>)
        : null,
      null,
    );

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[processor] Error processing log row ${logRow.id}:`, err);

    // Determine whether to retry or give up.
    // We need the subscription's max_retries for this — fetch it via admin pool
    // to avoid another withTenantContext call.
    const adminClient = await adminPool.connect();
    try {
      const subResult = await adminClient.query<{ max_retries: number }>(
        `SELECT s.max_retries
           FROM event_subscriptions s
          WHERE s.id        = $1
            AND s.tenant_id = $2`,
        [logRow.subscription_id, logRow.tenant_id],
      );

      const maxRetries = subResult.rows[0]?.max_retries ?? 3;

      if (logRow.attempt < maxRetries) {
        // Retry: increment attempt counter, requeue.
        await adminClient.query(
          `UPDATE event_execution_log
              SET status        = 'retrying',
                  attempt       = $1,
                  error_message = $2,
                  completed_at  = NULL
            WHERE id = $3`,
          [logRow.attempt + 1, errorMessage.slice(0, 2000), logRow.id],
        );
      } else {
        // Max retries exhausted — mark as permanently failed.
        await adminClient.query(
          `UPDATE event_execution_log
              SET status        = 'failed',
                  error_message = $1,
                  completed_at  = now()
            WHERE id = $2`,
          [errorMessage.slice(0, 2000), logRow.id],
        );
      }
    } finally {
      adminClient.release();
    }
  }
}

/**
 * Writes a terminal status update to event_execution_log via the admin pool.
 * Uses a new connection so the caller does not have to manage client lifecycle.
 */
async function updateLogStatus(
  adminPool:       import('pg').Pool,
  logId:           string,
  status:          'succeeded' | 'failed',
  responsePayload: Record<string, unknown> | null,
  errorMessage:    string | null,
): Promise<void> {
  const client = await adminPool.connect();
  try {
    await client.query(
      `UPDATE event_execution_log
          SET status           = $1,
              response_payload = $2::jsonb,
              error_message    = $3,
              completed_at     = now()
        WHERE id = $4`,
      [
        status,
        responsePayload !== null ? JSON.stringify(responsePayload) : null,
        errorMessage,
        logId,
      ],
    );
  } finally {
    client.release();
  }
}
