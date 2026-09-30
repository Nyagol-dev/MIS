/**
 * lib/db/withTenant.ts
 *
 * WHY THIS WRAPPER EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The schema uses a transaction-local `app.current_tenant_id` setting to tell
 * PostgreSQL's RLS policies which tenant the current request belongs to.
 * `SET LOCAL` only lives for the duration of the enclosing transaction — once
 * the transaction ends the setting is gone.
 *
 * Without `SET LOCAL` inside an explicit transaction, a `SET` on a pooled
 * connection would persist for the lifetime of that connection, meaning
 * the NEXT request that reuses the same connection would inherit the
 * previous tenant's context — a catastrophic isolation failure.
 *
 * The lifecycle enforced here:
 *   1. Checkout a client from appPool
 *   2. BEGIN (explicit transaction — required for SET LOCAL)
 *   3. set_config(..., $1, true) (parameterized and transaction-local)
 *   4. Run caller's fn(client)
 *   5. COMMIT on success
 *   6. ROLLBACK on any throw
 *   7. release() in finally — unconditional, even if COMMIT/ROLLBACK throws
 *
 * Callers receive a `PoolClient` and can execute any number of parameterised
 * queries within the same transaction. They should NOT call BEGIN/COMMIT/
 * ROLLBACK themselves — that lifecycle is owned here.
 */

import type { PoolClient } from "pg";
import { appPool } from "./pool";

// ── THIS IS THE ONLY SANCTIONED WAY REQUEST CODE SHOULD TOUCH appPool ────────
// Do NOT import appPool directly from lib/db/pool.ts in route handlers or
// Server Actions. Doing so bypasses the tenant-context setup and leaves
// app.current_tenant_id unset, causing every RLS policy to evaluate against
// a NULL tenant — which means zero rows returned (or an RLS error), not a
// security breach, but a silent correctness failure that is hard to debug.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes `fn` inside a transaction scoped to the given tenant.
 *
 * `app.current_tenant_id` is set transaction-locally immediately after BEGIN so that
 * every query inside `fn` sees the correct RLS context. The client is always
 * released back to the pool in the `finally` block, regardless of success or
 * failure, so the pool is never leaked.
 *
 * @param tenantId - The organization UUID for this request scope.
 * @param fn       - Async callback receiving the tenant-scoped PoolClient.
 *                   Do NOT call BEGIN/COMMIT/ROLLBACK inside fn.
 * @returns The value returned by fn.
 * @throws Re-throws any error from fn (after ROLLBACK).
 *
 * @example
 * const user = await withTenantContext(session.tenantId, async (client) => {
 *   const { rows } = await client.query(
 *     'SELECT id, email FROM users WHERE tenant_id = $1 AND id = $2',
 *     [session.tenantId, session.userId]
 *   );
 *   return rows[0] ?? null;
 * });
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await appPool.connect();

  try {
    await client.query("BEGIN");

    // SET LOCAL: the setting lives only for this transaction. When the
    // transaction ends (COMMIT or ROLLBACK) the setting reverts, so the
    // connection returned to the pool carries no tenant state.
    //
    // $1 is a true wire-protocol bind parameter: the value is never
    // concatenated into SQL text, making injection impossible by construction.
    // PostgreSQL's SET statement accepts parameters in the extended query
    // protocol, which is what `pg` uses for any query() call with a values
    // array.
    // SET LOCAL doesn't support bind parameters in PostgreSQL's utility
    // statement grammar. set_config() does, so the tenant ID remains a true
    // wire-protocol parameter while retaining transaction-local scope.
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

    const result = await fn(client);

    await client.query("COMMIT");
    return result;
  } catch (err) {
    // Best-effort ROLLBACK. If ROLLBACK itself throws (e.g. connection dropped),
    // swallow that secondary error so the original error propagates to the caller.
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error(
        "[withTenantContext] ROLLBACK failed — connection may be in a broken state:",
        rollbackErr
      );
    }
    throw err;
  } finally {
    // Unconditional release — this MUST run even if COMMIT or ROLLBACK throws.
    // After release(), the client returns to the pool with a clean connection
    // (SET LOCAL has been rolled back or the transaction has ended).
    client.release();
  }
}
