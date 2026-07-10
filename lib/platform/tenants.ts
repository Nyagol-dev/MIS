/**
 * lib/platform/tenants.ts
 *
 * Platform-admin CRUD operations for the `organizations` (tenants) table.
 *
 * ARCHITECTURAL NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 * • Every exported function is entry-point style: it accepts a verified
 *   AnySessionPayload, calls requirePlatformAdminSession(session) first,
 *   then getPlatformAdminPool(session) to obtain { pool, platformAdminId }.
 *
 * • NO SET LOCAL app.current_tenant_id is issued on any connection from this
 *   pool. Platform-admin operations run without a tenant context, against the
 *   mis_admin role which bypasses RLS entirely (blueprint Q5).
 *
 * • Errors for EXPECTED failure modes (e.g. slug collision) are returned as
 *   typed objects with a `code` property — never thrown as raw Errors.
 *
 * • writePlatformAuditLog is called on the SAME client, inside the SAME
 *   transaction, before COMMIT. Audit and mutation are atomic.
 *
 * SCHEMA REFERENCE (canonical_postgres_schema.md §2.1)
 * ─────────────────────────────────────────────────────────────────────────────
 * CREATE TABLE organizations (
 *     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     slug         TEXT NOT NULL UNIQUE,
 *     display_name TEXT NOT NULL,
 *     org_type     TEXT NOT NULL REFERENCES org_types(slug),
 *     metadata     JSONB NOT NULL DEFAULT '{}',
 *     is_active    BOOLEAN NOT NULL DEFAULT TRUE,    ← confirmed column name
 *     created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
 * );
 */

import { requirePlatformAdminSession } from "@/lib/auth/platformAdmin";
import { getPlatformAdminPool, ForbiddenError } from "@/lib/auth/permissions";
import { writePlatformAuditLog } from "@/lib/db/audit";
import type { AnySessionPayload } from "@/lib/auth/session";

// ─── Row type ────────────────────────────────────────────────────────────────

export interface OrganizationRow {
  id: string;
  slug: string;
  display_name: string;
  org_type: string;
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// ─── Typed errors ─────────────────────────────────────────────────────────────

export interface SlugCollisionError {
  code: "SLUG_COLLISION";
  message: string;
  slug: string;
}

export interface TenantNotFoundError {
  code: "TENANT_NOT_FOUND";
  message: string;
  tenantId: string;
}

export type CreateTenantResult = OrganizationRow | SlugCollisionError;
export type DeactivateTenantResult = void | TenantNotFoundError;

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isSlugCollisionError(v: unknown): v is SlugCollisionError {
  return (
    typeof v === "object" && v !== null && (v as SlugCollisionError).code === "SLUG_COLLISION"
  );
}

export function isTenantNotFoundError(v: unknown): v is TenantNotFoundError {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as TenantNotFoundError).code === "TENANT_NOT_FOUND"
  );
}

// ─── Postgres error code constants ───────────────────────────────────────────

/** Postgres error code for unique constraint violations. */
const PG_UNIQUE_VIOLATION = "23505";

// ─── createTenant ─────────────────────────────────────────────────────────────

export interface CreateTenantParams {
  slug: string;
  name: string;
  orgTypeId: string; // Corresponds to org_types.slug (the PK of org_types)
}

/**
 * Creates a new tenant (organization) row.
 *
 * Runs inside a transaction on the mis_admin pool (no SET LOCAL
 * app.current_tenant_id — per blueprint Q5, cross-tenant admin operations
 * must never set a tenant context on the mis_admin connection).
 *
 * Audit log written on the same client within the same transaction.
 *
 * @param session   - A verified AnySessionPayload (must be platform_admin kind).
 * @param params    - { slug, name, orgTypeId }
 * @returns The newly created OrganizationRow, or a SlugCollisionError if the
 *          slug is already taken.
 * @throws {ForbiddenError} If the session is not a platform_admin session, or
 *                          the admin is inactive in the database.
 */
