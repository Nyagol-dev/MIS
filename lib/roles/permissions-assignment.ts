/**
 * lib/roles/permissions-assignment.ts
 *
 * Permission assignment and user-role assignment — Task 5.4 (Round 5, User
 * Management).
 *
 * DESIGN CONTRACTS
 * ────────────────────────────────────────────────────────────────────────────
 * • All functions accept a PoolClient obtained externally via withTenantContext.
 *   They do NOT open their own connections or transactions. The caller owns the
 *   transaction lifecycle (BEGIN / COMMIT / ROLLBACK).
 *
 * • Actor threading: every writeAuditLog call here supplies a real actorUserId
 *   (the session user performing the assignment), never null. This module is
 *   the canonical introduction of real actor IDs in the audit trail.
 *
 * • Errors for EXPECTED failure modes are returned as typed objects with a
 *   `code` property — never thrown as raw Errors.
 *
 * • writeAuditLog is called on the SAME client, inside the SAME transaction,
 *   immediately after every mutation — before the function returns.
 *
 * • All queries are fully parameterised. No string interpolation of external
 *   values reaches a query template.
 *
 * OUT OF SCOPE (this file)
 * ────────────────────────────────────────────────────────────────────────────
 * • Authorization guards — callers must run requireTenantAdmin before invoking
 *   these functions.
 * • Connection / transaction management — owned entirely by the caller.
 */

import type { PoolClient } from "pg";
import { writeAuditLog } from "@/lib/db/audit";

// ─── Allowed action values (mirrors the CHECK constraint in the schema) ────────

/**
 * The exhaustive set of action strings accepted by role_entity_type_permissions.
 *
 * Schema DDL:
 *   action TEXT NOT NULL CHECK (action IN ('create','read','update','delete','manage'))
 */
const ALLOWED_ENTITY_ACTIONS = new Set([
  "create",
  "read",
  "update",
  "delete",
  "manage",
] as const);

export type EntityAction = "create" | "read" | "update" | "delete" | "manage";

// ─── Typed error shapes ────────────────────────────────────────────────────────

export interface ForbiddenSystemRoleError {
  code: "FORBIDDEN_SYSTEM_ROLE";
  message: string;
}

export interface NotFoundError {
  code: "NOT_FOUND";
  message: string;
}

export interface InvalidActionError {
  code: "INVALID_ACTION";
  message: string;
}

export interface TenantMismatchError {
  code: "TENANT_MISMATCH";
  message: string;
}

// Union used by callers to discriminate on `.code`.
export type AssignmentError =
  | ForbiddenSystemRoleError
  | NotFoundError
  | InvalidActionError
  | TenantMismatchError;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Checks whether `roleId` is a system role within `tenantId`.
 * Returns the `is_system` flag, or undefined if the role is not found.
 */
async function fetchRoleIsSystem(
  client: PoolClient,
  tenantId: string,
  roleId: string
): Promise<boolean | undefined> {
  const { rows } = await client.query<{ is_system: boolean }>(
    `SELECT is_system FROM roles WHERE tenant_id = $1 AND id = $2`,
    [tenantId, roleId]
  );
  return rows[0]?.is_system;
}

// ─── 1. assignGlobalPermission ────────────────────────────────────────────────

/**
 * Grants a global permission (from the platform `permissions` table) to a role
 * by inserting into `role_permissions` with `permission_id` set and
 * `override_id` NULL.
 *
 * Rejects if the target role has `is_system = TRUE` (system roles cannot be
 * modified programmatically).
 *
 * Schema note — role_permissions XOR constraint:
 *   CONSTRAINT exactly_one_permission_source CHECK (
 *       (permission_id IS NOT NULL AND override_id IS NULL) OR
 *       (permission_id IS NULL     AND override_id IS NOT NULL)
 *   )
 * This function satisfies it by always inserting `override_id = NULL`.
 *
 * @param client       - PoolClient from withTenantContext.
 * @param tenantId     - The tenant UUID.
 * @param roleId       - UUID of the role to receive the permission.
 * @param permissionId - UUID from the global `permissions` table.
 * @param actorUserId  - UUID of the session user performing this action.
 * @returns undefined on success, or a typed error.
 */
