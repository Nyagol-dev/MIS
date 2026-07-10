/**
 * lib/auth/requireTenantAdmin.ts
 *
 * Authorization guard for tenant-admin operations (user CRUD, role CRUD,
 * permission assignment). Verifies that the calling user holds the
 * 'user:manage' permission before any admin mutation is allowed to proceed.
 *
 * ── DESIGN CONTRACT ──────────────────────────────────────────────────────────
 *
 * Return shape — not throw:
 *   This function returns `ForbiddenError` for the expected "not authorized"
 *   case instead of throwing it. This matches the established convention for
 *   typed, expected failures in this codebase (distinct from
 *   `requirePermission()` in permissions.ts, which throws). Route handlers
 *   inspect the return value and convert it to HTTP 403 themselves.
 *
 * Client ownership:
 *   The caller passes in an already-checked-out `PoolClient` that is running
 *   inside a `withTenantContext` transaction. This function uses that same
 *   client for its permission query — it does NOT call `withTenantContext`
 *   internally and does NOT open a new transaction. The permission check is
 *   therefore fully atomic with the surrounding admin operation.
 *
 * ── WHY THIS DOES NOT CALL getEffectivePermissions() ────────────────────────
 *
 * `getEffectivePermissions(tenantId, userId)` (permissions.ts) internally
 * calls `withTenantContext`, which opens a *new* transaction on a *new*
 * pooled connection. Calling it from inside an existing `withTenantContext`
 * callback would therefore:
 *   1. Check out a second connection from the pool.
 *   2. Issue an independent BEGIN / SET LOCAL / COMMIT on that connection.
 *   3. Run the permission query in a separate transaction, decoupled from
 *      the outer admin transaction — breaking atomicity.
 *
 * This is exactly the bug that was identified and fixed in the reporting
 * engine (executor.ts lines 28–30, 115–117, 175–177): the correct pattern
 * there is to call `getEffectivePermissions` *before* entering
 * `withTenantContext`, capture the result, then use it inside the callback.
 * Replicating that approach here is not possible because `requireTenantAdmin`
 * is called from *within* an already-open transaction where the caller owns
 * the client. Therefore this guard replicates the codename-resolution query
 * directly against the provided `client`, keeping all work in a single
 * connection and transaction.
 *
 * ── CORRECT CALL-SITE PATTERN ────────────────────────────────────────────────
 *
 * @example
 * // In an API route handler or server action:
 * const result = await withTenantContext(session.tenantId, async (client) => {
 *   const authErr = await requireTenantAdmin(client, session);
 *   if (authErr) return authErr;               // caller maps to HTTP 403
 *   return inviteUser(client, session, input); // safe to proceed
 * });
 *
 * NOTE: Do NOT call requireTenantAdmin outside a withTenantContext callback.
 * The `client` must already have `app.current_tenant_id` set via SET LOCAL
 * (guaranteed by withTenantContext) so that RLS policies apply correctly to
 * the permission query below.
 */

import type { PoolClient } from "pg";
import { ForbiddenError } from "./permissions";
import type { SessionPayload } from "./session";

// ── Permission codename required for all tenant-admin operations ──────────────

const REQUIRED_PERMISSION = "user:manage" as const;

// ── Guard ─────────────────────────────────────────────────────────────────────

/**
 * Checks that the session user holds the `'user:manage'` permission before
 * allowing any admin operation (user CRUD, role CRUD, permission assignment).
 *
 * Must be called from within a `withTenantContext` callback — the `client`
 * parameter must be the already-scoped `PoolClient` provided by that callback.
 * Do NOT call `withTenantContext` inside this function.
 *
 * @param client  - The tenant-scoped `PoolClient` from the enclosing
 *                  `withTenantContext` transaction.
 * @param session - The verified `SessionPayload` for the current request.
 * @returns `undefined` if the user is authorized, or a `ForbiddenError`
 *          instance if the `'user:manage'` permission is not present.
 *          The caller is responsible for converting the returned error to
 *          an appropriate HTTP 403 response.
 */
export async function requireTenantAdmin(
  client: PoolClient,
  session: SessionPayload
): Promise<ForbiddenError | undefined> {
  // Resolve codename-based permissions for this user within the current tenant.
  //
  // This mirrors Query 1 in getEffectivePermissions() (permissions.ts L95–L111)
  // but runs against the caller's existing PoolClient rather than opening a new
  // withTenantContext transaction. Both the global `permissions` table and the
  // tenant-scoped `tenant_permission_overrides` table are covered by the XOR
  // LEFT JOIN + COALESCE pattern, consistent with the schema's role_permissions
  // CHECK constraint (exactly one of permission_id / override_id is non-null).
  const { rows } = await client.query<{ codename: string }>(
    `
    SELECT COALESCE(p.codename, tpo.codename) AS codename
    FROM user_roles ur
      JOIN role_permissions rp
        ON rp.tenant_id = ur.tenant_id
       AND rp.role_id   = ur.role_id
      LEFT JOIN permissions p
        ON p.id = rp.permission_id
      LEFT JOIN tenant_permission_overrides tpo
        ON tpo.tenant_id = rp.tenant_id
       AND tpo.id        = rp.override_id
    WHERE ur.tenant_id = $1
      AND ur.user_id   = $2
    `,
    [session.tenantId, session.userId]
  );

  const codenames = new Set(rows.map((r) => r.codename));

  if (!codenames.has(REQUIRED_PERMISSION)) {
    return new ForbiddenError(
      `Permission denied: '${REQUIRED_PERMISSION}' is required for tenant admin operations.`,
      REQUIRED_PERMISSION
    );
  }

  // Authorized — return undefined so callers can use a simple truthiness check.
  return undefined;
}
