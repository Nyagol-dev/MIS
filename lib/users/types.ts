/**
 * lib/users/types.ts
 *
 * Shared TypeScript types for the user management layer (lib/users/users.ts).
 *
 * Placement rationale:
 *  - No UserRow or NotFoundError type exists in lib/entities or lib/auth/permissions.ts.
 *  - lib/auth/permissions.ts defines ForbiddenError (code = 'FORBIDDEN') for auth errors.
 *  - lib/entities/records.ts defines EntityValidationError (code = 'ENTITY_VALIDATION_ERROR')
 *    for payload errors.
 *  - This file adds the user-specific shapes without duplicating or conflating those conventions.
 */

// ─── Database row type ────────────────────────────────────────────────────────

/**
 * Represents a row from the `users` table.
 *
 * Composite PK: (tenant_id, id)
 *
 * password_hash semantics:
 *   NULL  → no password set; user authenticates via SSO only (the "SSO-first" invariant).
 *   Non-null string → bcrypt/argon2 hash set for password-based auth.
 *   NEVER store an empty string or placeholder — use NULL exclusively.
 */
export interface UserRow {
  tenant_id: string;
  id: string;
  email: string;
  /** Column name in schema is `display_name`. Aliased here for clarity. */
  display_name: string;
  /** NULL = no password set (SSO-only). See password_hash semantics above. */
  password_hash: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// ─── Function parameter types ─────────────────────────────────────────────────

export interface InviteUserParams {
  email: string;
  /** Maps to `display_name` in the database. */
  fullName: string;
  /** Optional list of role UUIDs to assign immediately after user creation. */
  roleIds?: string[];
}

export interface UpdateUserProfileParams {
  fullName?: string;
  email?: string;
}

export interface ListUsersFilters {
  isActive?: boolean;
}

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * Returned (not thrown) by getUser when the requested user does not exist.
 *
 * Convention: functions that have an "expected" not-found outcome return this
 * typed object rather than throwing a raw Error, so callers can discriminate
 * without try/catch overhead. Matches the `code`-property pattern established
 * by ForbiddenError (lib/auth/permissions.ts) and EntityValidationError
 * (lib/entities/records.ts).
 */
export interface NotFoundError {
  code: "NOT_FOUND";
  message: string;
}

// ─── Discriminated union return types ────────────────────────────────────────

/** Return type for getUser — either a row or a typed not-found sentinel. */
export type UserResult = UserRow | NotFoundError;

// ─── Type guard ───────────────────────────────────────────────────────────────

/** Narrows a UserResult to NotFoundError. */
export function isNotFound(result: UserResult): result is NotFoundError {
  return (result as NotFoundError).code === "NOT_FOUND";
}