export async function createTenant(
  session: AnySessionPayload,
  params: CreateTenantParams
): Promise<CreateTenantResult> {
  // ── Step 1: authorization ─────────────────────────────────────────────────
  requirePlatformAdminSession(session);
  const { pool, platformAdminId } = await getPlatformAdminPool(session);

  const { slug, name, orgTypeId } = params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Step 2: insert organization row ──────────────────────────────────────
    let row: OrganizationRow;
    try {
      const { rows } = await client.query<OrganizationRow>(
        `INSERT INTO organizations (slug, display_name, org_type)
         VALUES ($1, $2, $3)
         RETURNING id,
                   slug,
                   display_name,
                   org_type,
                   metadata,
                   is_active,
                   created_at,
                   updated_at`,
        [slug, name, orgTypeId]
      );
      row = rows[0];
    } catch (err: unknown) {
      await client.query("ROLLBACK");
      // Map the unique constraint violation on organizations.slug to a typed error.
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        return {
          code: "SLUG_COLLISION",
          message: `A tenant with slug '${slug}' already exists.`,
          slug,
        } satisfies SlugCollisionError;
      }
      // Any other database error is unexpected — re-throw.
      throw err;
    }

    // ── Step 3: audit log — same client, same transaction ────────────────────
    await writePlatformAuditLog(client, {
      platformAdminId,
      action: "tenant.created",
      entityType: "organization",
      entityId: row.id,
      oldState: null,
      newState: {
        id: row.id,
        slug: row.slug,
        display_name: row.display_name,
        org_type: row.org_type,
        is_active: row.is_active,
      },
      context: {
        slug,
        org_type: orgTypeId,
      },
    });

    await client.query("COMMIT");
    return row;
  } catch (err) {
    // Safety net: roll back if an unexpected error escaped the inner try.
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors — original error is what matters.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ─── deactivateTenant ─────────────────────────────────────────────────────────

/**
 * Deactivates a tenant by setting organizations.is_active = FALSE.
 *
 * The row is NOT deleted. Deactivated tenants are excluded from normal
 * operations but retained for audit history and referential integrity.
 *
 * Column name `is_active` is confirmed in canonical_postgres_schema.md §2.1.
 *
 * @param session  - A verified AnySessionPayload (must be platform_admin kind).
 * @param tenantId - UUID of the organization to deactivate.
 * @returns void on success, or a TenantNotFoundError if the tenant does not exist.
 * @throws {ForbiddenError} If the session is not a platform_admin session, or
 *                          the admin is inactive in the database.
 */
export async function deactivateTenant(
  session: AnySessionPayload,
  tenantId: string
): Promise<DeactivateTenantResult> {
  // ── Step 1: authorization ─────────────────────────────────────────────────
  requirePlatformAdminSession(session);
  const { pool, platformAdminId } = await getPlatformAdminPool(session);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Step 2: UPDATE is_active — parameterized, no interpolation ────────────
    const { rowCount } = await client.query(
      `UPDATE organizations
          SET is_active  = FALSE,
              updated_at = now()
        WHERE id = $1`,
      [tenantId]
    );

    if (!rowCount || rowCount === 0) {
      await client.query("ROLLBACK");
      return {
        code: "TENANT_NOT_FOUND",
        message: `Tenant '${tenantId}' not found.`,
        tenantId,
      } satisfies TenantNotFoundError;
    }

    // ── Step 3: audit log — same client, same transaction ────────────────────
    await writePlatformAuditLog(client, {
      platformAdminId,
      action: "tenant.deactivated",
      entityType: "organization",
      entityId: tenantId,
      context: {
        tenant_id: tenantId,
      },
    });

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ─── listTenants ──────────────────────────────────────────────────────────────

/**
 * Returns all organizations.
 *
 * No RLS filtering applies — this pool connects as mis_admin which bypasses
 * RLS. The function intentionally returns all rows, including inactive ones,
 * so the platform admin can see and manage all tenants.
 *
 * @param session - A verified AnySessionPayload (must be platform_admin kind).
 * @returns Array of OrganizationRow (may be empty).
 * @throws {ForbiddenError} If the session is not a platform_admin session, or
 *                          the admin is inactive in the database.
 */
export async function listTenants(
  session: AnySessionPayload
): Promise<OrganizationRow[]> {
  // ── Step 1: authorization ─────────────────────────────────────────────────
  requirePlatformAdminSession(session);
  const { pool } = await getPlatformAdminPool(session);

  // ── Step 2: SELECT — no transaction needed for a read-only query ──────────
  const { rows } = await pool.query<OrganizationRow>(
    `SELECT id,
            slug,
            display_name,
            org_type,
            metadata,
            is_active,
            created_at,
            updated_at
       FROM organizations
      ORDER BY created_at ASC`
  );

  return rows;
}
