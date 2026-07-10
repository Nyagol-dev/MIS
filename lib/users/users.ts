/**
 * lib/users/users.ts
 *
 * CRUD layer for the `users` table — Task 5.1 (Round 5, User Management).
 *
 * DESIGN CONTRACTS
 * ────────────────────────────────────────────────────────────────────────────
 * • All functions accept a PoolClient obtained externally via withTenantContext.
 *   They do NOT open their own connections or transactions. The caller owns the
 *   transaction lifecycle (BEGIN / COMMIT / ROLLBACK).
 *
 * • password_hash is always NULL for new users ("SSO-first" invariant).
 *   NULL means "no password set yet", never an empty string or placeholder.
 *
 * • Errors for EXPECTED failure modes (e.g. user not found) are returned as
 *   typed objects with a `code` property — never thrown as raw Errors.
 *   This matches the `code`-property pattern from ForbiddenError and
 *   EntityValidationError elsewhere in the codebase.
 *
 * • writeAuditLog is called on the SAME client, inside the SAME transaction,
 *   immediately after every mutation query — before the function returns.
 *
 * • dispatchEntityEvent is NOT called here. User mutations are not
 *   entity_records; the event dispatcher is out of scope for this round.
 *
 * OUT OF SCOPE (this file)
 * ────────────────────────────────────────────────────────────────────────────
 * • Authorization guards — Task 5.2 (follow-up). Assume the caller is already
 *   authorized before invoking these functions.
 * • Route handlers — lib functions only.
 * • Real email delivery — stubbed with a console.log.
 * • Pagination for listUsers — flagged as TODO below.
 */

import type { PoolClient } from "pg";
import { writeAuditLog } from "@/lib/db/audit";
import type {
  UserRow,
  InviteUserParams,
  UpdateUserProfileParams,
  ListUsersFilters,
  UserResult,
  NotFoundError,
} from "./types";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Computes which scalar fields changed between two user snapshots and returns
 * them as a plain object diff keyed by field name.
 *
 * This is a local equivalent of computeChangedFields in lib/events/utils.ts.
 * That utility is tightly coupled to the ChangedField / MutationEvent types in
 * lib/events — importing it here would introduce an unnecessary dependency on
 * the event subsystem for a layer that explicitly does NOT dispatch entity
 * events. The logic is trivial and duplicating it is the correct boundary call.
 *
 * Returns undefined (no diff) if oldState equals newState.
 */