export async function assignGlobalPermission(
  client: PoolClient,
  tenantId: string,
  roleId: string,
  permissionId: string,
  actorUserId: string
): Promise<ForbiddenSystemRoleError | NotFoundError | undefined> {
  const isSystem = await fetchRoleIsSystem(client, tenantId, roleId);

  if (isSystem === undefined) {
    return {
      code: "NOT_FOUND",
      message: `Role '${roleId}' not found in tenant '${tenantId}'.`,
    };
  }

  if (isSystem) {
    return {
      code: "FORBIDDEN_SYSTEM_ROLE",
      message: `Role '${roleId}' is a system role and cannot be modified.`,
    };
  }

  await client.query(
    `INSERT INTO role_permissions (tenant_id, role_id, permission_id, override_id)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT DO NOTHING`,
    [tenantId, roleId, permissionId]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "permission.granted",
    entityType: "role",
    entityId: roleId,
    oldState: null,
    newState: null,
    context: { permissionId },
  });

  return undefined;
}

// ─── 2. revokeGlobalPermission ────────────────────────────────────────────────

/**
 * Revokes a global permission from a role by deleting the matching
 * `role_permissions` row (the one where `permission_id` matches and
 * `override_id` is NULL).
 *
 * Rejects if the target role has `is_system = TRUE` (system roles cannot be
 * modified programmatically).
 *
 * @param client       - PoolClient from withTenantContext.
 * @param tenantId     - The tenant UUID.
 * @param roleId       - UUID of the role to revoke from.
 * @param permissionId - UUID of the global permission to revoke.
 * @param actorUserId  - UUID of the session user performing this action.
 * @returns undefined on success, or a typed error.
 */
export async function revokeGlobalPermission(
  client: PoolClient,
  tenantId: string,
  roleId: string,
  permissionId: string,
  actorUserId: string
): Promise<ForbiddenSystemRoleError | NotFoundError | undefined> {
  // Guard: system role check.
  const isSystem = await fetchRoleIsSystem(client, tenantId, roleId);

  if (isSystem === undefined) {
    return {
      code: "NOT_FOUND",
      message: `Role '${roleId}' not found in tenant '${tenantId}'.`,
    };
  }

  if (isSystem) {
    return {
      code: "FORBIDDEN_SYSTEM_ROLE",
      message: `Role '${roleId}' is a system role and cannot be modified.`,
    };
  }

  await client.query(
    `DELETE FROM role_permissions
      WHERE tenant_id     = $1
        AND role_id       = $2
        AND permission_id = $3
        AND override_id   IS NULL`,
    [tenantId, roleId, permissionId]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "permission.revoked",
    entityType: "role",
    entityId: roleId,
    oldState: null,
    newState: null,
    context: { permissionId },
  });

  return undefined;
}

// ─── 3. assignPermissionOverride ─────────────────────────────────────────────

/**
 * Grants a tenant-scoped permission override (from `tenant_permission_overrides`)
 * to a role by inserting into `role_permissions` with `override_id` set and
 * `permission_id` NULL.
 *
 * Security: explicitly verifies that the override actually belongs to this
 * tenant before inserting. Although RLS policies on `tenant_permission_overrides`
 * enforce tenant isolation at the DB layer, we perform an explicit ownership
 * check here to prevent IDOR — a caller must not be able to assign another
 * tenant's override even if they can guess its UUID.
 *
 * Rejects if the target role has `is_system = TRUE`.
 *
 * @param client      - PoolClient from withTenantContext.
 * @param tenantId    - The tenant UUID.
 * @param roleId      - UUID of the role to receive the override.
 * @param overrideId  - UUID from `tenant_permission_overrides` for this tenant.
 * @param actorUserId - UUID of the session user performing this action.
 * @returns undefined on success, or a typed error.
 */
