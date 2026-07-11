import type { PoolClient } from "pg";
import { ForbiddenError } from "./permissions";
import type { SessionPayload } from "./session";

export type BillingPermission = 
  | "billing:manage"
  | "billing:read"
  | "billing:create"
  | "billing:update"
  | "billing:delete";

/**
 * Checks that the session user holds the required billing permission before
 * allowing the operation.
 *
 * Must be called from within a `withTenantContext` callback.
 */
export async function requireBillingPermission(
  client: PoolClient,
  session: SessionPayload,
  requiredPermission: BillingPermission
): Promise<ForbiddenError | undefined> {
  const { rows } = await client.query<{ codename: string }>(
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
    [session.tenantId, session.userId]
  );

  const codenames = new Set(rows.map((r) => r.codename));

  if (!codenames.has(requiredPermission) && !codenames.has("billing:manage")) {
    return new ForbiddenError(
      `Permission denied: '${requiredPermission}' or 'billing:manage' is required for this operation.`,
      requiredPermission
    );
  }

  return undefined;
}
