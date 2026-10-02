/**
 * lib/authz/check.ts
 *
 * CENTRAL AUTHORIZATION MODULE (§4.1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Every authorization check in the hospital HMIS goes through this module.
 * NO ad-hoc `if (user.role === ...)` in routes or components.
 *
 * This file contains the DB-touching `loadUserAuthz()` function.
 * Pure check functions (can, canAny, canAll, authorize) are in `can.ts`.
 *
 * USAGE:
 *   import { loadUserAuthz } from '@/lib/authz/check';
 *   import { authorize, can } from '@/lib/authz/can';
 *
 *   // In a route handler (inside withTenantContext):
 *   const authz = await loadUserAuthz(client, session);
 *   authorize(authz, 'patient:read', { departmentId: deptId });
 */

import type { PoolClient } from 'pg';
import type { SessionPayload } from '@/lib/auth/session';
import { ForbiddenError } from '@/lib/auth/permissions';
import { CATALOGUE_MAP, type PermissionScope } from './catalogue';
import type { UserAuthzContext, AuthzResourceContext } from './types';

// Re-export everything from can.ts and types.ts for convenience
export { can, canAny, canAll, scopeCovers, isDepartmentHead } from './can';
export type { UserAuthzContext, AuthzResourceContext } from './types';

// ─── Scope hierarchy (local copy for loadUserAuthz) ───────────────────────────

const SCOPE_RANK: Record<PermissionScope, number> = {
  own: 1,
  assigned: 2,
  department: 3,
  hospital: 4,
};

// ─── Load user authz context ──────────────────────────────────────────────────

/**
 * Loads the full authorization context for a user within a tenant.
 * Must be called inside a withTenantContext transaction.
 *
 * This replaces the old getEffectivePermissions() for new hospital code.
 * The old function is preserved for backward compatibility with existing
 * entity-engine code paths.
 *
 * @param client  - Tenant-scoped PoolClient from withTenantContext
 * @param session - Verified session payload
 */
export async function loadUserAuthz(
  client: PoolClient,
  session: SessionPayload,
): Promise<UserAuthzContext> {
  // ── Query 1: Scoped permission grants ─────────────────────────────────────
  const grantResult = await client.query<{
    codename: string;
    scope: PermissionScope;
  }>(
    `SELECT COALESCE(p.codename, tpo.codename) AS codename,
            COALESCE(rp.scope, 'hospital') AS scope
       FROM user_roles ur
       JOIN role_permissions rp
         ON rp.tenant_id = ur.tenant_id AND rp.role_id = ur.role_id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       LEFT JOIN tenant_permission_overrides tpo
         ON tpo.tenant_id = rp.tenant_id AND tpo.id = rp.override_id
      WHERE ur.tenant_id = $1 AND ur.user_id = $2`,
    [session.tenantId, session.userId],
  );

  // If a user has the same codename from multiple roles with different scopes,
  // keep the widest scope.
  const grants = new Map<string, PermissionScope>();
  for (const row of grantResult.rows) {
    const existing = grants.get(row.codename);
    if (!existing || SCOPE_RANK[row.scope] > SCOPE_RANK[existing]) {
      grants.set(row.codename, row.scope);
    }
  }

  // ── Query 2: Department memberships ───────────────────────────────────────
  const deptResult = await client.query<{ department_id: string }>(
    `SELECT department_id FROM department_members
      WHERE tenant_id = $1 AND user_id = $2 AND is_active = TRUE`,
    [session.tenantId, session.userId],
  );
  const departmentIds = new Set(deptResult.rows.map((r) => r.department_id));

  // ── Query 3: Departments where user is head/deputy ────────────────────────
  const headResult = await client.query<{ id: string }>(
    `SELECT id FROM departments
      WHERE tenant_id = $1 AND (head_user_id = $2 OR deputy_head_user_id = $2)
        AND is_active = TRUE`,
    [session.tenantId, session.userId],
  );
  const headOfDepartmentIds = new Set(headResult.rows.map((r) => r.id));

  // ── Determine if hospital admin ───────────────────────────────────────────
  const isHospitalAdmin =
    grants.has('user:manage') ||
    grants.has('hospital:manage') ||
    grants.has('tenant:admin');

  return {
    tenantId: session.tenantId,
    userId: session.userId,
    grants,
    departmentIds,
    headOfDepartmentIds,
    isHospitalAdmin,
  };
}

// ─── Throwing helpers (import ForbiddenError, so they live here) ──────────────

/**
 * Throws ForbiddenError if the user is not authorized.
 *
 * @param authz    - User's loaded authorization context
 * @param codename - Permission codename to check (e.g. 'patient:read')
 * @param context  - Resource context for scope evaluation
 * @throws {ForbiddenError}
 */
export function authorize(
  authz: UserAuthzContext,
  codename: string,
  context?: AuthzResourceContext,
): void {
  // Import locally to avoid circular — can is a pure module
  const { can: canCheck } = require('./can') as typeof import('./can');
  if (!canCheck(authz, codename, context)) {
    const entry = CATALOGUE_MAP.get(codename);
    const description = entry?.description ?? codename;
    throw new ForbiddenError(
      `Permission denied: '${codename}' (${description}) is required for this operation.`,
      codename,
    );
  }
}

/**
 * Checks if the user is a Hospital Admin.
 * Convenience wrapper used by admin-only routes.
 */
export function requireHospitalAdmin(authz: UserAuthzContext): void {
  if (!authz.isHospitalAdmin) {
    throw new ForbiddenError(
      'Permission denied: Hospital Administrator access is required.',
      'hospital:manage',
    );
  }
}