export async function assignPermissionOverride(
  client: PoolClient,
  tenantId: string,
  roleId: string,
  overrideId: string,
  actorUserId: string
): Promise<ForbiddenSystemRoleError | NotFoundError | TenantMismatchError | undefined> {
  // Guard: system role check.
  const isSystem = await fetchRoleIsSystem(client, tenantId, roleId);

  if (isSystem === undefined) {
    return {
      code: "NOT_FOUND",
      message: `Role '${roleId}' not found in tenant '${tenantId}'.`,
    };
  }

  if (isSystem) {
    return {
      code: "FORBIDDEN_SYSTEM_ROLE",
      message: `Role '${roleId}' is a system role and cannot be modified.`,
    };
  }

  // Security: confirm the override belongs to this tenant.
  // This is an explicit IDOR guard — we do not rely solely on RLS.
  const { rows: overrideRows } = await client.query<{ id: string }>(
    `SELECT id FROM tenant_permission_overrides
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, overrideId]
  );

  if (overrideRows.length === 0) {
    // Either the override does not exist, or it belongs to a different tenant.
    // Return TenantMismatch rather than NotFound to avoid leaking existence of
    // cross-tenant UUIDs.
    return {
      code: "TENANT_MISMATCH",
      message: `Override '${overrideId}' does not exist or does not belong to tenant '${tenantId}'.`,
    };
  }

  await client.query(
    `INSERT INTO role_permissions (tenant_id, role_id, permission_id, override_id)
     VALUES ($1, $2, NULL, $3)
     ON CONFLICT DO NOTHING`,
    [tenantId, roleId, overrideId]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "permission_override.granted",
    entityType: "role",
    entityId: roleId,
    oldState: null,
    newState: null,
    context: { overrideId },
  });

  return undefined;
}

// ─── 4. revokePermissionOverride ─────────────────────────────────────────────

/**
 * Revokes a tenant-scoped permission override from a role by deleting the
 * matching `role_permissions` row (where `override_id` matches and
 * `permission_id` is NULL).
 *
 * Rejects if the target role has `is_system = TRUE` (system roles cannot be
 * modified programmatically).
 *
 * @param client      - PoolClient from withTenantContext.
 * @param tenantId    - The tenant UUID.
 * @param roleId      - UUID of the role to revoke from.
 * @param overrideId  - UUID of the tenant_permission_overrides entry.
 * @param actorUserId - UUID of the session user performing this action.
 * @returns undefined on success, or a typed error.
 */
export async function revokePermissionOverride(
  client: PoolClient,
  tenantId: string,
  roleId: string,
  overrideId: string,
  actorUserId: string
): Promise<ForbiddenSystemRoleError | NotFoundError | undefined> {
  // Guard: system role check.
  const isSystem = await fetchRoleIsSystem(client, tenantId, roleId);

  if (isSystem === undefined) {
    return {
      code: "NOT_FOUND",
      message: `Role '${roleId}' not found in tenant '${tenantId}'.`,
    };
  }

  if (isSystem) {
    return {
      code: "FORBIDDEN_SYSTEM_ROLE",
      message: `Role '${roleId}' is a system role and cannot be modified.`,
    };
  }

  await client.query(
    `DELETE FROM role_permissions
      WHERE tenant_id   = $1
        AND role_id     = $2
        AND override_id = $3
        AND permission_id IS NULL`,
    [tenantId, roleId, overrideId]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "permission_override.revoked",
    entityType: "role",
    entityId: roleId,
    oldState: null,
    newState: null,
    context: { overrideId },
  });

  return undefined;
}

// ─── 5. grantEntityTypePermission ────────────────────────────────────────────

/**
 * Grants a fine-grained entity-type action to a role by inserting into
 * `role_entity_type_permissions`.
 *
 * Validates `action` against the schema's CHECK constraint values before
 * issuing any query:
 *   CHECK (action IN ('create', 'read', 'update', 'delete', 'manage'))
 *
 * Security: explicitly verifies that `entityTypeId` belongs to this tenant
 * before inserting. Mirrors the IDOR guard in assignPermissionOverride.
 *
 * Rejects if the target role has `is_system = TRUE`.
 *
 * @param client       - PoolClient from withTenantContext.
 * @param tenantId     - The tenant UUID.
 * @param roleId       - UUID of the role to receive the grant.
 * @param entityTypeId - UUID of the tenant-defined entity type.
 * @param action       - One of: 'create', 'read', 'update', 'delete', 'manage'.
 * @param actorUserId  - UUID of the session user performing this action.
 * @returns undefined on success, or a typed error.
 */
export async function grantEntityTypePermission(
  client: PoolClient,
  tenantId: string,
  roleId: string,
  entityTypeId: string,
  action: EntityAction,
  actorUserId: string
): Promise<
  | InvalidActionError
  | ForbiddenSystemRoleError
  | NotFoundError
  | TenantMismatchError
  | undefined
> {
  // Validate action against the schema's CHECK constraint.
  // We do this in application code so we surface a typed error rather than
  // letting Postgres raise an unchecked constraint violation.
  if (!ALLOWED_ENTITY_ACTIONS.has(action)) {
    return {
      code: "INVALID_ACTION",
      message: `Invalid entity action '${action}'. Must be one of: ${[...ALLOWED_ENTITY_ACTIONS].join(", ")}.`,
    };
  }

  // Guard: system role check.
  const isSystem = await fetchRoleIsSystem(client, tenantId, roleId);

  if (isSystem === undefined) {
    return {
      code: "NOT_FOUND",
      message: `Role '${roleId}' not found in tenant '${tenantId}'.`,
    };
  }

  if (isSystem) {
    return {
      code: "FORBIDDEN_SYSTEM_ROLE",
      message: `Role '${roleId}' is a system role and cannot be modified.`,
    };
  }

  // Security: confirm entity_type_id belongs to this tenant.
  // Explicit IDOR guard — we do not rely solely on RLS.
  const { rows: entityTypeRows } = await client.query<{ id: string }>(
    `SELECT id FROM entity_types
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, entityTypeId]
  );

  if (entityTypeRows.length === 0) {
    // Either the entity type does not exist, or it belongs to a different tenant.
    // Return TenantMismatch rather than NotFound to avoid leaking cross-tenant UUIDs.
    return {
      code: "TENANT_MISMATCH",
      message: `Entity type '${entityTypeId}' does not exist or does not belong to tenant '${tenantId}'.`,
    };
  }

  await client.query(
    `INSERT INTO role_entity_type_permissions (tenant_id, role_id, entity_type_id, action)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [tenantId, roleId, entityTypeId, action]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "entity_permission.granted",
    entityType: "role",
    entityId: roleId,
    oldState: null,
    newState: null,
    context: { entityTypeId, action },
  });

  return undefined;
}

// ─── 6. revokeEntityTypePermission ───────────────────────────────────────────

/**
 * Revokes a fine-grained entity-type action from a role by deleting the
 * matching `role_entity_type_permissions` row.
 *
 * Validates `action` before issuing any query.
 * Rejects if the target role has `is_system = TRUE`.
 *
 * @param client       - PoolClient from withTenantContext.
 * @param tenantId     - The tenant UUID.
 * @param roleId       - UUID of the role to revoke from.
 * @param entityTypeId - UUID of the tenant-defined entity type.
 * @param action       - One of: 'create', 'read', 'update', 'delete', 'manage'.
 * @param actorUserId  - UUID of the session user performing this action.
 * @returns undefined on success, or a typed error.
 */
export async function revokeEntityTypePermission(
  client: PoolClient,
  tenantId: string,
  roleId: string,
  entityTypeId: string,
  action: EntityAction,
  actorUserId: string
): Promise<InvalidActionError | ForbiddenSystemRoleError | NotFoundError | undefined> {
  if (!ALLOWED_ENTITY_ACTIONS.has(action)) {
    return {
      code: "INVALID_ACTION",
      message: `Invalid entity action '${action}'. Must be one of: ${[...ALLOWED_ENTITY_ACTIONS].join(", ")}.`,
    };
  }

  // Guard: system role check.
  const isSystem = await fetchRoleIsSystem(client, tenantId, roleId);

  if (isSystem === undefined) {
    return {
      code: "NOT_FOUND",
      message: `Role '${roleId}' not found in tenant '${tenantId}'.`,
    };
  }

  if (isSystem) {
    return {
      code: "FORBIDDEN_SYSTEM_ROLE",
      message: `Role '${roleId}' is a system role and cannot be modified.`,
    };
  }

  await client.query(
    `DELETE FROM role_entity_type_permissions
      WHERE tenant_id     = $1
        AND role_id       = $2
        AND entity_type_id = $3
        AND action        = $4`,
    [tenantId, roleId, entityTypeId, action]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "entity_permission.revoked",
    entityType: "role",
    entityId: roleId,
    oldState: null,
    newState: null,
    context: { entityTypeId, action },
  });

  return undefined;
}

// ─── 7. assignUserRole ────────────────────────────────────────────────────────

/**
 * Assigns a role to a user within a tenant by inserting into `user_roles`.
 *
 * `assigned_by` is set to `actorUserId`. This is the canonical implementation
 * of the `assigned_by` requirement from the Round 5 spec.
 *
 * ⚠️  REFACTOR POINTER — lib/users/users.ts:inviteUser (line ~153)
 *     `inviteUser` currently contains its own inline INSERT INTO user_roles
 *     that omits the `assigned_by` column. Once this function is available,
 *     `inviteUser` should be refactored to call `assignUserRole` instead of
 *     issuing that INSERT directly. This is a cross-file change intentionally
 *     deferred by the team; do not silently merge it here.
 *
 * Schema — user_roles DDL:
 *   CREATE TABLE user_roles (
 *       tenant_id   UUID NOT NULL,
 *       user_id     UUID NOT NULL,
 *       role_id     UUID NOT NULL,
 *       assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 *       assigned_by UUID,            -- NULL = system-assigned
 *       PRIMARY KEY (tenant_id, user_id, role_id),
 *       ...
 *   );
 *
 * @param client      - PoolClient from withTenantContext.
 * @param tenantId    - The tenant UUID.
 * @param userId      - UUID of the user to receive the role.
 * @param roleId      - UUID of the role to assign.
 * @param actorUserId - UUID of the session user performing the assignment.
 *                      Written to `assigned_by`.
 * @returns undefined on success.
 */
export async function assignUserRole(
  client: PoolClient,
  tenantId: string,
  userId: string,
  roleId: string,
  actorUserId: string
): Promise<undefined> {
  await client.query(
    `INSERT INTO user_roles (tenant_id, user_id, role_id, assigned_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
    [tenantId, userId, roleId, actorUserId]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "user_role.assigned",
    entityType: "user",
    entityId: userId,
    oldState: null,
    newState: null,
    context: { roleId, assignedBy: actorUserId },
  });

  return undefined;
}

// ─── 8. unassignUserRole ─────────────────────────────────────────────────────

/**
 * Removes a role from a user within a tenant by deleting the matching
 * `user_roles` row.
 *
 * @param client      - PoolClient from withTenantContext.
 * @param tenantId    - The tenant UUID.
 * @param userId      - UUID of the user to remove the role from.
 * @param roleId      - UUID of the role to unassign.
 * @param actorUserId - UUID of the session user performing the unassignment.
 * @returns undefined on success.
 */
export async function unassignUserRole(
  client: PoolClient,
  tenantId: string,
  userId: string,
  roleId: string,
  actorUserId: string
): Promise<undefined> {
  await client.query(
    `DELETE FROM user_roles
      WHERE tenant_id = $1
        AND user_id   = $2
        AND role_id   = $3`,
    [tenantId, userId, roleId]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "user_role.unassigned",
    entityType: "user",
    entityId: userId,
    oldState: null,
    newState: null,
    context: { roleId },
  });

  return undefined;
}