function buildUserDiff(
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
 * Serialises a UserRow to a plain object suitable for audit log snapshots.
 * Excludes password_hash — never log credential material.
 */
function toAuditSnapshot(
  user: UserRow
): Record<string, unknown> {
  const { password_hash: _omitted, ...safe } = user;
  return safe as Record<string, unknown>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Invites a new user by creating a row in the `users` table with
 * password_hash = NULL (SSO-first invariant).
 *
 * Role assignment:
 *   If `params.roleIds` is provided and non-empty, each role is inserted into
 *   `user_roles` within the same transaction. If a role UUID does not exist in
 *   the tenant's roles table, the FK constraint will cause the transaction to
 *   fail — this is intentional; callers should validate role IDs upstream.
 *
 * Email delivery:
 *   No real email is sent. A console.log stub is emitted so the call site can
 *   be grepped when real delivery is wired in.
 *
 * @param client   - PoolClient from withTenantContext (caller owns transaction).
 * @param tenantId - The tenant UUID.
 * @param params   - { email, fullName, roleIds? }
 * @returns The newly created UserRow.
 */
export async function inviteUser(
  client: PoolClient,
  tenantId: string,
  params: InviteUserParams
): Promise<UserRow> {
  const { email, fullName, roleIds } = params;

  // 1. Insert the user row. password_hash is explicitly omitted from the
  //    INSERT so Postgres writes NULL (the column default). Passing NULL
  //    explicitly would also be correct; omitting is self-documenting.
  const { rows } = await client.query<UserRow>(
    `INSERT INTO users (tenant_id, email, display_name)
     VALUES ($1, $2, $3)
     RETURNING tenant_id,
               id,
               email,
               display_name,
               password_hash,
               is_active,
               metadata,
               created_at,
               updated_at`,
    [tenantId, email, fullName]
  );

  const user = rows[0];

  // 2. Optionally assign roles — within the same transaction.
  if (roleIds && roleIds.length > 0) {
    for (const roleId of roleIds) {
      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [tenantId, user.id, roleId]
      );
    }
  }

  // 3. Audit — same client, same transaction.
  await writeAuditLog(client, {
    tenantId,
    actorId: null, // no actor context at this layer; wire in actorId when auth is added (Task 5.2)
    action: "user.invited",
    entityType: "user",
    entityId: user.id,
    oldState: null,
    newState: toAuditSnapshot(user),
    context: {
      email,
      roleIds: roleIds ?? [],
    },
  });

  // 4. Stub email notification — replace with real delivery in a later task.
  // [stub] Real invite email would be sent here via the email service.
  console.log(`[stub] invite email would be sent to ${email}`);

  return user;
}

/**
 * Deactivates a user by setting is_active = FALSE.
 *
 * The row is NOT deleted. Deactivated users are excluded from active
 * operations but retained for audit history and referential integrity.
 *
 * @param client      - PoolClient from withTenantContext.
 * @param tenantId    - The tenant UUID.
 * @param userId      - UUID of the user to deactivate.
 * @param actorUserId - UUID of the user performing the deactivation (for audit).
 */
export async function deactivateUser(
  client: PoolClient,
  tenantId: string,
  userId: string,
  actorUserId: string
): Promise<void> {
  // 1. Capture the pre-mutation state for the audit diff.
  const existing = await fetchUserRow(client, tenantId, userId);

  // 2. Update is_active — parameterised, no string interpolation.
  await client.query(
    `UPDATE users
        SET is_active  = FALSE,
            updated_at = now()
      WHERE tenant_id = $1
        AND id        = $2`,
    [tenantId, userId]
  );

  // 3. Audit — same client, same transaction.
  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "user.deactivated",
    entityType: "user",
    entityId: userId,
    oldState: existing ? toAuditSnapshot(existing) : null,
    newState: existing
      ? toAuditSnapshot({ ...existing, is_active: false })
      : null,
    context: {
      actorUserId,
    },
  });
}

/**
 * Updates a user's profile fields (fullName and/or email).
 *
 * Only the provided fields are written — omitted fields are left untouched.
 * At least one field must be provided; if neither is given the function is a
 * no-op (no query is issued, no audit row is written).
 *
 * @param client   - PoolClient from withTenantContext.
 * @param tenantId - The tenant UUID.
 * @param userId   - UUID of the user to update.
 * @param params   - Partial<{ fullName, email }>
 * @returns The updated UserRow, or undefined if no fields were provided.
 */
export async function updateUserProfile(
  client: PoolClient,
  tenantId: string,
  userId: string,
  params: UpdateUserProfileParams
): Promise<UserRow | undefined> {
  const { fullName, email } = params;

  // Build the SET clause dynamically — only include provided fields.
  // Uses an explicit allow-list of column names; no user input is ever
  // interpolated as a SQL identifier.
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (fullName !== undefined) {
    setClauses.push(`display_name = $${paramIndex++}`);
    values.push(fullName);
  }
  if (email !== undefined) {
    setClauses.push(`email = $${paramIndex++}`);
    values.push(email);
  }

  // No-op if nothing was provided.
  if (setClauses.length === 0) {
    return undefined;
  }

  // Always bump updated_at.
  setClauses.push("updated_at = now()");

  // Append the WHERE parameters.
  values.push(tenantId); // $N
  values.push(userId);   // $N+1

  const tenantParam = paramIndex;
  const userParam = paramIndex + 1;

  // 1. Capture pre-mutation state for the diff.
  const existing = await fetchUserRow(client, tenantId, userId);

  // 2. Issue the UPDATE.
  const { rows } = await client.query<UserRow>(
    `UPDATE users
        SET ${setClauses.join(", ")}
      WHERE tenant_id = $${tenantParam}
        AND id        = $${userParam}
      RETURNING tenant_id,
                id,
                email,
                display_name,
                password_hash,
                is_active,
                metadata,
                created_at,
                updated_at`,
    values
  );

  const updated = rows[0];
  if (!updated) {
    // Row did not exist or RLS filtered it out — treat as no-op; the
    // caller's auth layer should have validated the user exists first.
    return undefined;
  }

  // 3. Compute the diff of only the changed fields.
  const oldSnapshot = existing ? toAuditSnapshot(existing) : {};
  const newSnapshot = toAuditSnapshot(updated);
  const diff = buildUserDiff(oldSnapshot, newSnapshot);

  // 4. Audit — same client, same transaction.
  await writeAuditLog(client, {
    tenantId,
    actorId: null, // wire in actorId when auth layer is added (Task 5.2)
    action: "user.updated",
    entityType: "user",
    entityId: userId,
    oldState: existing ? toAuditSnapshot(existing) : null,
    newState: newSnapshot,
    context: {
      diff: diff ?? {},
    },
  });

  return updated;
}

