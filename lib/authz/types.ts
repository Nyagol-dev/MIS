/**
 * lib/authz/types.ts
 *
 * Shared types for the authz module. Kept in a separate file to enable
 * pure-function imports without pulling in DB dependencies (pool, pg).
 */

import type { PermissionScope } from './catalogue';

/**
 * Loaded authorization context for a user within a tenant.
 * Cached per request; loaded once at the start of a handler.
 */
export interface UserAuthzContext {
  tenantId: string;
  userId: string;
  /** Permission codename → granted scope */
  grants: ReadonlyMap<string, PermissionScope>;
  /** Department IDs the user belongs to */
  departmentIds: ReadonlySet<string>;
  /** Department IDs where the user is head or deputy head */
  headOfDepartmentIds: ReadonlySet<string>;
  /** Whether the user has the hospital_admin system role */
  isHospitalAdmin: boolean;
}

/**
 * Context for scope evaluation. Callers provide what they know
 * about the resource being accessed.
 */
export interface AuthzResourceContext {
  /** Department the resource belongs to */
  departmentId?: string;
  /** User who created/owns the resource */
  ownerId?: string;
  /** Patient ID (for care-team checks in Phase 2+) */
  patientId?: string;
}
