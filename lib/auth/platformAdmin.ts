/**
 * lib/auth/platformAdmin.ts
 *
 * Authorization guard for the platform-admin session track (Round 6).
 *
 * ARCHITECTURAL NOTE
 * ─────────────────────────────────────────────────────────────────────────────
 * This module is intentionally isolated from the tenant-admin authorization
 * path. It does NOT import requireTenantAdmin, getEffectivePermissions, or
 * withTenantContext — their absence from the import list is a correctness signal
 * for future reviewers: platform-admin operations bypass RLS entirely and must
 * never be conflated with tenant-scoped permission resolution.
 *
 * Call site pattern:
 *   import { requirePlatformAdminSession } from "@/lib/auth/platformAdmin";
 *   import { getPlatformAdminPool }        from "@/lib/auth/permissions";
 *
 *   requirePlatformAdminSession(session);          // narrows type
 *   const { pool, platformAdminId } =
 *     await getPlatformAdminPool(session);          // verifies DB-side is_active
 */

import { ForbiddenError } from "@/lib/auth/permissions";
import type { AnySessionPayload, PlatformAdminSessionPayload } from "@/lib/auth/session";

// ─── Guard ────────────────────────────────────────────────────────────────────

/**
 * Asserts that `session` is a PlatformAdminSessionPayload.
 *
 * Narrows the TypeScript type via an assertion signature so that callers
 * can use `session` as `PlatformAdminSessionPayload` after this call returns
 * without an additional cast.
 *
 * This function:
 *   - Does NOT call withTenantContext.
 *   - Does NOT accept a PoolClient parameter.
 *   - Does NOT call getEffectivePermissions.
 *   - Does NOT query the database.
 *
 * It is a pure structural check on the JWT payload. Database-side liveness
 * verification (is_active) is performed by getPlatformAdminPool() in
 * lib/auth/permissions.ts, which calls this function internally as its first
 * defense-in-depth gate.
 *
 * @param session - A verified AnySessionPayload from verifyAnySession().
 * @throws {ForbiddenError} If session.sessionKind !== 'platform_admin'.
 */
export function requirePlatformAdminSession(
  session: AnySessionPayload
): asserts session is PlatformAdminSessionPayload {
  if (session.sessionKind !== "platform_admin") {
    throw new ForbiddenError(
      "Platform admin session required. " +
        "This operation is restricted to platform administrators."
    );
  }
}
