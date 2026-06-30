/**
 * lib/auth/permissions.ts
 *
 * Permission resolution for the multi-tenant MIS.
 *
 * SCHEMA PERMISSION MODEL (summary)
 * ─────────────────────────────────────────────────────────────────────────────
 * The schema has two orthogonal permission axes:
 *
 * 1. Codename-based permissions (user_roles → role_permissions → permissions
 *    OR tenant_permission_overrides)
 *    - `permissions` table: platform-defined atoms, globally shared.
 *      e.g. 'user:write', 'entity_record:read'
 *    - `tenant_permission_overrides` table: additive tenant-scoped atoms for
 *      custom entity types. e.g. 'patient:approve'
 *    - role_permissions enforces XOR: exactly one of permission_id / override_id
 *      is non-null per row (CHECK constraint in the schema).
 *
 * 2. Entity-type action grants (user_roles → role_entity_type_permissions)
 *    - Fine-grained access to specific tenant-defined entity types per action.
 *    - Actions: 'create', 'read', 'update', 'delete', 'manage'
 *
 * getEffectivePermissions() resolves both axes in a single withTenantContext
 * call (two queries). The result is cached by the caller for the request scope.
 *
 * requirePlatformAdmin() DOES NOT QUERY THE DB. It is a marker/guard that
 * future code must call before using adminPool. If/when a platform_admin flag
 * is added to the schema, wire it here.
 */

import { withTenantContext } from "@/lib/db/withTenant";
import { _adminPoolInternal } from "@/lib/db/pool";
import type { Pool } from "pg";
import type { SessionPayload } from "./session";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The resolved effective permissions for a user within a tenant context.
 *
 * codenames   — union of global permission codenames and tenant override
 *               codenames granted to the user via their roles.
 * entityGrants — per entity-type-id map of granted action strings.
 *                e.g. Map { 'uuid-of-patient-type' => Set { 'read', 'create' } }
 */
export interface EffectivePermissions {
  codenames: Set<string>;
  entityGrants: Map<string, Set<string>>;
}

/**
 * Error thrown when a required permission or admin privilege is missing.
 * Route Handlers and Server Actions should catch this and return HTTP 403.
 */
export class ForbiddenError extends Error {
  public readonly code = "FORBIDDEN" as const;
  public readonly requiredPermission?: string;

  constructor(message: string, requiredPermission?: string) {
    super(message);
    this.name = "ForbiddenError";
    this.requiredPermission = requiredPermission;
  }
}

// ─── Permission resolution ────────────────────────────────────────────────────

/**
 * Resolves the effective permissions for a user within their tenant.
 *
 * Runs two queries inside a single withTenantContext transaction:
 *
 * Query 1: Codename-based permissions
 *   Joins user_roles → role_permissions → (permissions | tenant_permission_overrides)
 *   using LEFT JOINs on both sides of the XOR constraint, unions both codename
 *   columns via COALESCE.
 *
 * Query 2: Entity-type action grants
 *   Joins user_roles → role_entity_type_permissions, grouped by entity_type_id.
 *
 * @param tenantId - The tenant UUID (from session).
 * @param userId   - The user UUID (from session, non-tenant portion of PK).
 * @returns Fully resolved EffectivePermissions for this user.
 */
export async function getEffectivePermissions(
  tenantId: string,
  userId: string
): Promise<EffectivePermissions> {
  return withTenantContext(tenantId, async (client) => {
    // ── Query 1: codename-based permissions ──────────────────────────────────
    // Both sources (global permissions + tenant overrides) are LEFT-joined so
    // one query resolves the XOR without needing UNION/two queries.
    // COALESCE picks whichever side is non-null (only one can be, per the schema
    // CHECK constraint on role_permissions).
    const codenameResult = await client.query<{ codename: string }>(
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
      [tenantId, userId]
    );

    const codenames = new Set(codenameResult.rows.map((r) => r.codename));

    // ── Query 2: entity-type action grants ───────────────────────────────────
    const entityGrantResult = await client.query<{
      entity_type_id: string;
      action: string;
    }>(
      `
      SELECT retp.entity_type_id, retp.action
      FROM user_roles ur
        JOIN role_entity_type_permissions retp
          ON retp.tenant_id = ur.tenant_id
         AND retp.role_id   = ur.role_id
      WHERE ur.tenant_id = $1
        AND ur.user_id   = $2
      `,
      [tenantId, userId]
    );

    const entityGrants = new Map<string, Set<string>>();
    for (const row of entityGrantResult.rows) {
      let actions = entityGrants.get(row.entity_type_id);
      if (!actions) {
        actions = new Set<string>();
        entityGrants.set(row.entity_type_id, actions);
      }
      actions.add(row.action);
    }

    return { codenames, entityGrants };
  });
}

