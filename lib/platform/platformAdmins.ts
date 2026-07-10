/**
 * lib/platform/platformAdmins.ts
 *
 * Platform-admin CRUD operations for the `platform_admins` table.
 *
 * ARCHITECTURAL NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 * • Every exported function is entry-point style: it accepts a verified
 *   AnySessionPayload, calls requirePlatformAdminSession(session) first,
 *   then getPlatformAdminPool(session) to obtain { pool, platformAdminId }.
 *
 * • The pool is the mis_admin pool (_adminPoolInternal). No SET LOCAL
 *   app.current_tenant_id is ever issued. Platform-admin operations have no
 *   tenant context.
 *
 * • password_hash is always NULL for new platform admins (SSO-first invariant,
 *   matching the same rule applied to tenant users in lib/users/users.ts).
 *
 * • Errors for EXPECTED failure modes are returned as typed objects with a
 *   `code` property — never thrown as raw Errors.
 *
 * • writePlatformAuditLog is called on the SAME client, inside the SAME
 *   transaction, before COMMIT.
 *
 * SCHEMA REFERENCE (db/migrations/round6_platform_admin_layer.sql)
 * ─────────────────────────────────────────────────────────────────────────────
 * CREATE TABLE platform_admins (
 *     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     email         TEXT NOT NULL UNIQUE,
 *     display_name  TEXT NOT NULL,
 *     password_hash TEXT,               -- NULL for SSO-only platform admins
 *     is_active     BOOLEAN NOT NULL DEFAULT TRUE,
 *     created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
 * );
 */

import { requirePlatformAdminSession } from "@/lib/auth/platformAdmin";
import { getPlatformAdminPool, ForbiddenError } from "@/lib/auth/permissions";
import { writePlatformAuditLog } from "@/lib/db/audit";
import type { AnySessionPayload } from "@/lib/auth/session";

// ─── Row type ────────────────────────────────────────────────────────────────

export interface PlatformAdminRow {
  id: string;
  email: string;
  display_name: string;
  /** Always null — password_hash is excluded from SELECT; callers must never log it. */
  password_hash: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Safe projection of PlatformAdminRow — excludes password_hash.
 * Use this type for all return values that leave this module.
 */
export type SafePlatformAdminRow = Omit<PlatformAdminRow, "password_hash">;

// ─── Typed errors ─────────────────────────────────────────────────────────────

export interface EmailCollisionError {
  code: "EMAIL_COLLISION";
  message: string;
  email: string;
}

export interface CannotDeactivateSelfError {
  code: "CANNOT_DEACTIVATE_SELF";
  message: string;
}

export interface PlatformAdminNotFoundError {
  code: "PLATFORM_ADMIN_NOT_FOUND";
  message: string;
  platformAdminId: string;
}

export type CreatePlatformAdminResult = SafePlatformAdminRow | EmailCollisionError;
export type DeactivatePlatformAdminResult =
  | void
  | CannotDeactivateSelfError
  | PlatformAdminNotFoundError;

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isEmailCollisionError(v: unknown): v is EmailCollisionError {
  return (
    typeof v === "object" && v !== null && (v as EmailCollisionError).code === "EMAIL_COLLISION"
  );
}

export function isCannotDeactivateSelfError(
  v: unknown
): v is CannotDeactivateSelfError {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as CannotDeactivateSelfError).code === "CANNOT_DEACTIVATE_SELF"
  );
}

export function isPlatformAdminNotFoundError(
  v: unknown
): v is PlatformAdminNotFoundError {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as PlatformAdminNotFoundError).code === "PLATFORM_ADMIN_NOT_FOUND"
  );
}

// ─── Postgres error code constants ───────────────────────────────────────────

/** Postgres error code for unique constraint violations. */
const PG_UNIQUE_VIOLATION = "23505";

// ─── Internal helper ─────────────────────────────────────────────────────────

/**
 * Strips password_hash from a raw PlatformAdminRow to produce a SafePlatformAdminRow.
 * Credential material must never leave this module.
 */
function toSafeRow(row: PlatformAdminRow): SafePlatformAdminRow {
  const { password_hash: _omitted, ...safe } = row;
  return safe;
}

// ─── createPlatformAdmin ──────────────────────────────────────────────────────

export interface CreatePlatformAdminParams {
  email: string;
  displayName: string;
}

/**
 * Creates a new platform_admins row.
 *
 * password_hash is explicitly omitted from the INSERT so Postgres writes NULL
 * (the SSO-first invariant, identical to how tenant users are created in
 * lib/users/users.ts). The platform admin must authenticate via SSO until
 * a password is explicitly set through a separate, audited flow.
 *
 * Audit log written on the same client within the same transaction.
 *
 * @param session - A verified AnySessionPayload (must be platform_admin kind).
 * @param params  - { email, displayName }
 * @returns SafePlatformAdminRow on success, or EmailCollisionError if the
 *          email is already registered to another platform admin.
 * @throws {ForbiddenError} If the session is not a platform_admin session, or
 *                          the admin is inactive in the database.
 */
