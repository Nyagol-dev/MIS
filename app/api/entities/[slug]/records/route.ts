/**
 * app/api/entities/[slug]/records/route.ts
 *
 * GET  /api/entities/[slug]/records — Paginated list of records for an entity type.
 * POST /api/entities/[slug]/records — Create a new record for an entity type.
 *
 * AUTH: Tenant session required.
 *   GET  — requires 'read'   action grant on the entity type (canOnEntityType).
 *   POST — requires 'create' action grant on the entity type (canOnEntityType).
 *
 * IDOR GUARD (Round 5 precedent)
 * ─────────────────────────────────────────────────────────────────────────────
 * The [slug] parameter is resolved to an entityTypeId via a query that
 * explicitly scopes to `tenant_id = session.tenantId`. If the slug exists
 * for a different tenant the query returns no rows and we return 404, giving
 * no cross-tenant information leakage. This is the same IDOR pattern used in
 * all prior rounds: verify that referenced resources belong to the current
 * tenant, not just that they exist.
 *
 * SCHEMA VERSIONING (create path, §5.4)
 * ─────────────────────────────────────────────────────────────────────────────
 * On POST the lib function createEntityRecord loads field_definitions at the
 * entity type's CURRENT schema_version and validates the submitted data against
 * those fields before inserting. The route does NOT re-implement this logic —
 * it delegates entirely to createEntityRecord.
 *
 * PAGINATION CONTRACT
 * ─────────────────────────────────────────────────────────────────────────────
 * Response shape: { items, total, limit, offset }
 *   - Default limit: 50, max: 200 (enforced by listEntityRecords).
 *   - Query params:  ?limit=<n>&offset=<n>
 *
 * The `total` count is resolved via a scoped COUNT query inside withTenantContext
 * (separate from listEntityRecords which manages its own transaction). This is
 * intentional — listEntityRecords wraps its own withTenantContext; running a
 * count inside that internal context would require changing the lib signature.
 *
 * STATUS CODES
 *   200 — GET success
 *   201 — POST success (record created)
 *   400 — Malformed request body or pagination params
 *   401 — No valid session
 *   403 — Session lacks action grant on this entity type
 *   404 — Entity type slug not found in this tenant
 *   422 — Entity record validation error (field errors returned as array)
 *   500 — Unexpected server error
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { withTenantContext } from "@/lib/db/withTenant";
import {
  createEntityRecord,
  listEntityRecords,
  EntityValidationError,
} from "@/lib/entities/records";
import { ForbiddenError } from "@/lib/auth/permissions";

// ─── Route param type ─────────────────────────────────────────────────────────

type SlugParams = { params: Promise<{ slug: string }> };

// ─── Shared error handler ─────────────────────────────────────────────────────

function handleError(error: unknown): NextResponse {
  // EntityValidationError — field-level validation failure from the lib.
  if (error instanceof EntityValidationError) {
    return NextResponse.json(
      {
        error: "Entity record validation failed.",
        code: "ENTITY_VALIDATION_ERROR",
        fields: error.errors,
      },
      { status: 422 }
    );
  }

  // ForbiddenError — thrown by requireEntityAccess inside the lib functions.
  if (error instanceof ForbiddenError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 403 }
    );
  }

  // Typed-error objects returned by lib functions (code / message shape).
  if (typeof error === "object" && error !== null && "code" in error) {
    const typed = error as { code: string; message: string };
    const status =
      typed.code === "NOT_FOUND"
        ? 404
        : typed.code === "CONFLICT"
        ? 409
        : typed.code === "VALIDATION_ERROR"
        ? 400
        : typed.code === "FORBIDDEN" ||
          typed.code === "ForbiddenError" ||
          typed.code === "FORBIDDEN_SYSTEM_ROLE"
        ? 403
        : 500;
    return NextResponse.json({ error: typed.message }, { status });
  }

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return NextResponse.json({ error: message }, { status: 500 });
}

// ─── Slug → entityTypeId resolution (with tenant IDOR guard) ─────────────────

/**
 * Resolves the entity type slug to an entityTypeId, explicitly scoping the
 * query to the session's tenantId.
 *
 * This is the standing IDOR check: a slug that belongs to a different tenant
 * returns null (NOT_FOUND) rather than leaking the cross-tenant ID.
 *
 * Must be called from within a withTenantContext callback. The RLS context
 * set by withTenantContext PLUS the explicit tenant_id = $1 WHERE clause
 * provide defense-in-depth.
 */
