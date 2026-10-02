/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * lib/authz/can.ts
 *
 * PURE AUTHORIZATION CHECK FUNCTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 * These functions evaluate permissions against a pre-loaded UserAuthzContext.
 * They have NO database dependencies and can be safely imported in tests,
 * Edge Runtime, or any other context.
 *
 * The DB-touching `loadUserAuthz()` lives in `check.ts` and imports these.
 */

import { CATALOGUE_MAP, type PermissionScope } from './catalogue';
import type { UserAuthzContext, AuthzResourceContext } from './types';

// Re-export types so callers get everything from one import
export type { UserAuthzContext, AuthzResourceContext } from './types';

// ─── Scope hierarchy ──────────────────────────────────────────────────────────

const SCOPE_RANK: Record<PermissionScope, number> = {
  own: 1,
  assigned: 2,
  department: 3,
  hospital: 4,
};

/**
 * Returns true if `granted` scope is at least as wide as `required` scope.
 */
export function scopeCovers(granted: PermissionScope, required: PermissionScope): boolean {
  return SCOPE_RANK[granted] >= SCOPE_RANK[required];
}

// ─── Authorization checks ─────────────────────────────────────────────────────

/**
 * Checks if the user is authorized for the given permission and context.
 * Returns true/false without throwing.
 */
export function can(
  authz: UserAuthzContext,
  codename: string,
  context?: AuthzResourceContext,
): boolean {
  const grantedScope = authz.grants.get(codename);
  if (!grantedScope) return false;

  // Hospital scope → always allowed
  if (grantedScope === 'hospital') return true;

  // Department scope → resource must be in one of the user's departments
  if (grantedScope === 'department') {
    if (!context?.departmentId) return false;
    return (
      authz.departmentIds.has(context.departmentId) ||
      authz.headOfDepartmentIds.has(context.departmentId)
    );
  }

  // Own scope → resource must be owned by this user
  if (grantedScope === 'own') {
    if (!context?.ownerId) return false;
    return context.ownerId === authz.userId;
  }

  // Assigned scope → check care-team relationship (Phase 2+, currently same as department)
  if (grantedScope === 'assigned') {
    // TODO: Phase 2 — check care_team_assignments for patientId
    // For now, fall back to department check
    if (context?.ownerId && context.ownerId === authz.userId) return true;
    if (!context?.departmentId) return false;
    return (
      authz.departmentIds.has(context.departmentId) ||
      authz.headOfDepartmentIds.has(context.departmentId)
    );
  }

  return false;
}

/**
 * Checks that the user has at least one of the given permissions.
 */
export function canAny(
  authz: UserAuthzContext,
  codenames: string[],
  context?: AuthzResourceContext,
): boolean {
  return codenames.some((c) => can(authz, c, context));
}

/**
 * Checks that the user has ALL of the given permissions.
 */
export function canAll(
  authz: UserAuthzContext,
  codenames: string[],
  context?: AuthzResourceContext,
): boolean {
  return codenames.every((c) => can(authz, c, context));
}

/**
 * Checks if the user is a department head for the given department.
 */
export function isDepartmentHead(
  authz: UserAuthzContext,
  departmentId: string,
): boolean {
  return authz.headOfDepartmentIds.has(departmentId);
}