/**
 * Lists users in a tenant, optionally filtered by active status.
 *
 * Returns both active and inactive users by default.
 *
 * @param client     - PoolClient from withTenantContext.
 * @param tenantId   - The tenant UUID.
 * @param filters    - Optional { isActive?: boolean }
 * @param pagination - Optional { limit?: number; offset?: number }
 * @returns Paginated result or VALIDATION_ERROR.
 */
export async function listUsers(
  client: PoolClient,
  tenantId: string,
  filters?: ListUsersFilters,
  pagination?: { limit?: number; offset?: number }
): Promise<
  | { items: UserRow[]; total: number; limit: number; offset: number }
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

  // Build the WHERE clause. The only dynamic predicate is is_active, which is
  // a boolean column — safe to compare to a bind parameter.
  const conditions: string[] = ["tenant_id = $1"];
  const values: unknown[] = [tenantId];

  if (filters?.isActive !== undefined) {
    conditions.push(`is_active = $${values.length + 1}`);
    values.push(filters.isActive);
  }

  // 1. COUNT(*) query over the same WHERE clause
  const countResult = await client.query<{ count: string }>(
    `SELECT count(*) FROM users WHERE ${conditions.join(" AND ")}`,
    values
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // 2. Fetch paginated rows
  const queryValues = [...values, finalLimit, offsetVal];
  const limitParam = values.length + 1;
  const offsetParam = values.length + 2;

  const { rows } = await client.query<UserRow>(
    `SELECT tenant_id,
            id,
            email,
            display_name,
            password_hash,
            is_active,
            metadata,
            created_at,
            updated_at
       FROM users
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at ASC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    queryValues
  );

  return {
    items: rows,
    total,
    limit: finalLimit,
    offset: offsetVal,
  };
}

/**
 * Retrieves a single user by (tenantId, userId).
 *
 * Returns a typed NotFoundError object — does NOT throw a raw Error — when
 * the user does not exist or is outside the tenant's RLS scope. This allows
 * callers to discriminate between "not found" and unexpected errors with a
 * simple `isNotFound()` type guard rather than try/catch.
 *
 * @param client   - PoolClient from withTenantContext.
 * @param tenantId - The tenant UUID.
 * @param userId   - UUID of the user to retrieve.
 * @returns UserRow on success, NotFoundError if the user does not exist.
 */
export async function getUser(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<UserResult> {
  const user = await fetchUserRow(client, tenantId, userId);

  if (!user) {
    return {
      code: "NOT_FOUND",
      message: `User '${userId}' not found in tenant '${tenantId}'.`,
    } satisfies NotFoundError;
  }

  return user;
}

// ─── Private query helper ────────────────────────────────────────────────────

/**
 * Fetches a single user row or returns undefined if not found.
 * Shared by getUser, deactivateUser, and updateUserProfile.
 *
 * Internal only — callers must own the transaction context.
 */
async function fetchUserRow(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<UserRow | undefined> {
  const { rows } = await client.query<UserRow>(
    `SELECT tenant_id,
            id,
            email,
            display_name,
            password_hash,
            is_active,
            metadata,
            created_at,
            updated_at
       FROM users
      WHERE tenant_id = $1
        AND id        = $2`,
    [tenantId, userId]
  );
  return rows[0];
}
