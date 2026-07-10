/**
 * lib/roles/roles.ts
 *
 * CRUD layer for the `roles` table — Task 5.2 (Round 5, User Management).
 *
 * DESIGN CONTRACTS
 * ────────────────────────────────────────────────────────────────────────────
 * • All functions accept a PoolClient obtained externally via withTenantContext.
 *   They do NOT open their own connections or transactions. The caller owns the
 *   transaction lifecycle (BEGIN / COMMIT / ROLLBACK).
 *
 * • Errors for EXPECTED failure modes (e.g. role not found, forbidden operations)
 *   are returned as typed objects with a `code` property — never thrown as raw Errors.
 *
 * • writeAuditLog is called on the SAME client, inside the SAME transaction,
 *   immediately after every mutation query — before the function returns.
 *
 * OUT OF SCOPE (this file)
 * ────────────────────────────────────────────────────────────────────────────
 * • Authorization guards — Task 5.3 (requireTenantAdmin). Assume the caller is
 *   already authorized before invoking these functions.
 */

import type { PoolClient } from "pg";
import { writeAuditLog } from "@/lib/db/audit";
import type {
  RoleRow,
  CreateRoleParams,
  UpdateRoleParams,
  RoleResult,
  UpdateRoleResult,
  DeleteRoleResult,
} from "./types";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Computes which scalar fields changed between two role snapshots and returns
 * them as a plain object diff keyed by field name.
 *
 * This mirrors buildUserDiff in lib/users/users.ts. Keeping it file-local
 * maintains boundary separation.
 *
 * Returns undefined (no diff) if oldState equals newState.
 */