async function resolveEntityTypeId(
  tenantId: string,
  slug: string
): Promise<string | null> {
  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id
         FROM entity_types
        WHERE tenant_id = $1
          AND slug      = $2
          AND is_active = TRUE`,
      [tenantId, slug]
    );
    return rows[0]?.id ?? null;
  });
}

// ─── GET /api/entities/[slug]/records ─────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: SlugParams
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const searchParams = request.nextUrl.searchParams;

    // ── Parse pagination params ──────────────────────────────────────────────
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    let limit: number | undefined;
    let offset: number | undefined;

    if (limitParam !== null) {
      limit = parseInt(limitParam, 10);
      if (Number.isNaN(limit) || limit < 1) {
        return NextResponse.json(
          { error: "'limit' must be a positive integer." },
          { status: 400 }
        );
      }
    }
    if (offsetParam !== null) {
      offset = parseInt(offsetParam, 10);
      if (Number.isNaN(offset) || offset < 0) {
        return NextResponse.json(
          { error: "'offset' must be a non-negative integer." },
          { status: 400 }
        );
      }
    }

    // Clamp to the same defaults/max the lib enforces so the response
    // envelope reflects the actual values used.
    const resolvedLimit = Math.min(limit ?? 50, 200);
    const resolvedOffset = offset ?? 0;

    // ── IDOR: resolve slug → entityTypeId, scoped to this tenant ────────────
    const entityTypeId = await resolveEntityTypeId(session.tenantId, slug);
    if (!entityTypeId) {
      return NextResponse.json(
        { error: `Entity type '${slug}' not found.` },
        { status: 404 }
      );
    }

    // ── Fetch total count (same tenant + entityTypeId scope) ─────────────────
    // listEntityRecords manages its own withTenantContext, so the count query
    // runs in a separate (but equivalent) transaction to get the pagination total.
    const total = await withTenantContext(session.tenantId, async (client) => {
      const { rows } = await client.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
           FROM entity_records
          WHERE tenant_id      = $1
            AND entity_type_id = $2`,
        [session.tenantId, entityTypeId]
      );
      return parseInt(rows[0]?.total ?? "0", 10);
    });

    // ── List records — permission check (read) is inside listEntityRecords ───
    // listEntityRecords calls requireEntityAccess(session, entityTypeId, 'read')
    // which throws ForbiddenError on denial.
    const items = await listEntityRecords(session, entityTypeId, {
      limit: resolvedLimit,
      offset: resolvedOffset,
    });

    return NextResponse.json(
      { items, total, limit: resolvedLimit, offset: resolvedOffset },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  }
}

// ─── POST /api/entities/[slug]/records ────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: SlugParams
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    // ── Parse and validate request body ─────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object." },
        { status: 400 }
      );
    }

    const data = body as Record<string, unknown>;

    // ── IDOR: resolve slug → entityTypeId, scoped to this tenant ────────────
    const entityTypeId = await resolveEntityTypeId(session.tenantId, slug);
    if (!entityTypeId) {
      return NextResponse.json(
        { error: `Entity type '${slug}' not found.` },
        { status: 404 }
      );
    }

    // ── Create — field_definitions loaded at CURRENT schema_version, ─────────
    // validated, and inserted by createEntityRecord. Permission check (create)
    // is inside the lib via requireEntityAccess.
    // createEntityRecord throws:
    //   • ForbiddenError        → HTTP 403 (caught by handleError)
    //   • EntityValidationError → HTTP 422 (caught by handleError)
    //   • Error                 → HTTP 500 (entity type not found/inactive)
    const record = await createEntityRecord(session, entityTypeId, data);

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
