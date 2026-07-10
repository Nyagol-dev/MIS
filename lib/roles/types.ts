/**
 * lib/roles/types.ts
 *
 * Shared TypeScript types for the roles management layer (lib/roles/roles.ts).
 */

export interface RoleRow {
  tenant_id: string;
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateRoleParams {
  name: string;
  description?: string;
}

export interface UpdateRoleParams {
  name?: string;
  description?: string | null;
}

export interface ForbiddenSystemRoleError {
  code: "FORBIDDEN_SYSTEM_ROLE";
  message: string;
}

export interface RoleInUseError {
  code: "ROLE_IN_USE";
  message: string;
}

export interface NotFoundError {
  code: "NOT_FOUND";
  message: string;
}

export type RoleResult = RoleRow | NotFoundError;
export type UpdateRoleResult = RoleRow | ForbiddenSystemRoleError | NotFoundError;
export type DeleteRoleResult = undefined | ForbiddenSystemRoleError | RoleInUseError | NotFoundError;

export function isNotFound(result: unknown): result is NotFoundError {
  return (result as NotFoundError)?.code === "NOT_FOUND";
}

export function isForbiddenSystemRole(result: unknown): result is ForbiddenSystemRoleError {
  return (result as ForbiddenSystemRoleError)?.code === "FORBIDDEN_SYSTEM_ROLE";
}

export function isRoleInUse(result: unknown): result is RoleInUseError {
  return (result as RoleInUseError)?.code === "ROLE_IN_USE";
}