export async function createPlatformAdmin(
  session: AnySessionPayload,
  params: CreatePlatformAdminParams
): Promise<CreatePlatformAdminResult> {
  // ── Step 1: authorization ─────────────────────────────────────────────────
  requirePlatformAdminSession(session);
  const { pool, platformAdminId } = await getPlatformAdminPool(session);

  const { email, displayName } = params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Step 2: insert platform_admins row ────────────────────────────────────
    // password_hash is intentionally absent from the column list — Postgres
    // writes NULL via the column default, preserving the SSO-first invariant.
    let row: PlatformAdminRow;
    try {
      const { rows } = await client.query<PlatformAdminRow>(
        `INSERT INTO platform_admins (email, display_name)
         VALUES ($1, $2)
         RETURNING id,
                   email,
                   display_name,
                   password_hash,
                   is_active,
                   created_at,
                   updated_at`,
        [email, displayName]
      );
      row = rows[0];
    } catch (err: unknown) {
      await client.query("ROLLBACK");
      // Map the unique constraint violation on platform_admins.email to a typed error.
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        return {
          code: "EMAIL_COLLISION",
          message: `A platform admin with email '${email}' already exists.`,
          email,
        } satisfies EmailCollisionError;
      }
      // Any other database error is unexpected — re-throw.
      throw err;
    }

    // ── Step 3: audit log — same client, same transaction ────────────────────
    await writePlatformAuditLog(client, {
      platformAdminId,
      action: "platform_admin.created",
      entityType: "platform_admin",
      entityId: row.id,
      oldState: null,
      newState: {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        is_active: row.is_active,
      },
      context: {
        created_by: platformAdminId,
      },
    });

    await client.query("COMMIT");
    return toSafeRow(row);
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

// ─── deactivatePlatformAdmin ──────────────────────────────────────────────────

/**
 * Deactivates a platform admin by setting is_active = FALSE.
 *
 * The row is NOT deleted. Deactivated admins are excluded from future
 * operations but retained for audit history.
 *
 * SELF-DEACTIVATION GUARD: A platform admin cannot deactivate their own
 * account. This prevents accidental lockout and ensures at least one active
 * platform admin always exists after any deactivation. Returns a typed
 * CannotDeactivateSelfError rather than allowing it silently.
 *
 * @param session         - A verified AnySessionPayload (must be platform_admin kind).
 * @param platformAdminId - UUID of the platform admin to deactivate.
 * @returns void on success, CannotDeactivateSelfError if the caller is
 *          attempting to deactivate their own account, or
 *          PlatformAdminNotFoundError if the target does not exist.
 * @throws {ForbiddenError} If the session is not a platform_admin session, or
 *                          the session admin is inactive in the database.
 */
export async function deactivatePlatformAdmin(
  session: AnySessionPayload,
  platformAdminId: string
): Promise<DeactivatePlatformAdminResult> {
  // ── Step 1: authorization ─────────────────────────────────────────────────
  requirePlatformAdminSession(session);
  const { pool, platformAdminId: actorId } = await getPlatformAdminPool(session);

  // ── Step 2: self-deactivation guard ──────────────────────────────────────
  if (platformAdminId === actorId) {
    return {
      code: "CANNOT_DEACTIVATE_SELF",
      message:
        "A platform admin cannot deactivate their own account. " +
        "Have another platform admin perform this action.",
    } satisfies CannotDeactivateSelfError;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Step 3: UPDATE is_active — parameterized, no interpolation ────────────
    const { rowCount } = await client.query(
      `UPDATE platform_admins
          SET is_active  = FALSE,
              updated_at = now()
        WHERE id = $1`,
      [platformAdminId]
    );

    if (!rowCount || rowCount === 0) {
      await client.query("ROLLBACK");
      return {
        code: "PLATFORM_ADMIN_NOT_FOUND",
        message: `Platform admin '${platformAdminId}' not found.`,
        platformAdminId,
      } satisfies PlatformAdminNotFoundError;
    }

    // ── Step 4: audit log — same client, same transaction ────────────────────
    await writePlatformAuditLog(client, {
      platformAdminId: actorId,
      action: "platform_admin.deactivated",
      entityType: "platform_admin",
      entityId: platformAdminId,
      context: {
        deactivated_admin_id: platformAdminId,
        deactivated_by: actorId,
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

// ─── listPlatformAdmins ───────────────────────────────────────────────────────

/**
 * Returns all platform_admins rows.
 *
 * password_hash is excluded from the SELECT — credential material must never
 * leave the data layer. All other columns are returned, including inactive
 * rows, so the caller can display the full roster.
 *
 * No RLS filtering applies — this pool connects as mis_admin which bypasses
 * RLS. platform_admins has no RLS policies (access control is entirely via
 * database pool/role selection per the Round 6 migration).
 *
 * @param session - A verified AnySessionPayload (must be platform_admin kind).
 * @returns Array of SafePlatformAdminRow (may be empty).
 * @throws {ForbiddenError} If the session is not a platform_admin session, or
 *                          the admin is inactive in the database.
 */
export async function listPlatformAdmins(
  session: AnySessionPayload
): Promise<SafePlatformAdminRow[]> {
  // ── Step 1: authorization ─────────────────────────────────────────────────
  requirePlatformAdminSession(session);
  const { pool } = await getPlatformAdminPool(session);

  // ── Step 2: SELECT — password_hash excluded; read-only, no transaction ────
  const { rows } = await pool.query<SafePlatformAdminRow>(
    `SELECT id,
            email,
            display_name,
            is_active,
            created_at,
            updated_at
       FROM platform_admins
      ORDER BY created_at ASC`
  );

  return rows;
}