function buildRoleDiff(
  oldState: Record<string, unknown>,
  newState: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> | undefined {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const allKeys = new Set([
    ...Object.keys(oldState),
    ...Object.keys(newState),
  ]);

  for (const key of allKeys) {
    const from = oldState[key];
    const to = newState[key];

    const equal =
      from === to ||
      (typeof from === "object" &&
        from !== null &&
        typeof to === "object" &&
        to !== null &&
        JSON.stringify(from) === JSON.stringify(to));

    if (!equal) {
      diff[key] = { from, to };
    }
  }

  return Object.keys(diff).length > 0 ? diff : undefined;
}

/**
 * Serialises a RoleRow to a plain object suitable for audit log snapshots.
 */
function toAuditSnapshot(role: RoleRow): Record<string, unknown> {
  return { ...role };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a new role.
 * is_system defaults to FALSE — this function can never create a system role.
 *
 * @param client   - PoolClient from withTenantContext.
 * @param tenantId - The tenant UUID.
 * @param params   - { name, description? }
 * @returns The newly created RoleRow.
 */
export async function createRole(
  client: PoolClient,
  tenantId: string,
  params: CreateRoleParams
): Promise<RoleRow> {
  const { name, description } = params;

  // Insert the role row. is_system is explicitly set to FALSE.
  const { rows } = await client.query<RoleRow>(
    `INSERT INTO roles (tenant_id, name, description, is_system)
     VALUES ($1, $2, $3, FALSE)
     RETURNING tenant_id,
               id,
               name,
               description,
               is_system,
               created_at,
               updated_at`,
    [tenantId, name, description ?? null]
  );

  const role = rows[0];

  // Audit — same client, same transaction.
  await writeAuditLog(client, {
    tenantId,
    actorId: null, // wire in actorId when auth layer is added
    action: "role.created",
    entityType: "role",
    entityId: role.id,
    oldState: null,
    newState: toAuditSnapshot(role),
    context: {
      name,
      description: description ?? null,
    },
  });

  return role;
}

/**
 * Updates a role's fields (name and/or description).
 *
 * Only touches provided fields. If is_system is TRUE, returns a typed error
 * without mutating.
 *
 * @param client   - PoolClient from withTenantContext.
 * @param tenantId - The tenant UUID.
 * @param roleId   - UUID of the role to update.
 * @param params   - Partial<{ name, description }>
 * @returns The updated RoleRow, a ForbiddenSystemRoleError, or NotFoundError.
 */
export async function updateRole(
  client: PoolClient,
  tenantId: string,
  roleId: string,
  params: UpdateRoleParams
): Promise<UpdateRoleResult> {
  // 1. Capture pre-mutation state and check constraints.
  const existing = await fetchRoleRow(client, tenantId, roleId);
  
  if (!existing) {
    return {
      code: "NOT_FOUND",
      message: `Role '${roleId}' not found in tenant '${tenantId}'.`,
    };
  }

  if (existing.is_system) {
    return {
      code: "FORBIDDEN_SYSTEM_ROLE",
      message: `Role '${roleId}' is a system role and cannot be modified.`,
    };
  }

  const { name, description } = params;
  
  // Build the SET clause dynamically — only include provided fields.
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    values.push(name);
  }
  if (description !== undefined) {
    setClauses.push(`description = $${paramIndex++}`);
    values.push(description);
  }

  // No-op if nothing was provided.
  if (setClauses.length === 0) {
    return existing;
  }

  // Always bump updated_at.
  setClauses.push("updated_at = now()");

  // Append the WHERE parameters.
  values.push(tenantId);
  values.push(roleId);

  const tenantParam = paramIndex;
  const roleParam = paramIndex + 1;

  // 2. Issue the UPDATE.
  const { rows } = await client.query<RoleRow>(
    `UPDATE roles
        SET ${setClauses.join(", ")}
      WHERE tenant_id = $${tenantParam}
        AND id        = $${roleParam}
      RETURNING tenant_id,
                id,
                name,
                description,
                is_system,
                created_at,
                updated_at`,
    values
  );

  const updated = rows[0];
  if (!updated) {
    return {
      code: "NOT_FOUND",
      message: `Role '${roleId}' not found in tenant '${tenantId}'.`,
    };
  }

  // 3. Compute the diff of only the changed fields.
  const oldSnapshot = toAuditSnapshot(existing);
  const newSnapshot = toAuditSnapshot(updated);
  const diff = buildRoleDiff(oldSnapshot, newSnapshot);

  // 4. Audit — same client, same transaction.
  await writeAuditLog(client, {
    tenantId,
    actorId: null, // wire in actorId when auth layer is added
    action: "role.updated",
    entityType: "role",
    entityId: roleId,
    oldState: oldSnapshot,
    newState: newSnapshot,
    context: {
      diff: diff ?? {},
    },
  });

  return updated;
}

/**
 * Deletes a role.
 *
 * Checks if the role is assigned to any users before deleting.
 * If is_system is TRUE, returns a typed error.
 *
 * @param client   - PoolClient from withTenantContext.
 * @param tenantId - The tenant UUID.
 * @param roleId   - UUID of the role to delete.
 * @returns undefined on success, or a typed error.
 */
export async function deleteRole(
  client: PoolClient,
  tenantId: string,
  roleId: string
): Promise<DeleteRoleResult> {
  // 1. Capture pre-mutation state and check constraints.
  const existing = await fetchRoleRow(client, tenantId, roleId);
  
  if (!existing) {
    return {
      code: "NOT_FOUND",
      message: `Role '${roleId}' not found in tenant '${tenantId}'.`,
    };
  }

  if (existing.is_system) {
    return {
      code: "FORBIDDEN_SYSTEM_ROLE",
      message: `Role '${roleId}' is a system role and cannot be deleted.`,
    };
  }

  // 2. Check for existing user_roles referencing this role.
  const { rows: userRoleRows } = await client.query(
    `SELECT 1 FROM user_roles WHERE tenant_id = $1 AND role_id = $2 LIMIT 1`,
    [tenantId, roleId]
  );

  if (userRoleRows.length > 0) {
    return {
      code: "ROLE_IN_USE",
      message: `Role '${roleId}' is assigned to one or more users and cannot be deleted.`,
    };
  }

  const oldSnapshot = toAuditSnapshot(existing);

  // 3. Delete the role.
  const { rowCount } = await client.query(
    `DELETE FROM roles WHERE tenant_id = $1 AND id = $2`,
    [tenantId, roleId]
  );

  if (rowCount === 0) {
    return {
      code: "NOT_FOUND",
      message: `Role '${roleId}' not found in tenant '${tenantId}'.`,
    };
  }

  // 4. Audit — same client, same transaction.
  await writeAuditLog(client, {
    tenantId,
    actorId: null, // wire in actorId when auth layer is added
    action: "role.deleted",
    entityType: "role",
    entityId: roleId,
    oldState: oldSnapshot,
    newState: null,
    context: {},
  });
  
  return undefined;
}

/**
 * Lists all roles in a tenant, including system roles.
 *
 * @param client     - PoolClient from withTenantContext.
 * @param tenantId   - The tenant UUID.
 * @param pagination - Optional { limit?: number; offset?: number }
 * @returns Paginated result or VALIDATION_ERROR.
 */
export async function listRoles(
  client: PoolClient,
  tenantId: string,
  pagination?: { limit?: number; offset?: number }
): Promise<
  | { items: RoleRow[]; total: number; limit: number; offset: number }
  | { code: "VALIDATION_ERROR"; message: string }
> {
  const limitVal = pagination?.limit !== undefined ? pagination.limit : 50;
  const offsetVal = pagination?.offset !== undefined ? pagination.offset : 0;

  if (!Number.isInteger(limitVal) || limitVal < 0) {
    return {
      code: "VALIDATION_ERROR",
      message: "limit must be a non-negative integer",
    };
  }
  if (!Number.isInteger(offsetVal) || offsetVal < 0) {
    return {
      code: "VALIDATION_ERROR",
      message: "offset must be a non-negative integer",
    };
  }

  const finalLimit = Math.min(limitVal, 200);

  // 1. COUNT(*) query over the same WHERE clause
  const countResult = await client.query<{ count: string }>(
    `SELECT count(*) FROM roles WHERE tenant_id = $1`,
    [tenantId]
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // 2. Fetch paginated rows
  const { rows } = await client.query<RoleRow>(
    `SELECT tenant_id,
            id,
            name,
            description,
            is_system,
            created_at,
            updated_at
       FROM roles
      WHERE tenant_id = $1
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3`,
    [tenantId, finalLimit, offsetVal]
  );

  return {
    items: rows,
    total,
    limit: finalLimit,
    offset: offsetVal,
  };
}

/**
 * Retrieves a single role by (tenantId, roleId).
 *
 * @param client   - PoolClient from withTenantContext.
 * @param tenantId - The tenant UUID.
 * @param roleId   - UUID of the role to retrieve.
 * @returns RoleRow on success, NotFoundError if the role does not exist.
 */
export async function getRole(
  client: PoolClient,
  tenantId: string,
  roleId: string
): Promise<RoleResult> {
  const role = await fetchRoleRow(client, tenantId, roleId);

  if (!role) {
    return {
      code: "NOT_FOUND",
      message: `Role '${roleId}' not found in tenant '${tenantId}'.`,
    };
  }

  return role;
}

// ─── Private query helper ────────────────────────────────────────────────────

/**
 * Fetches a single role row or returns undefined if not found.
 * Internal only — callers must own the transaction context.
 */
async function fetchRoleRow(
  client: PoolClient,
  tenantId: string,
  roleId: string
): Promise<RoleRow | undefined> {
  const { rows } = await client.query<RoleRow>(
    `SELECT tenant_id,
            id,
            name,
            description,
            is_system,
            created_at,
            updated_at
       FROM roles
      WHERE tenant_id = $1
        AND id        = $2`,
    [tenantId, roleId]
  );
  return rows[0];
}
