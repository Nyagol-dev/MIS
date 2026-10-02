/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * lib/authz/seed.ts
 *
 * PERMISSION CATALOGUE & SYSTEM ROLE SEEDER
 * ─────────────────────────────────────────────────────────────────────────────
 * Syncs the code-defined PERMISSION_CATALOGUE and SYSTEM_ROLES into the
 * database. Called during migration or via a management script.
 *
 * DESIGN:
 * - Uses UPSERT (ON CONFLICT) so it is safe to run repeatedly.
 * - Runs on the admin pool (mis_admin) since it writes to global tables
 *   (permissions) and tenant-scoped tables (roles, role_permissions).
 * - System roles are seeded per-tenant; this function requires a tenantId.
 */

import type { PoolClient } from 'pg';
import {
  PERMISSION_CATALOGUE,
  SYSTEM_ROLES,
  type SystemRoleDefinition,
  type PermissionScope,
} from './catalogue';

/**
 * Syncs the code-defined permission catalogue into the `permissions` table.
 * Safe to run repeatedly via UPSERT.
 *
 * @param client - A PoolClient (admin or tenant-scoped, depending on usage)
 */
export async function seedPermissionCatalogue(
  client: PoolClient,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const entry of PERMISSION_CATALOGUE) {
    const result = await client.query(
      `INSERT INTO permissions (codename, description, resource, action)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (codename) DO UPDATE
         SET description = EXCLUDED.description,
             resource = EXCLUDED.resource,
             action = EXCLUDED.action
       RETURNING (xmax = 0) AS is_insert`,
      [
        entry.codename,
        entry.description,
        entry.resource,
        // Map extended actions to the CHECK-constrained set
        mapActionForDb(entry.action),
      ],
    );
    if (result.rows[0]?.is_insert) {
      inserted++;
    } else {
      updated++;
    }
  }

  return { inserted, updated };
}

/**
 * Seeds all system roles and their permission assignments for a tenant.
 * Safe to run repeatedly — roles are matched by (tenant_id, name) and
 * permissions are matched by (tenant_id, role_id, permission_id).
 *
 * @param client   - Tenant-scoped PoolClient from withTenantContext
 * @param tenantId - The tenant UUID
 */
export async function seedSystemRoles(
  client: PoolClient,
  tenantId: string,
): Promise<{ rolesCreated: number; permissionsAssigned: number }> {
  let rolesCreated = 0;
  let permissionsAssigned = 0;

  for (const roleDef of SYSTEM_ROLES) {
    // Upsert the role row
    const roleResult = await client.query<{ id: string; is_new: boolean }>(
      `INSERT INTO roles (tenant_id, name, description, is_system)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (tenant_id, name) DO UPDATE
         SET description = EXCLUDED.description,
             is_system = TRUE,
             updated_at = now()
       RETURNING id, (xmax = 0) AS is_new`,
      [tenantId, roleDef.name, roleDef.description],
    );

    const roleId = roleResult.rows[0].id;
    if (roleResult.rows[0].is_new) rolesCreated++;

    // Assign permissions to the role
    for (const perm of roleDef.permissions) {
      const assigned = await assignPermissionToRole(
        client,
        tenantId,
        roleId,
        perm.codename,
        perm.scope,
      );
      if (assigned) permissionsAssigned++;
    }
  }

  return { rolesCreated, permissionsAssigned };
}

/**
 * Assigns a permission to a role by codename, with scope.
 * Looks up the permission ID from the global permissions table.
 *
 * @returns true if a new assignment was created, false if it already existed
 */
async function assignPermissionToRole(
  client: PoolClient,
  tenantId: string,
  roleId: string,
  codename: string,
  scope: PermissionScope,
): Promise<boolean> {
  // Look up the permission ID
  const permResult = await client.query<{ id: string }>(
    `SELECT id FROM permissions WHERE codename = $1`,
    [codename],
  );

  if (permResult.rows.length === 0) {
    // Permission not yet seeded; skip silently
    // (this can happen if seedPermissionCatalogue hasn't run yet)
    console.warn(`[authz:seed] Permission '${codename}' not found in DB — skipping assignment.`);
    return false;
  }

  const permissionId = permResult.rows[0].id;

  const result = await client.query(
    `INSERT INTO role_permissions (tenant_id, role_id, permission_id, override_id, scope)
     VALUES ($1, $2, $3, NULL, $4)
     ON CONFLICT ON CONSTRAINT idx_role_permissions_global
       WHERE permission_id IS NOT NULL
       DO UPDATE SET scope = EXCLUDED.scope
     RETURNING (xmax = 0) AS is_insert`,
    [tenantId, roleId, permissionId, scope],
  );

  return result.rows[0]?.is_insert ?? false;
}

/**
 * Maps extended action names (verify, submit, approve, dispense, administer)
 * to the DB CHECK-constrained set (create, read, update, delete, manage).
 * Extended actions are stored as 'manage' in the DB permissions table but
 * tracked by their full codename in role_permissions.
 */
function mapActionForDb(action: string): string {
  const extendedActions = new Set([
    'verify', 'submit', 'approve', 'dispense', 'administer',
  ]);
  if (extendedActions.has(action)) return 'manage';
  return action;
}

/**
 * Full seed: catalogue + system roles for a tenant.
 * Runs both steps in order.
 *
 * @param client   - PoolClient (should have admin-level access for permissions table)
 * @param tenantId - The tenant to seed system roles into
 */
export async function seedAll(
  client: PoolClient,
  tenantId: string,
): Promise<{
  catalogue: { inserted: number; updated: number };
  roles: { rolesCreated: number; permissionsAssigned: number };
}> {
  const catalogue = await seedPermissionCatalogue(client);
  const roles = await seedSystemRoles(client, tenantId);
  return { catalogue, roles };
}