// ─── Guard helpers ────────────────────────────────────────────────────────────

/**
 * Returns true if the user has the given codename in their effective permissions.
 *
 * Checks both global permission codenames (e.g. 'user:write') and tenant
 * override codenames (e.g. 'patient:approve').
 *
 * @param perms    - Result of getEffectivePermissions().
 * @param codename - The permission codename to check.
 */
export function can(perms: EffectivePermissions, codename: string): boolean {
  return perms.codenames.has(codename);
}

/**
 * Returns true if the user has the given action grant on a specific entity type.
 *
 * 'manage' on an entity type implies all actions — this is consistent with
 * the schema's action CHECK constraint which includes 'manage' as a catch-all.
 *
 * @param perms        - Result of getEffectivePermissions().
 * @param entityTypeId - The UUID of the tenant-defined entity type.
 * @param action       - One of: 'create', 'read', 'update', 'delete', 'manage'.
 */
export function canOnEntityType(
  perms: EffectivePermissions,
  entityTypeId: string,
  action: string
): boolean {
  const grants = perms.entityGrants.get(entityTypeId);
  if (!grants) return false;
  // 'manage' is a superset of all other actions.
  return grants.has(action) || grants.has("manage");
}

/**
 * Throws ForbiddenError if the user does not have the given codename.
 *
 * Convenience wrapper for use in Route Handlers and Server Actions:
 *   requirePermission(perms, 'user:write');
 *   // ... proceed knowing the permission is granted
 *
 * @param perms    - Result of getEffectivePermissions().
 * @param codename - The permission codename to require.
 * @throws {ForbiddenError}
 */
export function requirePermission(
  perms: EffectivePermissions,
  codename: string
): void {
  if (!can(perms, codename)) {
    throw new ForbiddenError(
      `Permission denied: '${codename}' is required for this operation.`,
      codename
    );
  }
}

/**
 * Throws ForbiddenError if the user does not have the given action grant
 * on the specified entity type.
 *
 * @param perms        - Result of getEffectivePermissions().
 * @param entityTypeId - The UUID of the tenant-defined entity type.
 * @param action       - One of: 'create', 'read', 'update', 'delete', 'manage'.
 * @throws {ForbiddenError}
 */
export function requireEntityTypePermission(
  perms: EffectivePermissions,
  entityTypeId: string,
  action: string
): void {
  if (!canOnEntityType(perms, entityTypeId, action)) {
    throw new ForbiddenError(
      `Permission denied: action '${action}' on entity type '${entityTypeId}' is not granted.`
    );
  }
}

// ─── Platform admin guard ─────────────────────────────────────────────────────

/**
 * Guard that MUST be called before using adminPool for cross-tenant operations.
 *
 * Currently this throws unconditionally — there is no `is_platform_admin` flag
 * on the users table in the current schema. This is an intentional extension
 * point: when a platform-admin mechanism is added to the schema, implement the
 * check here without changing any call sites.
 *
 * TODO: Wire to a `is_platform_admin` column or a separate platform_admins
 *       table when that schema addition is made.
 *
 * @param _session - The verified session payload (will be used for the check
 *                   once a platform-admin flag exists in the schema).
 * @throws {ForbiddenError} Always — until the schema has a platform-admin mechanism.
 */
export function requirePlatformAdmin(_session: SessionPayload): void {
  // TODO: Replace with a real check once the schema includes a platform-admin mechanism.
  // Example (future):
  //   if (!_session.isPlatformAdmin) {
  //     throw new ForbiddenError("Platform admin access required.");
  //   }
  throw new ForbiddenError(
    "Platform admin access is not yet implemented. " +
      "The schema does not include a platform-admin mechanism. " +
      "See requirePlatformAdmin() in lib/auth/permissions.ts."
  );
}

/**
 * Safely accesses the admin connection pool.
 * Internally runs requirePlatformAdmin(session) to ensure the caller has
 * permission before returning the RLS-bypassing pool.
 *
 * @param session - The verified session payload.
 * @returns The admin Pool instance.
 */
export async function getAdminPool(session: SessionPayload): Promise<Pool> {
  requirePlatformAdmin(session);
  return _adminPoolInternal;
}
