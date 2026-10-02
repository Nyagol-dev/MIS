/**
 * lib/authz/safeguards.ts
 *
 * AUTHORIZATION SAFEGUARDS (§4.3, §4.8)
 * ─────────────────────────────────────────────────────────────────────────────
 * Hard rules that prevent privilege escalation and ensure continuity:
 *
 * 1. A user can never grant a permission or scope they do not themselves hold.
 * 2. A user cannot edit their own roles.
 * 3. At least two active Hospital Admins required — block deactivating the last one.
 * 4. Changes to admin-level roles require a second admin's approval (two-person rule).
 *
 * All safeguard violations are returned as typed errors, never thrown as raw
 * Errors. The caller converts them to HTTP 403/409 responses.
 */

import type { PoolClient } from 'pg';
import type { UserAuthzContext } from './types';
import type { PermissionScope } from './catalogue';

// ─── Error types ──────────────────────────────────────────────────────────────

export interface EscalationError {
  code: 'ESCALATION_PREVENTED';
  message: string;
  details: { codename: string; requestedScope: PermissionScope; actorScope: PermissionScope | null };
}

export interface SelfEditError {
  code: 'SELF_EDIT_PREVENTED';
  message: string;
}

export interface LastAdminError {
  code: 'LAST_ADMIN_PREVENTED';
  message: string;
}

export interface TwoPersonRuleError {
  code: 'TWO_PERSON_RULE';
  message: string;
}

export type SafeguardError =
  | EscalationError
  | SelfEditError
  | LastAdminError
  | TwoPersonRuleError;

// ─── Scope hierarchy ──────────────────────────────────────────────────────────

const SCOPE_RANK: Record<PermissionScope, number> = {
  own: 1,
  assigned: 2,
  department: 3,
  hospital: 4,
};

// ─── Safeguard checks ─────────────────────────────────────────────────────────

/**
 * RULE 1: Escalation prevention.
 * Checks that the actor holds every permission being granted, at an equal or
 * wider scope than what they are granting.
 *
 * @param actorAuthz   - The granting user's authorization context
 * @param permissions  - List of { codename, scope } to be granted
 * @returns undefined if all checks pass, or an EscalationError
 */
export function checkEscalation(
  actorAuthz: UserAuthzContext,
  permissions: { codename: string; scope: PermissionScope }[],
): EscalationError | undefined {
  for (const perm of permissions) {
    const actorScope = actorAuthz.grants.get(perm.codename);

    // Actor doesn't hold this permission at all
    if (!actorScope) {
      return {
        code: 'ESCALATION_PREVENTED',
        message: `Cannot grant '${perm.codename}': you do not hold this permission.`,
        details: { codename: perm.codename, requestedScope: perm.scope, actorScope: null },
      };
    }

    // Actor holds it but at a narrower scope than what they're trying to grant
    if (SCOPE_RANK[actorScope] < SCOPE_RANK[perm.scope]) {
      return {
        code: 'ESCALATION_PREVENTED',
        message: `Cannot grant '${perm.codename}' at scope '${perm.scope}': your scope is '${actorScope}'.`,
        details: { codename: perm.codename, requestedScope: perm.scope, actorScope },
      };
    }
  }

  return undefined;
}

/**
 * RULE 2: Self-edit prevention.
 * A user cannot edit their own roles.
 *
 * @param actorUserId - The user performing the edit
 * @param targetUserId - The user whose roles are being edited
 */
export function checkSelfEdit(
  actorUserId: string,
  targetUserId: string,
): SelfEditError | undefined {
  if (actorUserId === targetUserId) {
    return {
      code: 'SELF_EDIT_PREVENTED',
      message: 'You cannot modify your own role assignments.',
    };
  }
  return undefined;
}

/**
 * RULE 3: Last-admin protection.
 * Ensures at least two active Hospital Admins exist before allowing
 * deactivation of an admin or removal of admin role.
 *
 * Must be called inside a withTenantContext transaction.
 *
 * @param client        - Tenant-scoped PoolClient
 * @param tenantId      - The tenant UUID
 * @param targetUserId  - The user being deactivated or having admin role removed
 */
export async function checkLastAdmin(
  client: PoolClient,
  tenantId: string,
  targetUserId: string,
): Promise<LastAdminError | undefined> {
  // Count active users who hold the 'user:manage' or 'hospital:manage' permission
  // via their role assignments, excluding the target user.
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(DISTINCT ur.user_id) AS count
       FROM user_roles ur
       JOIN role_permissions rp
         ON rp.tenant_id = ur.tenant_id AND rp.role_id = ur.role_id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       LEFT JOIN tenant_permission_overrides tpo
         ON tpo.tenant_id = rp.tenant_id AND tpo.id = rp.override_id
       JOIN users u ON u.tenant_id = ur.tenant_id AND u.id = ur.user_id
      WHERE ur.tenant_id = $1
        AND ur.user_id <> $2
        AND u.is_active = TRUE
        AND COALESCE(p.codename, tpo.codename) IN ('user:manage', 'hospital:manage')`,
    [tenantId, targetUserId],
  );

  const remainingAdmins = parseInt(result.rows[0].count, 10);

  if (remainingAdmins < 1) {
    return {
      code: 'LAST_ADMIN_PREVENTED',
      message: 'Cannot remove the last Hospital Administrator. At least two active admins are required.',
    };
  }

  return undefined;
}

/**
 * RULE 4: Two-person rule for admin-level changes.
 * Changes to roles that include admin-level permissions require a
 * different admin's approval. In Phase 1 we enforce that the actor
 * is not the same as the target.
 *
 * Full approval workflow (pending queue + second admin confirmation)
 * is deferred to a later sub-step; for now this is effectively
 * the same as self-edit prevention for admin roles.
 *
 * @param actorUserId   - The admin performing the change
 * @param targetUserId  - The user whose admin role is being changed
 * @param isAdminLevelChange - Whether the role change involves admin-level permissions
 */
export function checkTwoPersonRule(
  actorUserId: string,
  targetUserId: string,
  isAdminLevelChange: boolean,
): TwoPersonRuleError | undefined {
  if (!isAdminLevelChange) return undefined;

  if (actorUserId === targetUserId) {
    return {
      code: 'TWO_PERSON_RULE',
      message: 'Admin-level role changes require a different administrator.',
    };
  }

  return undefined;
}

/**
 * Determines if a set of permissions includes admin-level access.
 * Used by checkTwoPersonRule to decide if the rule applies.
 */
export function containsAdminPermissions(
  codenames: string[],
): boolean {
  const adminCodenames = new Set([
    'user:manage',
    'tenant:admin',
    'hospital:manage',
    'role:manage',
    'role:assign',
    'staff:create',
    'staff:deactivate',
    'module:manage',
    'integration:manage',
  ]);

  return codenames.some((c) => adminCodenames.has(c));
}
